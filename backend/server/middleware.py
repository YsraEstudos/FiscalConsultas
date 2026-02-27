"""
Multi-Tenant Middleware para extração de org_id do Clerk JWT.

Este middleware:
1. Processa apenas rotas da API (/api/*)
2. Valida e decodifica o token Clerk (RS256/JWKS)
3. Extrai o org_id para contexto multi-tenant
4. Define tenant no contextvar para RLS do PostgreSQL
"""

import asyncio
import base64
import hashlib
import json
import logging
import time
from contextvars import ContextVar
from typing import Any, Coroutine, Dict, Optional
from urllib.parse import urlparse

import jwt
from backend.config.settings import settings
from backend.infrastructure.db_engine import tenant_context
from jwt import PyJWKClient
from starlette.responses import JSONResponse

logger = logging.getLogger("middleware.tenant")

# Cache do JWKS client (Clerk public keys)
_jwks_client: Optional[PyJWKClient] = None

# JWT decode cache
_jwt_decode_cache: dict[str, tuple[dict, float, Optional[float]]] = {}
_JWT_CACHE_TTL = 60.0
_JWT_CACHE_MAX_SIZE = 1000

# Provisioning cache
_provisioned_entities_cache: dict[tuple[str, str], float] = {}
_PROVISION_CACHE_TTL = 300.0
_PROVISION_CACHE_MAX_SIZE = 5000

# Strong refs para tarefas fire-and-forget. Sem isso, o loop mantém apenas weak refs.
_background_tasks: set[asyncio.Future[Any]] = set()

_JWT_DEBUG_HEADER_FIELDS = ("alg", "kid", "typ")
_JWT_DEBUG_CLAIM_FIELDS = (
    "iss",
    "sub",
    "sid",
    "azp",
    "aud",
    "org_id",
    "exp",
    "iat",
    "nbf",
)
_jwt_failure_reason_ctx: ContextVar[Optional[str]] = ContextVar(
    "jwt_failure_reason", default=None
)
_DEV_MIN_CLOCK_SKEW_SECONDS = 120


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


def _token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


def _decode_jwt_json_segment(segment: str) -> dict[str, Any]:
    try:
        padded_segment = segment + ("=" * (-len(segment) % 4))
        decoded_bytes = base64.urlsafe_b64decode(padded_segment.encode("ascii"))
        decoded_json = json.loads(decoded_bytes.decode("utf-8"))
        if isinstance(decoded_json, dict):
            return decoded_json
    except Exception:
        pass
    return {}


def _safe_get_unverified_header(token: str) -> dict[str, Any]:
    # Header sem verificação é usado somente em logs diagnósticos (nunca para auth).
    parts = token.split(".")
    if len(parts) < 1:
        return {}
    return _decode_jwt_json_segment(parts[0])


def _safe_get_unverified_claims(token: str) -> dict[str, Any]:
    # Claims sem verificação são usados somente para observabilidade.
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    return _decode_jwt_json_segment(parts[1])


def _token_observability_snapshot(token: str) -> dict[str, Any]:
    header = _safe_get_unverified_header(token)
    claims = _safe_get_unverified_claims(token)
    return {
        "fingerprint": _token_fingerprint(token),
        "header": {k: header.get(k) for k in _JWT_DEBUG_HEADER_FIELDS},
        "claims": {k: claims.get(k) for k in _JWT_DEBUG_CLAIM_FIELDS},
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
        return max(configured, _DEV_MIN_CLOCK_SKEW_SECONDS)
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


def _validate_expected_azp(payload: dict[str, Any], expected_azp: set[str]) -> None:
    if not expected_azp:
        return

    token_azp = payload.get("azp")
    if not isinstance(token_azp, str) or not token_azp.strip():
        raise jwt.InvalidTokenError("Missing 'azp' claim")

    if token_azp not in expected_azp:
        raise jwt.InvalidTokenError(
            f"Invalid azp. expected one of {sorted(expected_azp)!r}, received={token_azp!r}"
        )


def _log_jwt_failure(
    reason: str,
    token_snapshot: dict[str, Any],
    error: Exception | str,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    _jwt_failure_reason_ctx.set(reason)
    payload = {
        "event": "jwt_validation_failed",
        "reason": reason,
        "error": str(error),
        "token": token_snapshot,
        "expected": {
            "issuer": _resolve_expected_issuer(),
            "issuer_hint_from_clerk_domain": _derive_issuer_hint_from_domain(),
            "audience": _resolve_expected_audience(),
            "azp": sorted(_resolve_expected_azp()),
            "clock_skew_seconds_configured": _configured_clock_skew_seconds(),
            "clock_skew_seconds_effective": _effective_clock_skew_seconds(),
        },
        "timestamp_epoch": int(time.time()),
    }
    if extra:
        payload["extra"] = extra
    logger.warning(json.dumps(payload, ensure_ascii=False, default=str))


def get_jwks_client() -> Optional[PyJWKClient]:
    """
    Retorna JWKS client para validação de tokens Clerk.
    Clerk publica suas chaves públicas em: https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json
    """
    global _jwks_client
    jwks_url = _build_jwks_url(settings.auth.clerk_domain)
    if not jwks_url:
        logger.error("AUTH__CLERK_DOMAIN inválido: %r", settings.auth.clerk_domain)
        return None
    if _jwks_client is None:
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


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


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_cached_jwt_payload(
    token_hash: str, token: str, leeway_seconds: int, now_monotonic: float
) -> tuple[bool, Optional[dict]]:
    cached = _jwt_decode_cache.get(token_hash)
    if not cached:
        return False, None

    payload, cached_at, exp_epoch = cached
    if now_monotonic - cached_at >= _JWT_CACHE_TTL:
        del _jwt_decode_cache[token_hash]
        return False, None

    if exp_epoch is not None and time.time() >= (exp_epoch + leeway_seconds):
        del _jwt_decode_cache[token_hash]
        _log_jwt_failure(
            reason="expired_cache",
            token_snapshot={
                "fingerprint": _token_fingerprint(token),
                "header": {},
                "claims": {k: payload.get(k) for k in _JWT_DEBUG_CLAIM_FIELDS},
            },
            error="Token expirado no cache local",
        )
        return True, None

    return True, payload.copy()


def _build_jwt_decode_kwargs(
    expected_audience: Optional[list[str]], leeway_seconds: int
) -> dict[str, Any]:
    decode_kwargs: dict[str, Any] = {
        "algorithms": ["RS256"],
        "leeway": leeway_seconds,
        "options": {
            "verify_aud": bool(expected_audience),
            # nbf/iat são validados manualmente para gerar logs mais úteis.
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


def _log_jwt_validation_success(token_snapshot: dict[str, Any], payload: dict[str, Any]) -> None:
    if not settings.features.debug_mode:
        return

    logger.debug(
        "jwt_validation_ok %s",
        json.dumps(
            {
                "fingerprint": token_snapshot["fingerprint"],
                "claims": {k: payload.get(k) for k in _JWT_DEBUG_CLAIM_FIELDS},
            },
            ensure_ascii=False,
            default=str,
        ),
    )


def _cache_decoded_jwt(
    token_hash: str, payload: dict[str, Any], now_monotonic: float, exp_value: float
) -> None:
    if len(_jwt_decode_cache) >= _JWT_CACHE_MAX_SIZE:
        oldest_keys = sorted(_jwt_decode_cache, key=lambda k: _jwt_decode_cache[k][1])[
            :50
        ]
        for key in oldest_keys:
            del _jwt_decode_cache[key]

    _jwt_decode_cache[token_hash] = (payload.copy(), now_monotonic, exp_value)


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


async def decode_clerk_jwt(token: str) -> Optional[dict]:
    """
    Valida e decodifica JWT do Clerk.
    Performance: Cacheia resultado por hash do token (TTL 60s).

    Returns:
        Payload decodificado ou None se inválido/expirado.
    """
    _jwt_failure_reason_ctx.set(None)
    leeway_seconds = _effective_clock_skew_seconds()

    token_hash = _token_cache_key(token)
    now_monotonic = time.monotonic()
    cache_handled, cached_payload = _get_cached_jwt_payload(
        token_hash, token, leeway_seconds, now_monotonic
    )
    if cache_handled:
        return cached_payload

    token_snapshot = _token_observability_snapshot(token)
    expected_issuer = _resolve_expected_issuer()
    expected_audience = _resolve_expected_audience()
    expected_azp = _resolve_expected_azp()

    try:
        jwks_client = get_jwks_client()
        if not jwks_client:
            logger.error("Clerk domain não configurado; JWT não pode ser validado")
            _log_jwt_failure(
                reason="jwks_unavailable",
                token_snapshot=token_snapshot,
                error="AUTH__CLERK_DOMAIN ausente ou inválido",
            )
            return None

        # Produção/Dev com Clerk domain configurado: validar assinatura via JWKS.
        signing_key = await asyncio.to_thread(
            jwks_client.get_signing_key_from_jwt, token
        )

        payload = _decode_jwt_with_signature(
            token=token,
            signing_key=signing_key,
            expected_audience=expected_audience,
            leeway_seconds=leeway_seconds,
        )

        if _is_payload_expired(payload, leeway_seconds):
            _log_jwt_failure(
                reason="expired_payload",
                token_snapshot=token_snapshot,
                error="Token expirado",
            )
            return None

        if not payload.get("sub"):
            _log_jwt_failure(
                reason="missing_sub",
                token_snapshot=token_snapshot,
                error="Claim 'sub' ausente",
            )
            return None

        _validate_expected_issuer(payload, expected_issuer)
        _validate_expected_azp(payload, expected_azp)

        if not _validate_expected_audience_claim(
            payload, expected_audience, token_snapshot
        ):
            return None

        exp_value = _validate_temporal_claims(payload, leeway_seconds, token_snapshot)
        if exp_value is None:
            return None

        _log_jwt_validation_success(token_snapshot, payload)
        _cache_decoded_jwt(token_hash, payload, now_monotonic, exp_value)
        _jwt_failure_reason_ctx.set(None)
        return payload.copy()

    except jwt.PyJWTError as e:
        _log_jwt_validation_error(e, token_snapshot, leeway_seconds)
        return None
    except Exception as e:
        _log_jwt_failure("unexpected_error", token_snapshot, e)
        return None


def get_last_jwt_failure_reason() -> Optional[str]:
    """Retorna o último motivo de falha de validação JWT no contexto da request."""
    return _jwt_failure_reason_ctx.get()


async def is_clerk_token_valid(token: str) -> bool:
    """Retorna True se o JWT do Clerk for válido."""
    return (await decode_clerk_jwt(token)) is not None


def _resolve_user_id(payload: Dict[str, Any]) -> Optional[str]:
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        return None
    return user_id


def _is_recently_provisioned(cache_key: tuple[str, str], now: float) -> bool:
    cached_at = _provisioned_entities_cache.get(cache_key)
    return bool(cached_at and (now - cached_at) < _PROVISION_CACHE_TTL)


def _resolve_full_name(payload: Dict[str, Any]) -> Optional[str]:
    if isinstance(payload.get("name"), str) and payload.get("name"):
        return payload.get("name")
    given = str(payload.get("given_name") or "")
    family = str(payload.get("family_name") or "")
    return f"{given} {family}".strip() or None


def _resolve_identity_fields(
    payload: Dict[str, Any], user_id: str, org_id: str
) -> tuple[str, str, Optional[str]]:
    org_name = str(payload.get("org_name") or payload.get("organization_name") or org_id)
    email = str(payload.get("email") or payload.get("email_address") or f"{user_id}@clerk.local")
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

        # Atualizações parciais evitam writes desnecessários e preservam performance.
        if user.tenant_id != org_id:
            user.tenant_id = org_id
        if email and user.email != email:
            user.email = email
        if full_name and user.full_name != full_name:
            user.full_name = full_name


def _mark_entities_as_provisioned(cache_key: tuple[str, str], now: float) -> None:
    if len(_provisioned_entities_cache) >= _PROVISION_CACHE_MAX_SIZE:
        oldest = sorted(_provisioned_entities_cache.items(), key=lambda item: item[1])[
            :100
        ]
        for key, _ in oldest:
            del _provisioned_entities_cache[key]
    _provisioned_entities_cache[cache_key] = now


async def ensure_clerk_entities(payload: Dict[str, Any], org_id: str) -> None:
    """
    Provisiona Tenant/User localmente a partir do JWT do Clerk.

    Performance: Cacheia entidades já provisionadas em memória (TTL 5min).
    Executa em best effort: falhas são logadas e não bloqueiam a requisição.
    """
    if not settings.database.is_postgres:
        return

    user_id = _resolve_user_id(payload)
    if not user_id:
        return

    # Evita round-trip no banco para o mesmo par org/user em janelas curtas.
    cache_key = (org_id, user_id)
    now = time.monotonic()
    if _is_recently_provisioned(cache_key, now):
        return

    org_name, email, full_name = _resolve_identity_fields(payload, user_id, org_id)

    try:
        await _upsert_clerk_entities(org_id, user_id, org_name, email, full_name)
        _mark_entities_as_provisioned(cache_key, now)
    except Exception as e:
        logger.warning(f"Provisioning Clerk entities falhou (org={org_id}): {e}")


async def extract_org_from_jwt(token: str) -> Optional[str]:
    """
    Extrai org_id do JWT do Clerk.

    Returns:
        org_id ou None se não encontrado/inválido
    """
    payload = await decode_clerk_jwt(token)
    if not payload:
        return None

    org_id = payload.get("org_id")
    if org_id:
        logger.debug(f"Tenant extraído do JWT: {org_id}")
    return org_id


def _schedule_background_task(task_coro: Coroutine[Any, Any, Any]) -> None:
    # Mantemos ensure_future por compatibilidade com testes e,
    # principalmente, guardamos referência forte para evitar GC prematuro.
    task = asyncio.ensure_future(task_coro)
    if not isinstance(task, asyncio.Future):
        return

    _background_tasks.add(task)

    def _on_done(done_task: asyncio.Future[Any]) -> None:
        _background_tasks.discard(done_task)
        try:
            done_task.result()
        except Exception as exc:
            logger.warning("Background task failed: %s", exc)

    task.add_done_callback(_on_done)


class TenantMiddleware:
    """
    Middleware ASGI puro para extrair tenant_id (org_id) do token Clerk.

    Usa Pure ASGI em vez de BaseHTTPMiddleware para evitar o bug de buffering
    do Starlette: BaseHTTPMiddleware bufferiza a resposta inteira em memória
    (~860KB para chapters NESH), bloqueando o pool de DB durante o buffer e
    causando deadlock/timeout quando concurrent tasks também precisam de conexão.
    """

    # Rotas de API que não precisam de tenant
    PUBLIC_EXACT_PATHS = {
        "/api/auth/me",
        "/api/status",
        "/api/webhooks",
    }
    PUBLIC_PREFIX_PATHS = ("/api/webhooks/",)

    def __init__(self, app):
        self.app = app

    @classmethod
    def _is_public_path(cls, path: str) -> bool:
        if path in cls.PUBLIC_EXACT_PATHS:
            return True
        for prefix in cls.PUBLIC_PREFIX_PATHS:
            if path.startswith(prefix):
                return True
        return False

    @staticmethod
    def _extract_bearer_token(scope: dict[str, Any]) -> Optional[str]:
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("latin-1")
        if auth_header.startswith("Bearer "):
            return auth_header[7:]
        return None

    @staticmethod
    def _extract_debug_tenant(scope: dict[str, Any]) -> Optional[str]:
        if settings.server.env != "development":
            return None
        query_string = scope.get("query_string", b"").decode("latin-1")
        for part in query_string.split("&"):
            if part.startswith("_tenant="):
                tenant = part[8:]
                return tenant or None
        return None

    @staticmethod
    def _resolve_dev_fallback_tenant(org_id: Optional[str]) -> Optional[str]:
        if org_id:
            return org_id
        if settings.server.env == "development" and settings.features.debug_mode:
            return "org_default"
        return None

    @staticmethod
    def _requires_tenant_rejection(org_id: Optional[str]) -> bool:
        if org_id:
            return False
        if settings.server.env == "development":
            return False
        return settings.database.is_postgres

    @staticmethod
    def _log_tenant_resolution(scope: dict[str, Any], path: str, org_id: Optional[str]) -> None:
        method = scope.get("method", "?")
        if org_id:
            logger.debug("Request %s %s - Tenant: %s", method, path, org_id)
            return
        logger.debug("Request %s %s - No tenant (public)", method, path)

    async def _resolve_request_tenant(
        self, scope: dict[str, Any]
    ) -> tuple[Optional[str], Optional[dict[str, Any]]]:
        token = self._extract_bearer_token(scope)
        if not token:
            org_id = self._extract_debug_tenant(scope)
            return self._resolve_dev_fallback_tenant(org_id), None

        jwt_payload = await decode_clerk_jwt(token)
        org_id = jwt_payload.get("org_id") if jwt_payload else None
        if not org_id:
            org_id = self._extract_debug_tenant(scope)
        return self._resolve_dev_fallback_tenant(org_id), jwt_payload

    async def _call_with_optional_tenant_context(
        self,
        org_id: Optional[str],
        scope: dict[str, Any],
        receive: Any,
        send: Any,
    ) -> None:
        if not org_id:
            await self.app(scope, receive, send)
            return

        token_var = tenant_context.set(org_id)
        try:
            await self.app(scope, receive, send)
        finally:
            tenant_context.reset(token_var)

    @staticmethod
    async def _send_missing_tenant_response(scope: dict[str, Any], receive: Any, send: Any) -> None:
        response = JSONResponse(
            status_code=401,
            content={"success": False, "detail": "Tenant não identificado"},
        )
        await response(scope, receive, send)

    @staticmethod
    def _schedule_provisioning_if_needed(
        jwt_payload: Optional[dict[str, Any]], org_id: Optional[str]
    ) -> None:
        if not jwt_payload or not org_id:
            return
        _schedule_background_task(ensure_clerk_entities(jwt_payload.copy(), org_id))

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        # 0. Só processa APIs; arquivos estáticos/frontend não exigem tenant
        if not path.startswith("/api"):
            await self.app(scope, receive, send)
            return

        # 1. Ignorar rotas púbalicas
        if self._is_public_path(path):
            await self.app(scope, receive, send)
            return

        org_id, jwt_payload = await self._resolve_request_tenant(scope)
        if self._requires_tenant_rejection(org_id):
            await self._send_missing_tenant_response(scope, receive, send)
            return

        self._log_tenant_resolution(scope, path, org_id)
        await self._call_with_optional_tenant_context(org_id, scope, receive, send)
        self._schedule_provisioning_if_needed(jwt_payload, org_id)


def get_current_tenant() -> Optional[str]:
    """
    Utility function para obter tenant atual em qualquer lugar do código.

    Uso:
        from backend.server.middleware import get_current_tenant
        tenant_id = get_current_tenant()
    """
    return tenant_context.get() or None
