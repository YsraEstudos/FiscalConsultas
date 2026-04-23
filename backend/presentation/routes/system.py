import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse

from backend.config.settings import is_valid_admin_token, reload_settings, settings
from backend.server.dependencies import get_nesh_service
from backend.server.middleware import decode_clerk_jwt
from backend.server.rate_limit import status_rate_limiter
from backend.services import NeshService
from backend.utils.auth import extract_bearer_token, extract_client_ip, is_admin_payload

from .system_metrics import append_catalog_status_metrics  # noqa: F401 - re-exported for callers
from .system_metrics import append_database_latency_metric  # noqa: F401 - re-exported for callers
from .system_metrics import append_internal_cache_hit_rate_metrics  # noqa: F401 - re-exported for callers
from .system_metrics import append_metric_line  # noqa: F401 - re-exported for callers
from .system_metrics import append_payload_cache_metrics  # noqa: F401 - re-exported for callers
from .system_metrics import build_prometheus_metrics_payload
from .system_metrics import metric_value_from_status  # noqa: F401 - re-exported for callers
from .system_status import await_status_refresh_snapshot  # noqa: F401 - re-exported for callers
from .system_status import build_detailed_status_payload
from .system_status import build_public_status_payload
from .system_status import build_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import coerce_int  # noqa: F401 - re-exported for callers
from .system_status import collect_db_status  # noqa: F401 - re-exported for callers
from .system_status import collect_nbs_catalog_health
from .system_status import collect_status_payloads
from .system_status import collect_status_payloads_uncached  # noqa: F401 - re-exported for callers
from .system_status import collect_tipi_status  # noqa: F401 - re-exported for callers
from .system_status import extract_prefixed_metadata  # noqa: F401 - re-exported for callers
from .system_status import get_status_cache_lock  # noqa: F401 - re-exported for callers
from .system_status import get_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import normalize_count_catalog_status  # noqa: F401 - re-exported for callers
from .system_status import normalize_db_status  # noqa: F401 - re-exported for callers
from .system_status import normalize_tipi_status  # noqa: F401 - re-exported for callers
from .system_status import read_l1_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import read_redis_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import read_stale_l1_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import recover_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import refresh_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import reset_status_cache_for_tests  # noqa: F401 - re-exported for callers
from .system_status import status_cache_ttl_seconds  # noqa: F401 - re-exported for callers
from .system_status import store_status_snapshot  # noqa: F401 - re-exported for callers
from .system_status import unpack_status_snapshot  # noqa: F401 - re-exported for callers

router = APIRouter()
collect_nbs_status = collect_nbs_catalog_health
STATUS_RESPONSES = {
    429: {"description": "Limite de requisições para status excedido."},
}
STATUS_DETAILS_RESPONSES = {
    **STATUS_RESPONSES,
    403: {"description": "Forbidden (admin-only endpoint)."},
}
METRICS_RESPONSES = {
    403: {"description": "Forbidden (invalid metrics token)."},
    404: {"description": "Not Found when metrics endpoint is disabled."},
}


async def _is_admin_request(request: Request) -> bool:
    admin_token = request.headers.get("X-Admin-Token")
    if is_valid_admin_token(admin_token):
        return True

    token = extract_bearer_token(request)
    if not token:
        return False
    payload = await decode_clerk_jwt(token)
    return is_admin_payload(payload)


def _extract_metrics_token(request: Request) -> str | None:
    header_token = request.headers.get("X-Metrics-Token", "").strip()
    if header_token:
        return header_token

    authorization = request.headers.get("Authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _metrics_endpoint_enabled() -> bool:
    return settings.observability.metrics_enabled


def _is_metrics_request_authorized(request: Request) -> bool:
    configured_token = settings.observability.metrics_token.strip()
    if not configured_token:
        return False
    token = _extract_metrics_token(request)
    return bool(token and secrets.compare_digest(token, configured_token))


def _status_limiter_key(request: Request) -> str:
    return f"status:ip:{extract_client_ip(request)}"


async def _apply_status_rate_limit(request: Request) -> None:
    allowed, retry_after = await status_rate_limiter.consume(
        key=_status_limiter_key(request),
        limit=settings.security.status_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for status endpoint. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


async def _collect_system_cache_metrics_payload(request: Request) -> dict:
    from backend.presentation.routes import search as search_route
    from backend.presentation.routes import tipi as tipi_route

    nesh_internal = None
    if hasattr(request.app.state, "service") and request.app.state.service:
        nesh_internal = (
            await request.app.state.service.snapshotNeshInternalCacheMetrics()
        )

    tipi_internal = None
    if hasattr(request.app.state, "tipi_service") and request.app.state.tipi_service:
        tipi_internal = (
            await request.app.state.tipi_service.snapshotTipiInternalCacheMetrics()
        )

    return {
        "status": "ok",
        "search_code_payload_cache": (
            search_route.snapshotSearchCodePayloadCacheMetrics()
        ),
        "tipi_code_payload_cache": (tipi_route.snapshotTipiCodePayloadCacheMetrics()),
        "nesh_internal_caches": nesh_internal,
        "tipi_internal_caches": tipi_internal,
    }


@router.get("/status", responses=STATUS_RESPONSES)
async def fetch_system_status(request: Request):
    await _apply_status_rate_limit(request)
    (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    ) = await collect_status_payloads(request)
    return build_public_status_payload(
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )


@router.head("/status", include_in_schema=False)
async def head_system_status(request: Request):
    await collect_status_payloads(request)
    return Response(status_code=200)


@router.get("/status/details", responses=STATUS_DETAILS_RESPONSES)
async def fetch_system_status_details(request: Request):
    await _apply_status_rate_limit(request)
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    ) = await collect_status_payloads(request)
    return build_detailed_status_payload(
        request,
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )


@router.get(
    "/cache-metrics",
    responses={403: {"description": "Forbidden (admin-only endpoint)."}},
)
async def fetch_system_cache_metrics(request: Request):
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    return await _collect_system_cache_metrics_payload(request)


@router.get(
    "/metrics",
    include_in_schema=False,
    response_class=PlainTextResponse,
    responses=METRICS_RESPONSES,
)
async def fetch_system_metrics(request: Request):
    if not _metrics_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not Found")
    if not _is_metrics_request_authorized(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    await _apply_status_rate_limit(request)

    (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    ) = await collect_status_payloads(request)
    status_payload = build_detailed_status_payload(
        request,
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )
    cache_metrics = await _collect_system_cache_metrics_payload(request)
    payload = build_prometheus_metrics_payload(status_payload, cache_metrics)
    return PlainTextResponse(
        payload,
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get(
    "/debug/anchors",
    responses={
        403: {"description": "Forbidden (admin-only endpoint)."},
        404: {"description": "Not found when debug mode is disabled."},
    },
)
async def debug_nesh_anchors(
    request: Request,
    service: Annotated[NeshService, Depends(get_nesh_service)],
    ncm: Annotated[str, Query(description="Código NCM para debug de anchors")],
):
    if not settings.features.debug_mode:
        raise HTTPException(status_code=404, detail="Not found")
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    response_data = await service.executeNeshSearchWithVectorWeights(ncm)
    html_content = response_data.get("markdown", "") or ""
    id_pattern = re.compile(r'id="([^"]+)"')
    all_ids = id_pattern.findall(html_content)
    pos_ids = [
        item for item in all_ids if item.startswith("pos-") or item.startswith("cap-")
    ]

    return {
        "query": ncm,
        "normalized": response_data.get("normalized", ncm),
        "scroll_to_anchor": response_data.get("scroll_to_anchor"),
        "posicao_alvo": response_data.get("posicao_alvo"),
        "all_position_ids": pos_ids,
        "total_ids": len(pos_ids),
        "html_preview": html_content[:2000] if html_content else None,
    }


@router.post(
    "/admin/reload-secrets",
    responses={403: {"description": "Forbidden (admin-only endpoint)."}},
)
async def reload_system_secrets(request: Request):
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    reload_settings()
    return {"success": True}
