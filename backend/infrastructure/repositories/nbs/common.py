from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from sqlalchemy import text

from backend.config.exceptions import NotFoundError
from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
)

from .types import (
    NBS_EXPLANATORY_PUBLIC_FIELDS,
    NBS_REPOSITORY_MAX_ANCESTOR_DEPTH,
    NbsCatalogItemPayload,
    NbsExplanatoryEntryPayload,
)

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import NbsRepository


class _NbsCatalogItemRow(Protocol):
    code: str
    code_clean: str
    description: str
    parent_code: str | None
    level: int


class _NbsExplanatoryEntryRow(Protocol):
    code: str
    code_clean: str
    title: str
    title_normalized: str
    body_text: str
    body_markdown: str
    body_normalized: str
    section_title: str | None
    page_start: int | None
    page_end: int | None
    parser_status: str
    parse_warnings: str | None
    source_hash: str
    updated_at: object


def row_to_nbs_catalog_item(row: _NbsCatalogItemRow) -> NbsCatalogItemPayload:
    return {
        "code": row.code,
        "code_clean": row.code_clean,
        "description": row.description,
        "parent_code": row.parent_code,
        "level": row.level,
    }


def row_to_nbs_explanatory_entry(
    row: _NbsExplanatoryEntryRow,
) -> NbsExplanatoryEntryPayload:
    return {
        "code": row.code,
        "code_clean": row.code_clean,
        "title": row.title,
        "title_normalized": row.title_normalized,
        "body_text": row.body_text,
        "body_markdown": row.body_markdown,
        "body_normalized": row.body_normalized,
        "section_title": row.section_title,
        "page_start": row.page_start,
        "page_end": row.page_end,
        "parser_status": row.parser_status,
        "parse_warnings": row.parse_warnings,
        "source_hash": row.source_hash,
        "updated_at": row.updated_at,
    }


def public_nbs_explanatory_entry(
    entry: dict[str, object] | None,
) -> dict[str, object] | None:
    if not entry:
        return None
    return {field: entry[field] for field in NBS_EXPLANATORY_PUBLIC_FIELDS}


def build_nbs_excerpt_snippet(body_text: str, limit: int = 220) -> str:
    compact = " ".join((body_text or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3].rstrip()}..."


def resolve_nbs_code_aliases(code: str) -> tuple[list[str], list[str]]:
    aliases = list(build_nbs_code_variants((code or "").strip()))
    clean_aliases: list[str] = []
    for alias in aliases:
        clean_alias = clean_nbs_code(alias)
        if clean_alias:
            clean_aliases.append(clean_alias)
    return aliases, list(dict.fromkeys(clean_aliases))


def build_nbs_tenant_predicate_sql(tenant_id: str | None, alias: str) -> str:
    if tenant_id:
        return f" AND ({alias}.tenant_id = :tenant_id OR {alias}.tenant_id IS NULL)"
    return f" AND {alias}.tenant_id IS NULL"


def build_nbs_tenant_params(tenant_id: str | None) -> dict[str, object]:
    if tenant_id:
        return {"tenant_id": tenant_id}
    return {}


def append_nbs_sql_in_clause(
    fragments: list[str],
    params: dict[str, object],
    column_sql: str,
    values: list[str],
    prefix: str,
) -> None:
    if not values:
        return
    placeholders: list[str] = []
    for index, value in enumerate(values):
        key = f"{prefix}_{index}"
        placeholders.append(f":{key}")
        params[key] = value
    fragments.append(f"{column_sql} IN ({', '.join(placeholders)})")


def resolve_nbs_catalog_hierarchy_root(
    item: NbsCatalogItemPayload, ancestors: list[NbsCatalogItemPayload]
) -> NbsCatalogItemPayload:
    if item["level"] <= 1:
        return item

    for ancestor in ancestors:
        if ancestor["level"] == 1:
            return ancestor

    return ancestors[0] if ancestors else item


async def load_nbs_catalog_item_by_code(
    repo: "NbsRepository", code: str
) -> NbsCatalogItemPayload:
    raw_code = (code or "").strip()
    aliases, clean_aliases = resolve_nbs_code_aliases(raw_code)
    if not aliases and not clean_aliases:
        raise NotFoundError("Serviço NBS", raw_code)

    where_clauses: list[str] = []
    params: dict[str, object] = {}
    append_nbs_sql_in_clause(where_clauses, params, "code", aliases, "code")
    append_nbs_sql_in_clause(
        where_clauses, params, "code_clean", clean_aliases, "code_clean"
    )
    params.update(build_nbs_tenant_params(repo.tenant_id))
    sql = f"""
        SELECT code, code_clean, description, parent_code, level
        FROM nbs_items
        WHERE ({" OR ".join(where_clauses)})
        {build_nbs_tenant_predicate_sql(repo.tenant_id, "nbs_items")}
        ORDER BY LENGTH(code_clean) DESC, source_order ASC
        LIMIT 1
    """
    row = (await repo.session.execute(text(sql), params)).first()
    if row is None:
        raise NotFoundError("Serviço NBS", raw_code)
    return row_to_nbs_catalog_item(row)


async def load_nbs_catalog_item_ancestors(
    repo: "NbsRepository",
    item: NbsCatalogItemPayload,
) -> list[NbsCatalogItemPayload]:
    ancestors: list[NbsCatalogItemPayload] = []
    parent_code = item["parent_code"]
    visited_codes = {item["code"]}
    depth = 0

    while parent_code:
        if depth >= NBS_REPOSITORY_MAX_ANCESTOR_DEPTH or parent_code in visited_codes:
            break
        params = {"parent_code": parent_code, **build_nbs_tenant_params(repo.tenant_id)}
        sql = f"""
            SELECT code, code_clean, description, parent_code, level
            FROM nbs_items
            WHERE code = :parent_code
            {build_nbs_tenant_predicate_sql(repo.tenant_id, "nbs_items")}
            LIMIT 1
        """
        row = (await repo.session.execute(text(sql), params)).first()
        if row is None:
            break
        parent_item = row_to_nbs_catalog_item(row)
        visited_codes.add(parent_item["code"])
        ancestors.append(parent_item)
        parent_code = parent_item["parent_code"]
        depth += 1

    ancestors.reverse()
    return ancestors


async def load_nbs_catalog_items_by_prefix(
    repo: "NbsRepository",
    root_code: str,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> list[NbsCatalogItemPayload]:
    sql = f"""
        SELECT code, code_clean, description, parent_code, level
        FROM nbs_items
        WHERE (code = :root_code OR code LIKE :root_prefix)
        {build_nbs_tenant_predicate_sql(repo.tenant_id, "nbs_items")}
        ORDER BY source_order ASC
    """
    params = {
        "root_code": root_code,
        "root_prefix": f"{root_code}%",
        **build_nbs_tenant_params(repo.tenant_id),
    }
    if limit is not None:
        sql = f"{sql}\n LIMIT :limit OFFSET :offset"
        params["limit"] = limit
        params["offset"] = max(offset, 0)
    result = await repo.session.execute(text(sql), params)
    return [row_to_nbs_catalog_item(row) for row in result]


async def load_trusted_nbs_explanatory_entry(
    repo: "NbsRepository",
    code: str,
    *,
    allow_aliases: bool,
) -> NbsExplanatoryEntryPayload | None:
    where_clauses: list[str] = []
    params: dict[str, object] = {
        "parser_status": "trusted",
        **build_nbs_tenant_params(repo.tenant_id),
    }

    if allow_aliases:
        aliases, clean_aliases = resolve_nbs_code_aliases(code)
        append_nbs_sql_in_clause(where_clauses, params, "code", aliases, "nebs_code")
        append_nbs_sql_in_clause(
            where_clauses,
            params,
            "code_clean",
            clean_aliases,
            "nebs_code_clean",
        )
    else:
        params["code"] = code
        where_clauses.append("code = :code")

    if not where_clauses:
        return None

    sql = f"""
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
        WHERE ({" OR ".join(where_clauses)})
          AND parser_status = :parser_status
          {build_nbs_tenant_predicate_sql(repo.tenant_id, "nebs_entries")}
        ORDER BY LENGTH(code_clean) DESC
        LIMIT 1
    """
    row = (await repo.session.execute(text(sql), params)).first()
    if row is None:
        return None
    return row_to_nbs_explanatory_entry(row)
