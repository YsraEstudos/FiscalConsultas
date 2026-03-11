from typing import Annotated

from backend.config.constants import SearchConfig
from backend.config.exceptions import ValidationError
from backend.config.settings import settings
from backend.server.middleware import decode_clerk_jwt, get_last_jwt_failure_reason
from backend.server.rate_limit import (
    services_detail_rate_limiter,
    services_search_rate_limiter,
)
from backend.server.dependencies import get_nbs_service
from backend.services.nbs_service import NbsService
from backend.utils.auth import extract_bearer_token, extract_client_ip
from fastapi import APIRouter, Depends, HTTPException, Query, Request

router = APIRouter()


async def _require_payload(request: Request) -> dict:
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Token ausente")  # NOSONAR

    payload = await decode_clerk_jwt(token)
    if not payload:
        reason = get_last_jwt_failure_reason()
        detail = "Token inválido ou expirado"
        if reason:
            detail = f"{detail} ({reason})"
        raise HTTPException(status_code=401, detail=detail)  # NOSONAR
    return payload


def _services_limiter_key(request: Request, payload: dict) -> str:
    user_id = payload.get("sub")
    if isinstance(user_id, str) and user_id.strip():
        return f"services:user:{user_id.strip()}"
    return f"services:ip:{extract_client_ip(request)}"


async def _apply_search_rate_limit(request: Request, payload: dict) -> None:
    allowed, retry_after = await services_search_rate_limiter.consume(
        key=_services_limiter_key(request, payload),
        limit=settings.security.services_search_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for services search. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


async def _apply_detail_rate_limit(request: Request, payload: dict) -> None:
    allowed, retry_after = await services_detail_rate_limiter.consume(
        key=_services_limiter_key(request, payload),
        limit=settings.security.services_detail_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for services detail. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


@router.get("/nbs/search")
async def search_nbs(
    request: Request,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    q: Annotated[str, Query(description="Código NBS ou descrição")] = "",
):
    payload = await _require_payload(request)
    await _apply_search_rate_limit(request, payload)
    if len(q) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="q",
        )
    return await service.search(q)


@router.get("/nbs/{code}")
async def get_nbs_detail(
    request: Request,
    code: str,
    service: Annotated[NbsService, Depends(get_nbs_service)],
):
    payload = await _require_payload(request)
    await _apply_detail_rate_limit(request, payload)
    if not code.strip():
        raise ValidationError("Parâmetro 'code' é obrigatório", field="code")
    return await service.get_item_details(code)


@router.get("/nebs/search")
async def search_nebs(
    request: Request,
    service: Annotated[NbsService, Depends(get_nbs_service)],
    q: Annotated[str, Query(description="Código NEBS ou termo textual")] = "",
):
    payload = await _require_payload(request)
    await _apply_search_rate_limit(request, payload)
    if len(q) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="q",
        )
    return await service.search_nebs(q)


@router.get("/nebs/{code}")
async def get_nebs_detail(
    request: Request,
    code: str,
    service: Annotated[NbsService, Depends(get_nbs_service)],
):
    payload = await _require_payload(request)
    await _apply_detail_rate_limit(request, payload)
    if not code.strip():
        raise ValidationError("Parâmetro 'code' é obrigatório", field="code")
    return await service.get_nebs_details(code)
