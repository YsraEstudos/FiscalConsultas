from fastapi import APIRouter, Depends, Query, HTTPException, Request
from fastapi.responses import JSONResponse
from backend.services import NeshService
from backend.server.dependencies import get_nesh_service
from backend.config.constants import SearchConfig
from backend.config.exceptions import ValidationError
from backend.data.glossary_manager import glossary_manager
from backend.config.logging_config import server_logger as logger
from backend.utils.cache import cache_scope_key, weak_etag

router = APIRouter()


@router.get("/search")
async def search(
    request: Request,
    ncm: str = Query(..., description="Código NCM ou termo textual para busca"),
    service: NeshService = Depends(get_nesh_service)
):
    """
    Busca Principal (NCM/NESH).
    
    Realiza busca híbrida:
    - Se a query for numérica (ex: "8517"): Busca hierárquica por código.
    - Se for texto (ex: "sem fio"): Busca Full-Text Search (FTS) com ranking.
    
    Returns:
        JSON com resultados da busca, metadados e estrutura para renderização.
        
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
    logger.info("Busca: '%s'", safe_ncm)
    
    # Service Layer (ASYNC) - Exceções propagam para o handler global
    response_data = await service.process_request(ncm)
    
    # Presentation Layer (Separated View: Client-side rendering)
    # Ensure 'resultados' alias exists for frontend compatibility
    if response_data.get('type') == 'code':
        response_data['resultados'] = response_data['results']
    
    # Performance: Add caching headers for catalog data (rarely changes)
    response = JSONResponse(content=response_data)
    cache_key = cache_scope_key(request)
    response.headers["Cache-Control"] = "private, max-age=3600, stale-while-revalidate=86400"
    response.headers["ETag"] = weak_etag("nesh", cache_key, ncm)
    response.headers["Vary"] = "Authorization, X-Tenant-Id"
    return response

@router.get("/chapters")
async def get_chapters(request: Request):
    """
    Lista todos os capítulos do sistema Harmonizado (NESH).
    
    Returns:
        JSON contendo lista de capítulos disponíveis no banco de dados.
    """
    # Direct DB access via app state if service method doesn't exist for just listing simple things
    # But cleaner to have it in service. For now, accessing DB directly as in original code.
    db = request.app.state.db
    if db:
        chapters = await db.get_all_chapters_list()
    else:
        from backend.infrastructure.db_engine import get_session
        from backend.infrastructure.repositories.chapter_repository import ChapterRepository
        async with get_session() as session:
            repo = ChapterRepository(session)
            chapters = await repo.get_all_nums()
    return {"success": True, "capitulos": chapters}

@router.get("/nesh/chapter/{chapter}/notes")
async def get_chapter_notes(
    chapter: str,
    service: NeshService = Depends(get_nesh_service)
):
    """
    Busca notas de um capítulo específico (para cross-chapter references).
    
    Retorna apenas as notas parseadas, sem o conteúdo completo do capítulo.
    Otimizado para carregamento lazy de notas referenciadas em outros capítulos.
    
    Args:
        chapter: Número do capítulo (ex: "43", "62")
        
    Returns:
        JSON com notas parseadas do capítulo.
        
    Raises:
        HTTPException 404: Se o capítulo não for encontrado.
    """
    logger.info(f"Buscando notas do capítulo: {chapter}")
    
    # Usa o método existente de fetch com cache
    data = await service.fetch_chapter_data(chapter)
    
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"Capítulo {chapter} não encontrado"
        )
    
    return {
        "success": True,
        "capitulo": chapter,
        "notas_parseadas": data.get('parsed_notes', {}),
        "notas_gerais": data.get('notes', None)
    }


@router.get("/glossary")
async def get_glossary(term: str = Query(..., description="Termo para consultar no glossário")):
    """
    Consulta definições no Glossário Aduaneiro.
    
    Retorna a definição de um termo técnico se encontrado.
    """
    definition = glossary_manager.get_definition(term)
    if definition:
        return {"found": True, "term": term, "data": definition}
    else:
        return {"found": False, "term": term}
