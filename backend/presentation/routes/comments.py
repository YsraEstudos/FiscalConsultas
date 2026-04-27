"""
Endpoints REST para Comentários Contextuais.

Segue o padrão de routes do projeto: FastAPI Router com Depends de sessão,
autenticação via decode_clerk_jwt e verificação de admin via is_admin_payload.
"""

import logging
from typing import Annotated
from urllib.parse import urlparse

from backend.config.settings import settings
from backend.infrastructure.db_engine import get_db
from backend.presentation.schemas.comment_schemas import (
    ANCHOR_KEY_PATTERN,
    CommentApproveIn,
    CommentCreate,
    CommentOut,
    CommentUpdate,
)
from backend.server.middleware import (
    decode_clerk_jwt,
    get_current_tenant,
    get_last_jwt_failure_reason,
    _resolve_full_name,
)
from backend.server.rate_limit import (
    comment_admin_rate_limiter,
    comment_create_rate_limiter,
    comment_read_rate_limiter,
)
from backend.services.comment_service import COMMENT_NOT_FOUND, CommentService
from backend.utils.auth import extract_bearer_token, is_admin_payload
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("routes.comments")

router = APIRouter(prefix="/comments", tags=["Comments"])

ERROR_TENANT_MISSING = "Tenant não identificado"
PERMISSION_DENIED = "Sem permissão"
COMMENT_WRITE_LIMIT_DETAIL = "Limite de operações de escrita em comentários excedido"
RATE_LIMIT_RESPONSE = {429: {"description": "Rate limit exceeded"}}
COMMENT_CREATE_LIMIT_PER_MINUTE = 10
COMMENT_READ_LIMIT_PER_MINUTE = 60
COMMENT_ADMIN_LIMIT_PER_MINUTE = 30
ALLOWED_CLERK_IMAGE_HOSTS = {
    "img.clerk.com",
    "img.clerkstage.com",
    "images.clerk.dev",
}


# ─── Dependências de Autenticação ──────────────────────────────────────────


def _tenant_from_auth_payload(auth_payload: dict) -> str:
    tenant_id = get_current_tenant()
    if tenant_id:
        return tenant_id

    fallback_tenant = auth_payload.get("org_id")
    if isinstance(fallback_tenant, str) and fallback_tenant:
        return fallback_tenant

    raise HTTPException(status_code=400, detail=ERROR_TENANT_MISSING)  # NOSONAR


def _resolve_comment_author_identity(
    auth_payload: dict,
) -> tuple[str | None, str | None]:
    full_name = _resolve_full_name(auth_payload)
    if isinstance(full_name, str):
        full_name = full_name.strip() or None

    raw_image_url = auth_payload.get("image_url")
    trimmed_image_url = (
        raw_image_url.strip()
        if isinstance(raw_image_url, str) and raw_image_url.strip()
        else None
    )
    raw_picture = auth_payload.get("picture")
    trimmed_picture = (
        raw_picture.strip()
        if isinstance(raw_picture, str) and raw_picture.strip()
        else None
    )
    image_url = _sanitize_clerk_image_url(trimmed_image_url or trimmed_picture)

    return full_name, image_url


def _sanitize_clerk_image_url(value: str | None) -> str | None:
    if not value or len(value) > 1024:
        return None
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme.lower() != "https":
        return None
    if hostname not in ALLOWED_CLERK_IMAGE_HOSTS:
        return None
    return value


async def _consume_rate_limit(
    *,
    limiter,
    key: str,
    limit: int,
    detail: str,
) -> None:
    allowed, retry_after = await limiter.consume(key=key, limit=limit)
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(retry_after)},
    )


async def _require_payload(request: Request) -> dict:
    """Valida JWT e retorna o payload; levanta 401 se inválido."""
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Token ausente")  # NOSONAR

    payload = await decode_clerk_jwt(token)
    if not payload:
        reason = get_last_jwt_failure_reason()
        if settings.server.env == "development" and reason:
            raise HTTPException(  # NOSONAR
                status_code=401, detail=f"Token inválido ou expirado ({reason})"
            )
        raise HTTPException(
            status_code=401, detail="Token inválido ou expirado"
        )  # NOSONAR
    return payload


async def _require_admin_payload(request: Request) -> dict:
    """Valida JWT e verifica papel de admin; levanta 403 se não for admin."""
    payload = await _require_payload(request)
    if not is_admin_payload(payload):
        raise HTTPException(
            status_code=403, detail="Acesso restrito a administradores"
        )  # NOSONAR
    return payload


def _get_service(session: Annotated[AsyncSession, Depends(get_db)]) -> CommentService:
    return CommentService(session)


# ─── Endpoints Públicos (usuário autenticado) ──────────────────────────────


@router.post(
    "/",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        **RATE_LIMIT_RESPONSE,
        500: {"description": "Internal Server Error"},
    },
)
async def create_comment(
    payload: CommentCreate,
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Cria um novo comentário ancorado a um trecho de texto."""
    auth_payload = await _require_payload(request)
    tenant_id = _tenant_from_auth_payload(auth_payload)
    user_id: str = auth_payload.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_create_rate_limiter,
        key=f"{tenant_id}:{user_id}",
        limit=COMMENT_CREATE_LIMIT_PER_MINUTE,
        detail=COMMENT_WRITE_LIMIT_DETAIL,
    )
    user_name, user_image_url = _resolve_comment_author_identity(auth_payload)
    try:
        comment = await service.create_comment(
            payload,
            tenant_id,
            user_id,
            user_name=user_name,
            user_image_url=user_image_url,
        )
        return CommentOut.model_validate(comment)
    except Exception as e:
        logger.error("Erro ao criar comentário: %s", e)
        raise HTTPException(  # NOSONAR
            status_code=500, detail="Erro interno ao criar comentário"
        ) from e


@router.get(
    "/anchor/{anchor_key}",
    response_model=list[CommentOut],
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        **RATE_LIMIT_RESPONSE,
    },
)
async def list_by_anchor(
    anchor_key: Annotated[str, Path(pattern=ANCHOR_KEY_PATTERN)],
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Lista comentários aprovados + privados do usuário para um anchor."""
    auth_payload = await _require_payload(request)
    tenant_id = _tenant_from_auth_payload(auth_payload)
    user_id: str = auth_payload.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_read_rate_limiter,
        key=f"{tenant_id}:{user_id}",
        limit=COMMENT_READ_LIMIT_PER_MINUTE,
        detail="Limite de leitura de comentários excedido",
    )
    comments = await service.list_for_anchor(
        tenant_id, anchor_key, user_id, limit=limit, offset=offset
    )
    return [CommentOut.model_validate(c) for c in comments]


@router.patch(
    "/{comment_id}",
    response_model=CommentOut,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
        **RATE_LIMIT_RESPONSE,
        500: {"description": "Internal Server Error"},
    },
)
async def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Edita o corpo de um comentário (somente autor)."""
    auth_payload = await _require_payload(request)
    tenant_id = _tenant_from_auth_payload(auth_payload)
    user_id: str = auth_payload.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_create_rate_limiter,
        key=f"{tenant_id}:{user_id}",
        limit=COMMENT_CREATE_LIMIT_PER_MINUTE,
        detail=COMMENT_WRITE_LIMIT_DETAIL,
    )
    try:
        comment = await service.update_comment(comment_id, payload, tenant_id, user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=COMMENT_NOT_FOUND) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED) from e
    except Exception as e:
        logger.error("Erro ao editar comentário %s: %s", comment_id, e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao editar"
        ) from e  # NOSONAR


@router.delete(
    "/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
        **RATE_LIMIT_RESPONSE,
        500: {"description": "Internal Server Error"},
    },
)
async def delete_comment(
    comment_id: int,
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Remove permanentemente um comentário (somente autor)."""
    auth_payload = await _require_payload(request)
    tenant_id = _tenant_from_auth_payload(auth_payload)
    user_id: str = auth_payload.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_create_rate_limiter,
        key=f"{tenant_id}:{user_id}",
        limit=COMMENT_CREATE_LIMIT_PER_MINUTE,
        detail=COMMENT_WRITE_LIMIT_DETAIL,
    )
    try:
        await service.delete_comment(comment_id, tenant_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=COMMENT_NOT_FOUND) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED) from e
    except Exception as e:
        logger.error("Erro ao deletar comentário %s: %s", comment_id, e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao deletar"
        ) from e  # NOSONAR


@router.get(
    "/anchors",
    response_model=list[str],
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        **RATE_LIMIT_RESPONSE,
    },
)
async def list_commented_anchors(
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Lista anchor_keys que possuem comentários aprovados (para marcar no frontend)."""
    auth_payload = await _require_payload(request)
    tenant_id = _tenant_from_auth_payload(auth_payload)
    user_id: str = auth_payload.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_read_rate_limiter,
        key=f"{tenant_id}:{user_id}",
        limit=COMMENT_READ_LIMIT_PER_MINUTE,
        detail="Limite de leitura de comentários excedido",
    )
    return await service.get_commented_anchors(tenant_id)


# ─── Endpoints Admin ───────────────────────────────────────────────────────


@router.get(
    "/admin/pending",
    response_model=list[CommentOut],
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        **RATE_LIMIT_RESPONSE,
    },
)
async def list_pending(
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """[Admin] Lista todos os comentários pendentes de moderação."""
    admin_info = await _require_admin_payload(request)
    tenant_id = _tenant_from_auth_payload(admin_info)
    admin_user_id: str = admin_info.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_admin_rate_limiter,
        key=f"{tenant_id}:{admin_user_id}",
        limit=COMMENT_ADMIN_LIMIT_PER_MINUTE,
        detail="Limite de moderação excedido",
    )
    comments = await service.list_pending(tenant_id, limit=limit, offset=offset)
    return [CommentOut.model_validate(c) for c in comments]


@router.patch(
    "/admin/{comment_id}",
    response_model=CommentOut,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
        **RATE_LIMIT_RESPONSE,
        500: {"description": "Internal Server Error"},
    },
)
async def moderate_comment(
    comment_id: int,
    payload: CommentApproveIn,
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """[Admin] Aprova ou rejeita um comentário."""
    admin_info = await _require_admin_payload(request)
    tenant_id = _tenant_from_auth_payload(admin_info)
    admin_user_id: str = admin_info.get("sub", "")
    await _consume_rate_limit(
        limiter=comment_admin_rate_limiter,
        key=f"{tenant_id}:{admin_user_id}",
        limit=COMMENT_ADMIN_LIMIT_PER_MINUTE,
        detail="Limite de moderação excedido",
    )
    try:
        comment = await service.moderate(comment_id, payload, tenant_id, admin_user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=COMMENT_NOT_FOUND) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=PERMISSION_DENIED) from e
    except Exception as e:
        logger.error("Erro ao moderar comentário %s: %s", comment_id, e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao moderar"
        ) from e  # NOSONAR
