from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from backend.config.exceptions import NotFoundError
from backend.utils.nbs_parser import clean_nbs_code, normalize_nbs_text

from ..postgres_fts import build_postgres_tsquery
from .common import (
    load_nbs_catalog_item_ancestors,
    load_nbs_catalog_item_by_code,
    load_trusted_nbs_explanatory_entry,
    public_nbs_explanatory_entry,
)
from .types import (
    NbsExplanatoryDetailPayload,
    NbsExplanatorySearchResultPayload,
)

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import NbsRepository


async def load_nbs_explanatory_entries(
    repo: "NbsRepository", query: str, *, limit: int = 50
) -> list[NbsExplanatorySearchResultPayload]:
    raw_query = (query or "").strip()
    normalized_query = normalize_nbs_text(raw_query)
    clean_query = clean_nbs_code(raw_query)
    fts_query = build_postgres_tsquery(normalized_query or raw_query)

    if not raw_query or (not clean_query and not normalized_query):
        return []

    tenant_predicate_e = (
        " AND (e.tenant_id = :tenant_id OR e.tenant_id IS NULL)"
        if repo.tenant_id is not None
        else " AND e.tenant_id IS NULL"
    )
    fts_predicate = f"(e.search_vector @@ {fts_query.sql})"
    sql = f"""
        WITH ranked AS (
            SELECT
                e.code,
                e.code_clean,
                e.title,
                e.page_start,
                e.page_end,
                e.section_title,
                500 AS match_score,
                0::float AS fts_rank
            FROM nebs_entries AS e
            WHERE e.parser_status = 'trusted'
              AND :clean_query <> ''
              AND e.code_clean = :clean_query
              {tenant_predicate_e}
            UNION ALL
            SELECT
                e.code,
                e.code_clean,
                e.title,
                e.page_start,
                e.page_end,
                e.section_title,
                CASE
                    WHEN e.code = :raw_query THEN 480
                    WHEN e.code_clean LIKE :clean_prefix THEN 430
                    WHEN e.title_normalized = :normalized_query THEN 380
                    WHEN e.title_normalized LIKE :normalized_prefix THEN 340
                    ELSE 300
                END AS match_score,
                0::float AS fts_rank
            FROM nebs_entries AS e
            WHERE e.parser_status = 'trusted'
              AND (
                    (:clean_query <> '' AND e.code_clean LIKE :clean_prefix)
                    OR (:raw_query <> '' AND e.code LIKE :raw_prefix)
                    OR (:normalized_query <> '' AND e.title_normalized = :normalized_query)
                    OR (:normalized_query <> '' AND e.title_normalized LIKE :normalized_prefix)
              )
              {tenant_predicate_e}
            UNION ALL
            SELECT
                e.code,
                e.code_clean,
                e.title,
                e.page_start,
                e.page_end,
                e.section_title,
                220 AS match_score,
                ts_rank(e.search_vector, {fts_query.sql}) AS fts_rank
            FROM nebs_entries AS e
            WHERE e.parser_status = 'trusted'
              AND {fts_predicate}
              {tenant_predicate_e}
        )
        SELECT DISTINCT ON (code)
            code,
            title,
            page_start,
            page_end,
            section_title,
            match_score,
            fts_rank,
            code_clean
        FROM ranked
        ORDER BY code, match_score DESC, fts_rank DESC
    """
    wrapped_sql = f"""
        SELECT
            code,
            title,
            page_start,
            page_end,
            section_title
        FROM ({sql}) AS deduped
        ORDER BY match_score DESC, fts_rank DESC, LENGTH(code_clean) ASC, page_start ASC
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
        **fts_query.params,
    }
    if repo.tenant_id is not None:
        params["tenant_id"] = repo.tenant_id
    result = await repo.session.execute(text(wrapped_sql), params)
    return [
        {
            "code": row.code,
            "title": row.title,
            "excerpt": "",
            "page_start": row.page_start,
            "page_end": row.page_end,
            "section_title": row.section_title,
        }
        for row in result
    ]


async def load_nbs_explanatory_entry_details(
    repo: "NbsRepository", code: str
) -> NbsExplanatoryDetailPayload:
    normalized_code = (code or "").strip()
    item = await load_nbs_catalog_item_by_code(repo, normalized_code)
    ancestors = await load_nbs_catalog_item_ancestors(repo, item)
    entry = await load_trusted_nbs_explanatory_entry(
        repo,
        normalized_code,
        allow_aliases=True,
    )
    if entry is None:
        raise NotFoundError("Entrada NEBS", normalized_code)
    return {
        "success": True,
        "item": item,
        "ancestors": ancestors,
        "entry": public_nbs_explanatory_entry(entry),
    }
