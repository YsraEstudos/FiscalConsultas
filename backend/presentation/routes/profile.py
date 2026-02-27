"""
Endpoints REST para Perfil de Usuário.

Segue o padrão de routes do projeto: FastAPI Router com Depends de sessão,
autenticação via decode_clerk_jwt.
"""

import logging
from typing import Annotated

from backend.config.settings import settings
from backend.infrastructure.db_engine import get_db
from backend.presentation.schemas.profile_schemas import (
    ContributionItem,
    ContributionsResponse,
    UserCardResponse,
    UserProfileResponse,
    UserProfileUpdate,
)
from backend.server.middleware import (
    decode_clerk_jwt,
    get_current_tenant,
    get_last_jwt_failure_reason,
)
from backend.services.profile_service import ProfileService
from backend.utils.auth import extract_bearer_token
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("routes.profile")

router = APIRouter(prefix="/profile", tags=["Profile"])

ERROR_TENANT_MISSING = "Tenant não identificado"


# ─── Dependências ──────────────────────────────────────────────────────────


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

    if not payload.get("sub"):
        reason = get_last_jwt_failure_reason()
        if settings.server.env == "development" and reason:
            raise HTTPException(  # NOSONAR
                status_code=401, detail=f"Token inválido ou expirado ({reason})"
            )
        raise HTTPException(
            status_code=401, detail="Token inválido ou expirado"
        )  # NOSONAR
    return payload


def _get_service(session: Annotated[AsyncSession, Depends(get_db)]) -> ProfileService:
    return ProfileService(session)


def _resolve_tenant(payload: dict) -> str:
    """Resolve tenant_id do contexto ou do JWT claim."""
    context_tenant_id = get_current_tenant()
    payload_tenant_id = payload.get("org_id")

    if context_tenant_id and payload_tenant_id and context_tenant_id != payload_tenant_id:
        raise HTTPException(status_code=403, detail="Tenant inválido para token")  # NOSONAR

    tenant_id = context_tenant_id or payload_tenant_id
    if not tenant_id:
        raise HTTPException(status_code=400, detail=ERROR_TENANT_MISSING)  # NOSONAR
    return tenant_id


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.get(
    "/me",
    response_model=UserProfileResponse,
    responses={
        401: {"description": "Unauthorized"},
        404: {"description": "User not found"},
    },
)
async def get_my_profile(
    request: Request,
    service: Annotated[ProfileService, Depends(_get_service)],
):
    """Retorna perfil completo do usuário autenticado com estatísticas."""
    payload = await _require_payload(request)
    user_id: str = payload.get("sub", "")
    tenant_id = _resolve_tenant(payload)
    image_url = payload.get("image_url") or payload.get("picture")

    try:
        profile = await service.get_profile(user_id, tenant_id, image_url=image_url)
        return UserProfileResponse(**profile)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR


@router.patch(
    "/me",
    response_model=UserProfileResponse,
    responses={
        401: {"description": "Unauthorized"},
        404: {"description": "User not found"},
    },
)
async def update_my_profile(
    data: UserProfileUpdate,
    request: Request,
    service: Annotated[ProfileService, Depends(_get_service)],
):
    """Atualiza o perfil do usuário (bio)."""
    payload = await _require_payload(request)
    user_id: str = payload.get("sub", "")
    tenant_id = _resolve_tenant(payload)
    image_url = payload.get("image_url") or payload.get("picture")

    try:
        profile = await service.update_bio(user_id, tenant_id, data, image_url=image_url)
        return UserProfileResponse(**profile)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR


@router.get(
    "/me/contributions",
    response_model=ContributionsResponse,
    responses={
        401: {"description": "Unauthorized"},
    },
)
async def get_my_contributions(
    request: Request,
    service: Annotated[ProfileService, Depends(_get_service)],
    page: Annotated[int, Query(ge=1, description="Página")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Itens por página")] = 20,
    search: Annotated[str | None, Query(max_length=200, description="Busca por texto")] = None,
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            description="Filtrar por status (pending, approved, rejected, private)",
        ),
    ] = None,
):
    """Lista paginada de contribuições (comentários) do usuário."""
    payload = await _require_payload(request)
    user_id: str = payload.get("sub", "")
    tenant_id = _resolve_tenant(payload)

    result = await service.get_contributions(
        user_id,
        tenant_id,
        page=page,
        page_size=page_size,
        search=search,
        status_filter=status_filter,
    )
    return ContributionsResponse(
        items=[ContributionItem.model_validate(item) for item in result["items"]],
        total=result["total"],
        page=result["page"],
        page_size=result["page_size"],
        has_next=result["has_next"],
    )


@router.get(
    "/{user_id}/card",
    response_model=UserCardResponse,
    responses={
        401: {"description": "Unauthorized"},
        404: {"description": "User not found"},
    },
)
async def get_user_card(
    user_id: str,
    request: Request,
    service: Annotated[ProfileService, Depends(_get_service)],
):
    """Mini-card público de um usuário para hover tooltip."""
    payload = await _require_payload(request)
    tenant_id = _resolve_tenant(payload)

    try:
        card = await service.get_user_card(user_id, tenant_id)
        return UserCardResponse(**card)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR


@router.delete(
    "/me",
    responses={
        401: {"description": "Unauthorized"},
        404: {"description": "User not found"},
        500: {"description": "Internal Server Error"},
    },
)
async def delete_my_account(
    request: Request,
    service: Annotated[ProfileService, Depends(_get_service)],
):
    """
    Desativa a conta do usuário.

    Soft-delete local (desativa no DB). A exclusão definitiva no Clerk
    requer CLERK_SECRET_KEY e deve ser feita via Clerk Dashboard ou
    Backend API separadamente.
    """
    payload = await _require_payload(request)
    user_id: str = payload.get("sub", "")
    tenant_id = _resolve_tenant(payload)

    try:
        await service.delete_account(user_id, tenant_id)
        return {"success": True, "detail": "Conta desativada com sucesso"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e  # NOSONAR
    except Exception as e:
        logger.error("Erro ao desativar conta %s: %s", user_id, e)
        raise HTTPException(
            status_code=500, detail="Erro interno ao desativar conta"
        ) from e  # NOSONAR
