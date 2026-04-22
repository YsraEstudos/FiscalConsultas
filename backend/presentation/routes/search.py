import gzip
import threading
from collections import OrderedDict
from dataclasses import dataclass
from time import perf_counter
from typing import Annotated, Any, Mapping, cast

import orjson as _orjson  # pyright: ignore[reportMissingImports]
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.responses import Response

from backend.config.constants import SearchConfig
from backend.config.exceptions import ValidationError
from backend.config.logging_config import server_logger as logger
from backend.config.settings import settings
from backend.data.glossary_manager import glossary_manager
from backend.presentation.renderer import HtmlRenderer
from backend.server.dependencies import get_nesh_service
from backend.server.middleware import get_current_request_id, get_current_tenant
from backend.server.rate_limit import public_search_rate_limiter
from backend.services import NeshService
from backend.utils import ncm_utils
from backend.utils.auth import extract_client_ip
from backend.utils.cache import cache_scope_key, weak_etag
from backend.utils.payload_cache_metrics import search_payload_cache_metrics

JSON_MEDIA_TYPE = "application/json"

_CODE_PAYLOAD_CACHE_MAX = 16
_code_payload_cache: OrderedDict[str, tuple[bytes, bytes]] = OrderedDict()
_code_payload_cache_lock = threading.Lock()


@dataclass(slots=True)
class SearchPayloadCacheContext:
    is_code_query: bool
    normalized_query: str
    payload_scope_key: str
    cache_headers: dict[str, str]

    def build_code_payload_cache_key(self, *, shape: str) -> str:
        return f"{self.payload_scope_key}:{self.normalized_query}:{shape}"


def _normalize_search_query_for_cache_key(ncm: str, *, is_code_query: bool) -> str:
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


def _parse_quality_value(raw_value: str) -> float:
    try:
        return float(raw_value)
    except ValueError:
        return 0.0


def _parse_accept_encoding_token(token: str) -> tuple[str, float] | None:
    part = token.strip()
    if not part:
        return None

    pieces = [p.strip() for p in part.split(";")]
    encoding = pieces[0].lower()
    quality = 1.0
    for param in pieces[1:]:
        key, separator, value = param.partition("=")
        if not separator or key.strip().lower() != "q":
            continue
        quality = _parse_quality_value(value.strip())
        break

    return encoding, quality


def _request_accepts_gzip_encoding(request: Request) -> bool:
    accept_encoding = request.headers.get("Accept-Encoding") or ""
    gzip_q: float | None = None
    wildcard_q: float | None = None

    for token in accept_encoding.split(","):
        parsed = _parse_accept_encoding_token(token)
        if parsed is None:
            continue
        encoding, q_value = parsed
        if encoding == "gzip":
            gzip_q = q_value
        elif encoding == "*":
            wildcard_q = q_value

    if gzip_q is not None:
        return gzip_q > 0
    return wildcard_q is not None and wildcard_q > 0


def snapshot_search_code_payload_cache_metrics() -> dict[str, str | float | int]:
    with _code_payload_cache_lock:
        current_size = len(_code_payload_cache)
    snapshot = search_payload_cache_metrics.snapshot(
        current_size=current_size,
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


def get_payload_cache_metrics() -> dict[str, str | float | int]:
    """Alias compatível com a API anterior do módulo."""
    return snapshot_search_code_payload_cache_metrics()


def _build_search_payload_cache_headers(
    payload_scope_key: str, normalized_query: str
) -> dict[str, str]:
    return {
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        "ETag": weak_etag("nesh", payload_scope_key, normalized_query),
        "Vary": "Authorization, X-Tenant-Id, Accept-Encoding",
    }


def _validate_public_search_query_input(ncm: str) -> None:
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")

    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm",
        )


def _build_search_payload_cache_context(
    request: Request,
    *,
    ncm: str,
) -> SearchPayloadCacheContext:
    is_code_query = ncm_utils.is_code_query(ncm)
    ncm_normalized = _normalize_search_query_for_cache_key(
        ncm, is_code_query=is_code_query
    )

    payload_scope_key = cache_scope_key(request)
    headers = _build_search_payload_cache_headers(payload_scope_key, ncm_normalized)

    return SearchPayloadCacheContext(
        is_code_query=is_code_query,
        normalized_query=ncm_normalized,
        payload_scope_key=payload_scope_key,
        cache_headers=headers,
    )


def _extract_code_search_results(response_data: Mapping[str, Any]) -> dict[str, Any]:
    if "results" in response_data:
        raw_results = response_data.get("results")
    elif "resultados" in response_data:
        raw_results = response_data.get("resultados")
    else:
        raw_results = {}
    return raw_results if isinstance(raw_results, dict) else {}


def _build_search_payload_response(
    request: Request,
    payload: tuple[bytes, bytes],
    *,
    headers: Mapping[str, str],
    cache_status: str,
) -> Response:
    raw_body, gzip_body = payload
    common_headers = {**headers, "X-Payload-Cache": cache_status}
    if _request_accepts_gzip_encoding(request):
        search_payload_cache_metrics.record_served(gzip=True)
        return Response(
            content=gzip_body,
            media_type=JSON_MEDIA_TYPE,
            headers={**common_headers, "Content-Encoding": "gzip"},
        )
    search_payload_cache_metrics.record_served(gzip=False)
    return Response(
        content=raw_body, media_type=JSON_MEDIA_TYPE, headers=common_headers
    )


router = APIRouter()


def _build_public_search_rate_limit_key(request: Request) -> str:
    return f"search:ip:{extract_client_ip(request)}"


async def _enforce_public_search_rate_limit(request: Request) -> None:
    allowed, retry_after = await public_search_rate_limiter.consume(
        key=_build_public_search_rate_limit_key(request),
        limit=settings.security.public_search_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for public search. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


def _apply_code_search_response_contract(
    response_data: dict[str, Any], *, shape: str
) -> dict[str, Any]:
    results = _extract_code_search_results(response_data)
    if shape == "full":
        response_data["markdown"] = HtmlRenderer.render_full_response(results)
    for chapter_data in results.values():
        if isinstance(chapter_data, dict):
            chapter_data.pop("conteudo", None)
    response_data["results"] = results
    response_data["resultados"] = results  # legacy alias for backward compatibility
    response_data["total_capitulos"] = response_data.get("total_capitulos") or len(
        results
    )
    return response_data


def _serialize_search_response_body(
    response_data: Mapping[str, Any],
) -> tuple[bytes, float]:
    serialization_started = perf_counter()
    raw_body = _orjson.dumps(response_data)
    return raw_body, round((perf_counter() - serialization_started) * 1000, 2)


def _compress_search_response_body(raw_body: bytes) -> tuple[bytes, float]:
    gzip_started = perf_counter()
    gzip_body = gzip.compress(raw_body, compresslevel=1, mtime=0)
    return gzip_body, round((perf_counter() - gzip_started) * 1000, 2)


def _build_code_search_response(
    request: Request,
    response_data: Mapping[str, Any],
    *,
    headers: Mapping[str, str],
    payload_key: str,
    shape: str,
    request_id: str,
) -> Response:
    cached_payload = _code_payload_cache_get(payload_key)
    cache_status = "HIT" if cached_payload is not None else "MISS"
    serialization_ms = 0.0
    gzip_ms = 0.0
    response_bytes = 0
    compressed_bytes = 0

    if cached_payload is None:
        raw_body, serialization_ms = _serialize_search_response_body(response_data)
        gzip_body, gzip_ms = _compress_search_response_body(raw_body)
        response_bytes = len(raw_body)
        compressed_bytes = len(gzip_body)
        cached_payload = (raw_body, gzip_body)
        _code_payload_cache_set(payload_key, cached_payload)
    else:
        response_bytes = len(cached_payload[0])
        compressed_bytes = len(cached_payload[1])

    metric_headers = {
        "X-Response-Bytes": str(response_bytes),
        "X-Compressed-Bytes": str(compressed_bytes),
        "X-Serialize-Ms": str(serialization_ms),
        "X-Gzip-Ms": str(gzip_ms),
        "X-Response-Shape": shape,
    }

    logger.info(
        "search_request_finished request_id=%s path=%s outcome=success type=code cache_status=%s",
        request_id,
        request.url.path,
        cache_status,
    )
    return _build_search_payload_response(
        request,
        cached_payload,
        headers={**headers, **metric_headers},
        cache_status=cache_status,
    )


def _build_text_search_response(
    request: Request,
    response_data: Mapping[str, Any],
    *,
    headers: Mapping[str, str],
    shape: str,
    request_id: str,
) -> Response:
    raw_body, serialization_ms = _serialize_search_response_body(response_data)
    logger.info(
        "search_request_finished request_id=%s path=%s outcome=success type=non_code",
        request_id,
        request.url.path,
    )
    return Response(
        content=raw_body,
        media_type=JSON_MEDIA_TYPE,
        headers={
            **headers,
            "X-Response-Bytes": str(len(raw_body)),
            "X-Serialize-Ms": str(serialization_ms),
            "X-Response-Shape": shape,
        },
    )


@router.get(
    "/search",
    responses={
        429: {"description": "Limite de requisições para busca pública excedido."},
        500: {"description": "Formato de resposta inválido do serviço"},
    },
)
async def handle_global_fiscal_search_request(
    request: Request,
    service: Annotated[NeshService, Depends(get_nesh_service)],
    ncm: Annotated[
        str, Query(..., description="Código NCM ou termo textual para busca")
    ],
    shape: Annotated[
        str,
        Query(
            description="Payload shape for code searches",
            pattern="^(full|summary)$",
        ),
    ] = "full",
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
    request_id = (
        get_current_request_id() or request.headers.get("x-request-id") or "unknown"
    )
    logger.info(
        "search_request_received request_id=%s path=%s tenant=%s ncm=%s",
        request_id,
        request.url.path,
        get_current_tenant(),
        ncm,
    )

    await _enforce_public_search_rate_limit(request)
    _validate_public_search_query_input(ncm)

    safe_ncm = ncm.replace("\r", "\\r").replace("\n", "\\n")
    logger.debug("Busca: '%s'", safe_ncm)

    context = _build_search_payload_cache_context(request, ncm=ncm)
    is_code_query = context.is_code_query
    headers = context.cache_headers
    code_payload_cache_key = context.build_code_payload_cache_key(shape=shape)

    # Hot-path short-circuit:
    # for code queries, return cached payload before running service/renderer.
    cached_payload: tuple[bytes, bytes] | None = None
    if is_code_query:
        cached_payload = _code_payload_cache_get(code_payload_cache_key)
        if cached_payload is not None:
            logger.info(
                "search_request_finished request_id=%s path=%s outcome=cache_hit type=code",
                request_id,
                request.url.path,
            )
            return _build_search_payload_response(
                request,
                cached_payload,
                headers=headers,
                cache_status="HIT",
            )

    # Service Layer (ASYNC) - Exceções propagam para o handler global
    result = await service.executeNeshSearchWithVectorWeights(ncm)
    if not isinstance(result, dict):
        logger.error(
            "search_request_failed request_id=%s path=%s reason=invalid_service_response ncm=%s type=%s",
            request_id,
            request.url.path,
            safe_ncm,
            type(result).__name__,
        )
        raise HTTPException(
            status_code=500, detail="Formato de resposta inválido do serviço"
        )
    response_data = cast(dict[str, Any], result)

    # Compatibilidade de contrato / performance:
    # - manter 'results' como chave canônica e alias legado 'resultados'
    # - pre-renderizar HTML no backend (campo `markdown` mantido por compatibilidade)
    # - remover campos brutos pesados da serialização
    if response_data.get("type") == "code":
        response_data = _apply_code_search_response_contract(response_data, shape=shape)
        return _build_code_search_response(
            request,
            response_data,
            headers=headers,
            payload_key=code_payload_cache_key,
            shape=shape,
            request_id=request_id,
        )

    return _build_text_search_response(
        request,
        response_data,
        headers=headers,
        shape=shape,
        request_id=request_id,
    )


@router.get("/chapters")
async def list_nesh_chapters(request: Request):
    """
    Lista todos os capítulos do sistema Harmonizado (NESH).

    Returns:
        JSON contendo lista de capítulos disponíveis no banco de dados.
    """
    # Direct DB access via app state if service method doesn't exist
    # for just listing simple things.
    # Cleaner seria manter isso no service, mas preservamos o contrato atual.
    db = request.app.state.db
    if db:
        chapters = await db.get_all_chapters_list()
    else:
        from backend.infrastructure.db_engine import get_session
        from backend.infrastructure.repositories.chapter_repository import (
            ChapterRepository,
        )

        async with get_session() as session:
            repo = ChapterRepository(session)
            chapters = await repo.get_all_nums()
    return {"success": True, "capitulos": chapters}


@router.get(
    "/nesh/chapter/{chapter}/notes",
    responses={404: {"description": "Capítulo não encontrado"}},
)
async def fetch_nesh_chapter_notes(
    chapter: str, service: Annotated[NeshService, Depends(get_nesh_service)]
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
    logger.info("Buscando notas do capítulo: %s", chapter)

    # Usa o método existente de fetch com cache
    data = await service.fetchNeshChapterData(chapter)

    if not data:
        raise HTTPException(
            status_code=404, detail=f"Capítulo {chapter} não encontrado"
        )

    return {
        "success": True,
        "capitulo": chapter,
        "notas_parseadas": data.get("parsed_notes", {}),
        "notas_gerais": data.get("notes", None),
    }


@router.get(
    "/search/chapter/{chapter}/body",
    responses={404: {"description": "Capítulo não encontrado"}},
)
async def fetch_nesh_chapter_body(
    chapter: str,
    service: Annotated[NeshService, Depends(get_nesh_service)],
):
    data = await service.fetchNeshChapterData(chapter)
    if not data:
        raise HTTPException(
            status_code=404, detail=f"Capítulo {chapter} não encontrado"
        )

    sections = data.get("sections") or {}
    has_sections = any((sections.get(key) or "").strip() for key in sections)
    raw_content = data.get("content", "")
    content = (
        service.stripNeshChapterPreamble(raw_content) if has_sections else raw_content
    )

    return {
        "success": True,
        "capitulo": chapter,
        "conteudo": content,
        "notas_parseadas": data.get("parsed_notes", {}),
        "notas_gerais": data.get("notes", None),
        "secoes": sections if has_sections else None,
    }


@router.get("/glossary")
async def lookup_glossary_definition(
    term: Annotated[str, Query(..., description="Termo para consultar no glossário")],
):
    """
    Consulta definições no Glossário Aduaneiro.

    Retorna a definição de um termo técnico se encontrado.
    """
    definition = glossary_manager.get_definition(term)
    if definition:
        return {"found": True, "term": term, "data": definition}
    else:
        return {"found": False, "term": term}


snapshotSearchCodePayloadCacheMetrics = snapshot_search_code_payload_cache_metrics
handleGlobalFiscalSearchRequest = handle_global_fiscal_search_request
handle_global_fiscal_search_request.__name__ = "handleGlobalFiscalSearchRequest"
listNeshChapters = list_nesh_chapters
fetchNeshChapterNotes = fetch_nesh_chapter_notes
fetchNeshChapterBody = fetch_nesh_chapter_body
lookupGlossaryDefinition = lookup_glossary_definition
