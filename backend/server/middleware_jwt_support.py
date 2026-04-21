"""Pure JWT and Clerk provisioning helpers for the server middleware."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from typing import Any, Optional, Pattern
from urllib.parse import urlparse

import jwt

from backend.config.settings import settings
from backend.server.middleware_context import (
    get_current_request_id,
    _record_jwt_failure_reason,
)

logger = logging.getLogger("nesh.middleware.tenant")
_NEVER_MATCH_REGEX = re.compile(r"$^")


def _normalize_clerk_domain(raw_domain: Optional[str]) -> Optional[str]:
    if not raw_domain:
        return None

    raw = raw_domain.strip()
    if not raw:
        return None

    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        normalized = parsed.netloc or parsed.path
    else:
        normalized = raw

    normalized = normalized.strip().strip("/")
    return normalized or None


def _build_jwks_url(raw_domain: Optional[str]) -> Optional[str]:
    normalized_domain = _normalize_clerk_domain(raw_domain)
    if not normalized_domain:
        return None
    return f"https://{normalized_domain}/.well-known/jwks.json"


def _decode_jwt_json_segment(segment: str) -> dict[str, Any]:
    try:
        padded_segment = segment + ("=" * (-len(segment) % 4))
        decoded_bytes = base64.urlsafe_b64decode(padded_segment.encode("ascii"))
        decoded_json = json.loads(decoded_bytes.decode("utf-8"))
        if isinstance(decoded_json, dict):
            return decoded_json
    except Exception:
        logger.debug("Failed to decode JWT segment", exc_info=True)
    return {}


def _safe_get_unverified_header(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 1:
        return {}
    return _decode_jwt_json_segment(parts[0])


def _safe_get_unverified_claims(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    return _decode_jwt_json_segment(parts[1])


def _token_observability_snapshot(token: str) -> dict[str, Any]:
    header = _safe_get_unverified_header(token)
    claims = _safe_get_unverified_claims(token)
    return {
        "header": {k: header.get(k) for k in ("alg", "kid", "typ")},
        "claims": {
            k: claims.get(k)
            for k in ("iss", "sub", "sid", "azp", "aud", "org_id", "exp", "iat", "nbf")
        },
    }


def _normalize_issuer(issuer: str) -> str:
    return issuer.strip().rstrip("/")


def _resolve_expected_issuer() -> Optional[str]:
    explicit_issuer = (settings.auth.clerk_issuer or "").strip()
    if explicit_issuer:
        return _normalize_issuer(explicit_issuer)
    return None


def _derive_issuer_hint_from_domain() -> Optional[str]:
    normalized_domain = _normalize_clerk_domain(settings.auth.clerk_domain)
    if not normalized_domain:
        return None
    return _normalize_issuer(f"https://{normalized_domain}")


def _resolve_expected_audience() -> Optional[list[str]]:
    raw = (settings.auth.clerk_audience or "").strip()
    if not raw:
        return None

    audiences = [item.strip() for item in raw.split(",") if item.strip()]
    return audiences or None


def _resolve_expected_azp() -> set[str]:
    expected: set[str] = set()
    for item in settings.auth.clerk_authorized_parties or []:
        value = str(item).strip()
        if value:
            expected.add(value)
    return expected


def _parse_clock_skew_seconds(raw_value: Any) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _configured_clock_skew_seconds() -> int:
    return _parse_clock_skew_seconds(settings.auth.clerk_clock_skew_seconds)


def _effective_clock_skew_seconds() -> int:
    configured = _configured_clock_skew_seconds()
    if settings.server.env == "development":
        return max(configured, 120)
    return configured


def _safe_float_claim(claim_value: Any) -> Optional[float]:
    try:
        return float(claim_value)
    except (TypeError, ValueError):
        return None


def _build_temporal_claims_extra(
    token_snapshot: dict[str, Any], leeway_seconds: int
) -> dict[str, Any]:
    claims = token_snapshot.get("claims") if isinstance(token_snapshot, dict) else {}
    if not isinstance(claims, dict):
        claims = {}

    now_epoch = time.time()
    nbf_epoch = _safe_float_claim(claims.get("nbf"))
    iat_epoch = _safe_float_claim(claims.get("iat"))

    return {
        "now": now_epoch,
        "leeway_seconds": leeway_seconds,
        "nbf": nbf_epoch,
        "iat": iat_epoch,
        "nbf_minus_now": None if nbf_epoch is None else nbf_epoch - now_epoch,
        "iat_minus_now": None if iat_epoch is None else iat_epoch - now_epoch,
    }


def _validate_expected_issuer(
    payload: dict[str, Any], expected_issuer: Optional[str]
) -> None:
    if not expected_issuer:
        return

    token_issuer_raw = payload.get("iss")
    if not isinstance(token_issuer_raw, str) or not token_issuer_raw.strip():
        raise jwt.InvalidIssuerError("Missing 'iss' claim")

    token_issuer = _normalize_issuer(token_issuer_raw)
    if token_issuer != expected_issuer:
        raise jwt.InvalidIssuerError(
            f"Unexpected issuer. expected={expected_issuer!r}, received={token_issuer!r}"
        )


def _validate_expected_azp(
    payload: dict[str, Any],
    expected_azp: set[str],
    expected_azp_regex: Optional[Pattern[str]],
) -> None:
    if not expected_azp and expected_azp_regex is None:
        return

    token_azp = payload.get("azp")
    if not isinstance(token_azp, str) or not token_azp.strip():
        raise jwt.InvalidTokenError("Missing 'azp' claim")

    normalized_azp = token_azp.strip()
    matches_explicit = normalized_azp in expected_azp
    matches_regex = bool(
        expected_azp_regex is not None and expected_azp_regex.fullmatch(normalized_azp)
    )
    if matches_explicit or matches_regex:
        return

    regex_pattern = expected_azp_regex.pattern if expected_azp_regex else None
    raise jwt.InvalidTokenError(
        "Invalid azp. "
        f"expected one of {sorted(expected_azp)!r} or regex {regex_pattern!r}, "
        f"received={normalized_azp!r}"
    )


def _log_jwt_failure(
    reason: str,
    token_snapshot: dict[str, Any],
    error: Exception | str,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    _record_jwt_failure_reason(reason)
    payload = {
        "event": "jwt_validation_failed",
        "reason": reason,
        "error": str(error),
        "request_id": get_current_request_id(),
        "token": token_snapshot,
        "timestamp_epoch": int(time.time()),
    }
    if extra:
        payload["extra"] = extra
    logger.warning(json.dumps(payload, ensure_ascii=False, default=str))


def _log_jwt_validation_success(
    token_snapshot: dict[str, Any], payload: dict[str, Any]
) -> None:
    if not settings.features.debug_mode:
        return

    logger.debug(
        "jwt_validation_ok %s",
        json.dumps(
            {
                "request_id": get_current_request_id(),
                "header": token_snapshot.get("header", {}),
                "claims": {
                    k: payload.get(k)
                    for k in ("iss", "sub", "sid", "azp", "aud", "org_id", "exp", "iat", "nbf")
                },
            },
            ensure_ascii=False,
            default=str,
        ),
    )


def _build_jwt_decode_kwargs(
    expected_audience: Optional[list[str]], leeway_seconds: int
) -> dict[str, Any]:
    decode_kwargs: dict[str, Any] = {
        "algorithms": ["RS256"],
        "leeway": leeway_seconds,
        "options": {
            "verify_aud": bool(expected_audience),
            "verify_nbf": False,
            "verify_iat": False,
        },
    }
    if expected_audience:
        decode_kwargs["audience"] = expected_audience
    return decode_kwargs


def _decode_jwt_with_signature(
    token: str,
    signing_key: Any,
    expected_audience: Optional[list[str]],
    leeway_seconds: int,
) -> dict:
    return jwt.decode(
        token,
        signing_key.key,
        **_build_jwt_decode_kwargs(expected_audience, leeway_seconds),
    )


def _normalize_token_audience(token_aud: Any) -> set[str]:
    normalized_token_aud: set[str] = set()
    if isinstance(token_aud, str):
        normalized_token_aud.add(token_aud)
    elif isinstance(token_aud, list):
        normalized_token_aud.update(str(item) for item in token_aud if item)
    return normalized_token_aud


def _validate_expected_audience_claim(
    payload: dict[str, Any],
    expected_audience: Optional[list[str]],
    token_snapshot: dict[str, Any],
) -> bool:
    if not expected_audience:
        return True

    token_aud = payload.get("aud")
    if token_aud is None:
        _log_jwt_failure(
            reason="missing_aud",
            token_snapshot=token_snapshot,
            error="Claim 'aud' ausente, mas AUTH__CLERK_AUDIENCE está configurado",
        )
        return False

    normalized_token_aud = _normalize_token_audience(token_aud)
    if normalized_token_aud.intersection(set(expected_audience)):
        return True

    _log_jwt_failure(
        reason="audience_mismatch",
        token_snapshot=token_snapshot,
        error="Claim 'aud' não contém valor esperado",
        extra={"token_aud": sorted(normalized_token_aud)},
    )
    return False


def _validate_not_before_like_claim(
    payload: dict[str, Any],
    claim_name: str,
    leeway_seconds: int,
    token_snapshot: dict[str, Any],
    invalid_reason: str,
    future_reason: str,
    future_error: str,
) -> bool:
    claim_value = payload.get(claim_name)
    if claim_value is None:
        return True

    try:
        claim_epoch = float(claim_value)
    except (TypeError, ValueError):
        _log_jwt_failure(
            reason=invalid_reason,
            token_snapshot=token_snapshot,
            error=f"{claim_name} inválido: {claim_value!r}",
        )
        return False

    now_epoch = time.time()
    if now_epoch + leeway_seconds >= claim_epoch:
        return True

    _log_jwt_failure(
        reason=future_reason,
        token_snapshot=token_snapshot,
        error=future_error,
        extra={
            claim_name: claim_epoch,
            "now": now_epoch,
            f"{claim_name}_minus_now": claim_epoch - now_epoch,
            "leeway_seconds": leeway_seconds,
        },
    )
    return False


def _get_payload_exp(payload: dict) -> Optional[float]:
    exp = payload.get("exp")
    if exp is None:
        return None
    try:
        return float(exp)
    except (TypeError, ValueError):
        return None


def _is_payload_expired(payload: dict, leeway_seconds: int) -> bool:
    exp = payload.get("exp")
    if exp is None:
        return False
    exp_value = _get_payload_exp(payload)
    if exp_value is None:
        return True
    return time.time() >= (exp_value + max(0, leeway_seconds))


def _validate_temporal_claims(
    payload: dict[str, Any], leeway_seconds: int, token_snapshot: dict[str, Any]
) -> Optional[float]:
    if not _validate_not_before_like_claim(
        payload=payload,
        claim_name="nbf",
        leeway_seconds=leeway_seconds,
        token_snapshot=token_snapshot,
        invalid_reason="invalid_nbf",
        future_reason="nbf_in_future",
        future_error="Token ainda não é válido (nbf no futuro)",
    ):
        return None

    if not _validate_not_before_like_claim(
        payload=payload,
        claim_name="iat",
        leeway_seconds=leeway_seconds,
        token_snapshot=token_snapshot,
        invalid_reason="invalid_iat",
        future_reason="iat_in_future",
        future_error="iat no futuro além do leeway",
    ):
        return None

    exp_value = _get_payload_exp(payload)
    if exp_value is not None:
        return exp_value

    _log_jwt_failure(
        reason="missing_or_invalid_exp",
        token_snapshot=token_snapshot,
        error="Claim 'exp' ausente ou inválido",
    )
    return None


def _jwt_error_reason(error: jwt.PyJWTError) -> str:
    if isinstance(error, jwt.ImmatureSignatureError):
        return "immature_signature"
    if isinstance(error, jwt.ExpiredSignatureError):
        return "expired_signature"
    if isinstance(error, jwt.InvalidIssuedAtError):
        return "invalid_iat"
    if isinstance(error, jwt.InvalidIssuerError):
        return "invalid_issuer"
    if isinstance(error, jwt.InvalidAudienceError):
        return "invalid_audience"
    if isinstance(error, jwt.InvalidSignatureError):
        return "invalid_signature"
    return "invalid_token"


def _log_jwt_validation_error(
    error: jwt.PyJWTError, token_snapshot: dict[str, Any], leeway_seconds: int
) -> None:
    extra = None
    if isinstance(error, jwt.ImmatureSignatureError):
        extra = _build_temporal_claims_extra(token_snapshot, leeway_seconds)
    _log_jwt_failure(_jwt_error_reason(error), token_snapshot, error, extra=extra)


def _resolve_user_id(payload: dict[str, Any]) -> Optional[str]:
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        return None
    return user_id


def _is_recently_provisioned(
    cache_key: tuple[str, str], now: float, cache: dict[tuple[str, str], float], ttl: float
) -> bool:
    cached_at = cache.get(cache_key)
    return bool(cached_at and (now - cached_at) < ttl)


def _resolve_full_name(payload: dict[str, Any]) -> Optional[str]:
    if isinstance(payload.get("name"), str) and payload.get("name"):
        return payload.get("name")
    given = str(payload.get("given_name") or "")
    family = str(payload.get("family_name") or "")
    return f"{given} {family}".strip() or None


def _resolve_identity_fields(
    payload: dict[str, Any], user_id: str, org_id: str
) -> tuple[str, str, Optional[str]]:
    org_name = str(
        payload.get("org_name") or payload.get("organization_name") or org_id
    )
    email = str(
        payload.get("email") or payload.get("email_address") or f"{user_id}@clerk.local"
    )
    full_name = _resolve_full_name(payload)
    return org_name, email, full_name


async def _upsert_clerk_entities(
    org_id: str, user_id: str, org_name: str, email: str, full_name: Optional[str]
) -> None:
    from backend.domain.sqlmodels import Tenant, User
    from backend.infrastructure.db_engine import get_session

    async with get_session() as session:
        tenant = await session.get(Tenant, org_id)
        if tenant is None:
            session.add(Tenant(id=org_id, name=org_name))
        elif org_name and tenant.name != org_name:
            tenant.name = org_name

        user = await session.get(User, user_id)
        if user is None:
            session.add(
                User(id=user_id, email=email, full_name=full_name, tenant_id=org_id)
            )
            return

        if user.tenant_id != org_id:
            user.tenant_id = org_id
        if email and user.email != email:
            user.email = email
        if full_name and user.full_name != full_name:
            user.full_name = full_name


def _mark_entities_as_provisioned(
    cache_key: tuple[str, str], now: float, cache: dict[tuple[str, str], float], max_size: int
) -> None:
    if len(cache) >= max_size:
        oldest = sorted(cache.items(), key=lambda item: item[1])[:100]
        for key, _ in oldest:
            del cache[key]
    cache[cache_key] = now
