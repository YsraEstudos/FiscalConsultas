"""FTS and chapter query helpers for :class:`DatabaseAdapter`."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, TYPE_CHECKING

import aiosqlite

from ..config.constants import SearchConfig
from ..config.db_schema import CHAPTER_NOTES_SECTION_COLUMNS
from ..config.exceptions import DatabaseError
from ..config.logging_config import db_logger as logger
from .schema_cache import SchemaCache

if TYPE_CHECKING:
    from .database import DatabaseAdapter


class DatabaseSearchQueries:
    """Encapsulates schema probes and FTS/content queries."""

    _FTS_RESERVED_OPERATORS = {"AND", "OR", "NOT", "NEAR"}

    def __init__(self, adapter: "DatabaseAdapter") -> None:
        self._adapter = adapter
        self._fts_schema_cache: SchemaCache[Dict[str, Any]] = SchemaCache()
        self._chapter_notes_schema_cache: SchemaCache[set[str]] = SchemaCache()
        self._positions_schema_cache: SchemaCache[set[str]] = SchemaCache()
        self._chapter_sql_cache: Optional[str] = None
        self._chapter_sql_has_sections: Optional[bool] = None
        self._chapter_sql_has_parsed_notes_json: Optional[bool] = None

    def _get_db_signature(self) -> tuple[int, int, int, int] | None:
        try:
            stat_result = os.stat(self._adapter.db_path)
            return (
                stat_result.st_dev,
                stat_result.st_ino,
                stat_result.st_ctime_ns,
                stat_result.st_size,
            )
        except OSError:
            return None

    async def _detect_fts_schema(self, conn: aiosqlite.Connection) -> Dict[str, Any]:
        try:
            cursor = await conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_index' LIMIT 1"
            )
            if not await cursor.fetchone():
                return {
                    "available": False,
                    "reason": "Tabela FTS 'search_index' não encontrada",
                }

            cursor = await conn.execute("PRAGMA table_info(search_index)")
            rows = await cursor.fetchall()
            cols = {row["name"] for row in rows}

            if "indexed_content" in cols:
                content_column = "indexed_content"
            elif "description" in cols:
                content_column = "description"
            else:
                return {
                    "available": False,
                    "reason": "FTS sem coluna de conteúdo (esperado: indexed_content ou description)",
                }

            supports_rank = True
            try:
                await conn.execute(
                    f"SELECT rank FROM search_index WHERE {content_column} MATCH ? LIMIT 1",  # nosec B608 - validated by whitelist
                    ("probe",),
                )
            except Exception:
                logger.debug("FTS rank probe failed, rank not supported", exc_info=True)
                supports_rank = False

            return {
                "available": True,
                "content_column": content_column,
                "supports_rank": supports_rank,
            }
        except Exception as exc:
            logger.error(f"Erro ao detectar schema FTS: {exc}")
            return {
                "available": False,
                "reason": f"Falha ao inspecionar schema FTS: {exc}",
            }

    async def _get_fts_schema_cached(self, conn: aiosqlite.Connection) -> Dict[str, Any]:
        return await self._fts_schema_cache.get_or_load(
            load=lambda: self._detect_fts_schema(conn),
            resolve_db_signature=self._get_db_signature,
        )

    async def _get_chapter_notes_columns(self, conn: aiosqlite.Connection) -> set[str]:
        try:
            cursor = await conn.execute("PRAGMA table_info(chapter_notes)")
            rows = await cursor.fetchall()
            return {row["name"] for row in rows}
        except Exception as exc:
            logger.warning(f"Falha ao inspecionar chapter_notes: {exc}")
            return set()

    async def _get_chapter_notes_columns_cached(self, conn: aiosqlite.Connection) -> set[str]:
        return await self._chapter_notes_schema_cache.get_or_load(
            load=lambda: self._get_chapter_notes_columns(conn),
            resolve_db_signature=self._get_db_signature,
        )

    async def _get_positions_columns(self, conn: aiosqlite.Connection) -> set[str]:
        try:
            cursor = await conn.execute("PRAGMA table_info(positions)")
            rows = await cursor.fetchall()
            return {row["name"] for row in rows}
        except Exception as exc:
            logger.warning(f"Falha ao inspecionar positions: {exc}")
            return set()

    async def _get_positions_columns_cached(self, conn: aiosqlite.Connection) -> set[str]:
        return await self._positions_schema_cache.get_or_load(
            load=lambda: self._get_positions_columns(conn),
            resolve_db_signature=self._get_db_signature,
        )

    @staticmethod
    def _has_section_content(sections: Dict[str, Optional[str]]) -> bool:
        for value in sections.values():
            if isinstance(value, str):
                if value.strip():
                    return True
            elif value:
                return True
        return False

    @staticmethod
    def _fts_rank_sql(schema: Dict[str, Any]) -> Dict[str, str]:
        if schema.get("supports_rank"):
            return {"select": "rank", "order": "rank"}
        return {"select": "bm25(search_index) AS rank", "order": "bm25(search_index)"}

    def _build_chapter_sql(self, has_sections: bool, has_parsed_notes_json: bool) -> str:
        if (
            self._chapter_sql_cache is not None
            and self._chapter_sql_has_sections == has_sections
            and self._chapter_sql_has_parsed_notes_json == has_parsed_notes_json
        ):
            return self._chapter_sql_cache

        section_select = ", ".join(f"cn.{col}" for col in CHAPTER_NOTES_SECTION_COLUMNS)
        null_section_select = ", ".join(
            f"NULL AS {col}" for col in CHAPTER_NOTES_SECTION_COLUMNS
        )
        parsed_notes_select = (
            "cn.parsed_notes_json"
            if has_parsed_notes_json
            else "NULL AS parsed_notes_json"
        )
        section_projection = section_select if has_sections else null_section_select
        notes_select = f"cn.notes_content, {parsed_notes_select}, {section_projection}"
        sql = f"""SELECT
                    c.chapter_num,
                    c.content,
                    {notes_select}
                FROM chapters c
                LEFT JOIN chapter_notes cn ON c.chapter_num = cn.chapter_num
                WHERE c.chapter_num = ?"""  # nosec B608 - projection is built from fixed columns
        self._chapter_sql_cache = sql
        self._chapter_sql_has_sections = has_sections
        self._chapter_sql_has_parsed_notes_json = has_parsed_notes_json
        return sql

    @staticmethod
    def _sanitize_fts_token(token: str) -> str:
        stripped = token.strip()
        if not stripped:
            return ""

        cleaned_chars: list[str] = []
        for char in stripped:
            if char.isalnum() or char in {"_", "-", "."}:
                cleaned_chars.append(char)
            elif char in {'"', "(", ")", ":", "*", "^", "~"}:
                continue
            else:
                cleaned_chars.append(" ")

        normalized = " ".join("".join(cleaned_chars).split())
        if not normalized:
            return ""

        if " " in normalized:
            return ""

        if normalized.upper() in DatabaseSearchQueries._FTS_RESERVED_OPERATORS:
            return ""

        escaped = normalized.replace('"', '""')
        return f'"{escaped}"'

    async def _execute_fts_query(
        self,
        conn: aiosqlite.Connection,
        query: str,
        limit: int,
        *,
        raise_on_unavailable: bool,
    ) -> list[Dict[str, Any]]:
        schema = await self._get_fts_schema_cached(conn)
        if not schema.get("available"):
            msg = (
                f"Busca textual indisponível: {schema.get('reason')}. "
                "Recrie o índice FTS executando scripts/rebuild_index.py (recomendado)."
            )
            logger.error(msg)
            if raise_on_unavailable:
                raise DatabaseError(msg)
            return []

        content_col = schema["content_column"]
        rank_sql = self._fts_rank_sql(schema)
        cursor = await conn.execute(
            f"""
            SELECT ncm, display_text, type, description, {rank_sql["select"]}
            FROM search_index
            WHERE {content_col} MATCH ?
            ORDER BY {rank_sql["order"]}
            LIMIT ?
        """,  # nosec B608 - content_col/rank_sql come from validated schema
            (query, limit),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_chapter_raw(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        logger.debug(f"Buscando capítulo: {chapter_num}")

        async with self._adapter.get_connection() as conn:
            notes_cols = await self._get_chapter_notes_columns_cached(conn)
            expected_sections = set(CHAPTER_NOTES_SECTION_COLUMNS)
            has_sections = expected_sections.issubset(notes_cols)
            has_parsed_notes_json = "parsed_notes_json" in notes_cols
            chapter_sql = self._build_chapter_sql(has_sections, has_parsed_notes_json)
            cursor = await conn.execute(chapter_sql, (chapter_num,))

            first_row = await cursor.fetchone()
            if not first_row:
                logger.debug(f"Capítulo {chapter_num} não encontrado")
                return None

            position_cols = await self._get_positions_columns_cached(conn)
            has_anchor_id = "anchor_id" in position_cols
            anchor_projection = "anchor_id" if has_anchor_id else "NULL AS anchor_id"

            cursor = await conn.execute(
                f"""
                SELECT codigo, descricao, {anchor_projection}
                FROM positions
                WHERE chapter_num = ?
                -- Sort code segments numerically (major.minor.subminor)
                -- so 2-part and 3-part HS/NCM codes keep deterministic order.
                ORDER BY
                    CAST(COALESCE(NULLIF(SUBSTR(codigo, 1, INSTR(codigo || '.', '.') - 1), ''), '0') AS INTEGER),
                    CAST(COALESCE(NULLIF(
                        SUBSTR(
                            SUBSTR(codigo, INSTR(codigo || '.', '.') + 1),
                            1,
                            INSTR(SUBSTR(codigo, INSTR(codigo || '.', '.') + 1) || '.', '.') - 1
                        ),
                        ''
                    ), '0') AS INTEGER),
                    CAST(COALESCE(NULLIF(
                        SUBSTR(
                            SUBSTR(
                                SUBSTR(codigo, INSTR(codigo || '.', '.') + 1),
                                INSTR(SUBSTR(codigo, INSTR(codigo || '.', '.') + 1) || '.', '.') + 1
                            ),
                            1,
                            INSTR(
                                SUBSTR(
                                    SUBSTR(codigo, INSTR(codigo || '.', '.') + 1),
                                    INSTR(SUBSTR(codigo, INSTR(codigo || '.', '.') + 1) || '.', '.') + 1
                                ) || '.',
                                '.'
                            ) - 1
                        ),
                        ''
                    ), '0') AS INTEGER)
            """,  # nosec B608 - anchor_projection is whitelist-driven
                (chapter_num,),
            )
            pos_rows = await cursor.fetchall()

            positions = [
                {
                    "codigo": row["codigo"],
                    "descricao": row["descricao"],
                    "anchor_id": row["anchor_id"],
                }
                for row in pos_rows
                if row["codigo"] is not None
            ]

            logger.debug(f"Capítulo {chapter_num}: {len(positions)} posições (2 queries)")
            sections_map: Dict[str, Any] = {
                col: first_row[col] for col in CHAPTER_NOTES_SECTION_COLUMNS
            }
            sections: Optional[Dict[str, Any]] = sections_map
            if not self._has_section_content(sections_map):
                sections = None

            return {
                "chapter_num": first_row["chapter_num"],
                "content": first_row["content"],
                "positions": positions,
                "notes": first_row["notes_content"],
                "parsed_notes_json": first_row["parsed_notes_json"],
                "sections": sections,
            }

    async def fts_search(
        self, query: str, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        logger.debug(f"FTS search: '{query}'")
        result_limit = limit if limit is not None else SearchConfig.MAX_FTS_RESULTS

        async with self._adapter.get_connection() as conn:
            return await self._execute_fts_query(
                conn,
                query,
                result_limit,
                raise_on_unavailable=True,
            )

    async def fts_search_scored(
        self,
        query: str,
        tier: int,
        limit: int,
        words_matched: int = 0,
        total_words: int = 1,
    ) -> List[Dict[str, Any]]:
        tier_bases = {
            1: SearchConfig.TIER1_BASE_SCORE,
            2: SearchConfig.TIER2_BASE_SCORE,
            3: SearchConfig.TIER3_BASE_SCORE,
        }
        base = tier_bases.get(tier, 0)
        coverage_bonus = (words_matched / total_words * 100) if total_words > 0 else 0

        logger.debug(f"FTS scored search tier {tier}: '{query}'")

        async with self._adapter.get_connection() as conn:
            rows = await self._execute_fts_query(
                conn,
                query,
                limit,
                raise_on_unavailable=True,
            )

        results: list[Dict[str, Any]] = []
        for row in rows:
            result = dict(row)
            bm25_normalized = min(100, max(0, -result["rank"] * 10))
            result["score"] = round(base + bm25_normalized + coverage_bonus, 1)
            result["tier"] = tier
            results.append(result)

        logger.debug(f"FTS tier {tier} retornou {len(results)} resultados")
        return results

    async def fts_search_near(
        self, words: list[str], distance: int, limit: int
    ) -> List[Dict[str, Any]]:
        if len(words) < 2:
            return []

        sanitized_words = [
            token for word in words if (token := self._sanitize_fts_token(word))
        ]
        if len(sanitized_words) < 2:
            return []

        near_query = f"NEAR({' '.join(sanitized_words)}, {distance})"
        logger.debug(f"FTS NEAR search: '{near_query}'")

        try:
            async with self._adapter.get_connection() as conn:
                results = await self._execute_fts_query(
                    conn,
                    near_query,
                    limit,
                    raise_on_unavailable=False,
                )
            logger.debug(f"FTS NEAR retornou {len(results)} resultados")
            return results
        except Exception as exc:
            logger.debug(f"FTS NEAR falhou (ignorado): {exc}")
            return []
