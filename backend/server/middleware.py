"""
Multi-Tenant Middleware para extração de org_id do Clerk JWT.

Este middleware:
1. Processa apenas rotas da API (/api/*)
2. Valida e decodifica o token Clerk (RS256/JWKS)
3. Extrai o org_id para contexto multi-tenant
4. Define tenant no contextvar para RLS do PostgreSQL
"""

import logging
import time
import hashlib
import asyncio
import json
from contextvars import ContextVar
from typing import Optional, Any, Dict
from urllib.parse import urlparse
import jwt
from jwt import PyJWKClient

from starlette.responses import JSONResponse

from backend.config.settings import settings
from backend.infrastructure.db_engine import tenant_context

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


def _safe_get_unverified_header(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)  # NOSONAR
        if isinstance(header, dict):
            return header
    except Exception:
        pass
    return {}


def _safe_get_unverified_claims(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(  # NOSONAR
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
            },
        )
        if isinstance(claims, dict):
            return claims
    except Exception:
        pass
    return {}


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


def _is_payload_expired(payload: dict) -> bool:
    exp = payload.get("exp")
    if exp is None:
        return False
    exp_value = _get_payload_exp(payload)
    if exp_value is None:
        return True
    return time.time() >= exp_value


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def decode_clerk_jwt(token: str) -> Optional[dict]:  # NOSONAR
    """
    Valida e decodifica JWT do Clerk.
    Performance: Cacheia resultado por hash do token (TTL 60s).

    Returns:
        Payload decodificado ou None se inválido/expirado.
    """
    _jwt_failure_reason_ctx.set(None)

    # Performance: Check cache first
    global _jwt_decode_cache
    token_hash = _token_cache_key(token)
    now_monotonic = time.monotonic()
    cached = _jwt_decode_cache.get(token_hash)
    if cached:
        payload, cached_at, exp_epoch = cached
        if now_monotonic - cached_at < _JWT_CACHE_TTL:
            if exp_epoch is not None and time.time() >= exp_epoch:
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
                return None
            return payload.copy()
        else:
            del _jwt_decode_cache[token_hash]

    token_snapshot = _token_observability_snapshot(token)
    expected_issuer = _resolve_expected_issuer()
    expected_audience = _resolve_expected_audience()
    expected_azp = _resolve_expected_azp()
    leeway_seconds = _effective_clock_skew_seconds()

    try:
        jwks_client = get_jwks_client()

        if jwks_client:
            # Produção/Dev com Clerk domain configurado: validar assinatura via JWKS.
            signing_key = await asyncio.to_thread(
                jwks_client.get_signing_key_from_jwt, token
            )

            decode_kwargs: dict[str, Any] = {
                "algorithms": ["RS256"],
                "leeway": leeway_seconds,
                "options": {
                    "verify_aud": bool(expected_audience),
                    # nbf/iat são validados manualmente abaixo para logging detalhado.
                    "verify_nbf": False,
                    "verify_iat": False,
                },
            }
            if expected_audience:
                decode_kwargs["audience"] = expected_audience

            payload = jwt.decode(
                token,
                signing_key.key,
                **decode_kwargs,
            )
        elif settings.server.env != "development":
            logger.error("Clerk domain não configurado; JWT não pode ser validado")
            _log_jwt_failure(
                reason="jwks_unavailable",
                token_snapshot=token_snapshot,
                error="AUTH__CLERK_DOMAIN ausente ou inválido em ambiente não-development",
            )
            return None
        elif not settings.features.debug_mode:
            logger.error(
                "JWT sem assinatura só é permitido em development com debug_mode=true"
            )
            _log_jwt_failure(
                reason="unsigned_token_forbidden",
                token_snapshot=token_snapshot,
                error="Token sem assinatura recusado fora de debug_mode",
            )
            return None
        else:
            # Desenvolvimento: Decodificar sem validar assinatura
            payload = jwt.decode(  # NOSONAR
                token,
                options={
                    "verify_signature": False,
                    "verify_exp": False,
                    "verify_nbf": False,
                    "verify_iat": False,
                    "verify_aud": False,
                    "verify_iss": False,
                },
            )

        if _is_payload_expired(payload):
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

        if settings.features.debug_mode:
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

        if expected_audience:
            token_aud = payload.get("aud")
            if token_aud is None:
                _log_jwt_failure(
                    reason="missing_aud",
                    token_snapshot=token_snapshot,
                    error="Claim 'aud' ausente, mas AUTH__CLERK_AUDIENCE está configurado",
                )
                return None

            normalized_token_aud: set[str] = set()
            if isinstance(token_aud, str):
                normalized_token_aud.add(token_aud)
            elif isinstance(token_aud, list):
                normalized_token_aud.update(str(item) for item in token_aud if item)

            if not normalized_token_aud.intersection(set(expected_audience)):
                _log_jwt_failure(
                    reason="audience_mismatch",
                    token_snapshot=token_snapshot,
                    error="Claim 'aud' não contém valor esperado",
                    extra={
                        "token_aud": sorted(normalized_token_aud),
                    },
                )
                return None

        nbf = payload.get("nbf")
        if nbf is not None:
            try:
                nbf_epoch = float(nbf)
            except (TypeError, ValueError):
                _log_jwt_failure(
                    reason="invalid_nbf",
                    token_snapshot=token_snapshot,
                    error=f"nbf inválido: {nbf!r}",
                )
                return None
            now_epoch = time.time()
            if now_epoch + leeway_seconds < nbf_epoch:
                _log_jwt_failure(
                    reason="nbf_in_future",
                    token_snapshot=token_snapshot,
                    error="Token ainda não é válido (nbf no futuro)",
                    extra={
                        "nbf": nbf_epoch,
                        "now": now_epoch,
                        "nbf_minus_now": nbf_epoch - now_epoch,
                        "leeway_seconds": leeway_seconds,
                    },
                )
                return None

        iat = payload.get("iat")
        if iat is not None:
            try:
                iat_epoch = float(iat)
            except (TypeError, ValueError):
                _log_jwt_failure(
                    reason="invalid_iat",
                    token_snapshot=token_snapshot,
                    error=f"iat inválido: {iat!r}",
                )
                return None
            now_epoch = time.time()
            if now_epoch + leeway_seconds < iat_epoch:
                _log_jwt_failure(
                    reason="iat_in_future",
                    token_snapshot=token_snapshot,
                    error="iat no futuro além do leeway",
                    extra={
                        "iat": iat_epoch,
                        "now": now_epoch,
                        "iat_minus_now": iat_epoch - now_epoch,
                        "leeway_seconds": leeway_seconds,
                    },
                )
                return None

        exp_value = _get_payload_exp(payload)
        if exp_value is None:
            _log_jwt_failure(
                reason="missing_or_invalid_exp",
                token_snapshot=token_snapshot,
                error="Claim 'exp' ausente ou inválido",
            )
            return None

        # Cache the result
        if len(_jwt_decode_cache) >= _JWT_CACHE_MAX_SIZE:
            # Evict oldest entries
            oldest_keys = sorted(
                _jwt_decode_cache, key=lambda k: _jwt_decode_cache[k][1]
            )[:50]
            for k in oldest_keys:
                del _jwt_decode_cache[k]
        _jwt_decode_cache[token_hash] = (payload.copy(), now_monotonic, exp_value)
        _jwt_failure_reason_ctx.set(None)
        return payload.copy()

    except jwt.ExpiredSignatureError as e:
        _log_jwt_failure("expired_signature", token_snapshot, e)
        return None
    except jwt.ImmatureSignatureError as e:
        _log_jwt_failure(
            "immature_signature",
            token_snapshot,
            e,
            extra=_build_temporal_claims_extra(token_snapshot, leeway_seconds),
        )
        return None
    except jwt.InvalidIssuedAtError as e:
        _log_jwt_failure("invalid_iat", token_snapshot, e)
        return None
    except jwt.InvalidIssuerError as e:
        _log_jwt_failure("invalid_issuer", token_snapshot, e)
        return None
    except jwt.InvalidAudienceError as e:
        _log_jwt_failure("invalid_audience", token_snapshot, e)
        return None
    except jwt.InvalidSignatureError as e:
        _log_jwt_failure("invalid_signature", token_snapshot, e)
        return None
    except jwt.InvalidTokenError as e:
        _log_jwt_failure("invalid_token", token_snapshot, e)
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


async def ensure_clerk_entities(
    payload: Dict[str, Any], org_id: str
) -> None:  # NOSONAR
    """
    Provisiona Tenant/User localmente a partir do JWT do Clerk.

    Performance: Cacheia entidades já provisionadas em memória (TTL 5min).
    Executa em best effort: falhas são logadas e não bloqueiam a requisição.
    """
    if not settings.database.is_postgres:
        return

    user_id = payload.get("sub")
    if not user_id:
        return

    # Performance: Skip DB lookup if already provisioned recently
    global _provisioned_entities_cache
    cache_key = (org_id, user_id)
    now = time.monotonic()
    cached_at = _provisioned_entities_cache.get(cache_key)
    if cached_at and (now - cached_at) < _PROVISION_CACHE_TTL:
        return  # Already provisioned recently, skip DB queries

    org_name = payload.get("org_name") or payload.get("organization_name") or org_id
    email = (
        payload.get("email") or payload.get("email_address") or f"{user_id}@clerk.local"
    )

    full_name = payload.get("name")
    if not full_name:
        given = payload.get("given_name") or ""
        family = payload.get("family_name") or ""
        full_name = f"{given} {family}".strip() or None

    try:
        from backend.infrastructure.db_engine import get_session
        from backend.domain.sqlmodels import Tenant, User

        async with get_session() as session:
            tenant = await session.get(Tenant, org_id)
            if not tenant:
                session.add(Tenant(id=org_id, name=org_name))
            elif org_name and tenant.name != org_name:
                tenant.name = org_name

            user = await session.get(User, user_id)
            if not user:
                session.add(
                    User(
                        id=user_id,
                        email=email,
                        full_name=full_name,
                        tenant_id=org_id,
                    )
                )
            else:
                if user.tenant_id != org_id:
                    user.tenant_id = org_id
                if email and user.email != email:
                    user.email = email
                if full_name and user.full_name != full_name:
                    user.full_name = full_name

        # Mark as provisioned in cache
        if len(_provisioned_entities_cache) >= _PROVISION_CACHE_MAX_SIZE:
            # Evict oldest entries
            oldest = sorted(_provisioned_entities_cache.items(), key=lambda x: x[1])[
                :100
            ]
            for k, _ in oldest:
                del _provisioned_entities_cache[k]
        _provisioned_entities_cache[cache_key] = now

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

    async def __call__(self, scope, receive, send):  # NOSONAR
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

        # 2. Extrair org_id do JWT
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("latin-1")
        jwt_payload = None
        org_id = None

        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            jwt_payload = await decode_clerk_jwt(token)
            if jwt_payload:
                org_id = jwt_payload.get("org_id")

        # 2c. Query param (para debugging em desenvolvimento)
        if not org_id and settings.server.env == "development":
            query_string = scope.get("query_string", b"").decode("latin-1")
            for part in query_string.split("&"):
                if part.startswith("_tenant="):
                    org_id = part[8:]
                    break

        # 3. Fallback para desenvolvimento
        if (
            not org_id
            and settings.server.env == "development"
            and settings.features.debug_mode
        ):
            org_id = "org_default"

        # 3b. Em produção com Postgres, tenant é obrigatório
        if (
            not org_id
            and settings.server.env != "development"
            and settings.database.is_postgres
        ):
            response = JSONResponse(
                status_code=401,
                content={"success": False, "detail": "Tenant não identificado"},
            )
            await response(scope, receive, send)
            return

        # 4. Log para debugging
        if org_id:
            logger.debug(
                "Request %s %s - Tenant: %s", scope.get("method", "?"), path, org_id
            )
        else:
            logger.debug(
                "Request %s %s - No tenant (public)", scope.get("method", "?"), path
            )

        # 5. Definir no contexto e passar adiante (sem buffering!)
        token_var = None
        if org_id:
            token_var = tenant_context.set(org_id)

        try:
            await self.app(scope, receive, send)
        finally:
            if token_var:
                tenant_context.reset(token_var)

        # Provisiona entidades Clerk após a resposta ser enviada ao cliente
        if jwt_payload and org_id:
            asyncio.ensure_future(ensure_clerk_entities(jwt_payload.copy(), org_id))


def get_current_tenant() -> Optional[str]:
    """
    Utility function para obter tenant atual em qualquer lugar do código.

    Uso:
        from backend.server.middleware import get_current_tenant
        tenant_id = get_current_tenant()
    """
    return tenant_context.get() or None
