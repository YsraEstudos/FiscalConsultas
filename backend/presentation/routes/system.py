from typing import Annotated
from fastapi import APIRouter, Depends, Query, Request, HTTPException
import re
import time

from backend.services import NeshService
from backend.server.dependencies import get_nesh_service
from backend.config.settings import settings, reload_settings, is_valid_admin_token
from backend.server.middleware import decode_clerk_jwt
from backend.utils.auth import extract_bearer_token, is_admin_payload

router = APIRouter()


async def _is_admin_request(request: Request) -> bool:
    admin_token = request.headers.get("X-Admin-Token")
    if is_valid_admin_token(admin_token):
        return True

    token = extract_bearer_token(request)
    if not token:
        return False
    payload = await decode_clerk_jwt(token)
    return is_admin_payload(payload)


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

    has_error = raw_stats.get("status") == "error"
    payload = {
        "status": "error" if has_error else "online",
        "chapters": _to_int(raw_stats.get("chapters")),
        "positions": _to_int(raw_stats.get("positions")),
        "latency_ms": latency_ms,
    }
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


def _normalize_tipi_status(raw_stats: dict | None) -> dict:
    """Normaliza payload de status da TIPI para o mesmo contrato do banco principal."""
    raw_stats = raw_stats or {}
    is_online = bool(raw_stats.get("ok") is True or raw_stats.get("status") == "online")

    payload = {
        "status": "online" if is_online else "error",
        "chapters": _to_int(raw_stats.get("chapters")),
        "positions": _to_int(raw_stats.get("positions")),
    }
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


@router.get("/status")
async def get_status(request: Request):
    """
    Healthcheck e Status do Sistema.

    Verifica conectividade com:
    - Banco de dados Principal (nesh.db)
    - Banco de dados TIPI (tipi.db)

    Retorna versão da API e estado atual dos serviços.
    """
    # Access state directly from request
    db = getattr(request.app.state, "db", None)
    tipi_service = getattr(request.app.state, "tipi_service", None)

    start = time.perf_counter()
    if db:
        db_stats = await db.check_connection()
    else:
        try:
            from sqlalchemy import text
            from backend.infrastructure.db_engine import get_session

            async with get_session() as session:
                chapters_count = await session.execute(
                    text("SELECT COUNT(*) FROM chapters")
                )
                positions_count = await session.execute(
                    text("SELECT COUNT(*) FROM positions")
                )
            db_stats = {
                "status": "online",
                "chapters": int(chapters_count.scalar() or 0),
                "positions": int(positions_count.scalar() or 0),
            }
        except Exception as e:
            db_stats = {"status": "error", "error": str(e)}
    db_latency_ms = round((time.perf_counter() - start) * 1000, 2)

    # TIPI status - captura erros localmente para agregação
    tipi_stats = None
    if tipi_service is None:
        tipi_stats = {"status": "error", "error": "TIPI service unavailable"}
    else:
        try:
            tipi_stats = await tipi_service.check_connection()
        except Exception as tipi_err:
            tipi_stats = {"status": "error", "error": str(tipi_err)}

    normalized_db = _normalize_db_status(db_stats, db_latency_ms)
    normalized_tipi = _normalize_tipi_status(tipi_stats)
    overall_status = (
        "online"
        if normalized_db.get("status") == "online"
        and normalized_tipi.get("status") == "online"
        else "error"
    )

    status = {
        "status": overall_status,
        "version": getattr(request.app, "version", "unknown"),
        "backend": "FastAPI",
        "database": normalized_db,
        "tipi": normalized_tipi,
    }
    return status


@router.get("/cache-metrics")
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


@router.get("/debug/anchors")
async def debug_anchors(
    request: Request,
    service: Annotated[NeshService, Depends(get_nesh_service)],
    ncm: str = Query(..., description="Código NCM para debug de anchors"),
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


@router.post("/admin/reload-secrets")
async def reload_secrets(request: Request):
    """
    Recarrega secrets de env/.env sem reiniciar o servidor.
    """
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    reload_settings()
    return {"success": True}
