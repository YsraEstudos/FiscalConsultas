"""
Endpoints REST para Comentários Contextuais.

Segue o padrão de routes do projeto: FastAPI Router com Depends de sessão,
autenticação via decode_clerk_jwt e verificação de admin via is_admin_payload.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.infrastructure.db_engine import get_db
from backend.services.comment_service import CommentService
from backend.presentation.schemas.comment_schemas import (
    CommentCreate,
    CommentOut,
    CommentApproveIn,
    CommentUpdate,
)
from backend.server.middleware import get_current_tenant, decode_clerk_jwt, get_last_jwt_failure_reason
from backend.config.settings import settings
from backend.utils.auth import extract_bearer_token, is_admin_payload

logger = logging.getLogger("routes.comments")

router = APIRouter(prefix="/comments", tags=["Comments"])


# ─── Dependências de Autenticação ──────────────────────────────────────────


def _require_payload(request: Request) -> dict:
    """Valida JWT e retorna o payload; levanta 401 se inválido."""
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Token ausente")

    payload = decode_clerk_jwt(token)
    if not payload:
        reason = get_last_jwt_failure_reason()
        if settings.server.env == "development" and reason:
            raise HTTPException(status_code=401, detail=f"Token inválido ou expirado ({reason})")
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    return payload


def _require_admin_payload(request: Request) -> dict:
    """Valida JWT e verifica papel de admin; levanta 403 se não for admin."""
    payload = _require_payload(request)
    if not is_admin_payload(payload):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return payload


def _get_service(session: AsyncSession = Depends(get_db)) -> CommentService:
    return CommentService(session)


# ─── Endpoints Públicos (usuário autenticado) ──────────────────────────────


@router.post("/", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreate,
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """Cria um novo comentário ancorado a um trecho de texto."""
    auth_payload = _require_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    user_id: str = auth_payload.get("sub", "")
    try:
        comment = await service.create_comment(payload, tenant_id, user_id)
        return CommentOut.model_validate(comment)
    except Exception as e:
        logger.error("Erro ao criar comentário: %s", e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao criar comentário"
        ) from e


@router.get("/anchor/{anchor_key}", response_model=list[CommentOut])
async def list_by_anchor(
    anchor_key: str,
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """Lista comentários aprovados + privados do usuário para um anchor."""
    auth_payload = _require_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    user_id: str = auth_payload.get("sub", "")
    comments = await service.list_for_anchor(tenant_id, anchor_key, user_id)
    return [CommentOut.model_validate(c) for c in comments]


@router.patch("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """Edita o corpo de um comentário (somente autor)."""
    auth_payload = _require_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    user_id: str = auth_payload.get("sub", "")
    try:
        comment = await service.update_comment(comment_id, payload, tenant_id, user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except Exception as e:
        logger.error("Erro ao editar comentário %s: %s", comment_id, e)
        raise HTTPException(status_code=500, detail="Erro interno ao editar") from e


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: int,
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """Remove permanentemente um comentário (somente autor)."""
    auth_payload = _require_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    user_id: str = auth_payload.get("sub", "")
    try:
        await service.delete_comment(comment_id, tenant_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except Exception as e:
        logger.error("Erro ao deletar comentário %s: %s", comment_id, e)
        raise HTTPException(status_code=500, detail="Erro interno ao deletar") from e


@router.get("/anchors", response_model=list[str])
async def list_commented_anchors(
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """Lista anchor_keys que possuem comentários aprovados (para marcar no frontend)."""
    _require_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    return await service.get_commented_anchors(tenant_id)


# ─── Endpoints Admin ───────────────────────────────────────────────────────


@router.get("/admin/pending", response_model=list[CommentOut])
async def list_pending(
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """[Admin] Lista todos os comentários pendentes de moderação."""
    _require_admin_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    comments = await service.list_pending(tenant_id)
    return [CommentOut.model_validate(c) for c in comments]


@router.patch("/admin/{comment_id}", response_model=CommentOut)
async def moderate_comment(
    comment_id: int,
    payload: CommentApproveIn,
    request: Request,
    service: CommentService = Depends(_get_service),
):
    """[Admin] Aprova ou rejeita um comentário."""
    admin_info = _require_admin_payload(request)
    tenant_id = get_current_tenant()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    admin_user_id: str = admin_info.get("sub", "")
    try:
        comment = await service.moderate(comment_id, payload, tenant_id, admin_user_id)
        return CommentOut.model_validate(comment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except Exception as e:
        logger.error("Erro ao moderar comentário %s: %s", comment_id, e)
        raise HTTPException(status_code=500, detail="Erro interno ao moderar") from e
