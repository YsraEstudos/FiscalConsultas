"""
Endpoints REST para Comentários Contextuais.

Segue o padrão de routes do projeto: FastAPI Router com Depends de sessão,
autenticação via decode_clerk_jwt e verificação de admin via is_admin_payload.
"""

import logging
from typing import Annotated

from backend.config.settings import settings
from backend.infrastructure.db_engine import get_db
from backend.presentation.schemas.comment_schemas import (
    CommentApproveIn,
    CommentCreate,
    CommentOut,
    CommentUpdate,
)
from backend.server.middleware import (
    decode_clerk_jwt,
    get_current_tenant,
    get_last_jwt_failure_reason,
)
from backend.services.comment_service import CommentService
from backend.utils.auth import extract_bearer_token, is_admin_payload
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("routes.comments")

router = APIRouter(prefix="/comments", tags=["Comments"])

ERROR_TENANT_MISSING = "Tenant não identificado"


# ─── Dependências de Autenticação ──────────────────────────────────────────


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


def _resolve_tenant_id(auth_payload: dict) -> str:
    tenant_id = get_current_tenant() or auth_payload.get("org_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail=ERROR_TENANT_MISSING)  # NOSONAR
    return tenant_id


# ─── Endpoints Públicos (usuário autenticado) ──────────────────────────────


@router.post(
    "/",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
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
    tenant_id = _resolve_tenant_id(auth_payload)

    user_id: str = auth_payload.get("sub", "")
    try:
        comment = await service.create_comment(payload, tenant_id, user_id)
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
    },
)
async def list_by_anchor(
    anchor_key: str,
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Lista comentários aprovados + privados do usuário para um anchor."""
    auth_payload = await _require_payload(request)
    tenant_id = _resolve_tenant_id(auth_payload)

    user_id: str = auth_payload.get("sub", "")
    comments = await service.list_for_anchor(tenant_id, anchor_key, user_id)
    return [CommentOut.model_validate(c) for c in comments]


@router.patch(
    "/{comment_id}",
    response_model=CommentOut,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
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
    tenant_id = _resolve_tenant_id(auth_payload)

    user_id: str = auth_payload.get("sub", "")
    try:
        comment = await service.update_comment(comment_id, payload, tenant_id, user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e  # NOSONAR
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
    tenant_id = _resolve_tenant_id(auth_payload)

    user_id: str = auth_payload.get("sub", "")
    try:
        await service.delete_comment(comment_id, tenant_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e  # NOSONAR
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
    },
)
async def list_commented_anchors(
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """Lista anchor_keys que possuem comentários aprovados (para marcar no frontend)."""
    auth_payload = await _require_payload(request)
    tenant_id = _resolve_tenant_id(auth_payload)

    return await service.get_commented_anchors(tenant_id)


# ─── Endpoints Admin ───────────────────────────────────────────────────────


@router.get(
    "/admin/pending",
    response_model=list[CommentOut],
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
    },
)
async def list_pending(
    request: Request,
    service: Annotated[CommentService, Depends(_get_service)],
):
    """[Admin] Lista todos os comentários pendentes de moderação."""
    auth_payload = await _require_admin_payload(request)
    tenant_id = _resolve_tenant_id(auth_payload)

    comments = await service.list_pending(tenant_id)
    return [CommentOut.model_validate(c) for c in comments]


@router.patch(
    "/admin/{comment_id}",
    response_model=CommentOut,
    responses={
        400: {"description": "Bad Request"},
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Not Found"},
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
    tenant_id = _resolve_tenant_id(admin_info)

    admin_user_id: str = admin_info.get("sub", "")
    try:
        comment = await service.moderate(comment_id, payload, tenant_id, admin_user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e  # NOSONAR
    except Exception as e:
        logger.error("Erro ao moderar comentário %s: %s", comment_id, e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao moderar"
        ) from e  # NOSONAR
