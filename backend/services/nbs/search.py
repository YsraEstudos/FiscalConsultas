from __future__ import annotations

from backend.utils.nbs_parser import clean_nbs_code, normalize_nbs_text

from .bootstrap import acquire_nbs_repository
from .cache import (
    build_nbs_cache_key,
    read_nbs_search_cache_payload,
    resolve_nbs_cache_scope,
    write_nbs_search_cache_payload,
)
from .sqlite_common import (
    acquire_nbs_sqlite_connection,
    load_nbs_table_columns,
    row_to_nbs_item,
)
from .types import NbsServiceState


async def search_nbs_catalog_entries(
    service: NbsServiceState, query: str, *, limit: int = 50
) -> dict[str, object]:
    raw_query = (query or "").strip()
    normalized_query = normalize_nbs_text(raw_query)
    clean_query = clean_nbs_code(raw_query)
    cache_key = build_nbs_cache_key("nbs", raw_query, normalized_query, limit)
    scope = resolve_nbs_cache_scope(service._repository)
    cached = await read_nbs_search_cache_payload(service, "nbs", scope, cache_key)
    if cached is not None:
        return cached

    if service._use_repository:
        async with acquire_nbs_repository(service) as repo:
            if repo is None:
                raise RuntimeError("NBS repository unavailable")
            scoped_key = resolve_nbs_cache_scope(repo)
            if scoped_key != scope:
                cached = await read_nbs_search_cache_payload(
                    service, "nbs", scoped_key, cache_key
                )
                if cached is not None:
                    return cached
            scope = scoped_key
            results = await repo.load_nbs_catalog_entries(raw_query, limit=limit)
        payload = {
            "success": True,
            "query": raw_query,
            "normalized": normalized_query,
            "results": results,
            "total": len(results),
        }
        await write_nbs_search_cache_payload(service, "nbs", scope, cache_key, payload)
        return payload

    conn = await acquire_nbs_sqlite_connection(service)
    try:
        await load_nbs_table_columns(service, conn, "nbs_items")
        if not raw_query:
            cursor = await conn.execute(
                """
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE parent_code IS NULL
                ORDER BY source_order ASC
                LIMIT ?
                """,
                (limit,),
            )
            rows = await cursor.fetchall()
        elif not clean_query and not normalized_query:
            rows = []
        else:
            cursor = await conn.execute(
                """
                SELECT
                    code,
                    code_clean,
                    description,
                    parent_code,
                    level,
                    has_nebs,
                    CASE
                        WHEN code_clean = ? THEN 500
                        WHEN code = ? THEN 480
                        WHEN code_clean LIKE ? THEN 420
                        WHEN description_normalized = ? THEN 360
                        WHEN description_normalized LIKE ? THEN 320
                        ELSE 200
                    END AS match_score
                FROM nbs_items
                WHERE
                    (? <> '' AND code_clean = ?)
                    OR (? <> '' AND code_clean LIKE ?)
                    OR (? <> '' AND code LIKE ?)
                    OR (? <> '' AND description_normalized LIKE ?)
                ORDER BY match_score DESC, LENGTH(code_clean) ASC, source_order ASC
                LIMIT ?
                """,
                (
                    clean_query,
                    raw_query,
                    f"{clean_query}%",
                    normalized_query,
                    f"{normalized_query}%",
                    clean_query,
                    clean_query,
                    clean_query,
                    f"{clean_query}%",
                    raw_query,
                    f"{raw_query}%",
                    normalized_query,
                    f"%{normalized_query}%",
                    limit,
                ),
            )
            rows = await cursor.fetchall()

        payload = {
            "success": True,
            "query": raw_query,
            "normalized": normalized_query,
            "results": [row_to_nbs_item(row) for row in rows],
            "total": len(rows),
        }
        await write_nbs_search_cache_payload(service, "nbs", scope, cache_key, payload)
        return payload
    finally:
        from .sqlite_common import release_nbs_sqlite_connection

        await release_nbs_sqlite_connection(service, conn)
