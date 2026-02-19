from fastapi import APIRouter, Depends, Query, HTTPException, Request
from starlette.responses import Response
from collections import OrderedDict
import gzip
import threading
from backend.services import NeshService
from backend.server.dependencies import get_nesh_service
from backend.config.constants import SearchConfig
from backend.config.exceptions import ValidationError
from backend.data.glossary_manager import glossary_manager
from backend.config.logging_config import server_logger as logger
from backend.utils.cache import cache_scope_key, weak_etag
from backend.utils.payload_cache_metrics import search_payload_cache_metrics
from backend.utils import ncm_utils
from backend.presentation.renderer import HtmlRenderer

import orjson as _orjson


_CODE_PAYLOAD_CACHE_MAX = 16
_code_payload_cache: OrderedDict[str, tuple[bytes, bytes]] = OrderedDict()
_code_payload_cache_lock = threading.Lock()


def _normalize_query_for_cache(ncm: str, *, is_code_query: bool) -> str:
    """Normalize query while preserving multi-code intent for cache keys."""
    raw_query = (ncm or "").strip()
    if is_code_query:
        # Normalize each code token independently, but keep token boundaries.
        # Example:
        # - "85.17"  -> "8517"
        # - "85,17"  -> "85,17" (different intent from single code "8517")
        normalized_parts = [
            ncm_utils.clean_ncm(part) for part in ncm_utils.split_ncm_query(raw_query)
        ]
        normalized_parts = [part for part in normalized_parts if part]
        if normalized_parts:
            return ",".join(normalized_parts)
        return ncm_utils.clean_ncm(raw_query)
    return raw_query.lower()


def _orjson_response(content: dict, headers: dict[str, str] | None = None) -> Response:
    """Build a Response pre-serialized with orjson (5-10x faster than stdlib json)."""
    body = _orjson.dumps(content)
    resp = Response(content=body, media_type="application/json")
    if headers:
        resp.headers.update(headers)
    return resp


def _code_payload_cache_get(key: str) -> tuple[bytes, bytes] | None:
    with _code_payload_cache_lock:
        payload = _code_payload_cache.get(key)
        if payload is None:
            search_payload_cache_metrics.record_miss()
            return None
        _code_payload_cache.move_to_end(key)
        search_payload_cache_metrics.record_hit()
        return payload


def _code_payload_cache_set(key: str, payload: tuple[bytes, bytes]) -> None:
    with _code_payload_cache_lock:
        _code_payload_cache[key] = payload
        _code_payload_cache.move_to_end(key)
        search_payload_cache_metrics.record_set()
        if len(_code_payload_cache) > _CODE_PAYLOAD_CACHE_MAX:
            _code_payload_cache.popitem(last=False)
            search_payload_cache_metrics.record_eviction()


def _accepts_gzip(request: Request) -> bool:
    accept_encoding = (request.headers.get("Accept-Encoding") or "").lower()
    return "gzip" in accept_encoding


def get_payload_cache_metrics() -> dict[str, float | int]:
    snapshot = search_payload_cache_metrics.snapshot(
        current_size=len(_code_payload_cache),
        max_size=_CODE_PAYLOAD_CACHE_MAX,
    )
    return {
        "name": search_payload_cache_metrics.name,
        "hits": snapshot.hits,
        "misses": snapshot.misses,
        "sets": snapshot.sets,
        "evictions": snapshot.evictions,
        "served_gzip": snapshot.served_gzip,
        "served_identity": snapshot.served_identity,
        "current_size": snapshot.current_size,
        "max_size": snapshot.max_size,
        "hit_rate": snapshot.hit_rate,
    }


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
    logger.debug("Busca: '%s'", safe_ncm)

    # Normalize query for cache-key consistency:
    # - single-code variants converge (e.g. "85.17" == "8517")
    # - multi-code token boundaries are preserved (e.g. "85,17" != "8517")
    # - text queries use strip + lowercase
    is_code_query = ncm_utils.is_code_query(ncm)
    ncm_normalized = _normalize_query_for_cache(ncm, is_code_query=is_code_query)

    # Common caching headers / scope key
    cache_key = cache_scope_key(request)
    headers = {
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        "ETag": weak_etag("nesh", cache_key, ncm_normalized),
        "Vary": "Authorization, X-Tenant-Id, Accept-Encoding",
    }

    # Hot-path short-circuit:
    # for code queries, return cached payload before running service/renderer.
    payload_key: str | None = None
    cached_payload: tuple[bytes, bytes] | None = None
    cache_checked = False
    if is_code_query:
        payload_key = f"{cache_key}:{ncm_normalized}"
        cached_payload = _code_payload_cache_get(payload_key)
        cache_checked = True
        if cached_payload is not None:
            raw_body, gzip_body = cached_payload
            common_headers = {**headers, "X-Payload-Cache": "HIT"}
            if _accepts_gzip(request):
                search_payload_cache_metrics.record_served(gzip=True)
                return Response(
                    content=gzip_body,
                    media_type="application/json",
                    headers={**common_headers, "Content-Encoding": "gzip"},
                )
            search_payload_cache_metrics.record_served(gzip=False)
            return Response(content=raw_body, media_type="application/json", headers=common_headers)
    
    # Service Layer (ASYNC) - Exceções propagam para o handler global
    response_data = await service.process_request(ncm)
    
    # Compatibilidade de contrato / performance:
    # - manter 'results' como chave canônica e alias legado 'resultados'
    # - pre-renderizar HTML no backend (campo `markdown` mantido por compatibilidade)
    # - remover campos brutos pesados da serialização
    if response_data.get("type") == "code":
        results = response_data.get("results") or response_data.get("resultados") or {}
        response_data["markdown"] = HtmlRenderer.render_full_response(results)
        for chapter_data in results.values():
            if isinstance(chapter_data, dict):
                chapter_data.pop("conteudo", None)
        response_data["results"] = results
        response_data["resultados"] = results  # @deprecated: legacy alias, planned removal v2.0
        response_data["total_capitulos"] = response_data.get("total_capitulos") or len(results)
    
    # Hot path optimization:
    # code lookups are frequently repeated with very large payloads (~860KB+).
    # Cache both raw and gzip bodies to avoid serializing/compressing each request.
    if response_data.get("type") == "code":
        if not cache_checked:
            payload_key = f"{cache_key}:{ncm_normalized}"
            cached_payload = _code_payload_cache_get(payload_key)
            cache_checked = True

        cache_status = "HIT" if cached_payload is not None else "MISS"
        if cached_payload is None:
            raw_body = _orjson.dumps(response_data)
            gzip_body = gzip.compress(raw_body, compresslevel=1, mtime=0)
            cached_payload = (raw_body, gzip_body)
            if payload_key is not None:
                _code_payload_cache_set(payload_key, cached_payload)

        raw_body, gzip_body = cached_payload
        common_headers = {**headers, "X-Payload-Cache": cache_status}
        if _accepts_gzip(request):
            search_payload_cache_metrics.record_served(gzip=True)
            return Response(
                content=gzip_body,
                media_type="application/json",
                headers={**common_headers, "Content-Encoding": "gzip"},
            )
        search_payload_cache_metrics.record_served(gzip=False)
        return Response(content=raw_body, media_type="application/json", headers=common_headers)

    return _orjson_response(response_data, headers=headers)

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
