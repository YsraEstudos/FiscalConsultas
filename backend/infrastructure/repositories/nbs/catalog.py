from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from backend.utils.nbs_parser import clean_nbs_code, normalize_nbs_text

from ..postgres_fts import build_postgres_tsquery
from .common import (
    load_nbs_catalog_item_ancestors,
    load_nbs_catalog_item_by_code,
    load_nbs_catalog_items_by_prefix,
    load_trusted_nbs_explanatory_entry,
    public_nbs_explanatory_entry,
    resolve_nbs_catalog_hierarchy_root,
    row_to_nbs_catalog_item,
)
from .types import (
    NbsCatalogDetailPayload,
    NbsCatalogItemPayload,
    NbsCatalogTreePagePayload,
)

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import NbsRepository


async def load_nbs_catalog_entries(
    repo: "NbsRepository", query: str, *, limit: int = 50
) -> list[NbsCatalogItemPayload]:
    raw_query = (query or "").strip()
    normalized_query = normalize_nbs_text(raw_query)
    clean_query = clean_nbs_code(raw_query)

    if not raw_query:
        sql = f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE parent_code IS NULL
            {" AND " + "nbs_items.tenant_id IS NULL" if repo.tenant_id is None else " AND (nbs_items.tenant_id = :tenant_id OR nbs_items.tenant_id IS NULL)"}
            ORDER BY source_order ASC
            LIMIT :limit
        """
        params = {"limit": limit}
        if repo.tenant_id is not None:
            params["tenant_id"] = repo.tenant_id
        result = await repo.session.execute(text(sql), params)
        return [row_to_nbs_catalog_item(row) for row in result]

    if not clean_query and not normalized_query:
        return []

    tsquery = build_postgres_tsquery(normalized_query or raw_query)
    tenant_predicate_n = (
        " AND (n.tenant_id = :tenant_id OR n.tenant_id IS NULL)"
        if repo.tenant_id is not None
        else " AND n.tenant_id IS NULL"
    )
    fts_predicate = f"(n.search_vector @@ {tsquery.sql})"
    sql = f"""
        WITH ranked AS (
            SELECT
                n.code,
                n.code_clean,
                n.description,
                n.parent_code,
                n.level,
                n.has_nebs,
                500 AS match_score,
                0::float AS fts_rank
            FROM nbs_items AS n
            WHERE :clean_query <> ''
              AND n.code_clean = :clean_query
              {tenant_predicate_n}
            UNION ALL
            SELECT
                n.code,
                n.code_clean,
                n.description,
                n.parent_code,
                n.level,
                n.has_nebs,
                CASE
                    WHEN n.code = :raw_query THEN 480
                    WHEN n.code_clean LIKE :clean_prefix THEN 420
                    WHEN n.description_normalized = :normalized_query THEN 360
                    WHEN n.description_normalized LIKE :normalized_prefix THEN 320
                    ELSE 280
                END AS match_score,
                0::float AS fts_rank
            FROM nbs_items AS n
            WHERE (
                (:clean_query <> '' AND n.code_clean LIKE :clean_prefix)
                OR (:raw_query <> '' AND n.code LIKE :raw_prefix)
                OR (:normalized_query <> '' AND n.description_normalized = :normalized_query)
                OR (:normalized_query <> '' AND n.description_normalized LIKE :normalized_prefix)
            )
            {tenant_predicate_n}
            UNION ALL
            SELECT
                n.code,
                n.code_clean,
                n.description,
                n.parent_code,
                n.level,
                n.has_nebs,
                220 AS match_score,
                ts_rank(n.search_vector, {tsquery.sql}) AS fts_rank
            FROM nbs_items AS n
            WHERE {fts_predicate}
            {tenant_predicate_n}
        )
        SELECT DISTINCT ON (code)
            code,
            code_clean,
            description,
            parent_code,
            level,
            has_nebs,
            match_score
        FROM ranked
        ORDER BY code, match_score DESC, fts_rank DESC
    """
    wrapped_sql = f"""
        SELECT
            code,
            code_clean,
            description,
            parent_code,
            level,
            has_nebs
        FROM ({sql}) AS deduped
        ORDER BY match_score DESC, LENGTH(code_clean) ASC, code ASC
        LIMIT :limit
    """
    params = {
        "clean_query": clean_query,
        "raw_query": raw_query,
        "clean_prefix": f"{clean_query}%",
        "raw_prefix": f"{raw_query}%",
        "normalized_query": normalized_query,
        "normalized_prefix": f"{normalized_query}%",
        "limit": limit,
        **tsquery.params,
    }
    if repo.tenant_id is not None:
        params["tenant_id"] = repo.tenant_id
    result = await repo.session.execute(text(wrapped_sql), params)
    return [row_to_nbs_catalog_item(row) for row in result]


async def load_nbs_catalog_item_details(
    repo: "NbsRepository",
    code: str,
    *,
    include_tree: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> NbsCatalogDetailPayload:
    item = await load_nbs_catalog_item_by_code(repo, code)
    ancestors = await load_nbs_catalog_item_ancestors(repo, item)
    chapter_root = resolve_nbs_catalog_hierarchy_root(item, ancestors)

    children_sql = f"""
        SELECT code, code_clean, description, parent_code, level, has_nebs
        FROM nbs_items
        WHERE parent_code = :code
        {" AND (nbs_items.tenant_id = :tenant_id OR nbs_items.tenant_id IS NULL)" if repo.tenant_id is not None else " AND nbs_items.tenant_id IS NULL"}
        ORDER BY source_order ASC
    """
    children_params = {"code": item["code"]}
    if repo.tenant_id is not None:
        children_params["tenant_id"] = repo.tenant_id
    child_rows = await repo.session.execute(text(children_sql), children_params)
    tree_page = (
        await load_nbs_catalog_tree_page(repo, chapter_root["code"], page=page, page_size=page_size)
        if include_tree
        else None
    )
    nebs_payload = public_nbs_explanatory_entry(
        (
            await load_trusted_nbs_explanatory_entry(
                repo,
                item["code"],
                allow_aliases=False,
            )
        )
    )

    payload: NbsCatalogDetailPayload = {
        "success": True,
        "item": item,
        "ancestors": ancestors,
        "children": [row_to_nbs_catalog_item(row) for row in child_rows],
        "chapter_root": chapter_root,
        "nebs": nebs_payload,
    }
    if tree_page is not None:
        payload["chapter_items"] = tree_page["items"]
        payload["chapter_page"] = tree_page
    return payload


async def load_nbs_catalog_tree_page(
    repo: "NbsRepository",
    code: str,
    *,
    page: int = 1,
    page_size: int = 50,
) -> NbsCatalogTreePagePayload:
    normalized_page = max(int(page or 1), 1)
    normalized_size = min(max(int(page_size or 50), 1), 200)
    offset = (normalized_page - 1) * normalized_size
    count_sql = f"""
        SELECT COUNT(*) AS total
        FROM nbs_items
        WHERE (code = :root_code OR code LIKE :root_prefix)
        {" AND (nbs_items.tenant_id = :tenant_id OR nbs_items.tenant_id IS NULL)" if repo.tenant_id is not None else " AND nbs_items.tenant_id IS NULL"}
    """
    params = {
        "root_code": code,
        "root_prefix": f"{code}%",
    }
    if repo.tenant_id is not None:
        params["tenant_id"] = repo.tenant_id
    total_rows = int((await repo.session.execute(text(count_sql), params)).scalar() or 0)
    items = await load_nbs_catalog_items_by_prefix(
        repo,
        code,
        limit=normalized_size,
        offset=offset,
    )
    return {
        "items": items,
        "page": normalized_page,
        "page_size": normalized_size,
        "total": total_rows,
        "has_more": (offset + len(items)) < total_rows,
    }
