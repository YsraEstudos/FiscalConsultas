from __future__ import annotations

from backend.config.exceptions import NotFoundError

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
            scope = scoped_key
            payload = await repo.load_nbs_catalog_item_details(
                normalized_code,
                include_tree=include_tree,
                page=normalized_page,
                page_size=normalized_page_size,
            )
        payload = sanitize_nbs_detail_payload(payload)
        await write_nbs_detail_cache_payload(service, "nbs", scope, cache_key, payload)
        return payload

    conn = await acquire_nbs_sqlite_connection(service)
    try:
        item = await fetch_nbs_item_by_code(conn, normalized_code)
        ancestors = await fetch_nbs_ancestors(conn, item)
        chapter_root = resolve_nbs_hierarchy_root(item, ancestors)

        children_cursor = await conn.execute(
            """
            SELECT code, code_clean, description, parent_code, level, has_nebs
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

        nebs_cursor = await conn.execute(
            """
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
            WHERE code = ? AND parser_status = 'trusted'
            LIMIT 1
            """,
            (item["code"],),
        )
        nebs_row = await nebs_cursor.fetchone()
        nebs_payload = (
            None
            if nebs_row is None
            else public_nbs_explanatory_entry(row_to_nbs_explanatory_entry(nebs_row))
        )

        payload = {
            "success": True,
            "item": item,
            "ancestors": ancestors,
            "children": [row_to_nbs_item(row) for row in child_rows],
            "chapter_root": chapter_root,
            "nebs": nebs_payload,
        }
        if tree_page is not None:
            payload["chapter_items"] = tree_page["items"]
            payload["chapter_page"] = tree_page
        payload = sanitize_nbs_detail_payload(payload)
        await write_nbs_detail_cache_payload(service, "nbs", scope, cache_key, payload)
        return payload
    finally:
        await release_nbs_sqlite_connection(service, conn)


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


async def fetch_nbs_explanatory_entry_details(
    service: NbsServiceState, code: str
) -> dict[str, object]:
    normalized_code = (code or "").strip()
    cache_key = build_nbs_cache_key("nebs-detail", normalized_code)
    scope = resolve_nbs_cache_scope(service._repository)
    cached = await read_nbs_detail_cache_payload(service, "nebs", scope, cache_key)
    if cached is not None:
        return cached

    if service._use_repository:
        async with acquire_nbs_repository(service) as repo:
            if repo is None:
                raise RuntimeError("NBS repository unavailable")
            scoped_key = resolve_nbs_cache_scope(repo)
            if scoped_key != scope:
                cached = await read_nbs_detail_cache_payload(
                    service, "nebs", scoped_key, cache_key
                )
                if cached is not None:
                    return cached
            scope = scoped_key
            payload = await repo.load_nbs_explanatory_entry_details(normalized_code)
        payload = sanitize_nbs_detail_payload(payload)
        await write_nbs_detail_cache_payload(service, "nebs", scope, cache_key, payload)
        return payload

    conn = await acquire_nbs_sqlite_connection(service)
    try:
        item = await fetch_nbs_item_by_code(conn, normalized_code)
        ancestors = await fetch_nbs_ancestors(conn, item)
        from .sqlite_common import resolve_nbs_code_aliases

        aliases, clean_aliases = resolve_nbs_code_aliases(normalized_code)
        entry_where_clauses: list[str] = []
        entry_params: list[str] = []
        if aliases:
            entry_where_clauses.append(f"code IN ({', '.join(['?'] * len(aliases))})")
            entry_params.extend(aliases)
        if clean_aliases:
            entry_where_clauses.append(
                f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})"
            )
            entry_params.extend(clean_aliases)
        entry_params.append("trusted")
        entry_cursor = await conn.execute(
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
            WHERE ({" OR ".join(entry_where_clauses)}) AND parser_status = ?
            ORDER BY LENGTH(code_clean) DESC
            LIMIT 1
            """,
            entry_params,
        )
        entry_row = await entry_cursor.fetchone()
        if entry_row is None:
            raise NotFoundError("Entrada NEBS", normalized_code)

        payload = {
            "success": True,
            "item": item,
            "ancestors": ancestors,
            "entry": public_nbs_explanatory_entry(
                row_to_nbs_explanatory_entry(entry_row)
            ),
        }
        payload = sanitize_nbs_detail_payload(payload)
        await write_nbs_detail_cache_payload(service, "nebs", scope, cache_key, payload)
        return payload
    finally:
        await release_nbs_sqlite_connection(service, conn)
