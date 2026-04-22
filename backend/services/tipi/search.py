from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING, Any

from ...config.constants import CacheConfig
from ...utils import ncm_utils
from ...utils.id_utils import generate_anchor_id
from .types import (
    TipiChapterCatalogItem,
    TipiChapterResultsMap,
    TipiCodeCacheKey,
    TipiCodeChapterPayload,
    TipiCodeSearchPayload,
    TipiRowBatch,
    TipiTextSearchItem,
    TipiTextSearchPayload,
)

if TYPE_CHECKING:
    from ..tipi_service import TipiService


def build_empty_tipi_code_search_response(query: str) -> TipiCodeSearchPayload:
    return {
        "success": True,
        "type": "code",
        "query": query,
        "results": {},
        "resultados": {},
        "total": 0,
        "total_capitulos": 0,
    }


def clone_tipi_code_search_result(
    result: TipiCodeSearchPayload,
) -> TipiCodeSearchPayload:
    return deepcopy(result)


def normalize_tipi_multi_code_parts(ncm_query: str, *, max_parts: int) -> list[str]:
    normalized_parts: list[str] = []
    seen_parts: set[str] = set()
    for raw_part in ncm_utils.split_ncm_query(ncm_query):
        normalized_part = ncm_utils.clean_ncm(raw_part)
        if not normalized_part or normalized_part in seen_parts:
            continue
        normalized_parts.append(normalized_part)
        seen_parts.add(normalized_part)
        if len(normalized_parts) >= max_parts:
            break
    return normalized_parts


def prefer_more_specific_tipi_posicao_alvo(
    current: str | None, incoming: str | None
) -> str | None:
    if not incoming:
        return current
    if not current:
        return incoming

    current_clean = ncm_utils.clean_ncm(current)
    incoming_clean = ncm_utils.clean_ncm(incoming)
    if len(incoming_clean) > len(current_clean):
        return incoming
    return current


def resolve_tipi_target_position(
    clean_query: str, normalized_query: str, query_part: str
) -> str | None:
    if len(clean_query) <= 2:
        return None
    return (normalized_query or "").strip() or query_part.strip()


def resolve_tipi_chapter_target_position(
    capitulo: str, posicao_alvo: str | None
) -> str | None:
    if not posicao_alvo:
        return None
    clean_alvo = ncm_utils.clean_ncm(posicao_alvo)
    return posicao_alvo if clean_alvo.startswith(capitulo) else None


def build_ancestor_prefixes(prefix: str) -> set[str]:
    ancestor_prefixes: set[str] = set()
    if len(prefix) >= 4:
        ancestor_prefixes.add(prefix[:4])
    if len(prefix) >= 6:
        ancestor_prefixes.add(prefix[:6])
    return ancestor_prefixes


def _normalize_repository_rows(
    rows: list[dict[str, Any]], cap_num: str
) -> TipiRowBatch:
    return tuple(
        {
            **row,
            "capitulo": row.get("capitulo", cap_num),
            "nivel": row.get("nivel", 0),
        }
        for row in rows
    )


async def _store_chapter_positions_in_cache(
    service: "TipiService", cap_num: str, rows: TipiRowBatch
) -> TipiRowBatch:
    async with service._get_cache_lock():
        service._chapter_positions_cache[cap_num] = rows
        service._chapter_positions_cache_metrics.record_set()
        service._trim_tipi_lru_cache_to_limit(
            service._chapter_positions_cache,
            CacheConfig.TIPI_CHAPTER_CACHE_SIZE,
            service._chapter_positions_cache_metrics,
        )
    return rows


async def get_chapter_positions(service: "TipiService", cap_num: str) -> TipiRowBatch:
    async with service._get_cache_lock():
        if cap_num in service._chapter_positions_cache:
            service._chapter_positions_cache.move_to_end(cap_num)
            service._chapter_positions_cache_metrics.record_hit()
            return service._chapter_positions_cache[cap_num]
    service._chapter_positions_cache_metrics.record_miss()

    if service._use_repository:
        async with service._acquire_tipi_repository() as repo:
            if repo:
                rows = _normalize_repository_rows(
                    await repo.get_by_chapter(cap_num),
                    cap_num,
                )
                return await _store_chapter_positions_in_cache(service, cap_num, rows)

    conn = await service._acquire_tipi_connection()
    try:
        cols = await service._load_tipi_table_columns(conn, "tipi_positions")
        order_by = service._resolve_tipi_order_by_clause(cols)
        sql = f"""
            SELECT ncm, capitulo, descricao, aliquota, nivel
            FROM tipi_positions
            WHERE capitulo = ?
            ORDER BY {order_by}
            """  # nosec B608
        cursor = await conn.execute(sql, (cap_num,))
        rows = await cursor.fetchall()
        result: TipiRowBatch = tuple(dict(row) for row in rows)
        return await _store_chapter_positions_in_cache(service, cap_num, result)
    finally:
        await service._release_tipi_connection(conn)


async def get_family_positions(
    service: "TipiService",
    cap_num: str,
    prefix: str,
    ancestor_prefixes: set[str],
) -> TipiRowBatch:
    if service._use_repository:
        async with service._acquire_tipi_repository() as repo:
            if repo:
                return _normalize_repository_rows(
                    await repo.get_family_positions(cap_num, prefix, ancestor_prefixes),
                    cap_num,
                )

    conn = await service._acquire_tipi_connection()
    try:
        cols = await service._load_tipi_table_columns(conn, "tipi_positions")
        order_by = service._resolve_tipi_order_by_clause(cols)
        conditions = ["REPLACE(ncm, '.', '') LIKE ? || '%'"]
        params: list[str] = [prefix]

        for ancestor in ancestor_prefixes:
            conditions.append("REPLACE(ncm, '.', '') = ?")
            params.append(ancestor)

        where_clause = " OR ".join(conditions)
        sql = f"""
            SELECT ncm, capitulo, descricao, aliquota, nivel
            FROM tipi_positions
            WHERE capitulo = ? AND ({where_clause})
            ORDER BY {order_by}
            """  # nosec B608
        cursor = await conn.execute(sql, (cap_num, *params))
        rows = await cursor.fetchall()
        return tuple(dict(row) for row in rows)
    finally:
        await service._release_tipi_connection(conn)


async def read_tipi_code_search_cache(
    service: "TipiService", cache_key: TipiCodeCacheKey
) -> TipiCodeSearchPayload | None:
    cached: TipiCodeSearchPayload | None
    async with service._get_cache_lock():
        cached = service._code_search_cache.get(cache_key)
        if not cached:
            return None
        service._code_search_cache.move_to_end(cache_key)
        service._code_search_cache_metrics.record_hit()
    return clone_tipi_code_search_result(cached)


async def write_tipi_code_search_cache(
    service: "TipiService",
    cache_key: TipiCodeCacheKey,
    result: TipiCodeSearchPayload,
) -> None:
    cloned_result = clone_tipi_code_search_result(result)
    async with service._get_cache_lock():
        service._code_search_cache[cache_key] = cloned_result
        service._code_search_cache_metrics.record_set()
        service._trim_tipi_lru_cache_to_limit(
            service._code_search_cache,
            CacheConfig.TIPI_RESULT_CACHE_SIZE,
            service._code_search_cache_metrics,
        )


def merge_tipi_multi_code_part_payloads(
    merged: TipiChapterResultsMap, part_resp: TipiCodeSearchPayload
) -> None:
    source = part_resp.get("resultados") or part_resp.get("results") or {}
    for cap, cap_data in source.items():
        if cap not in merged:
            merged[cap] = {
                **cap_data,
                "posicoes": [],
            }
        merged[cap]["posicao_alvo"] = prefer_more_specific_tipi_posicao_alvo(
            merged[cap].get("posicao_alvo"),
            cap_data.get("posicao_alvo"),
        )
        merged[cap].setdefault("posicoes", [])
        seen_ncms = {pos.get("ncm") for pos in merged[cap]["posicoes"]}
        for posicao in cap_data.get("posicoes", []):
            ncm = posicao.get("ncm")
            if ncm in seen_ncms:
                continue
            merged[cap]["posicoes"].append(posicao)
            seen_ncms.add(ncm)


async def search_tipi_multi_code_parts(
    service: "TipiService",
    ncm_query: str,
    view_mode: str,
    parts: list[str],
) -> TipiCodeSearchPayload:
    merged: TipiChapterResultsMap = {}
    for part in parts:
        part_resp = await service.searchTipiByNcmCode(part, view_mode=view_mode)
        merge_tipi_multi_code_part_payloads(merged, part_resp)
    total_rows = sum(len(cap.get("posicoes", [])) for cap in merged.values())
    return {
        "success": True,
        "type": "code",
        "query": ncm_query,
        "results": merged,
        "resultados": merged,
        "total": total_rows,
        "total_capitulos": len(merged),
    }


async def load_tipi_rows_for_code(
    service: "TipiService", cap_num: str, clean_query: str, view_mode: str
) -> TipiRowBatch:
    if view_mode != "family" or len(clean_query) <= 2:
        return await service._get_chapter_positions(cap_num)
    return await service._get_family_positions(
        cap_num,
        clean_query,
        build_ancestor_prefixes(clean_query),
    )


def build_tipi_code_result_map(
    rows: TipiRowBatch, posicao_alvo: str | None
) -> TipiChapterResultsMap:
    resultados: TipiChapterResultsMap = {}
    for row in rows:
        cap = row["capitulo"]
        if cap not in resultados:
            resultados[cap] = TipiCodeChapterPayload(
                capitulo=cap,
                titulo=f"Capítulo {cap}",
                notas_gerais=None,
                posicao_alvo=resolve_tipi_chapter_target_position(cap, posicao_alvo),
                posicoes=[],
            )

        codigo = row["ncm"]
        resultados[cap]["posicoes"].append(
            {
                "ncm": codigo,
                "codigo": codigo,
                "descricao": row["descricao"],
                "aliquota": row.get("aliquota") or "0",
                "nivel": row.get("nivel", 0),
                "anchor_id": generate_anchor_id(codigo),
            }
        )
    return resultados


async def search_tipi_by_ncm_code(
    service: "TipiService", ncm_query: str, view_mode: str = "family"
) -> TipiCodeSearchPayload:
    parts = service._normalize_tipi_multi_code_parts(ncm_query)
    query_part = parts[0] if parts else ""
    normalized_query = ncm_utils.format_ncm_tipi(query_part)
    clean_query = ncm_utils.clean_ncm(normalized_query)
    if not clean_query:
        return service._build_empty_tipi_code_search_response(ncm_query)

    cache_view_mode = view_mode
    should_share_short_query_cache = len(parts) == 1 and len(clean_query) <= 2
    if should_share_short_query_cache:
        cache_view_mode = "family"

    cap_num = clean_query[:2].zfill(2)

    cache_key = (ncm_query, cache_view_mode)
    cached = await service._read_tipi_code_search_cache(cache_key)
    if cached:
        if should_share_short_query_cache:
            await service._get_chapter_positions(cap_num)
        return cached
    service._code_search_cache_metrics.record_miss()

    if len(parts) > 1:
        result = await service._search_tipi_multi_code_parts(
            ncm_query, view_mode, parts
        )
        await service._write_tipi_code_search_cache(cache_key, result)
        return result

    posicao_alvo = service._resolve_tipi_target_position(
        clean_query, normalized_query, query_part
    )
    rows = await service._load_tipi_rows_for_code(cap_num, clean_query, view_mode)
    if not rows:
        return service._build_empty_tipi_code_search_response(ncm_query)

    resultados = service._build_tipi_code_result_map(rows, posicao_alvo)
    result: TipiCodeSearchPayload = {
        "success": True,
        "type": "code",
        "query": ncm_query,
        "results": resultados,
        "resultados": resultados,
        "total": len(rows),
        "total_capitulos": len(resultados),
    }
    await service._write_tipi_code_search_cache(cache_key, result)
    return result


def _format_tipi_text_results(rows: list[dict[str, Any]]) -> list[TipiTextSearchItem]:
    return [
        {
            "ncm": row["ncm"],
            "capitulo": row.get("capitulo") or "",
            "descricao": row["descricao"],
            "aliquota": row.get("aliquota") or "0",
        }
        for row in rows
    ]


async def search_tipi_by_text_query(
    service: "TipiService", query: str, limit: int = 50
) -> TipiTextSearchPayload:
    if service._use_repository:
        async with service._acquire_tipi_repository() as repo:
            if repo:
                results = await repo.search_fulltext(query, limit)
                return {
                    "success": True,
                    "type": "text",
                    "query": query,
                    "normalized": query,
                    "match_type": "fts",
                    "warning": None,
                    "total": len(results),
                    "results": _format_tipi_text_results(results),
                }

    conn = await service._acquire_tipi_connection()
    try:
        escaped_query = query.replace('"', '""')
        fts_query = f'"{escaped_query}"'
        cursor = await conn.execute(
            """
            SELECT ncm, capitulo, descricao, aliquota
            FROM tipi_fts
            WHERE tipi_fts MATCH ?
            LIMIT ?
            """,
            (fts_query, limit),
        )
        rows = await cursor.fetchall()
        results = [dict(row) for row in rows]

        if len(results) < 5:
            words = query.split()
            if len(words) > 1:
                quoted_tokens = ['"' + word.replace('"', '""') + '"' for word in words]
                and_query = " AND ".join(quoted_tokens)
                cursor = await conn.execute(
                    """
                    SELECT ncm, capitulo, descricao, aliquota
                    FROM tipi_fts
                    WHERE tipi_fts MATCH ?
                    LIMIT ?
                    """,
                    (and_query, limit),
                )
                rows = await cursor.fetchall()
                results = [dict(row) for row in rows]
    finally:
        await service._release_tipi_connection(conn)

    return {
        "success": True,
        "type": "text",
        "query": query,
        "normalized": query,
        "match_type": "fts",
        "warning": None,
        "total": len(results),
        "results": _format_tipi_text_results(results),
    }


async def fetch_tipi_chapter_catalog(
    service: "TipiService",
) -> list[TipiChapterCatalogItem]:
    if service._use_repository:
        async with service._acquire_tipi_repository() as repo:
            if repo:
                return await repo.get_all_chapters()

    conn = await service._acquire_tipi_connection()
    try:
        cursor = await conn.execute(
            """
            SELECT codigo, titulo, secao
            FROM tipi_chapters
            ORDER BY codigo
            """
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await service._release_tipi_connection(conn)


def snapshot_tipi_internal_cache_metrics(service: "TipiService") -> dict[str, Any]:
    code_snapshot = service._code_search_cache_metrics.snapshot(
        current_size=len(service._code_search_cache),
        max_size=CacheConfig.TIPI_RESULT_CACHE_SIZE,
    )
    chapter_snapshot = service._chapter_positions_cache_metrics.snapshot(
        current_size=len(service._chapter_positions_cache),
        max_size=CacheConfig.TIPI_CHAPTER_CACHE_SIZE,
    )
    return {
        "code_search_cache": {
            "name": service._code_search_cache_metrics.name,
            "hits": code_snapshot.hits,
            "misses": code_snapshot.misses,
            "sets": code_snapshot.sets,
            "evictions": code_snapshot.evictions,
            "served_gzip": code_snapshot.served_gzip,
            "served_identity": code_snapshot.served_identity,
            "current_size": code_snapshot.current_size,
            "max_size": code_snapshot.max_size,
            "hit_rate": code_snapshot.hit_rate,
        },
        "chapter_positions_cache": {
            "name": service._chapter_positions_cache_metrics.name,
            "hits": chapter_snapshot.hits,
            "misses": chapter_snapshot.misses,
            "sets": chapter_snapshot.sets,
            "evictions": chapter_snapshot.evictions,
            "served_gzip": chapter_snapshot.served_gzip,
            "served_identity": chapter_snapshot.served_identity,
            "current_size": chapter_snapshot.current_size,
            "max_size": chapter_snapshot.max_size,
            "hit_rate": chapter_snapshot.hit_rate,
        },
    }
