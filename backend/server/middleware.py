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
from contextvars import ContextVar
from typing import Optional, Any, Dict
import jwt
from jwt import PyJWKClient
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.config.settings import settings

try:
    from backend.infrastructure.db_engine import tenant_context
except ModuleNotFoundError:
    # Fallback para evitar crash de import quando db_engine ainda não existe no branch.
    tenant_context: ContextVar[str] = ContextVar("tenant_context", default="")

logger = logging.getLogger("middleware.tenant")

# Cache do JWKS client (Clerk public keys)
_jwks_client: Optional[PyJWKClient] = None

# JWT decode cache
_jwt_decode_cache: dict[int, tuple[dict, float, Optional[float]]] = {}
_JWT_CACHE_TTL = 60.0
_JWT_CACHE_MAX_SIZE = 1000

# Provisioning cache
_provisioned_entities_cache: dict[tuple[str, str], float] = {}
_PROVISION_CACHE_TTL = 300.0
_PROVISION_CACHE_MAX_SIZE = 5000


def get_jwks_client() -> Optional[PyJWKClient]:
    """
    Retorna JWKS client para validação de tokens Clerk.
    Clerk publica suas chaves públicas em: https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json
    """
    global _jwks_client
    if _jwks_client is None:
        clerk_domain = settings.auth.clerk_domain
        if clerk_domain:
            jwks_url = f"https://{clerk_domain}/.well-known/jwks.json"
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


def decode_clerk_jwt(token: str) -> Optional[dict]:
    """
    Valida e decodifica JWT do Clerk.
    Performance: Cacheia resultado por hash do token (TTL 60s).

    Returns:
        Payload decodificado ou None se inválido/expirado.
    """
    # Performance: Check cache first
    global _jwt_decode_cache
    token_hash = hash(token)
    now_monotonic = time.monotonic()
    cached = _jwt_decode_cache.get(token_hash)
    if cached:
        payload, cached_at, exp_epoch = cached
        if now_monotonic - cached_at < _JWT_CACHE_TTL:
            if exp_epoch is not None and time.time() >= exp_epoch:
                del _jwt_decode_cache[token_hash]
                return None
            return payload
        else:
            del _jwt_decode_cache[token_hash]

    try:
        jwks_client = get_jwks_client()

        if jwks_client:
            # Produção: Validar assinatura com JWKS
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                options={"verify_aud": False}  # Clerk não sempre define audience
            )
        elif settings.server.env != "development":
            logger.error("Clerk domain não configurado; JWT não pode ser validado")
            return None
        else:
            # Desenvolvimento: Decodificar sem validar assinatura
            payload = jwt.decode(token, options={"verify_signature": False})

        if _is_payload_expired(payload):
            logger.warning("JWT expirado")
            return None

        # Cache the result
        if len(_jwt_decode_cache) >= _JWT_CACHE_MAX_SIZE:
            # Evict oldest entries
            oldest_keys = sorted(_jwt_decode_cache, key=lambda k: _jwt_decode_cache[k][1])[:50]
            for k in oldest_keys:
                del _jwt_decode_cache[k]
        _jwt_decode_cache[token_hash] = (payload, now_monotonic, _get_payload_exp(payload))
        return payload

    except jwt.ExpiredSignatureError:
        logger.warning("JWT expirado")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"JWT inválido: {e}")
        return None
    except Exception as e:
        logger.error(f"Erro ao processar JWT: {e}")
        return None


def is_clerk_token_valid(token: str) -> bool:
    """Retorna True se o JWT do Clerk for válido."""
    return decode_clerk_jwt(token) is not None


async def ensure_clerk_entities(payload: Dict[str, Any], org_id: str) -> None:
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
    email = payload.get("email") or payload.get("email_address") or f"{user_id}@clerk.local"

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
            oldest = sorted(_provisioned_entities_cache.items(), key=lambda x: x[1])[:100]
            for k, _ in oldest:
                del _provisioned_entities_cache[k]
        _provisioned_entities_cache[cache_key] = now

    except Exception as e:
        logger.warning(f"Provisioning Clerk entities falhou (org={org_id}): {e}")


def extract_org_from_jwt(token: str) -> Optional[str]:
    """
    Extrai org_id do JWT do Clerk.
    
    Returns:
        org_id ou None se não encontrado/inválido
    """
    payload = decode_clerk_jwt(token)
    if not payload:
        return None

    org_id = payload.get("org_id")
    if org_id:
        logger.debug(f"Tenant extraído do JWT: {org_id}")
    return org_id


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Middleware para extrair o tenant_id (org_id) do token Clerk e definir no contextvar.
    
    Este middleware é a ponte entre a autenticação do Clerk e o Row-Level Security (RLS)
    do PostgreSQL.
    """
    
    # Rotas de API que não precisam de tenant
    PUBLIC_PATHS = {
        "/api/auth/me", "/api/status", "/api/webhooks",
    }
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 0. Só processa APIs; arquivos estáticos/frontend não exigem tenant
        if not path.startswith("/api"):
            return await call_next(request)

        # 1. Ignorar rotas públicas
        if any(path.startswith(p) for p in self.PUBLIC_PATHS):
            return await call_next(request)

        # 2. Tentar extrair org_id de diferentes fontes
        org_id = None

        # 2a. JWT do Authorization header
        auth_header = request.headers.get("Authorization", "")
        jwt_payload = None
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]  # Remove "Bearer "
            jwt_payload = decode_clerk_jwt(token)
            if jwt_payload:
                org_id = jwt_payload.get("org_id")
        
        # 2c. Query param (para debugging em desenvolvimento)
        if not org_id and settings.server.env == "development":
            org_id = request.query_params.get("_tenant")
        
        # 3. Fallback para desenvolvimento
        if not org_id and settings.server.env == "development":
            org_id = "org_default"  # Tenant padrão criado na migração

        # 3b. Em produção com Postgres, tenant é obrigatório
        if not org_id and settings.server.env != "development" and settings.database.is_postgres:
            return JSONResponse(
                status_code=401,
                content={"success": False, "detail": "Tenant não identificado"}
            )
        
        # 4. Log para debugging
        if org_id:
            logger.debug(f"Request {request.method} {request.url.path} - Tenant: {org_id}")
        else:
            logger.debug(f"Request {request.method} {request.url.path} - No tenant (public)")
            
        # 5. Definir no contexto para ser lido pelo db_engine
        token_var = None
        if org_id:
            token_var = tenant_context.set(org_id)
            
        try:
            if jwt_payload and org_id:
                await ensure_clerk_entities(jwt_payload, org_id)
            return await call_next(request)
        finally:
            if token_var:
                tenant_context.reset(token_var)


def get_current_tenant() -> Optional[str]:
    """
    Utility function para obter tenant atual em qualquer lugar do código.
    
    Uso:
        from backend.server.middleware import get_current_tenant
        tenant_id = get_current_tenant()
    """
    return tenant_context.get() or None
