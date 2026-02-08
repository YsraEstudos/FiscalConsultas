from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from backend.services.tipi_service import TipiService
from backend.server.dependencies import get_tipi_service
from backend.config.constants import SearchConfig, ViewMode
from backend.config.exceptions import ValidationError
from backend.config.logging_config import server_logger as logger
from backend.utils.cache import cache_scope_key, weak_etag

router = APIRouter()


@router.get("/search")
async def tipi_search(
    request: Request,
    ncm: str = Query(..., description="Código NCM ou termo para busca na TIPI"),
    view_mode: ViewMode = Query(ViewMode.FAMILY, description="Modo de visualização: 'chapter' (completo) ou 'family' (apenas família NCM)"),
    tipi_service: TipiService = Depends(get_tipi_service)
):
    """
    Busca na Tabela TIPI (IPI).
    
    Endpoint dedicado para consulta de alíquotas de IPI.
    Suporta busca por código NCM (com destaque de alíquota) e busca textual.
    
    Parâmetros:
        - ncm: Código NCM ou termo de busca
        - view_mode: 'family' (padrão) retorna apenas sub-itens do NCM buscado;
                     'chapter' retorna o capítulo completo com auto-scroll para o NCM.
                     
    Raises:
        ValidationError: Se a query estiver vazia ou for muito longa.
    """
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")

    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm"
        )
    
    safe_ncm = ncm.replace("\r", "\\r").replace("\n", "\\n")
    logger.info("TIPI Busca: '%s' (mode=%s)", safe_ncm, view_mode)
    
    # Detectar tipo de busca - Exceções propagam para o handler global
    if tipi_service.is_code_query(ncm):
        result = await tipi_service.search_by_code(ncm, view_mode=view_mode.value)

        # Compatibilidade
        result['resultados'] = result.get('resultados') or result.get('results') or {}
        result['results'] = result.get('results') or result['resultados']
        result['total_capitulos'] = result.get('total_capitulos') or len(result['resultados'])
    else:
        result = await tipi_service.search_text(ncm)
        result.setdefault('normalized', result.get('query', ''))
        result.setdefault('warning', None)
        result.setdefault('match_type', 'text')
    
    # Performance: Add caching headers for TIPI catalog data
    response = JSONResponse(content=result)
    cache_key = cache_scope_key(request)
    response.headers["Cache-Control"] = "private, max-age=3600, stale-while-revalidate=86400"
    response.headers["ETag"] = weak_etag("tipi", cache_key, ncm, view_mode.value)
    response.headers["Vary"] = "Authorization, X-Tenant-Id"
    return response

@router.get("/chapters")
async def get_tipi_chapters(tipi_service: TipiService = Depends(get_tipi_service)):
    """
    Lista todos os capítulos da tabela TIPI.
    
    Útil para navegação hierárquica no frontend.
    """
    # Exceções propagam para o handler global
    chapters = await tipi_service.get_all_chapters()
    return {"success": True, "capitulos": chapters}
