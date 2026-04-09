import asyncio
import re
import time
from typing import Annotated

from backend.infrastructure.redis_client import redis_cache
from backend.config.settings import is_valid_admin_token, reload_settings, settings
from backend.server.dependencies import get_nesh_service
from backend.server.middleware import decode_clerk_jwt
from backend.server.rate_limit import status_rate_limiter
from backend.services import NeshService
from backend.utils.auth import extract_bearer_token, extract_client_ip, is_admin_payload
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

router = APIRouter()
_STATUS_CACHE: dict[str, object | None] = {"value": None, "expires_at": 0.0}
_STATUS_CACHE_REFRESH_TASK: asyncio.Task | None = None
_STATUS_CACHE_LOCK: asyncio.Lock | None = None
STATUS_RESPONSES = {
    429: {"description": "Limite de requisições para status excedido."},
}
STATUS_DETAILS_RESPONSES = {
    **STATUS_RESPONSES,
    403: {"description": "Forbidden (admin-only endpoint)."},
}


def _get_status_cache_lock() -> asyncio.Lock:
    global _STATUS_CACHE_LOCK
    if _STATUS_CACHE_LOCK is None:
        _STATUS_CACHE_LOCK = asyncio.Lock()
    return _STATUS_CACHE_LOCK


def _status_cache_ttl_seconds() -> int:
    return max(int(getattr(settings.cache, "status_cache_ttl", 0) or 0), 0)


def _read_l1_status_snapshot(now: float | None = None) -> dict | None:
    snapshot = _STATUS_CACHE.get("value")
    if not isinstance(snapshot, dict):
        return None
    if now is None:
        now = time.monotonic()
    expires_at = float(_STATUS_CACHE.get("expires_at") or 0.0)
    if expires_at > now:
        return snapshot
    return None


def _read_stale_l1_status_snapshot() -> dict | None:
    snapshot = _STATUS_CACHE.get("value")
    return snapshot if isinstance(snapshot, dict) else None


def _reset_status_cache_for_tests() -> None:
    global _STATUS_CACHE_REFRESH_TASK
    _STATUS_CACHE["value"] = None
    _STATUS_CACHE["expires_at"] = 0.0
    _STATUS_CACHE_REFRESH_TASK = None


async def _is_admin_request(request: Request) -> bool:
    admin_token = request.headers.get("X-Admin-Token")
    if is_valid_admin_token(admin_token):
        return True

    token = extract_bearer_token(request)
    if not token:
        return False
    payload = await decode_clerk_jwt(token)
    return is_admin_payload(payload)


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


def _to_int(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_db_status(raw_stats: dict | None, latency_ms: float) -> dict:
    """Normaliza payload de status do banco principal para um contrato estável."""
    if not raw_stats:
        return {
            "status": "error",
            "chapters": 0,
            "positions": 0,
            "latency_ms": latency_ms,
            "error": "Database unavailable",
        }

    chapters = _to_int(raw_stats.get("chapters"))
    positions = _to_int(raw_stats.get("positions"))
    has_error = raw_stats.get("status") == "error"
    payload = {
        "status": "online"
        if not has_error and chapters > 0 and positions > 0
        else "error",
        "chapters": chapters,
        "positions": positions,
        "latency_ms": latency_ms,
    }
    metadata = _extract_prefixed_metadata(raw_stats, "nesh")
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


def _normalize_tipi_status(raw_stats: dict | None) -> dict:
    """Normaliza payload de status da TIPI para o mesmo contrato do banco principal."""
    raw_stats = raw_stats or {}
    chapters = _to_int(raw_stats.get("chapters"))
    positions = _to_int(raw_stats.get("positions"))
    is_online = bool(
        (raw_stats.get("ok") is True or raw_stats.get("status") == "online")
        and chapters > 0
        and positions > 0
    )

    payload = {
        "status": "online" if is_online else "error",
        "chapters": chapters,
        "positions": positions,
    }
    metadata = _extract_prefixed_metadata(raw_stats, "tipi")
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


def _extract_prefixed_metadata(raw_stats: dict | None, prefix: str) -> dict[str, str]:
    metadata = (raw_stats or {}).get("metadata")
    if not isinstance(metadata, dict):
        return {}

    prefix_token = f"{prefix}_"
    return {
        key.removeprefix(prefix_token): str(value)
        for key, value in metadata.items()
        if key.startswith(prefix_token)
    }


def _normalize_count_catalog_status(
    raw_stats: dict | None,
    *,
    count_field: str,
    metadata_prefix: str,
    public_count_field: str,
) -> dict:
    raw_stats = raw_stats or {}
    total = _to_int(raw_stats.get(count_field))
    payload = {
        "status": (
            "online" if raw_stats.get("status") != "error" and total > 0 else "error"
        ),
        public_count_field: total,
    }
    metadata = _extract_prefixed_metadata(raw_stats, metadata_prefix)
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


async def _collect_db_status(request: Request) -> tuple[dict, float]:
    db = getattr(request.app.state, "db", None)
    start = time.perf_counter()

    if db:
        db_stats = await db.check_connection()
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        return db_stats, latency_ms

    try:
        from backend.infrastructure.db_engine import get_session
        from sqlalchemy import text

        async with get_session() as session:
            chapters_count = await session.execute(
                text("SELECT COUNT(*) FROM chapters")
            )
            positions_count = await session.execute(
                text("SELECT COUNT(*) FROM positions")
            )
            metadata: dict[str, str] = {}
            if settings.database.is_postgres:
                try:
                    metadata_result = await session.execute(
                        text(
                            """
                            SELECT key, value
                            FROM catalog_metadata
                            WHERE key LIKE 'nesh_%'
                            ORDER BY key
                            """
                        )
                    )
                    metadata = {row.key: row.value for row in metadata_result}
                except Exception:
                    metadata = {}
        db_stats = {
            "status": "online",
            "chapters": int(chapters_count.scalar() or 0),
            "positions": int(positions_count.scalar() or 0),
            "metadata": metadata,
        }
    except Exception as e:
        db_stats = {"status": "error", "error": str(e)}

    latency_ms = round((time.perf_counter() - start) * 1000, 2)
    return db_stats, latency_ms


async def _collect_tipi_status(request: Request) -> dict:
    tipi_service = getattr(request.app.state, "tipi_service", None)
    if tipi_service is None:
        return {"status": "error", "error": "TIPI service unavailable"}

    try:
        return await tipi_service.check_connection()
    except Exception as tipi_err:
        return {"status": "error", "error": str(tipi_err)}


async def _collect_nbs_status(request: Request) -> dict:
    nbs_service = getattr(request.app.state, "nbs_service", None)
    if nbs_service is None:
        return {"status": "error", "error": "NBS service unavailable"}

    try:
        return await nbs_service.check_connection()
    except Exception as nbs_err:
        return {"status": "error", "error": str(nbs_err)}


async def _collect_status_payloads_uncached(
    request: Request,
) -> tuple[dict, dict, dict, dict, str]:
    db_stats, db_latency_ms = await _collect_db_status(request)
    tipi_stats = await _collect_tipi_status(request)
    nbs_stats = await _collect_nbs_status(request)

    normalized_db = _normalize_db_status(db_stats, db_latency_ms)
    normalized_tipi = _normalize_tipi_status(tipi_stats)
    normalized_nbs = _normalize_count_catalog_status(
        nbs_stats,
        count_field="nbs_items",
        metadata_prefix="nbs",
        public_count_field="items",
    )
    normalized_nebs = _normalize_count_catalog_status(
        nbs_stats,
        count_field="nebs_entries",
        metadata_prefix="nebs",
        public_count_field="entries",
    )
    overall_status = (
        "online"
        if normalized_db.get("status") == "online"
        and normalized_tipi.get("status") == "online"
        and normalized_nbs.get("status") == "online"
        and normalized_nebs.get("status") == "online"
        else "error"
    )
    return (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )


def _build_status_snapshot(
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict,
    normalized_nebs: dict,
    overall_status: str,
) -> dict:
    return {
        "normalized_db": normalized_db,
        "normalized_tipi": normalized_tipi,
        "normalized_nbs": normalized_nbs,
        "normalized_nebs": normalized_nebs,
        "overall_status": overall_status,
    }


def _unpack_status_snapshot(snapshot: dict) -> tuple[dict, dict, dict, dict, str]:
    return (
        dict(snapshot.get("normalized_db") or {}),
        dict(snapshot.get("normalized_tipi") or {}),
        dict(snapshot.get("normalized_nbs") or {}),
        dict(snapshot.get("normalized_nebs") or {}),
        str(snapshot.get("overall_status") or "error"),
    )


def _store_status_snapshot(snapshot: dict, *, expires_at: float) -> dict:
    _STATUS_CACHE["value"] = snapshot
    _STATUS_CACHE["expires_at"] = expires_at
    return snapshot


async def _refresh_status_snapshot(request: Request, ttl_seconds: int) -> dict:
    snapshot = _build_status_snapshot(*await _collect_status_payloads_uncached(request))
    _store_status_snapshot(snapshot, expires_at=time.monotonic() + ttl_seconds)
    if redis_cache.available:
        await redis_cache.set_status_snapshot("public", snapshot)
    return snapshot


async def _read_redis_status_snapshot(*, now: float, ttl_seconds: int) -> dict | None:
    if not redis_cache.available:
        return None

    redis_cached = await redis_cache.get_status_snapshot("public")
    if not isinstance(redis_cached, dict):
        return None

    return _store_status_snapshot(redis_cached, expires_at=now + ttl_seconds)


async def _await_status_refresh_snapshot(request: Request, ttl_seconds: int) -> dict:
    global _STATUS_CACHE_REFRESH_TASK

    task: asyncio.Task | None = None
    lock = _get_status_cache_lock()
    async with lock:
        cached = _read_l1_status_snapshot()
        if cached is not None:
            return cached

        task = _STATUS_CACHE_REFRESH_TASK
        if task is None:
            task = asyncio.create_task(_refresh_status_snapshot(request, ttl_seconds))
            _STATUS_CACHE_REFRESH_TASK = task

    try:
        return await task
    finally:
        async with lock:
            if _STATUS_CACHE_REFRESH_TASK is task:
                _STATUS_CACHE_REFRESH_TASK = None


async def _recover_status_snapshot(ttl_seconds: int) -> dict | None:
    stale = _read_stale_l1_status_snapshot()
    if stale is not None:
        return stale

    return await _read_redis_status_snapshot(
        now=time.monotonic(),
        ttl_seconds=ttl_seconds,
    )


async def _get_status_snapshot(request: Request) -> dict:
    ttl_seconds = _status_cache_ttl_seconds()
    if ttl_seconds <= 0:
        return _build_status_snapshot(*await _collect_status_payloads_uncached(request))

    now = time.monotonic()
    cached = _read_l1_status_snapshot(now)
    if cached is not None:
        return cached

    redis_cached = await _read_redis_status_snapshot(now=now, ttl_seconds=ttl_seconds)
    if redis_cached is not None:
        return redis_cached

    try:
        return await _await_status_refresh_snapshot(request, ttl_seconds)
    except Exception:
        fallback = await _recover_status_snapshot(ttl_seconds)
        if fallback is not None:
            return fallback
        raise


async def _collect_status_payloads(
    request: Request,
) -> tuple[dict, dict, dict, dict, str]:
    return _unpack_status_snapshot(await _get_status_snapshot(request))


def _build_public_status_payload(
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict | str | None = None,
    normalized_nebs: dict | None = None,
    overall_status: str | None = None,
) -> dict:
    legacy_mode = False
    if isinstance(normalized_nbs, str) and overall_status is None:
        overall_status = normalized_nbs
        normalized_nbs = None
        normalized_nebs = None
        legacy_mode = True

    overall_status = overall_status or "error"
    catalogs = {
        "nesh": {
            "status": normalized_db.get("status", "error"),
            "latency_ms": normalized_db.get("latency_ms", 0),
        },
        "tipi": {"status": normalized_tipi.get("status", "error")},
    }
    if normalized_nbs is not None:
        catalogs["nbs"] = {"status": normalized_nbs.get("status", "error")}
    if normalized_nebs is not None:
        catalogs["nebs"] = {"status": normalized_nebs.get("status", "error")}
    payload = {
        "status": overall_status,
        "database": {
            "status": normalized_db.get("status", "error"),
            "latency_ms": normalized_db.get("latency_ms", 0),
        },
        "tipi": {
            "status": normalized_tipi.get("status", "error"),
        },
    }
    if not legacy_mode:
        payload["catalogs"] = catalogs
    if normalized_nbs is not None:
        payload["nbs"] = {"status": normalized_nbs.get("status", "error")}
    if normalized_nebs is not None:
        payload["nebs"] = {"status": normalized_nebs.get("status", "error")}
    return payload


def _build_detailed_status_payload(
    request: Request,
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict,
    normalized_nebs: dict,
    overall_status: str,
) -> dict:
    catalogs = {
        "nesh": normalized_db,
        "tipi": normalized_tipi,
        "nbs": normalized_nbs,
        "nebs": normalized_nebs,
    }
    return {
        "status": overall_status,
        "version": getattr(request.app, "version", "unknown"),
        "backend": "FastAPI",
        "database": normalized_db,
        "tipi": normalized_tipi,
        "nbs": normalized_nbs,
        "nebs": normalized_nebs,
        "catalogs": catalogs,
    }


@router.get("/status", responses=STATUS_RESPONSES)
async def get_status(request: Request):
    """
    Healthcheck e Status do Sistema.

    Verifica conectividade com:
    - Catálogo principal NESH
    - TIPI
    - NBS
    - NEBS

    Retorna apenas o mínimo necessário para readiness público.
    """
    await _apply_status_rate_limit(request)
    (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    ) = await _collect_status_payloads(request)
    return _build_public_status_payload(
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )


@router.head("/status", include_in_schema=False)
async def head_status(request: Request):
    await _collect_status_payloads(request)
    return Response(status_code=200)


@router.get("/status/details", responses=STATUS_DETAILS_RESPONSES)
async def get_status_details(request: Request):
    """
    Status detalhado do sistema para administradores.
    """
    await _apply_status_rate_limit(request)
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    ) = await _collect_status_payloads(request)
    return _build_detailed_status_payload(
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
async def get_cache_metrics(request: Request):
    """
    Métricas de hit/miss dos payload caches de /api/search e /api/tipi/search.
    Restrito a admins por conter dados operacionais internos.
    """
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    from backend.presentation.routes import search as search_route
    from backend.presentation.routes import tipi as tipi_route

    nesh_internal = None
    if hasattr(request.app.state, "service") and request.app.state.service:
        nesh_internal = await request.app.state.service.get_internal_cache_metrics()

    tipi_internal = None
    if hasattr(request.app.state, "tipi_service") and request.app.state.tipi_service:
        tipi_internal = (
            await request.app.state.tipi_service.get_internal_cache_metrics()
        )

    return {
        "status": "ok",
        "search_code_payload_cache": search_route.get_payload_cache_metrics(),
        "tipi_code_payload_cache": tipi_route.get_payload_cache_metrics(),
        "nesh_internal_caches": nesh_internal,
        "tipi_internal_caches": tipi_internal,
    }


@router.get(
    "/debug/anchors",
    responses={
        403: {"description": "Forbidden (admin-only endpoint)."},
        404: {"description": "Not found when debug mode is disabled."},
    },
)
async def debug_anchors(
    request: Request,
    service: Annotated[NeshService, Depends(get_nesh_service)],
    ncm: Annotated[str, Query(description="Código NCM para debug de anchors")],
):
    """
    DEBUG: Retorna o HTML renderizado e lista todos os IDs injetados.
    Útil para diagnosticar problemas de scroll.
    """
    if not settings.features.debug_mode:
        raise HTTPException(status_code=404, detail="Not found")

    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    response_data = await service.process_request(ncm)

    # Collect all IDs from the rendered HTML
    html_content = response_data.get("markdown", "") or ""
    id_pattern = re.compile(r'id="([^"]+)"')
    all_ids = id_pattern.findall(html_content)

    # Filter to position-related IDs
    pos_ids = [id for id in all_ids if id.startswith("pos-") or id.startswith("cap-")]

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
async def reload_secrets(request: Request):
    """
    Recarrega secrets de env/.env sem reiniciar o servidor.
    """
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    reload_settings()
    return {"success": True}
