from fastapi import APIRouter, Depends, Query, Request, HTTPException
import time

from backend.services import NeshService
from backend.services.tipi_service import TipiService
from backend.server.dependencies import get_nesh_service
from backend.config.settings import settings, reload_settings
from backend.server.middleware import is_clerk_token_valid

router = APIRouter()


def _extract_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return None


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
    is_online = bool(
        raw_stats.get("ok") is True
        or raw_stats.get("status") == "online"
    )

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
    db = request.app.state.db
    tipi_service = request.app.state.tipi_service
    
    start = time.perf_counter()
    if db:
        db_stats = await db.check_connection()
    else:
        try:
            from sqlalchemy import text
            from backend.infrastructure.db_engine import get_session
            async with get_session() as session:
                chapters_count = await session.execute(text("SELECT COUNT(*) FROM chapters"))
                positions_count = await session.execute(text("SELECT COUNT(*) FROM positions"))
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
    try:
        tipi_stats = await tipi_service.check_connection()
    except Exception as tipi_err:
        tipi_stats = {"status": "error", "error": str(tipi_err)}

    normalized_db = _normalize_db_status(db_stats, db_latency_ms)
    normalized_tipi = _normalize_tipi_status(tipi_stats)
    overall_status = (
        "online"
        if normalized_db.get("status") == "online" and normalized_tipi.get("status") == "online"
        else "error"
    )

    status = {
        "status": overall_status,
        "version": "4.2",
        "backend": "FastAPI",
        "database": normalized_db,
        "tipi": normalized_tipi,
    }
    return status

@router.get("/debug/anchors")
async def debug_anchors(
    request: Request,
    ncm: str = Query(..., description="Código NCM para debug de anchors"),
    service: NeshService = Depends(get_nesh_service)
):
    """
    DEBUG: Retorna o HTML renderizado e lista todos os IDs injetados.
    Útil para diagnosticar problemas de scroll.
    """
    if not settings.features.debug_mode:
        raise HTTPException(status_code=404, detail="Not found")

    token = _extract_token(request)
    if not token or not is_clerk_token_valid(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    import re
    
    response_data = await service.process_request(ncm)
    
    # Collect all IDs from the rendered HTML
    html_content = response_data.get('markdown', '') or ''
    id_pattern = re.compile(r'id="([^"]+)"')
    all_ids = id_pattern.findall(html_content)
    
    # Filter to position-related IDs
    pos_ids = [id for id in all_ids if id.startswith('pos-') or id.startswith('cap-')]
    
    return {
        "query": ncm,
        "normalized": response_data.get('normalized', ncm),
        "scroll_to_anchor": response_data.get('scroll_to_anchor'),
        "posicao_alvo": response_data.get('posicao_alvo'),
        "all_position_ids": pos_ids,
        "total_ids": len(pos_ids),
        "html_preview": html_content[:2000] if html_content else None
    }


@router.post("/admin/reload-secrets")
async def reload_secrets(request: Request):
    """
    Recarrega secrets de env/.env sem reiniciar o servidor.
    """
    token = _extract_token(request)
    if not token or not is_clerk_token_valid(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    reload_settings()
    return {"success": True}
