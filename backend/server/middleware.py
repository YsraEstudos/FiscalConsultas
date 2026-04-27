"""Multi-tenant middleware for Clerk JWT validation and request scoping."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from typing import Any, Optional, Pattern

import jwt
from jwt import PyJWKClient
from starlette.responses import JSONResponse

from backend.config.settings import settings
from backend.infrastructure.db_engine import tenant_context
from backend.server.middleware_context import (
    _jwt_failure_reason_ctx,
    _request_id_ctx,
    _schedule_background_task,
    get_current_request_id,  # noqa: F401 - re-exported for callers
    get_current_tenant,  # noqa: F401 - re-exported for callers
    get_last_jwt_failure_reason,
)
from backend.server.middleware_jwt_support import (
    _build_jwt_decode_kwargs,  # noqa: F401 - re-exported for callers
    _build_temporal_claims_extra,  # noqa: F401 - re-exported for callers
    _build_jwks_url,
    _configured_clock_skew_seconds,  # noqa: F401 - re-exported for callers
    _decode_jwt_with_signature,
    _derive_issuer_hint_from_domain,  # noqa: F401 - re-exported for callers
    _effective_clock_skew_seconds,
    _get_payload_exp,  # noqa: F401 - re-exported for callers
    _is_payload_expired,
    _jwt_error_reason,  # noqa: F401 - re-exported for callers
    _log_jwt_failure,
    _log_jwt_validation_error,
    _log_jwt_validation_success,
    _normalize_clerk_domain,  # noqa: F401 - re-exported for callers
    _normalize_issuer,  # noqa: F401 - re-exported for callers
    _normalize_token_audience,  # noqa: F401 - re-exported for callers
    _parse_clock_skew_seconds,  # noqa: F401 - re-exported for callers
    _resolve_expected_audience,
    _resolve_expected_azp,
    _resolve_expected_issuer,
    _resolve_full_name,  # noqa: F401 - re-exported for callers
    _resolve_identity_fields,
    _resolve_user_id,
    _safe_float_claim,  # noqa: F401 - re-exported for callers
    _safe_get_unverified_claims,  # noqa: F401 - re-exported for callers
    _safe_get_unverified_header,  # noqa: F401 - re-exported for callers
    _token_observability_snapshot,
    _upsert_clerk_entities,
    _validate_expected_audience_claim,
    _validate_expected_azp,
    _validate_expected_issuer,
    _validate_not_before_like_claim,  # noqa: F401 - re-exported for callers
    _validate_temporal_claims,
    _is_recently_provisioned,
    _mark_entities_as_provisioned,
)
from backend.server.middleware_network import (
    is_loopback_host,
    origin_looks_like_loopback,  # noqa: F401 - re-exported for callers
)

logger = logging.getLogger("nesh.middleware.tenant")

# Cache do JWKS client (Clerk public keys)
_jwks_client: Optional[PyJWKClient] = None

# JWT decode cache
_jwt_decode_cache: dict[str, tuple[dict, float, Optional[float]]] = {}
_JWT_CACHE_TTL = 30.0
_JWT_CACHE_MAX_SIZE = 1000

# Provisioning cache
_provisioned_entities_cache: dict[tuple[str, str], float] = {}
_PROVISION_CACHE_TTL = 300.0
_PROVISION_CACHE_MAX_SIZE = 5000
_cached_expected_azp_regex_raw: Optional[str] = None
_cached_expected_azp_regex: Optional[Pattern[str]] = None
_dev_fallback_logged = False


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
_NEVER_MATCH_REGEX = re.compile(r"$^")


def _resolve_expected_azp_regex() -> Optional[Pattern[str]]:
    global _cached_expected_azp_regex_raw, _cached_expected_azp_regex

    raw = (settings.auth.clerk_authorized_parties_regex or "").strip()
    if raw == _cached_expected_azp_regex_raw:
        return _cached_expected_azp_regex

    _cached_expected_azp_regex_raw = raw
    if not raw:
        _cached_expected_azp_regex = None
        return None

    try:
        _cached_expected_azp_regex = re.compile(raw)
    except re.error as error:
        logger.error(
            "AUTH__CLERK_AUTHORIZED_PARTIES_REGEX inválido: %r (%s)", raw, error
        )
        _cached_expected_azp_regex = _NEVER_MATCH_REGEX

    return _cached_expected_azp_regex


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
                "header": {},
                "claims": {k: payload.get(k) for k in _JWT_DEBUG_CLAIM_FIELDS},
            },
            error="Token expirado no cache local",
        )
        return True, None

    return True, payload.copy()


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


async def decode_clerk_jwt(token: str) -> Optional[dict]:
    """
    Valida e decodifica JWT do Clerk.
    Performance: Cacheia resultado por hash do token (_JWT_CACHE_TTL).

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
    expected_azp_regex = _resolve_expected_azp_regex()

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
        _validate_expected_azp(payload, expected_azp, expected_azp_regex)

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


async def is_clerk_token_valid(token: str) -> bool:
    """Retorna True se o JWT do Clerk for válido."""
    return (await decode_clerk_jwt(token)) is not None


async def ensure_clerk_entities(payload: dict[str, Any], org_id: str) -> None:
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
    if _is_recently_provisioned(
        cache_key, now, _provisioned_entities_cache, _PROVISION_CACHE_TTL
    ):
        return

    org_name, email, full_name = _resolve_identity_fields(payload, user_id, org_id)

    try:
        await _upsert_clerk_entities(org_id, user_id, org_name, email, full_name)
        _mark_entities_as_provisioned(
            cache_key, now, _provisioned_entities_cache, _PROVISION_CACHE_MAX_SIZE
        )
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
        "/api/status/details",
        "/api/cache-metrics",
        "/api/metrics",
        "/api/admin/reload-secrets",
        "/api/debug/anchors",
        "/api/search",
        "/api/chapters",
        "/api/glossary",
        "/api/tipi/search",
        "/api/tipi/chapters",
        "/api/webhooks",
        "/api/database/version",
    }
    PUBLIC_PREFIX_PATHS = (
        "/api/webhooks/",
        "/api/nesh/chapter/",
        "/api/search/chapter/",
        "/api/services/nbs/",
        "/api/services/nebs/",
    )

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
    def _extract_client_host(scope: dict[str, Any]) -> Optional[str]:
        client = scope.get("client")
        if isinstance(client, tuple) and client:
            host = client[0]
            if isinstance(host, str):
                return host
        return None

    @staticmethod
    def _extract_request_id(scope: dict[str, Any]) -> str:
        headers = dict(scope.get("headers", []))
        request_id = headers.get(b"x-request-id", b"").decode("latin-1").strip()
        return request_id or uuid.uuid4().hex

    @classmethod
    def _allow_dev_tenant_override(cls, scope: dict[str, Any]) -> bool:
        if settings.server.env != "development" or not settings.features.debug_mode:
            return False
        return is_loopback_host(cls._extract_client_host(scope))

    @staticmethod
    def _extract_debug_tenant(scope: dict[str, Any]) -> Optional[str]:
        if not TenantMiddleware._allow_dev_tenant_override(scope):
            return None
        query_string = scope.get("query_string", b"").decode("latin-1")
        for part in query_string.split("&"):
            if part.startswith("_tenant="):
                tenant = part[8:]
                return tenant or None
        return None

    @staticmethod
    def _resolve_dev_fallback_tenant(
        org_id: Optional[str], *, allow_dev_fallback: bool
    ) -> Optional[str]:
        global _dev_fallback_logged
        if org_id:
            return org_id
        if allow_dev_fallback:
            if not _dev_fallback_logged:
                logger.warning(
                    "Using development fallback tenant org_default for a loopback request"
                )
                _dev_fallback_logged = True
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
    def _log_tenant_resolution(
        scope: dict[str, Any],
        path: str,
        request_id: str,
        org_id: Optional[str],
        jwt_payload: Optional[dict[str, Any]],
    ) -> None:
        if not settings.features.debug_mode:
            return

        method = scope.get("method", "?")
        logger.info(
            "request_tenant_resolution %s",
            json.dumps(
                {
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "tenant": org_id,
                    "token_present": jwt_payload is not None,
                    "jwt_failure_reason": get_last_jwt_failure_reason(),
                },
                ensure_ascii=False,
                default=str,
            ),
        )

    async def _resolve_request_tenant(
        self, scope: dict[str, Any]
    ) -> tuple[Optional[str], Optional[dict[str, Any]]]:
        allow_dev_tenant_override = self._allow_dev_tenant_override(scope)
        token = self._extract_bearer_token(scope)
        if not token:
            org_id = self._extract_debug_tenant(scope)
            return (
                self._resolve_dev_fallback_tenant(
                    org_id, allow_dev_fallback=allow_dev_tenant_override
                ),
                None,
            )

        jwt_payload = await decode_clerk_jwt(token)
        org_id = jwt_payload.get("org_id") if jwt_payload else None
        if not org_id:
            org_id = self._extract_debug_tenant(scope)
        return (
            self._resolve_dev_fallback_tenant(
                org_id, allow_dev_fallback=allow_dev_tenant_override
            ),
            jwt_payload,
        )

    async def _call_with_optional_tenant_context(
        self,
        org_id: Optional[str],
        request_id: str,
        scope: dict[str, Any],
        receive: Any,
        send: Any,
    ) -> None:
        send_wrapper = self._wrap_send_with_request_id(send, request_id, scope, org_id)
        if not org_id:
            await self.app(scope, receive, send_wrapper)
            return

        token_var = tenant_context.set(org_id)
        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            tenant_context.reset(token_var)

    @staticmethod
    async def _send_missing_tenant_response(
        scope: dict[str, Any], receive: Any, send: Any, request_id: str
    ) -> None:
        response = JSONResponse(
            status_code=401,
            content={"success": False, "detail": "Tenant não identificado"},
        )
        send_wrapper = TenantMiddleware._wrap_send_with_request_id(
            send, request_id, scope, None
        )
        await response(scope, receive, send_wrapper)

    @staticmethod
    def _wrap_send_with_request_id(
        send: Any, request_id: str, scope: dict[str, Any], org_id: Optional[str]
    ) -> Any:
        async def send_wrapper(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                header_key = b"x-request-id"
                header_value = request_id.encode("latin-1", "ignore")
                replaced = False
                for idx, (name, _) in enumerate(headers):
                    if isinstance(name, bytes) and name.lower() == header_key:
                        headers[idx] = (name, header_value)
                        replaced = True
                        break
                if not replaced:
                    headers.append((header_key, header_value))

                if settings.features.debug_mode:
                    status = message.get("status")
                    method = scope.get("method", "?")
                    path = scope.get("path", "?")
                    logger.info(
                        "request_response %s",
                        json.dumps(
                            {
                                "request_id": request_id,
                                "method": method,
                                "path": path,
                                "status": status,
                                "tenant": org_id,
                            },
                            ensure_ascii=False,
                            default=str,
                        ),
                    )
                message = {**message, "headers": headers}
            await send(message)

        return send_wrapper

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

        request_id = self._extract_request_id(scope)
        request_token = _request_id_ctx.set(request_id)
        path = scope.get("path", "")

        try:
            # 0. Só processa APIs; arquivos estáticos/frontend não exigem tenant
            if not path.startswith("/api"):
                await self.app(scope, receive, send)
                return

            if settings.features.debug_mode:
                logger.info(
                    "request_received %s",
                    json.dumps(
                        {
                            "request_id": request_id,
                            "method": scope.get("method", "?"),
                            "path": path,
                            "auth_header_present": self._extract_bearer_token(scope)
                            is not None,
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                )

            # 1. Ignorar rotas públicas
            if self._is_public_path(path):
                await self._call_with_optional_tenant_context(
                    None, request_id, scope, receive, send
                )
                return

            org_id, jwt_payload = await self._resolve_request_tenant(scope)
            if self._requires_tenant_rejection(org_id):
                if settings.features.debug_mode:
                    logger.warning(
                        "request_missing_tenant %s",
                        json.dumps(
                            {
                                "request_id": request_id,
                                "method": scope.get("method", "?"),
                                "path": path,
                                "jwt_failure_reason": get_last_jwt_failure_reason(),
                            },
                            ensure_ascii=False,
                            default=str,
                        ),
                    )
                await self._send_missing_tenant_response(
                    scope, receive, send, request_id
                )
                return

            self._log_tenant_resolution(scope, path, request_id, org_id, jwt_payload)
            await self._call_with_optional_tenant_context(
                org_id, request_id, scope, receive, send
            )
            self._schedule_provisioning_if_needed(jwt_payload, org_id)
        finally:
            _request_id_ctx.reset(request_token)
