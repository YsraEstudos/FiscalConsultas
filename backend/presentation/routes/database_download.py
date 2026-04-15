"""
Secure database download routes for offline search.

Provides:
- GET  /version  — Public metadata (version, size)
- POST /token    — One-time download token (rate limited)
- POST /download — Encrypted database blob (token required)
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.config.settings import settings
from backend.infrastructure.redis_client import redis_cache
from backend.server.rate_limit import SlidingWindowRateLimiter
from backend.utils.auth import extract_client_ip

logger = logging.getLogger("routes.database_download")

router = APIRouter()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(os.path.abspath(__file__)).parent.parent.parent.parent
DB_DIR = PROJECT_ROOT / "database"
ENCRYPTED_DB = DB_DIR / "fiscal_offline.enc"
META_FILE = DB_DIR / "fiscal_offline.meta"

# ---------------------------------------------------------------------------
# Rate limiting (strict: 3 tokens per hour per IP)
# ---------------------------------------------------------------------------
_token_rate_limiter = SlidingWindowRateLimiter(window_seconds=3600)
_TOKEN_LIMIT_PER_HOUR = 3

# ---------------------------------------------------------------------------
# Token management (in-memory fallback + Redis)
# ---------------------------------------------------------------------------
_TOKEN_TTL_SECONDS = 300  # 5 minutes
_REDIS_TOKEN_PREFIX = "dbtoken:"

# In-memory token store (fallback when Redis unavailable)
_memory_tokens: dict[str, tuple[float, str]] = {}  # jti -> (created_at, client_ip)
_MEMORY_TOKEN_MAX = 100


class DownloadDatabaseRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)


def _load_metadata() -> dict | None:
    """Load cached metadata from the .meta file."""
    if not META_FILE.exists():
        return None
    try:
        return json.loads(META_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read offline DB metadata: %s", exc)
        return None


def _generate_token_jti() -> str:
    return secrets.token_urlsafe(32)


def _is_local_request(request: Request) -> bool:
    forwarded_for = request.headers.get("x-forwarded-host", "")
    host_header = forwarded_for or request.headers.get("host", "")
    host = host_header.split(":", maxsplit=1)[0].strip().lower()
    client_host = (request.client.host if request.client else "").strip().lower()
    return host in {"127.0.0.1", "localhost"} or client_host in {
        "127.0.0.1",
        "::1",
        "localhost",
    }


def _resolve_request_scheme(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip()
    if forwarded_proto:
        return forwarded_proto.split(",", maxsplit=1)[0].strip().lower()
    return request.url.scheme.lower()


def _enforce_secure_request(request: Request) -> None:
    if settings.server.env.lower() != "production":
        return
    if _is_local_request(request):
        return
    if _resolve_request_scheme(request) == "https":
        return
    raise HTTPException(
        status_code=400,
        detail="Offline database download requires HTTPS in production",
    )


async def _store_token(jti: str, client_ip: str) -> None:
    """Store a one-time token (Redis preferred, memory fallback)."""
    if redis_cache.available and redis_cache._client is not None:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        try:
            await redis_cache._client.setex(key, _TOKEN_TTL_SECONDS, client_ip)
            return
        except Exception as exc:
            logger.debug("Redis token store failed, using memory: %s", exc)

    # Memory fallback
    now = time.monotonic()
    # Cleanup expired tokens
    expired = [k for k, (created, _) in _memory_tokens.items() if now - created > _TOKEN_TTL_SECONDS]
    for k in expired:
        del _memory_tokens[k]
    # Evict oldest if full
    if len(_memory_tokens) >= _MEMORY_TOKEN_MAX:
        oldest_key = min(_memory_tokens, key=lambda k: _memory_tokens[k][0])
        del _memory_tokens[oldest_key]

    _memory_tokens[jti] = (now, client_ip)


async def _consume_token(jti: str, client_ip: str) -> bool:
    """Verify and consume a one-time token. Returns True if valid."""
    if redis_cache.available and redis_cache._client is not None:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        try:
            stored_ip = await redis_cache._client.get(key)
            if stored_ip is not None:
                await redis_cache._client.delete(key)
                normalized_ip = (
                    stored_ip.decode("utf-8")
                    if isinstance(stored_ip, bytes)
                    else str(stored_ip)
                )
                return secrets.compare_digest(normalized_ip, client_ip)
            # Token not found in Redis, but may be in memory fallback
        except Exception as exc:
            logger.debug("Redis token consume failed: %s", exc)

    # Memory fallback
    now = time.monotonic()
    entry = _memory_tokens.pop(jti, None)
    if entry is None:
        return False
    created_at, stored_ip = entry
    if now - created_at > _TOKEN_TTL_SECONDS:
        return False  # Expired
    return secrets.compare_digest(stored_ip, client_ip)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/version")
async def get_database_version():
    """
    Return metadata about the available offline database.

    Public endpoint — no authentication required.
    """
    meta = _load_metadata()
    if meta is None:
        raise HTTPException(status_code=503, detail="Offline database not available")

    return {
        "version": meta.get("version"),
        "size_bytes": meta.get("size_bytes"),
        "sha256": meta.get("sha256"),
        "encrypted_sha256": meta.get("encrypted_sha256"),
        "updated_at": meta.get("built_at"),
        "built_at": meta.get("built_at"),
        "format_version": meta.get("format_version", 1),
        "chunk_size": meta.get("chunk_size", 65536),
        "pbkdf2_iterations": meta.get("pbkdf2_iterations", 600_000),
    }


@router.post("/token")
async def create_download_token(request: Request):
    """
    Generate a one-time download token.

    Rate limited to 3 per hour per IP to prevent abuse.
    The token expires after 5 minutes and can only be used once.
    """
    _enforce_secure_request(request)
    client_ip = extract_client_ip(request)
    limiter_key = f"db-download:ip:{client_ip}"

    allowed, retry_after = await _token_rate_limiter.consume(
        key=limiter_key, limit=_TOKEN_LIMIT_PER_HOUR
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for database download tokens. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    meta = _load_metadata()
    if meta is None:
        raise HTTPException(status_code=503, detail="Offline database not available")

    if not ENCRYPTED_DB.exists():
        raise HTTPException(status_code=503, detail="Offline database file missing")

    jti = _generate_token_jti()
    await _store_token(jti, client_ip)

    return {
        "token": jti,
        "version": meta.get("version"),
        "sha256": meta.get("sha256"),
        "encrypted_sha256": meta.get("encrypted_sha256"),
        "expires_in": _TOKEN_TTL_SECONDS,
        "format_version": meta.get("format_version", 1),
        "chunk_size": meta.get("chunk_size", 65536),
        "pbkdf2_iterations": meta.get("pbkdf2_iterations", 600_000),
    }


@router.post("/download")
async def download_database(
    request: Request,
    payload: DownloadDatabaseRequest,
):
    """
    Download the encrypted offline database.

    Requires a valid one-time token from POST /token.
    The token is consumed upon use and cannot be reused.
    """
    _enforce_secure_request(request)
    token = payload.token.strip()
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="Invalid token format")

    is_valid = await _consume_token(token, extract_client_ip(request))
    if not is_valid:
        raise HTTPException(
            status_code=403,
            detail="Token invalid, expired, or already used",
        )

    if not ENCRYPTED_DB.exists():
        raise HTTPException(status_code=503, detail="Offline database file missing")

    try:
        data = ENCRYPTED_DB.read_bytes()
    except OSError as exc:
        logger.error("Failed to read encrypted DB: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error")

    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="data.bin"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
