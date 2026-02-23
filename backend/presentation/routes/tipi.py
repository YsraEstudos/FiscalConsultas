import gzip
import threading
from collections import OrderedDict
from typing import Annotated, Any, Mapping

import orjson as _orjson  # pyright: ignore[reportMissingImports]
from backend.config.constants import SearchConfig, ViewMode
from backend.config.exceptions import ValidationError
from backend.config.logging_config import server_logger as logger
from backend.presentation.renderer import HtmlRenderer
from backend.server.dependencies import get_tipi_service
from backend.services.tipi_service import TipiService
from backend.utils.cache import cache_scope_key, weak_etag
from backend.utils.payload_cache_metrics import tipi_payload_cache_metrics
from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import Response

JSON_MEDIA_TYPE = "application/json"
_TIPI_CODE_PAYLOAD_CACHE_MAX = 16
_tipi_code_payload_cache: OrderedDict[str, tuple[bytes, bytes]] = OrderedDict()
_tipi_code_payload_cache_lock = threading.Lock()


def _orjson_response(
    content: Mapping[str, Any], headers: dict[str, str] | None = None
) -> Response:
    body = _orjson.dumps(content)
    resp = Response(content=body, media_type=JSON_MEDIA_TYPE)
    if headers:
        resp.headers.update(headers)
    return resp


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


def _accepts_gzip(request: Request) -> bool:
    accept_encoding = (request.headers.get("Accept-Encoding") or "").lower()
    return "gzip" in accept_encoding


def _apply_highlights_code_search(results: dict[str, Any]) -> None:
    for cap_data in results.values():
        if not isinstance(cap_data, dict):
            continue
        for pos in cap_data.get("posicoes") or []:
            desc = pos.get("descricao", "")
            if desc:
                desc = HtmlRenderer.inject_exclusion_highlights(desc)
                desc = HtmlRenderer.inject_unit_highlights(desc)
                pos["descricao"] = desc


def _apply_highlights_text_search(results: list) -> None:
    for item in results:
        desc = item.get("descricao", "")
        if desc:
            desc = HtmlRenderer.inject_exclusion_highlights(desc)
            desc = HtmlRenderer.inject_unit_highlights(desc)
            item["descricao"] = desc


def _apply_highlights_to_descriptions(result: dict[str, Any]) -> None:
    """Aplica highlights de unidades e exclusões antes de serializar.

    Percorre as duas estruturas possíveis de resposta:
    - code search: result["results"][cap]["posicoes"][i]["descricao"]
    - text search: result["results"][i]["descricao"]
    """
    results = result.get("results") or result.get("resultados")
    if not results:
        return

    if isinstance(results, dict):
        # Code search: results é {cap: {posicoes: [...]}}
        _apply_highlights_code_search(results)
    elif isinstance(results, list):
        # Text search: results é [{descricao: ...}, ...]
        _apply_highlights_text_search(results)


def get_payload_cache_metrics() -> dict[str, str | float | int]:
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


router = APIRouter()


@router.get("/search")
async def tipi_search(
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
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")

    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm",
        )

    safe_ncm = ncm.replace("\r", "\\r").replace("\n", "\\n")
    logger.debug("TIPI Busca: '%s' (mode=%s)", safe_ncm, view_mode)

    # Detectar tipo de busca - Exceções propagam para o handler global
    if tipi_service.is_code_query(ncm):
        result = await tipi_service.search_by_code(ncm, view_mode=view_mode.value)

        # Compatibilidade de contrato:
        # manter 'results' como canônica e preservar alias legado 'resultados'.
        results = result.get("results") or result.get("resultados") or {}
        result["results"] = results
        result["resultados"] = results
        result["total_capitulos"] = result.get("total_capitulos") or len(results)
    else:
        result = await tipi_service.search_text(ncm)
        result.setdefault("normalized", result.get("query", ""))
        result.setdefault("warning", None)
        result.setdefault("match_type", "text")

    # Aplicar highlights de unidades e exclusões nas descrições antes de serializar
    _apply_highlights_to_descriptions(result)

    cache_key = cache_scope_key(request)
    headers = {
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        "ETag": weak_etag("tipi", cache_key, ncm, view_mode.value),
        "Vary": "Authorization, X-Tenant-Id, Accept-Encoding",
    }

    # Same strategy used in /api/search:
    # keep pre-serialized payloads for hot TIPI code lookups.
    if result.get("type") == "code":
        payload_key = f"{cache_key}:{view_mode.value}:{ncm}"
        cache_status = "MISS"
        cached_payload = _tipi_payload_cache_get(payload_key)
        if cached_payload is None:
            raw_body = _orjson.dumps(result)
            gzip_body = gzip.compress(raw_body, compresslevel=1, mtime=0)
            cached_payload = (raw_body, gzip_body)
            _tipi_payload_cache_set(payload_key, cached_payload)
        else:
            cache_status = "HIT"

        raw_body, gzip_body = cached_payload
        common_headers = {**headers, "X-Payload-Cache": cache_status}
        if _accepts_gzip(request):
            tipi_payload_cache_metrics.record_served(gzip=True)
            return Response(
                content=gzip_body,
                media_type=JSON_MEDIA_TYPE,
                headers={**common_headers, "Content-Encoding": "gzip"},
            )
        tipi_payload_cache_metrics.record_served(gzip=False)
        return Response(
            content=raw_body, media_type=JSON_MEDIA_TYPE, headers=common_headers
        )

    return _orjson_response(result, headers=headers)


@router.get("/chapters")
async def get_tipi_chapters(
    tipi_service: Annotated[TipiService, Depends(get_tipi_service)],
):
    """
    Lista todos os capítulos da tabela TIPI.

    Útil para navegação hierárquica no frontend.
    """
    # Exceções propagam para o handler global
    chapters = await tipi_service.get_all_chapters()
    return {"success": True, "capitulos": chapters}
