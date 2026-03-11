"""Async service for the NBS catalog stored in services.db."""

from __future__ import annotations

import asyncio
from pathlib import Path
import re
from typing import Any

import aiosqlite

from backend.config.exceptions import DatabaseError, DatabaseNotFoundError, NotFoundError
from backend.config.logging_config import service_logger as logger
from backend.config.settings import settings
from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
    normalize_nbs_text,
)

NBS_ALLOWED_TABLES = {"nbs_items", "nebs_entries", "catalog_metadata"}
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


class NbsService:
    """Query helper for the NBS/NEBS catalog database."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path or settings.database.services_path)
        self._schema_columns_cache: dict[str, set[str]] = {}
        self._pool: list[aiosqlite.Connection] = []
        self._pool_lock = asyncio.Lock()
        self._pool_max_size = 2

    async def __aenter__(self) -> NbsService:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _get_connection(self) -> aiosqlite.Connection:
        if not self.db_path.exists():
            raise DatabaseNotFoundError(str(self.db_path))

        async with self._pool_lock:
            if self._pool:
                return self._pool.pop()

        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            return conn
        except Exception as exc:
            logger.error("Failed to connect to services DB: %s", exc)
            raise DatabaseError(f"Services DB connection failed: {exc}") from exc

    async def _release_connection(self, conn: aiosqlite.Connection) -> None:
        async with self._pool_lock:
            if len(self._pool) < self._pool_max_size:
                self._pool.append(conn)
                return
        await conn.close()

    async def close(self) -> None:
        async with self._pool_lock:
            while self._pool:
                conn = self._pool.pop()
                try:
                    await conn.close()
                except Exception as exc:
                    logger.warning("Error closing NBS pool connection: %s", exc)

    async def _get_table_columns(
        self, conn: aiosqlite.Connection, table: str
    ) -> set[str]:
        if table not in NBS_ALLOWED_TABLES:
            raise ValueError(f"Tabela não permitida para inspeção de schema: {table}")
        if table in self._schema_columns_cache:
            return self._schema_columns_cache[table]

        cursor = await conn.execute(f"PRAGMA table_info({table})")
        rows = await cursor.fetchall()
        cols = {row["name"] for row in rows}
        self._schema_columns_cache[table] = cols
        return cols

    async def _table_exists(self, conn: aiosqlite.Connection, table: str) -> bool:
        cursor = await conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type IN ('table', 'view') AND name = ?
            LIMIT 1
            """,
            (table,),
        )
        row = await cursor.fetchone()
        return row is not None

    @staticmethod
    def _row_to_item(row: aiosqlite.Row) -> dict[str, Any]:
        return {
            "code": row["code"],
            "code_clean": row["code_clean"],
            "description": row["description"],
            "parent_code": row["parent_code"],
            "level": row["level"],
            "has_nebs": bool(row["has_nebs"]),
        }

    @staticmethod
    def _row_to_nebs_entry_internal(row: aiosqlite.Row) -> dict[str, Any]:
        return {
            "code": row["code"],
            "code_clean": row["code_clean"],
            "title": row["title"],
            "title_normalized": row["title_normalized"],
            "body_text": row["body_text"],
            "body_markdown": row["body_markdown"],
            "body_normalized": row["body_normalized"],
            "section_title": row["section_title"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
            "parser_status": row["parser_status"],
            "parse_warnings": row["parse_warnings"],
            "source_hash": row["source_hash"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _to_public_nebs_entry(entry: dict[str, Any] | None) -> dict[str, Any] | None:
        if not entry:
            return None
        return {field: entry[field] for field in NEBS_PUBLIC_FIELDS}

    @staticmethod
    def _build_nebs_fts_query(normalized_query: str) -> str:
        tokens = re.findall(r"[0-9a-z]+", normalized_query or "")
        if not tokens:
            return ""
        return " AND ".join(f"{token}*" for token in tokens)

    @staticmethod
    def _build_excerpt(body_text: str, limit: int = 220) -> str:
        compact = " ".join((body_text or "").split())
        if len(compact) <= limit:
            return compact
        return f"{compact[: limit - 3].rstrip()}..."

    @staticmethod
    def _resolve_code_aliases(code: str) -> tuple[list[str], list[str]]:
        aliases = list(build_nbs_code_variants((code or "").strip()))
        clean_aliases = [clean_nbs_code(alias) for alias in aliases if clean_nbs_code(alias)]
        return aliases, list(dict.fromkeys(clean_aliases))

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

    async def _fetch_items_by_prefix(
        self, conn: aiosqlite.Connection, root_code: str
    ) -> list[dict[str, Any]]:
        cursor = await conn.execute(
            """
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE code = ? OR code LIKE ?
            ORDER BY source_order ASC
            """,
            (root_code, f"{root_code}%"),
        )
        rows = await cursor.fetchall()
        return [self._row_to_item(row) for row in rows]

    async def _fetch_item_by_code(
        self, conn: aiosqlite.Connection, code: str
    ) -> dict[str, Any]:
        raw_code = (code or "").strip()
        aliases, clean_aliases = self._resolve_code_aliases(raw_code)
        if not aliases and not clean_aliases:
            raise NotFoundError("Serviço NBS", raw_code)

        where_clauses: list[str] = []
        params: list[str] = []
        if aliases:
            where_clauses.append(f"code IN ({', '.join(['?'] * len(aliases))})")
            params.extend(aliases)
        if clean_aliases:
            where_clauses.append(f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})")
            params.extend(clean_aliases)

        cursor = await conn.execute(
            f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE {' OR '.join(where_clauses)}
            ORDER BY LENGTH(code_clean) DESC, source_order ASC
            LIMIT 1
            """,
            params,
        )
        row = await cursor.fetchone()
        if row is None:
            raise NotFoundError("Serviço NBS", raw_code)
        return self._row_to_item(row)

    async def _fetch_ancestors(
        self, conn: aiosqlite.Connection, item: dict[str, Any]
    ) -> list[dict[str, Any]]:
        ancestors: list[dict[str, Any]] = []
        parent_code = item["parent_code"]

        while parent_code:
            parent_cursor = await conn.execute(
                """
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE code = ?
                LIMIT 1
                """,
                (parent_code,),
            )
            parent_row = await parent_cursor.fetchone()
            if parent_row is None:
                break
            parent_item = self._row_to_item(parent_row)
            ancestors.append(parent_item)
            parent_code = parent_item["parent_code"]

        ancestors.reverse()
        return ancestors

    async def search(self, query: str, *, limit: int = 50) -> dict[str, Any]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)

        conn = await self._get_connection()
        try:
            await self._get_table_columns(conn, "nbs_items")
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

            return {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": [self._row_to_item(row) for row in rows],
                "total": len(rows),
            }
        finally:
            await self._release_connection(conn)

    async def get_item_details(self, code: str) -> dict[str, Any]:
        conn = await self._get_connection()
        try:
            item = await self._fetch_item_by_code(conn, code)
            ancestors = await self._fetch_ancestors(conn, item)
            chapter_root = self._resolve_hierarchy_root(item, ancestors)

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
            chapter_items = await self._fetch_items_by_prefix(conn, chapter_root["code"])

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
                else self._to_public_nebs_entry(
                    self._row_to_nebs_entry_internal(nebs_row)
                )
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
        finally:
            await self._release_connection(conn)

    async def search_nebs(self, query: str, *, limit: int = 50) -> dict[str, Any]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)
        fts_query = self._build_nebs_fts_query(normalized_query)
        conn = await self._get_connection()
        try:
            await self._get_table_columns(conn, "nebs_entries")
            has_fts = await self._table_exists(conn, "nebs_entries_fts")
            if not raw_query:
                rows = []
            elif not clean_query and not normalized_query:
                rows = []
            elif not has_fts:
                cursor = await conn.execute(
                    """
                    SELECT
                        code,
                        code_clean,
                        title,
                        section_title,
                        page_start,
                        page_end,
                        body_text,
                        CASE
                            WHEN code_clean = ? THEN 500
                            WHEN code = ? THEN 480
                            WHEN code_clean LIKE ? THEN 430
                            WHEN title_normalized = ? THEN 380
                            WHEN title_normalized LIKE ? THEN 340
                            WHEN body_normalized LIKE ? THEN 220
                            ELSE 180
                        END AS match_score
                    FROM nebs_entries
                    WHERE parser_status = 'trusted'
                      AND (
                        (? <> '' AND code_clean = ?)
                        OR (? <> '' AND code_clean LIKE ?)
                        OR (? <> '' AND code LIKE ?)
                        OR (? <> '' AND title_normalized LIKE ?)
                        OR (? <> '' AND body_normalized LIKE ?)
                      )
                    ORDER BY match_score DESC, LENGTH(code_clean) ASC, page_start ASC
                    LIMIT ?
                    """,
                    (
                        clean_query,
                        raw_query,
                        f"{clean_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        f"%{normalized_query}%",
                        clean_query,
                        clean_query,
                        clean_query,
                        f"{clean_query}%",
                        raw_query,
                        f"{raw_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        normalized_query,
                        f"%{normalized_query}%",
                        limit,
                    ),
                )
                rows = await cursor.fetchall()
            else:
                cursor = await conn.execute(
                    """
                    WITH fts_hits AS (
                        SELECT
                            code,
                            bm25(nebs_entries_fts, 8.0, 4.0, 1.0, 0.5) AS fts_rank
                        FROM nebs_entries_fts
                        WHERE ? <> '' AND nebs_entries_fts MATCH ?
                    )
                    SELECT
                        e.code,
                        e.code_clean,
                        e.title,
                        e.section_title,
                        e.page_start,
                        e.page_end,
                        e.body_text,
                        CASE
                            WHEN e.code_clean = ? THEN 500
                            WHEN e.code = ? THEN 480
                            WHEN e.code_clean LIKE ? THEN 430
                            WHEN e.title_normalized = ? THEN 380
                            WHEN e.title_normalized LIKE ? THEN 340
                            WHEN fts_hits.code IS NOT NULL THEN 220
                            ELSE 180
                        END AS match_score,
                        COALESCE(fts_hits.fts_rank, 999999.0) AS fts_rank
                    FROM nebs_entries AS e
                    LEFT JOIN fts_hits ON fts_hits.code = e.code
                    WHERE e.parser_status = 'trusted'
                      AND (
                        (? <> '' AND e.code_clean = ?)
                        OR (? <> '' AND e.code_clean LIKE ?)
                        OR (? <> '' AND e.code LIKE ?)
                        OR (? <> '' AND e.title_normalized LIKE ?)
                        OR fts_hits.code IS NOT NULL
                      )
                    ORDER BY match_score DESC, fts_rank ASC, LENGTH(e.code_clean) ASC, e.page_start ASC
                    LIMIT ?
                    """,
                    (
                        fts_query,
                        fts_query,
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
                        f"{normalized_query}%",
                        limit,
                    ),
                )
                rows = await cursor.fetchall()

            results = [
                {
                    "code": row["code"],
                    "title": row["title"],
                    "excerpt": self._build_excerpt(row["body_text"]),
                    "page_start": row["page_start"],
                    "page_end": row["page_end"],
                    "section_title": row["section_title"],
                }
                for row in rows
            ]
            return {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": results,
                "total": len(results),
            }
        finally:
            await self._release_connection(conn)

    async def get_nebs_details(self, code: str) -> dict[str, Any]:
        conn = await self._get_connection()
        try:
            item = await self._fetch_item_by_code(conn, code)
            ancestors = await self._fetch_ancestors(conn, item)
            aliases, clean_aliases = self._resolve_code_aliases(code)
            entry_where_clauses: list[str] = []
            entry_params: list[str] = []
            if aliases:
                entry_where_clauses.append(f"code IN ({', '.join(['?'] * len(aliases))})")
                entry_params.extend(aliases)
            if clean_aliases:
                entry_where_clauses.append(f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})")
                entry_params.extend(clean_aliases)
            entry_params.append('trusted')
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
                WHERE ({' OR '.join(entry_where_clauses)}) AND parser_status = ?
                ORDER BY LENGTH(code_clean) DESC
                LIMIT 1
                """,
                entry_params,
            )
            entry_row = await entry_cursor.fetchone()
            if entry_row is None:
                raise NotFoundError("Entrada NEBS", (code or "").strip())

            return {
                "success": True,
                "item": item,
                "ancestors": ancestors,
                "entry": self._to_public_nebs_entry(
                    self._row_to_nebs_entry_internal(entry_row)
                ),
            }
        finally:
            await self._release_connection(conn)
