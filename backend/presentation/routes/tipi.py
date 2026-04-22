import gzip
import threading
from collections import OrderedDict
from dataclasses import dataclass
from time import perf_counter
from typing import Annotated, Any, Mapping

import orjson as _orjson  # pyright: ignore[reportMissingImports]
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.responses import Response

from backend.config.constants import SearchConfig, ViewMode
from backend.config.exceptions import ValidationError
from backend.config.logging_config import server_logger as logger
from backend.config.settings import settings
from backend.presentation.renderer import HtmlRenderer
from backend.server.dependencies import get_tipi_service
from backend.server.rate_limit import public_search_rate_limiter
from backend.services.tipi_service import TipiService
from backend.utils import ncm_utils
from backend.utils.auth import extract_client_ip
from backend.utils.cache import cache_scope_key, weak_etag
from backend.utils.payload_cache_metrics import tipi_payload_cache_metrics

JSON_MEDIA_TYPE = "application/json"
_TIPI_CODE_PAYLOAD_CACHE_MAX = 16
_tipi_code_payload_cache: OrderedDict[str, tuple[bytes, bytes]] = OrderedDict()
_tipi_code_payload_cache_lock = threading.Lock()


@dataclass(slots=True)
class TipiPayloadCacheContext:
    is_code_query: bool
    normalized_query: str
    payload_scope_key: str
    view_mode: str
    cache_headers: dict[str, str]

    def build_code_payload_cache_key(self) -> str:
        return f"{self.payload_scope_key}:{self.view_mode}:{self.normalized_query}"


def _normalize_tipi_query_for_cache_key(query: str, *, is_code_query: bool) -> str:
    raw_query = (query or "").strip()
    if is_code_query:
        normalized_parts: list[str] = []
        seen_parts: set[str] = set()
        for raw_part in ncm_utils.split_ncm_query(raw_query):
            normalized_part = ncm_utils.clean_ncm(raw_part)
            if not normalized_part or normalized_part in seen_parts:
                continue
            normalized_parts.append(normalized_part)
            seen_parts.add(normalized_part)
        if normalized_parts:
            return ",".join(normalized_parts)
        return ncm_utils.clean_ncm(raw_query)
    return raw_query.lower()


def _tipi_payload_cache_get(key: str) -> tuple[bytes, bytes] | None:
    with _tipi_code_payload_cache_lock:
        payload = _tipi_code_payload_cache.get(key)
        if payload is None:
            tipi_payload_cache_metrics.record_miss()
            return None
        _tipi_code_payload_cache.move_to_end(key)
        tipi_payload_cache_metrics.record_hit()
        return payload


def _tipi_payload_cache_set(key: str, payload: tuple[bytes, bytes]) -> None:
    with _tipi_code_payload_cache_lock:
        _tipi_code_payload_cache[key] = payload
        _tipi_code_payload_cache.move_to_end(key)
        tipi_payload_cache_metrics.record_set()
        if len(_tipi_code_payload_cache) > _TIPI_CODE_PAYLOAD_CACHE_MAX:
            _tipi_code_payload_cache.popitem(last=False)
            tipi_payload_cache_metrics.record_eviction()


def _parse_tipi_accept_encoding_quality_value(raw_value: str) -> float:
    try:
        return float(raw_value)
    except ValueError:
        return 0.0


def _parse_tipi_accept_encoding_token(token: str) -> tuple[str, float] | None:
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
        quality = _parse_tipi_accept_encoding_quality_value(value.strip())
        break

    return encoding, quality


def _request_accepts_tipi_gzip_encoding(request: Request) -> bool:
    accept_encoding = request.headers.get("Accept-Encoding") or ""
    gzip_q: float | None = None
    wildcard_q: float | None = None

    for token in accept_encoding.split(","):
        parsed = _parse_tipi_accept_encoding_token(token)
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


def snapshot_tipi_code_payload_cache_metrics() -> dict[str, str | float | int]:
    snapshot = tipi_payload_cache_metrics.snapshot(
        current_size=len(_tipi_code_payload_cache),
        max_size=_TIPI_CODE_PAYLOAD_CACHE_MAX,
    )
    return {
        "name": tipi_payload_cache_metrics.name,
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
    return snapshot_tipi_code_payload_cache_metrics()


def _build_tipi_payload_cache_headers(
    payload_scope_key: str, normalized_query: str, view_mode: str
) -> dict[str, str]:
    return {
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        "ETag": weak_etag("tipi", payload_scope_key, normalized_query, view_mode),
        "Vary": "Authorization, X-Tenant-Id, Accept-Encoding",
    }


def _validate_tipi_search_query_input(ncm: str) -> None:
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")

    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm",
        )


def _build_tipi_payload_cache_context(
    request: Request,
    *,
    ncm: str,
    view_mode: ViewMode,
) -> TipiPayloadCacheContext:
    is_code_query = ncm_utils.is_code_query(ncm)
    normalized_query = _normalize_tipi_query_for_cache_key(
        ncm, is_code_query=is_code_query
    )
    payload_scope_key = cache_scope_key(request)
    headers = _build_tipi_payload_cache_headers(
        payload_scope_key, normalized_query, view_mode.value
    )
    return TipiPayloadCacheContext(
        is_code_query=is_code_query,
        normalized_query=normalized_query,
        payload_scope_key=payload_scope_key,
        view_mode=view_mode.value,
        cache_headers=headers,
    )


def _extract_tipi_code_search_results(
    response_data: Mapping[str, Any],
) -> dict[str, Any]:
    if "results" in response_data:
        raw_results = response_data.get("results")
    elif "resultados" in response_data:
        raw_results = response_data.get("resultados")
    else:
        raw_results = {}
    return raw_results if isinstance(raw_results, dict) else {}


def _build_tipi_payload_response(
    request: Request,
    payload: tuple[bytes, bytes],
    *,
    headers: Mapping[str, str],
    cache_status: str,
) -> Response:
    raw_body, gzip_body = payload
    common_headers = {**headers, "X-Payload-Cache": cache_status}
    if _request_accepts_tipi_gzip_encoding(request):
        tipi_payload_cache_metrics.record_served(gzip=True)
        return Response(
            content=gzip_body,
            media_type=JSON_MEDIA_TYPE,
            headers={**common_headers, "Content-Encoding": "gzip"},
        )
    tipi_payload_cache_metrics.record_served(gzip=False)
    return Response(
        content=raw_body,
        media_type=JSON_MEDIA_TYPE,
        headers=common_headers,
    )


router = APIRouter()
INVALID_TIPI_RESPONSE_DETAIL = "Formato de resposta inválido do serviço"
TIPI_SEARCH_RESPONSES = {
    429: {"description": "Limite de requisições para busca pública excedido."},
    500: {"description": INVALID_TIPI_RESPONSE_DETAIL},
}


def _build_public_tipi_search_rate_limit_key(request: Request) -> str:
    return f"tipi:ip:{extract_client_ip(request)}"


async def _enforce_public_tipi_search_rate_limit(request: Request) -> None:
    allowed, retry_after = await public_search_rate_limiter.consume(
        key=_build_public_tipi_search_rate_limit_key(request),
        limit=settings.security.public_search_requests_per_minute,
    )
    if allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for public search. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


def _apply_tipi_code_description_highlights(results: dict[str, Any]) -> None:
    for cap_data in results.values():
        if not isinstance(cap_data, dict):
            continue
        for pos in cap_data.get("posicoes") or []:
            desc = pos.get("descricao", "")
            if desc:
                desc = HtmlRenderer.inject_exclusion_highlights(desc)
                desc = HtmlRenderer.inject_unit_highlights(desc)
                pos["descricao"] = desc


def _apply_tipi_text_description_highlights(results: list) -> None:
    for item in results:
        desc = item.get("descricao", "")
        if desc:
            desc = HtmlRenderer.inject_exclusion_highlights(desc)
            desc = HtmlRenderer.inject_unit_highlights(desc)
            item["descricao"] = desc


def _apply_tipi_description_highlights(result: dict[str, Any]) -> None:
    """Aplica highlights de unidades e exclusões antes de serializar.

    Percorre as duas estruturas possíveis de resposta:
    - code search: result["results"][cap]["posicoes"][i]["descricao"]
    - text search: result["results"][i]["descricao"]
    """
    results = result.get("results") or result.get("resultados")
    if not results:
        return

    if isinstance(results, dict):
        _apply_tipi_code_description_highlights(results)
    elif isinstance(results, list):
        _apply_tipi_text_description_highlights(results)


def _apply_tipi_code_search_contract(response_data: dict[str, Any]) -> dict[str, Any]:
    results = _extract_tipi_code_search_results(response_data)
    response_data["results"] = results
    response_data["resultados"] = results
    response_data["total"] = response_data.get("total") or len(results)
    response_data["total_capitulos"] = response_data.get("total_capitulos") or len(
        results
    )
    return response_data


def _serialize_tipi_response_body(
    response_data: Mapping[str, Any],
) -> tuple[bytes, float]:
    serialization_started = perf_counter()
    raw_body = _orjson.dumps(response_data)
    return raw_body, round((perf_counter() - serialization_started) * 1000, 2)


def _compress_tipi_response_body(raw_body: bytes) -> tuple[bytes, float]:
    gzip_started = perf_counter()
    gzip_body = gzip.compress(raw_body, compresslevel=1, mtime=0)
    return gzip_body, round((perf_counter() - gzip_started) * 1000, 2)


def _build_tipi_code_search_response(
    request: Request,
    response_data: Mapping[str, Any],
    *,
    headers: Mapping[str, str],
    payload_key: str,
    request_id: str,
) -> Response:
    raw_body, serialization_ms = _serialize_tipi_response_body(response_data)
    gzip_body, gzip_ms = _compress_tipi_response_body(raw_body)
    response_bytes = len(raw_body)
    compressed_bytes = len(gzip_body)
    cached_payload = (raw_body, gzip_body)
    _tipi_payload_cache_set(payload_key, cached_payload)

    metric_headers = {
        "X-Response-Bytes": str(response_bytes),
        "X-Compressed-Bytes": str(compressed_bytes),
        "X-Serialize-Ms": str(serialization_ms),
        "X-Gzip-Ms": str(gzip_ms),
    }

    logger.info(
        "tipi_request_finished request_id=%s path=%s outcome=success type=code cache_status=MISS",
        request_id,
        request.url.path,
    )
    return _build_tipi_payload_response(
        request,
        cached_payload,
        headers={**headers, **metric_headers},
        cache_status="MISS",
    )


def _build_tipi_text_search_response(
    request: Request,
    response_data: Mapping[str, Any],
    *,
    headers: Mapping[str, str],
    request_id: str,
) -> Response:
    raw_body, serialization_ms = _serialize_tipi_response_body(response_data)
    logger.info(
        "tipi_request_finished request_id=%s path=%s outcome=success type=non_code",
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
        },
    )


@router.get("/search", responses=TIPI_SEARCH_RESPONSES)
async def handle_tipi_search_request(
    request: Request,
    tipi_service: Annotated[TipiService, Depends(get_tipi_service)],
    ncm: Annotated[
        str, Query(..., description="Código NCM ou termo para busca na TIPI")
    ],
    view_mode: Annotated[
        ViewMode,
        Query(
            description=(
                "Modo de visualização: 'chapter' (completo) "
                "ou 'family' (apenas família NCM)"
            ),
        ),
    ] = ViewMode.FAMILY,
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
    _validate_tipi_search_query_input(ncm)
    await _enforce_public_tipi_search_rate_limit(request)

    request_id = request.headers.get("x-request-id") or "unknown"
    safe_ncm = ncm.replace("\r", "\\r").replace("\n", "\\n")
    logger.debug("TIPI Busca: '%s' (mode=%s)", safe_ncm, view_mode)

    context = _build_tipi_payload_cache_context(
        request,
        ncm=ncm,
        view_mode=view_mode,
    )
    headers = context.cache_headers

    if context.is_code_query:
        payload_key = context.build_code_payload_cache_key()
        cached_payload = _tipi_payload_cache_get(payload_key)
        if cached_payload is not None:
            logger.info(
                "tipi_request_finished request_id=%s path=%s outcome=cache_hit type=code",
                request_id,
                request.url.path,
            )
            return _build_tipi_payload_response(
                request,
                cached_payload,
                headers=headers,
                cache_status="HIT",
            )

        result = await tipi_service.searchTipiByNcmCode(ncm, view_mode=view_mode.value)
        if not isinstance(result, dict):
            logger.error(
                "tipi_request_failed request_id=%s path=%s reason=invalid_service_response ncm=%s type=%s",
                request_id,
                request.url.path,
                safe_ncm,
                type(result).__name__,
            )
            raise HTTPException(status_code=500, detail=INVALID_TIPI_RESPONSE_DETAIL)

        result = _apply_tipi_code_search_contract(result)
        _apply_tipi_description_highlights(result)
        return _build_tipi_code_search_response(
            request,
            result,
            headers=headers,
            payload_key=payload_key,
            request_id=request_id,
        )

    result = await tipi_service.searchTipiByTextQuery(ncm)
    if not isinstance(result, dict):
        logger.error(
            "tipi_request_failed request_id=%s path=%s reason=invalid_service_response ncm=%s type=%s",
            request_id,
            request.url.path,
            safe_ncm,
            type(result).__name__,
        )
        raise HTTPException(status_code=500, detail=INVALID_TIPI_RESPONSE_DETAIL)

    result.setdefault("normalized", result.get("query", ""))
    result.setdefault("warning", None)
    result.setdefault("match_type", "text")
    result.setdefault("total", len(result.get("results") or []))
    _apply_tipi_description_highlights(result)
    return _build_tipi_text_search_response(
        request,
        result,
        headers=headers,
        request_id=request_id,
    )


@router.get("/chapters")
async def list_tipi_chapters(
    tipi_service: Annotated[TipiService, Depends(get_tipi_service)],
):
    """
    Lista todos os capítulos da tabela TIPI.

    Útil para navegação hierárquica no frontend.
    """
    chapters = await tipi_service.fetchTipiChapterCatalog()
    return {"success": True, "capitulos": chapters}


snapshotTipiCodePayloadCacheMetrics = snapshot_tipi_code_payload_cache_metrics
handleTipiSearchRequest = handle_tipi_search_request
listTipiChapters = list_tipi_chapters
