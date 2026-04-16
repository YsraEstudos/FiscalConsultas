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
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.config.settings import settings
from backend.infrastructure.redis_client import redis_cache
from backend.server.rate_limit import SlidingWindowRateLimiter
from backend.utils.auth import _is_trusted_proxy, extract_client_ip

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

_VERSION_RESPONSES = {503: {"description": "Offline database metadata is unavailable."}}
_TOKEN_RESPONSES = {
    400: {
        "description": "Offline database token requests require HTTPS in production unless they originate locally."
    },
    429: {"description": "Rate limit exceeded for database download token requests."},
    503: {"description": "Offline database metadata or encrypted file is unavailable."},
}
_DOWNLOAD_RESPONSES = {
    400: {
        "description": "Offline database downloads require HTTPS in production and a valid token format."
    },
    403: {"description": "The download token is invalid, expired, or already used."},
    500: {"description": "The encrypted offline database could not be read."},
    503: {"description": "The encrypted offline database file is unavailable."},
}


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
    direct_ip = request.client.host if request.client else None
    forwarded_host = request.headers.get("x-forwarded-host", "").strip()
    host_header = (
        forwarded_host if forwarded_host and _is_trusted_proxy(direct_ip) else ""
    ) or request.headers.get("host", "")
    host = host_header.split(":", maxsplit=1)[0].strip().lower()
    client_host = (direct_ip or "").strip().lower()
    return host in {"127.0.0.1", "localhost"} or client_host in {
        "127.0.0.1",
        "::1",
        "localhost",
    }


def _resolve_request_scheme(request: Request) -> str:
    direct_ip = request.client.host if request.client else None
    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip()
    if forwarded_proto and _is_trusted_proxy(direct_ip):
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


async def _store_token(jti: str) -> None:
    """Store a one-time token (Redis preferred, memory fallback)."""
    if redis_cache.available:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        if await redis_cache.set_with_ttl(
            key, "1", ttl_seconds=_TOKEN_TTL_SECONDS
        ):
            return

    # Memory fallback
    now = time.monotonic()
    # Cleanup expired tokens
    expired = [
        k
        for k, (created, _) in _memory_tokens.items()
        if now - created > _TOKEN_TTL_SECONDS
    ]
    for k in expired:
        del _memory_tokens[k]
    # Evict oldest if full
    if len(_memory_tokens) >= _MEMORY_TOKEN_MAX:
        oldest_key = min(_memory_tokens, key=lambda k: _memory_tokens[k][0])
        del _memory_tokens[oldest_key]

    _memory_tokens[jti] = (now, "1")


async def _consume_token(jti: str) -> bool:
    """Verify and consume a one-time token. Returns True if valid."""
    if redis_cache.available:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        stored_ip = await redis_cache.consume_once(key)
        return stored_ip is not None

    # Memory fallback
    now = time.monotonic()
    entry = _memory_tokens.pop(jti, None)
    if entry is None:
        return False
    created_at, stored_ip = entry
    if now - created_at > _TOKEN_TTL_SECONDS:
        return False  # Expired
    return bool(stored_ip)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/version", responses=_VERSION_RESPONSES)
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


@router.post("/token", responses=_TOKEN_RESPONSES)
async def create_download_token(request: Request):
    """
    Generate a one-time download token.

    Rate limited to 3 per hour per IP to prevent abuse.
    The token expires after 5 minutes and can only be used once.
    """
    _enforce_secure_request(request)
    limiter_key = f"db-download:ip:{extract_client_ip(request)}"

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
    await _store_token(jti)

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


@router.post("/download", responses=_DOWNLOAD_RESPONSES)
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

    is_valid = await _consume_token(token)
    if not is_valid:
        raise HTTPException(
            status_code=403,
            detail="Token invalid, expired, or already used",
        )

    if not ENCRYPTED_DB.exists():
        raise HTTPException(status_code=503, detail="Offline database file missing")

    try:
        return FileResponse(
            path=ENCRYPTED_DB,
            filename="data.bin",
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": 'attachment; filename="data.bin"',
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Cross-Origin-Resource-Policy": "same-origin",
            },
        )
    except OSError as exc:
        logger.error("Failed to stream encrypted DB: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc
