from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from backend.config.constants import SearchConfig
from backend.config.exceptions import ValidationError
from backend.config.settings import settings
from backend.server.dependencies import get_nbs_service
from backend.server.rate_limit import (
    services_detail_rate_limiter,
    services_search_rate_limiter,
)
from backend.services.nbs_service import (
    DEFAULT_TREE_PAGE,
    DEFAULT_TREE_PAGE_SIZE,
    MAX_TREE_PAGE_SIZE,
    NbsService,
)
from backend.utils.auth import extract_client_ip

router = APIRouter()
MAX_SERVICE_CODE_LENGTH = 64

SERVICE_SEARCH_RESPONSES = {
    429: {
        "description": "Limite de requisições para busca de serviços excedido.",
    },
}
SERVICE_DETAIL_RESPONSES = {
    429: {
        "description": "Limite de requisições para detalhes de serviços excedido.",
    },
}


def build_nbs_services_rate_limit_key(
    request: Request, payload: dict | None = None
) -> str:
    user_id = (payload or {}).get("sub")
    if isinstance(user_id, str) and user_id.strip():
        return f"services:user:{user_id.strip()}"
    return f"services:ip:{extract_client_ip(request)}"


async def apply_nbs_services_search_rate_limit(
    request: Request, payload: dict | None = None
) -> None:
    allowed, retry_after = await services_search_rate_limiter.consume(
        key=build_nbs_services_rate_limit_key(request, payload),
        limit=settings.security.services_search_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for services search. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


async def apply_nbs_services_detail_rate_limit(
    request: Request, payload: dict | None = None
) -> None:
    allowed, retry_after = await services_detail_rate_limiter.consume(
        key=build_nbs_services_rate_limit_key(request, payload),
        limit=settings.security.services_detail_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for services detail. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


def normalize_nbs_service_code(code: str) -> str:
    normalized = code.strip()
    if not normalized:
        raise ValidationError("Parâmetro 'code' é obrigatório", field="code")
    if len(normalized) > MAX_SERVICE_CODE_LENGTH:
        raise ValidationError(
            f"Parâmetro 'code' muito longo (máximo {MAX_SERVICE_CODE_LENGTH} caracteres)",
            field="code",
        )
    return normalized


@router.get("/nbs/search", responses=SERVICE_SEARCH_RESPONSES)
async def search_nbs_catalog_entries_route(
    request: Request,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    q: Annotated[str, Query(description="Código NBS ou descrição")] = "",
):
    await apply_nbs_services_search_rate_limit(request)
    if len(q) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="q",
        )
    return await service.searchNbsCatalogEntries(q)


@router.get("/nbs/{code}", responses=SERVICE_DETAIL_RESPONSES)
async def fetch_nbs_catalog_item_details_route(
    request: Request,
    code: str,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    include_tree: Annotated[
        bool, Query(description="Include chapter subtree payload")
    ] = True,
    page: Annotated[
        int, Query(ge=1, description="Tree page number")
    ] = DEFAULT_TREE_PAGE,
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_TREE_PAGE_SIZE,
            description="Tree page size",
        ),
    ] = DEFAULT_TREE_PAGE_SIZE,
):
    await apply_nbs_services_detail_rate_limit(request)
    normalized_code = normalize_nbs_service_code(code)
    return await service.fetchNbsCatalogItemDetails(
        normalized_code,
        include_tree=include_tree,
        page=page,
        page_size=page_size,
    )


@router.get("/nbs/{code}/tree", responses=SERVICE_DETAIL_RESPONSES)
async def fetch_nbs_catalog_tree_page_route(
    request: Request,
    code: str,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    page: Annotated[
        int, Query(ge=1, description="Tree page number")
    ] = DEFAULT_TREE_PAGE,
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_TREE_PAGE_SIZE,
            description="Tree page size",
        ),
    ] = DEFAULT_TREE_PAGE_SIZE,
):
    await apply_nbs_services_detail_rate_limit(request)
    normalized_code = normalize_nbs_service_code(code)
    return await service.fetchNbsCatalogTreePage(
        normalized_code,
        page=page,
        page_size=page_size,
    )


@router.get("/nebs/search", responses=SERVICE_SEARCH_RESPONSES)
async def search_nbs_explanatory_entries_route(
    request: Request,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    q: Annotated[str, Query(description="Código NEBS ou termo textual")] = "",
):
    await apply_nbs_services_search_rate_limit(request)
    if len(q) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="q",
        )
    return await service.searchNbsExplanatoryEntries(q)


@router.get("/nebs/{code}", responses=SERVICE_DETAIL_RESPONSES)
async def fetch_nbs_explanatory_entry_details_route(
    request: Request,
    code: str,
    service: Annotated[NbsService, Depends(get_nbs_service)],
):
    await apply_nbs_services_detail_rate_limit(request)
    normalized_code = normalize_nbs_service_code(code)
    return await service.fetchNbsExplanatoryEntryDetails(normalized_code)
