"""
Secure database download routes for offline search.

Provides:
- GET  /version  — Public metadata (version, size)
- POST /token    — One-time download token (rate limited)
- POST /download — Encrypted database blob (token required)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
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
from backend.server.middleware import decode_clerk_jwt, get_last_jwt_failure_reason
from backend.server.middleware_network import is_loopback_host
from backend.server.rate_limit import RedisBackedRateLimiter
from backend.utils.auth import (
    extract_bearer_token,
    extract_client_ip,
    is_trusted_proxy,
)

logger = logging.getLogger("routes.database_download")

router = APIRouter()


def _extract_email(payload: dict | None) -> str | None:
    """Extract and normalize the user email from a Clerk JWT payload."""
    if not payload:
        return None
    for key in ("email", "email_address", "primary_email_address"):
        candidate = payload.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    return None


def _enforce_email_allowlist(payload: dict) -> None:
    """Reject the request if the authenticated user is not in the allowlist."""
    email = _extract_email(payload)
    allowed = settings.security.restricted_ui_allowed_email_set
    if not allowed:
        # If no allowlist is configured, allow all authenticated users.
        return
    if email and email in allowed:
        return
    logger.warning(
        "Download blocked for email=%s (not in restricted_ui allowlist)", email
    )
    raise HTTPException(
        status_code=403,
        detail="Your account is not authorized to download the offline database",
    )

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(os.path.abspath(__file__)).parent.parent.parent.parent
DB_DIR = PROJECT_ROOT / "database"
ENCRYPTED_DB = DB_DIR / "fiscal_offline.enc"
META_FILE = DB_DIR / "fiscal_offline.meta"

# ---------------------------------------------------------------------------
# Rate limiting (layered: IP + user + org)
# ---------------------------------------------------------------------------
_token_rate_limiter = RedisBackedRateLimiter(
    window_seconds=3600,
    redis_prefix="rate:db-download-token",
)
_TOKEN_LIMIT_PER_HOUR = 3

# Per-user: 1 download token per hour (each user only needs one)
_user_rate_limiter = RedisBackedRateLimiter(
    window_seconds=3600,
    redis_prefix="rate:db-download-user",
)
_USER_TOKEN_LIMIT_PER_HOUR = 1

# Per-org: 10 download tokens per day across all org members
_org_rate_limiter = RedisBackedRateLimiter(
    window_seconds=86400,
    redis_prefix="rate:db-download-org",
)
_ORG_TOKEN_LIMIT_PER_DAY = 10

# ---------------------------------------------------------------------------
# Token management (in-memory fallback + Redis)
# ---------------------------------------------------------------------------
_TOKEN_TTL_SECONDS = 300  # 5 minutes
_REDIS_TOKEN_PREFIX = "dbtoken:"
_SIGNED_TOKEN_PREFIX = "v1"

# In-memory token store (fallback when Redis unavailable)
_memory_tokens: dict[str, float] = {}  # jti -> created_at
_MEMORY_TOKEN_MAX = 100
_OFFLINE_UNAVAILABLE_DETAIL = "Offline database not available"

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


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _get_signed_token_secret(meta: dict) -> str:
    secret = (
        os.environ.get("OFFLINE_DB_TOKEN_SECRET")
        or settings.auth.secret_key
        or _require_app_seed(meta)
    )
    return secret.strip()


def _build_signed_token_payload(issued_at: int, nonce: str, bundle_hash: str) -> str:
    return f"{_SIGNED_TOKEN_PREFIX}.{issued_at}.{nonce}.{bundle_hash}"


def _sign_download_token_payload(payload: str, secret: str) -> str:
    signature = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(signature)


def _generate_signed_download_token(meta: dict) -> str:
    bundle_hash = str(meta.get("encrypted_sha256") or meta.get("sha256") or "")
    issued_at = int(time.time())
    nonce = secrets.token_urlsafe(24)
    payload = _build_signed_token_payload(issued_at, nonce, bundle_hash)
    signature = _sign_download_token_payload(payload, _get_signed_token_secret(meta))
    return f"{payload}.{signature}"


def _is_valid_signed_download_token(token: str) -> bool:
    parts = token.split(".")
    if len(parts) != 5 or parts[0] != _SIGNED_TOKEN_PREFIX:
        return False

    _, issued_at_raw, nonce, bundle_hash, supplied_signature = parts
    if not nonce or not bundle_hash or not supplied_signature:
        return False

    try:
        issued_at = int(issued_at_raw)
    except ValueError:
        return False

    now = int(time.time())
    if issued_at > now + 30 or now - issued_at > _TOKEN_TTL_SECONDS:
        return False

    meta = _load_metadata()
    if meta is None:
        return False

    expected_bundle_hash = str(meta.get("encrypted_sha256") or meta.get("sha256") or "")
    if not expected_bundle_hash or not secrets.compare_digest(
        bundle_hash, expected_bundle_hash
    ):
        return False

    payload = _build_signed_token_payload(issued_at, nonce, bundle_hash)
    expected_signature = _sign_download_token_payload(
        payload, _get_signed_token_secret(meta)
    )
    return hmac.compare_digest(supplied_signature, expected_signature)


def _is_local_request(request: Request) -> bool:
    return is_loopback_host(request.client.host if request.client else None)


def _resolve_request_scheme(request: Request) -> str:
    direct_ip = request.client.host if request.client else None
    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip()
    if forwarded_proto and is_trusted_proxy(direct_ip):
        return forwarded_proto.split(",", maxsplit=1)[0].strip().lower()
    return request.url.scheme.lower()


def _should_rate_limit_token_request(request: Request) -> bool:
    """Keep strict limits outside explicitly local development/test workflows."""
    if settings.server.env.lower() not in {"development", "test"}:
        return True
    return not _is_local_request(request)


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


async def _require_auth_payload(request: Request) -> dict:
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = await decode_clerk_jwt(token)
    if not payload:
        reason = get_last_jwt_failure_reason()
        if settings.server.env.lower() == "development" and reason:
            raise HTTPException(
                status_code=401,
                detail=f"Invalid or expired token ({reason})",
            )
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def _require_app_seed(meta: dict) -> str:
    seed = meta.get("app_seed") or os.environ.get("OFFLINE_DB_APP_SEED")
    if isinstance(seed, str) and seed.strip():
        return seed.strip()
    logger.error("Offline DB metadata is missing app_seed; rebuild the offline bundle")
    raise HTTPException(status_code=503, detail=_OFFLINE_UNAVAILABLE_DETAIL)


async def _store_token(jti: str, meta: dict, *, allow_memory_fallback: bool) -> str:
    """Store a short-lived one-time token."""
    if redis_cache.available:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        if await redis_cache.set_with_ttl(key, "1", ttl_seconds=_TOKEN_TTL_SECONDS):
            return jti

    if not allow_memory_fallback:
        return _generate_signed_download_token(meta)

    # Memory fallback
    now = time.monotonic()
    # Cleanup expired tokens
    expired = [
        k
        for k, created_at in _memory_tokens.items()
        if now - created_at > _TOKEN_TTL_SECONDS
    ]
    for k in expired:
        del _memory_tokens[k]
    # Evict oldest if full
    if len(_memory_tokens) >= _MEMORY_TOKEN_MAX:
        oldest_key = min(_memory_tokens, key=lambda k: _memory_tokens[k])
        del _memory_tokens[oldest_key]

    _memory_tokens[jti] = now
    return jti


async def _consume_token(jti: str) -> bool:
    """Verify and consume a one-time token. Returns True if valid."""
    if _is_valid_signed_download_token(jti):
        return True

    if redis_cache.available:
        key = f"{_REDIS_TOKEN_PREFIX}{jti}"
        return await redis_cache.consume_once(key) is not None

    # Memory fallback
    now = time.monotonic()
    created_at = _memory_tokens.get(jti)
    if created_at is None:
        return False
    if now - created_at > _TOKEN_TTL_SECONDS:
        _memory_tokens.pop(jti, None)
        return False  # Expired
    _memory_tokens.pop(jti, None)
    return True


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
        raise HTTPException(status_code=503, detail=_OFFLINE_UNAVAILABLE_DETAIL)

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

    Requires a valid Clerk JWT. The authenticated user's email must be in the
    restricted-UI allowlist (SECURITY__RESTRICTED_UI_ALLOWED_EMAILS).
    Rate limited to 3 per hour per IP to prevent abuse.
    The token expires after 5 minutes and can only be used once.
    """
    _enforce_secure_request(request)

    # --- Authentication gate (P0 security) ---
    jwt_payload = await _require_auth_payload(request)
    _enforce_email_allowlist(jwt_payload)

    user_id = jwt_payload.get("sub") or "unknown"
    org_id = jwt_payload.get("org_id") or "personal"
    email = _extract_email(jwt_payload) or "unknown"
    client_ip = extract_client_ip(request)

    # --- Layered rate limiting ---
    if _should_rate_limit_token_request(request):
        # Layer 1: per-IP (3/hour)
        allowed, retry_after = await _token_rate_limiter.consume(
            key=f"db-download:ip:{client_ip}", limit=_TOKEN_LIMIT_PER_HOUR
        )
        if not allowed:
            logger.warning(
                "RATE_LIMIT ip=%s user=%s layer=ip", client_ip, user_id
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded for database download tokens. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        # Layer 2: per-user (1/hour)
        allowed, retry_after = await _user_rate_limiter.consume(
            key=f"db-download:user:{user_id}", limit=_USER_TOKEN_LIMIT_PER_HOUR
        )
        if not allowed:
            logger.warning(
                "RATE_LIMIT ip=%s user=%s layer=user", client_ip, user_id
            )
            raise HTTPException(
                status_code=429,
                detail="Download token already issued recently. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        # Layer 3: per-org (10/day)
        allowed, retry_after = await _org_rate_limiter.consume(
            key=f"db-download:org:{org_id}", limit=_ORG_TOKEN_LIMIT_PER_DAY
        )
        if not allowed:
            logger.warning(
                "RATE_LIMIT ip=%s user=%s org=%s layer=org", client_ip, user_id, org_id
            )
            raise HTTPException(
                status_code=429,
                detail="Organization download limit exceeded for today.",
                headers={"Retry-After": str(retry_after)},
            )

    meta = _load_metadata()
    if meta is None:
        raise HTTPException(status_code=503, detail=_OFFLINE_UNAVAILABLE_DETAIL)

    if not ENCRYPTED_DB.exists():
        raise HTTPException(status_code=503, detail="Offline database file missing")

    app_seed = _require_app_seed(meta)
    jti = _generate_token_jti()
    token = await _store_token(
        jti, meta, allow_memory_fallback=_is_local_request(request)
    )

    # --- Audit log ---
    logger.info(
        "AUDIT db_download_token_issued user=%s org=%s email=%s ip=%s",
        user_id,
        org_id,
        email,
        client_ip,
    )

    return {
        "token": token,
        "app_seed": app_seed,
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
    client_ip = extract_client_ip(request)
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid token format")

    is_valid = await _consume_token(token)
    if not is_valid:
        logger.warning(
            "AUDIT db_download_token_rejected ip=%s reason=invalid_or_expired",
            client_ip,
        )
        raise HTTPException(
            status_code=403,
            detail="Token invalid, expired, or already used",
        )

    if not ENCRYPTED_DB.exists():
        raise HTTPException(status_code=503, detail="Offline database file missing")

    logger.info("AUDIT db_download_started ip=%s", client_ip)

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
                "X-Download-Options": "noopen",
            },
        )
    except OSError as exc:
        logger.error("Failed to stream encrypted DB: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc
