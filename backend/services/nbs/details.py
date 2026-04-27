from __future__ import annotations

from .bootstrap import acquire_nbs_repository
from .cache import (
    build_nbs_cache_key,
    read_nbs_detail_cache_payload,
    resolve_nbs_cache_scope,
    write_nbs_detail_cache_payload,
)
from .sqlite_common import (
    acquire_nbs_sqlite_connection,
    fetch_nbs_ancestors,
    fetch_nbs_item_by_code,
    fetch_nbs_tree_page_sqlite,
    release_nbs_sqlite_connection,
    resolve_nbs_code_aliases,
    resolve_nbs_explanatory_alias_filters,
    resolve_nbs_hierarchy_root,
    sanitize_nbs_detail_payload,
    sanitize_nbs_html_fields,
    row_to_nbs_item,
    row_to_nbs_explanatory_entry,
)
from .types import (
    DEFAULT_TREE_PAGE_SIZE,
    MAX_TREE_PAGE_SIZE,
    NEBS_PUBLIC_FIELDS,
    NbsServiceState,
)


def public_nbs_explanatory_entry(
    entry: dict[str, object] | None,
) -> dict[str, object] | None:
    if not entry:
        return None
    public_entry = {field: entry.get(field) for field in NEBS_PUBLIC_FIELDS}
    return sanitize_nbs_html_fields(public_entry)


async def _fetch_nbs_detail_from_repository(
    service: NbsServiceState,
    normalized_code: str,
    *,
    include_tree: bool,
    normalized_page: int,
    normalized_page_size: int,
    cache_key: str,
    scope: str,
) -> dict[str, object]:
    async with acquire_nbs_repository(service) as repo:
        if repo is None:
            raise RuntimeError("NBS repository unavailable")
        scoped_key = resolve_nbs_cache_scope(repo)
        if scoped_key != scope:
            cached = await read_nbs_detail_cache_payload(
                service, "nbs", scoped_key, cache_key
            )
            if cached is not None:
                return cached
        payload = await repo.load_nbs_catalog_item_details(
            normalized_code,
            include_tree=include_tree,
            page=normalized_page,
            page_size=normalized_page_size,
        )
    payload = sanitize_nbs_detail_payload(payload)
    await write_nbs_detail_cache_payload(service, "nbs", scoped_key, cache_key, payload)
    return payload


async def _fetch_inline_nebs_payload(conn, code: str) -> dict[str, object] | None:
    code_aliases, clean_aliases = resolve_nbs_code_aliases(code)
    nebs_where_clauses, nebs_params = resolve_nbs_explanatory_alias_filters(
        code_aliases,
        clean_aliases,
    )
    if not nebs_where_clauses:
        return None

    nebs_cursor = await conn.execute(
        f"""
        SELECT
            code,
            code_clean,
            title,
            title_normalized,
            body_text,
            body_markdown,
            body_normalized,
            section_title,
            page_start,
            page_end,
            parser_status,
            parse_warnings,
            source_hash,
            updated_at
        FROM nebs_entries
        WHERE ({" OR ".join(nebs_where_clauses)})
          AND parser_status = 'trusted'
        ORDER BY LENGTH(code_clean) DESC
        LIMIT 1
        """,
        nebs_params,
    )
    nebs_row = await nebs_cursor.fetchone()
    if nebs_row is None:
        return None
    return public_nbs_explanatory_entry(row_to_nbs_explanatory_entry(nebs_row))


async def _fetch_nbs_detail_from_sqlite(
    service: NbsServiceState,
    normalized_code: str,
    *,
    include_tree: bool,
    normalized_page: int,
    normalized_page_size: int,
) -> dict[str, object]:
    conn = await acquire_nbs_sqlite_connection(service)
    try:
        item = await fetch_nbs_item_by_code(conn, normalized_code)
        ancestors = await fetch_nbs_ancestors(conn, item)
        chapter_root = resolve_nbs_hierarchy_root(item, ancestors)

        children_cursor = await conn.execute(
            """
            SELECT code, code_clean, description, parent_code, level
            FROM nbs_items
            WHERE parent_code = ?
            ORDER BY source_order ASC
            """,
            (item["code"],),
        )
        child_rows = await children_cursor.fetchall()
        tree_page = (
            await fetch_nbs_tree_page_sqlite(
                conn,
                chapter_root["code"],
                page=normalized_page,
                page_size=normalized_page_size,
            )
            if include_tree
            else None
        )
        payload = {
            "success": True,
            "item": item,
            "ancestors": ancestors,
            "children": [row_to_nbs_item(row) for row in child_rows],
            "chapter_root": chapter_root,
            "nebs": await _fetch_inline_nebs_payload(conn, str(item["code"])),
        }
        if tree_page is not None:
            payload["chapter_items"] = tree_page["items"]
            payload["chapter_page"] = tree_page
        return sanitize_nbs_detail_payload(payload)
    finally:
        await release_nbs_sqlite_connection(service, conn)


async def fetch_nbs_catalog_item_details(
    service: NbsServiceState,
    code: str,
    *,
    include_tree: bool = True,
    page: int = 1,
    page_size: int = DEFAULT_TREE_PAGE_SIZE,
) -> dict[str, object]:
    normalized_code = (code or "").strip()
    normalized_page = max(int(page or 1), 1)
    normalized_page_size = min(
        max(int(page_size or DEFAULT_TREE_PAGE_SIZE), 1), MAX_TREE_PAGE_SIZE
    )
    cache_key = build_nbs_cache_key(
        "nbs-detail",
        normalized_code,
        include_tree,
        normalized_page,
        normalized_page_size,
    )
    scope = resolve_nbs_cache_scope(service._repository)
    cached = await read_nbs_detail_cache_payload(service, "nbs", scope, cache_key)
    if cached is not None:
        return cached

    if service._use_repository:
        return await _fetch_nbs_detail_from_repository(
            service,
            normalized_code,
            include_tree=include_tree,
            normalized_page=normalized_page,
            normalized_page_size=normalized_page_size,
            cache_key=cache_key,
            scope=scope,
        )

    payload = await _fetch_nbs_detail_from_sqlite(
        service,
        normalized_code,
        include_tree=include_tree,
        normalized_page=normalized_page,
        normalized_page_size=normalized_page_size,
    )
    await write_nbs_detail_cache_payload(service, "nbs", scope, cache_key, payload)
    return payload


async def fetch_nbs_catalog_tree_page(
    service: NbsServiceState,
    code: str,
    *,
    page: int = 1,
    page_size: int = DEFAULT_TREE_PAGE_SIZE,
) -> dict[str, object]:
    detail = await fetch_nbs_catalog_item_details(
        service,
        code,
        include_tree=True,
        page=page,
        page_size=page_size,
    )
    normalized_page = max(int(page or 1), 1)
    normalized_page_size = min(
        max(int(page_size or DEFAULT_TREE_PAGE_SIZE), 1), MAX_TREE_PAGE_SIZE
    )
    return {
        "success": True,
        "item": detail["item"],
        "chapter_root": detail.get("chapter_root"),
        "chapter_page": detail.get("chapter_page")
        or {
            "items": detail.get("chapter_items", []),
            "page": normalized_page,
            "page_size": normalized_page_size,
            "total": len(detail.get("chapter_items", [])),
            "has_more": False,
        },
    }
