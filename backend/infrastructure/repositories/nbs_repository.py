"""
Repository para operações do catálogo NBS / NEBS em PostgreSQL.

Mantém o contrato usado pelo serviço legado, mas executa consultas usando
AsyncSession e FTS do PostgreSQL.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...config.exceptions import NotFoundError
from ...config.settings import settings
from ...infrastructure.db_engine import tenant_context
from ...utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
    normalize_nbs_text,
)
from .postgres_fts import build_postgres_tsquery

MAX_ANCESTOR_DEPTH = 64
NEBS_PUBLIC_FIELDS = (
    "code",
    "code_clean",
    "title",
    "title_normalized",
    "body_text",
    "body_markdown",
    "body_normalized",
    "section_title",
    "page_start",
    "page_end",
)


class NbsRepository:
    """Repository do catálogo NBS / NEBS."""

    def __init__(self, session: AsyncSession, tenant_id: Optional[str] = None):
        self.session = session
        self.is_postgres = settings.database.is_postgres
        self.tenant_id = tenant_id or tenant_context.get() or None

    @staticmethod
    def _row_to_item(row: Any) -> dict[str, Any]:
        return {
            "code": row.code,
            "code_clean": row.code_clean,
            "description": row.description,
            "parent_code": row.parent_code,
            "level": row.level,
            "has_nebs": bool(row.has_nebs),
        }

    @staticmethod
    def _row_to_nebs_entry_internal(row: Any) -> dict[str, Any]:
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

    @staticmethod
    def _to_public_nebs_entry(entry: dict[str, Any] | None) -> dict[str, Any] | None:
        if not entry:
            return None
        return {field: entry[field] for field in NEBS_PUBLIC_FIELDS}

    @staticmethod
    def _build_excerpt(body_text: str, limit: int = 220) -> str:
        compact = " ".join((body_text or "").split())
        if len(compact) <= limit:
            return compact
        return f"{compact[: limit - 3].rstrip()}..."

    @staticmethod
    def _resolve_code_aliases(code: str) -> tuple[list[str], list[str]]:
        aliases = list(build_nbs_code_variants((code or "").strip()))
        clean_aliases = [
            clean_nbs_code(alias) for alias in aliases if clean_nbs_code(alias)
        ]
        return aliases, list(dict.fromkeys(clean_aliases))

    def _tenant_predicate_sql(self, alias: str) -> str:
        if self.tenant_id:
            return f" AND ({alias}.tenant_id = :tenant_id OR {alias}.tenant_id IS NULL)"
        return ""

    def _tenant_params(self) -> dict[str, Any]:
        if self.tenant_id:
            return {"tenant_id": self.tenant_id}
        return {}

    @staticmethod
    def _append_in_clause(
        fragments: list[str],
        params: dict[str, Any],
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

    async def get_catalog_metadata(self) -> dict[str, str]:
        sql = (
            "SELECT key, value FROM catalog_metadata WHERE 1=1"
            f"{self._tenant_predicate_sql('catalog_metadata')}"
        )
        result = await self.session.execute(text(sql), self._tenant_params())
        return {row.key: row.value for row in result}

    async def get_catalog_counts(self) -> dict[str, int]:
        nbs_sql = (
            "SELECT COUNT(*) AS total FROM nbs_items WHERE 1=1"
            f"{self._tenant_predicate_sql('nbs_items')}"
        )
        nebs_sql = (
            "SELECT COUNT(*) AS total FROM nebs_entries WHERE parser_status = 'trusted'"
            f"{self._tenant_predicate_sql('nebs_entries')}"
        )
        nbs_result = await self.session.execute(text(nbs_sql), self._tenant_params())
        nebs_result = await self.session.execute(text(nebs_sql), self._tenant_params())
        return {
            "nbs_items": int(nbs_result.scalar() or 0),
            "nebs_entries": int(nebs_result.scalar() or 0),
        }

    async def search(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)

        if not raw_query:
            sql = f"""
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE parent_code IS NULL
                {self._tenant_predicate_sql("nbs_items")}
                ORDER BY source_order ASC
                LIMIT :limit
            """
            result = await self.session.execute(
                text(sql), {"limit": limit, **self._tenant_params()}
            )
            return [self._row_to_item(row) for row in result]

        if not clean_query and not normalized_query:
            return []

        tsquery = build_postgres_tsquery(normalized_query or raw_query)
        fts_predicate = f"(n.search_vector @@ {tsquery.sql})"
        sql = f"""
            SELECT
                n.code,
                n.code_clean,
                n.description,
                n.parent_code,
                n.level,
                n.has_nebs,
                CASE
                    WHEN n.code_clean = :clean_query THEN 500
                    WHEN n.code = :raw_query THEN 480
                    WHEN n.code_clean LIKE :clean_prefix THEN 420
                    WHEN n.description_normalized = :normalized_query THEN 360
                    WHEN n.description_normalized LIKE :normalized_prefix THEN 320
                    WHEN {fts_predicate} THEN 220
                    ELSE 200
                END AS match_score
            FROM nbs_items AS n
            WHERE (
                (:clean_query <> '' AND n.code_clean = :clean_query)
                OR (:clean_query <> '' AND n.code_clean LIKE :clean_prefix)
                OR (:raw_query <> '' AND n.code LIKE :raw_prefix)
                OR (:normalized_query <> '' AND n.description_normalized LIKE :normalized_like)
                OR {fts_predicate}
            )
            {self._tenant_predicate_sql("n")}
            ORDER BY match_score DESC, LENGTH(n.code_clean) ASC, n.source_order ASC
            LIMIT :limit
        """
        params = {
            "clean_query": clean_query,
            "raw_query": raw_query,
            "clean_prefix": f"{clean_query}%",
            "raw_prefix": f"{raw_query}%",
            "normalized_query": normalized_query,
            "normalized_prefix": f"{normalized_query}%",
            "normalized_like": f"%{normalized_query}%",
            "limit": limit,
            **tsquery.params,
            **self._tenant_params(),
        }
        result = await self.session.execute(text(sql), params)
        return [self._row_to_item(row) for row in result]

    async def _fetch_item_by_code(self, code: str) -> dict[str, Any]:
        raw_code = (code or "").strip()
        aliases, clean_aliases = self._resolve_code_aliases(raw_code)
        if not aliases and not clean_aliases:
            raise NotFoundError("Serviço NBS", raw_code)

        where_clauses: list[str] = []
        params: dict[str, Any] = {}
        self._append_in_clause(where_clauses, params, "code", aliases, "code")
        self._append_in_clause(
            where_clauses, params, "code_clean", clean_aliases, "code_clean"
        )
        params.update(self._tenant_params())
        sql = f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE ({" OR ".join(where_clauses)})
            {self._tenant_predicate_sql("nbs_items")}
            ORDER BY LENGTH(code_clean) DESC, source_order ASC
            LIMIT 1
        """
        row = (await self.session.execute(text(sql), params)).first()
        if row is None:
            raise NotFoundError("Serviço NBS", raw_code)
        return self._row_to_item(row)

    async def _fetch_ancestors(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        ancestors: list[dict[str, Any]] = []
        parent_code = item["parent_code"]
        visited_codes = {item["code"]}
        depth = 0

        while parent_code:
            if depth >= MAX_ANCESTOR_DEPTH or parent_code in visited_codes:
                break
            params = {"parent_code": parent_code, **self._tenant_params()}
            sql = f"""
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE code = :parent_code
                {self._tenant_predicate_sql("nbs_items")}
                LIMIT 1
            """
            row = (await self.session.execute(text(sql), params)).first()
            if row is None:
                break
            parent_item = self._row_to_item(row)
            visited_codes.add(parent_item["code"])
            ancestors.append(parent_item)
            parent_code = parent_item["parent_code"]
            depth += 1

        ancestors.reverse()
        return ancestors

    async def _fetch_items_by_prefix(self, root_code: str) -> list[dict[str, Any]]:
        sql = f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE (code = :root_code OR code LIKE :root_prefix)
            {self._tenant_predicate_sql("nbs_items")}
            ORDER BY source_order ASC
        """
        result = await self.session.execute(
            text(sql),
            {
                "root_code": root_code,
                "root_prefix": f"{root_code}%",
                **self._tenant_params(),
            },
        )
        return [self._row_to_item(row) for row in result]

    @staticmethod
    def _resolve_hierarchy_root(
        item: dict[str, Any], ancestors: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if item["level"] <= 1:
            return item

        for ancestor in ancestors:
            if ancestor["level"] == 1:
                return ancestor

        return ancestors[0] if ancestors else item

    async def _fetch_trusted_nebs_entry(
        self, code: str, *, allow_aliases: bool
    ) -> dict[str, Any] | None:
        where_clauses: list[str] = []
        params: dict[str, Any] = {"parser_status": "trusted", **self._tenant_params()}

        if allow_aliases:
            aliases, clean_aliases = self._resolve_code_aliases(code)
            self._append_in_clause(where_clauses, params, "code", aliases, "nebs_code")
            self._append_in_clause(
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
              {self._tenant_predicate_sql("nebs_entries")}
            ORDER BY LENGTH(code_clean) DESC
            LIMIT 1
        """
        row = (await self.session.execute(text(sql), params)).first()
        if row is None:
            return None
        return self._row_to_nebs_entry_internal(row)

    async def get_item_details(self, code: str) -> dict[str, Any]:
        item = await self._fetch_item_by_code(code)
        ancestors = await self._fetch_ancestors(item)
        chapter_root = self._resolve_hierarchy_root(item, ancestors)

        children_sql = f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE parent_code = :code
            {self._tenant_predicate_sql("nbs_items")}
            ORDER BY source_order ASC
        """
        child_rows = await self.session.execute(
            text(children_sql), {"code": item["code"], **self._tenant_params()}
        )
        chapter_items = await self._fetch_items_by_prefix(chapter_root["code"])
        nebs_payload = self._to_public_nebs_entry(
            await self._fetch_trusted_nebs_entry(item["code"], allow_aliases=False)
        )

        return {
            "success": True,
            "item": item,
            "ancestors": ancestors,
            "children": [self._row_to_item(row) for row in child_rows],
            "chapter_root": chapter_root,
            "chapter_items": chapter_items,
            "nebs": nebs_payload,
        }

    async def search_nebs(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)
        if not raw_query or (not clean_query and not normalized_query):
            return []

        tsquery = build_postgres_tsquery(normalized_query or raw_query)
        fts_predicate = f"(e.search_vector @@ {tsquery.sql})"
        sql = f"""
            SELECT
                e.code,
                e.title,
                e.body_text,
                e.page_start,
                e.page_end,
                e.section_title,
                CASE
                    WHEN e.code_clean = :clean_query THEN 500
                    WHEN e.code = :raw_query THEN 480
                    WHEN e.code_clean LIKE :clean_prefix THEN 430
                    WHEN e.title_normalized = :normalized_query THEN 380
                    WHEN e.title_normalized LIKE :normalized_prefix THEN 340
                    WHEN {fts_predicate} THEN 220
                    ELSE 180
                END AS match_score,
                CASE
                    WHEN {fts_predicate} THEN ts_rank(e.search_vector, {tsquery.sql})
                    ELSE 0
                END AS fts_rank
            FROM nebs_entries AS e
            WHERE e.parser_status = 'trusted'
              AND (
                    (:clean_query <> '' AND e.code_clean = :clean_query)
                    OR (:clean_query <> '' AND e.code_clean LIKE :clean_prefix)
                    OR (:raw_query <> '' AND e.code LIKE :raw_prefix)
                    OR (:normalized_query <> '' AND e.title_normalized LIKE :normalized_prefix)
                    OR {fts_predicate}
              )
              {self._tenant_predicate_sql("e")}
            ORDER BY match_score DESC, fts_rank DESC, LENGTH(e.code_clean) ASC, e.page_start ASC
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
            **self._tenant_params(),
        }
        result = await self.session.execute(text(sql), params)
        return [
            {
                "code": row.code,
                "title": row.title,
                "excerpt": self._build_excerpt(row.body_text),
                "page_start": row.page_start,
                "page_end": row.page_end,
                "section_title": row.section_title,
            }
            for row in result
        ]

    async def get_nebs_details(self, code: str) -> dict[str, Any]:
        item = await self._fetch_item_by_code(code)
        ancestors = await self._fetch_ancestors(item)
        entry = await self._fetch_trusted_nebs_entry(code, allow_aliases=True)
        if entry is None:
            raise NotFoundError("Entrada NEBS", (code or "").strip())

        return {
            "success": True,
            "item": item,
            "ancestors": ancestors,
            "entry": self._to_public_nebs_entry(entry),
        }
