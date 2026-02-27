"""
Adaptador de banco de dados SQLite para o Nesh (Async).
Gerencia conexões e queries ao banco nesh.db com connection pooling assíncrono.
"""

import asyncio
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import aiosqlite

from ..config.constants import SearchConfig
from ..config.db_schema import CHAPTER_NOTES_SECTION_COLUMNS
from ..config.exceptions import DatabaseError, DatabaseNotFoundError
from ..config.logging_config import db_logger as logger
from ..config.settings import settings


class ConnectionPool:
    """
    Pool de conexões SQLite thread-safe e async.

    Mantém conexões reutilizáveis para evitar overhead
    de criar nova conexão a cada request.

    Attributes:
        db_path: Caminho para o arquivo SQLite
        max_size: Tamanho máximo do pool
    """

    def __init__(self, db_path: str, max_size: int = 5):
        self.db_path = db_path
        self.max_size = max_size
        self._pool: List[aiosqlite.Connection] = []
        self._lock = asyncio.Lock()
        self._created = 0
        logger.info(f"ConnectionPool inicializado (max={max_size})")

    async def _create_connection(self) -> aiosqlite.Connection:
        """Cria nova conexão configurada."""
        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            # Otimizações de performance
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute("PRAGMA synchronous=NORMAL")
            await conn.execute("PRAGMA cache_size=10000")
            self._created += 1
            logger.debug(f"Nova conexão criada (total: {self._created})")
            return conn
        except Exception as e:
            logger.error(f"Falha ao criar conexão: {e}")
            raise DatabaseError(f"Falha ao conectar ao banco: {e}")

    async def get(self) -> aiosqlite.Connection:
        """Obtém conexão do pool ou cria nova."""
        async with self._lock:
            if self._pool:
                conn = self._pool.pop()
                logger.debug(
                    f"Conexão reutilizada do pool ({len(self._pool)} restantes)"
                )
                return conn
        return await self._create_connection()

    async def release(self, conn: aiosqlite.Connection) -> None:
        """Devolve conexão ao pool."""
        async with self._lock:
            if len(self._pool) < self.max_size:
                self._pool.append(conn)
                logger.debug(f"Conexão devolvida ao pool ({len(self._pool)} total)")
            else:
                try:
                    await conn.close()
                except Exception as e:
                    logger.warning(f"Erro ao fechar conexão excedente: {e}")
                logger.debug("Pool cheio, conexão fechada")

    async def close_all(self) -> None:
        """Fecha todas as conexões do pool."""
        async with self._lock:
            for conn in self._pool:
                try:
                    await conn.close()
                except Exception as e:
                    logger.warning(f"Erro ao fechar conexão do pool: {e}")
            self._pool.clear()
            logger.info("Pool de conexões fechado")


class DatabaseAdapter:
    """
    Gerencia conexões e queries com o banco de dados SQLite de forma assíncrona.

    Attributes:
        db_path: Caminho absoluto para o arquivo .db
        pool: Pool de conexões reutilizáveis
    """

    # Pool compartilhado (singleton por db_path)
    _pools: Dict[str, ConnectionPool] = {}
    _pools_lock: Optional[asyncio.Lock] = None

    @classmethod
    def _get_pools_lock(cls) -> asyncio.Lock:
        """Lazy initialization do lock para evitar criação fora do event loop."""
        if cls._pools_lock is None:
            cls._pools_lock = asyncio.Lock()
        return cls._pools_lock

    def __init__(self, db_path: str, pool_size: int = 5):
        """
        Inicializa o adapter com pool de conexões.
        """
        self.db_path = db_path
        self.is_postgres = settings.database.is_postgres
        self._fts_schema_cache: Optional[Dict[str, Any]] = None
        self._fts_schema_cache_lock = asyncio.Lock()
        self._last_check_ts = 0.0
        self._chapter_notes_schema_cache: Optional[Dict[str, Any]] = None
        self._chapter_notes_schema_cache_lock = asyncio.Lock()
        self._chapter_notes_last_check_ts = 0.0
        self._positions_schema_cache: Optional[Dict[str, Any]] = None
        self._positions_schema_cache_lock = asyncio.Lock()
        self._positions_last_check_ts = 0.0
        self.pool_size = pool_size
        self.pool = None
        # Cached SQL fragments for get_chapter_raw (rebuilt on schema change)
        self._chapter_sql_cache: Optional[str] = None
        self._chapter_sql_has_sections: Optional[bool] = None
        self._chapter_sql_has_parsed_notes_json: Optional[bool] = None
        logger.debug(f"DatabaseAdapter inicializado: {db_path}")

    async def _ensure_pool(self):
        """Garante que o pool existe para este caminho (Async Singleton Pattern)."""
        if self.pool:
            return

        # Verifica existência do arquivo antes de inicar pool
        if not os.path.exists(self.db_path):
            raise DatabaseNotFoundError(self.db_path)

        async with self._get_pools_lock():
            if self.db_path not in self._pools:
                self._pools[self.db_path] = ConnectionPool(self.db_path, self.pool_size)
            self.pool = self._pools[self.db_path]

    async def close(self):
        """Fecha conexões do pool."""
        if self.pool:
            await self.pool.close_all()

    def _get_db_signature(self) -> Optional[tuple]:
        """Assinatura simples do arquivo do DB para invalidar caches em rebuilds."""
        try:
            return (os.path.getmtime(self.db_path), os.path.getsize(self.db_path))
        except OSError:
            return None

    async def _detect_fts_schema(self, conn: aiosqlite.Connection) -> Dict[str, Any]:
        """
        Detecta dinamicamente o schema do índice FTS5.
        """
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
                    f"SELECT rank FROM search_index WHERE {content_column} MATCH ? LIMIT 1",
                    ("probe",),
                )
            except Exception:
                supports_rank = False

            return {
                "available": True,
                "content_column": content_column,
                "supports_rank": supports_rank,
            }
        except Exception as e:
            logger.error(f"Erro ao detectar schema FTS: {e}")
            return {
                "available": False,
                "reason": f"Falha ao inspecionar schema FTS: {e}",
            }

    async def _get_fts_schema_cached(
        self, conn: aiosqlite.Connection
    ) -> Dict[str, Any]:
        """Retorna schema FTS com cache invalidado por mudança no arquivo do DB (TTL 60s)."""
        now = time.time()

        async with self._fts_schema_cache_lock:
            if self._fts_schema_cache and (now - self._last_check_ts < 60):
                return self._fts_schema_cache["schema"]

            signature = self._get_db_signature()
            if (
                self._fts_schema_cache
                and self._fts_schema_cache.get("db_signature") == signature
            ):
                self._last_check_ts = now
                return self._fts_schema_cache["schema"]

            schema = await self._detect_fts_schema(conn)
            self._fts_schema_cache = {
                "db_signature": signature,
                "schema": schema,
            }
            self._last_check_ts = now
            return schema

    async def _get_chapter_notes_columns(self, conn: aiosqlite.Connection) -> set:
        """Lê colunas disponíveis na tabela chapter_notes."""
        try:
            cursor = await conn.execute("PRAGMA table_info(chapter_notes)")
            rows = await cursor.fetchall()
            return {row["name"] for row in rows}
        except Exception as e:
            logger.warning(f"Falha ao inspecionar chapter_notes: {e}")
            return set()

    async def _get_chapter_notes_columns_cached(
        self, conn: aiosqlite.Connection
    ) -> set:
        """Cache simples de colunas de chapter_notes (TTL 60s, invalida por mudança no DB)."""
        now = time.time()

        async with self._chapter_notes_schema_cache_lock:
            if self._chapter_notes_schema_cache and (
                now - self._chapter_notes_last_check_ts < 60
            ):
                return self._chapter_notes_schema_cache["columns"]

            signature = self._get_db_signature()
            if (
                self._chapter_notes_schema_cache
                and self._chapter_notes_schema_cache.get("db_signature") == signature
            ):
                self._chapter_notes_last_check_ts = now
                return self._chapter_notes_schema_cache["columns"]

            columns = await self._get_chapter_notes_columns(conn)
            self._chapter_notes_schema_cache = {
                "db_signature": signature,
                "columns": columns,
            }
            self._chapter_notes_last_check_ts = now
            return columns

    async def _get_positions_columns(self, conn: aiosqlite.Connection) -> set:
        """Lê colunas disponíveis na tabela positions."""
        try:
            cursor = await conn.execute("PRAGMA table_info(positions)")
            rows = await cursor.fetchall()
            return {row["name"] for row in rows}
        except Exception as e:
            logger.warning(f"Falha ao inspecionar positions: {e}")
            return set()

    async def _get_positions_columns_cached(self, conn: aiosqlite.Connection) -> set:
        """Cache simples de colunas de positions (TTL 60s, invalida por mudança no DB)."""
        now = time.time()

        async with self._positions_schema_cache_lock:
            if self._positions_schema_cache and (
                now - self._positions_last_check_ts < 60
            ):
                return self._positions_schema_cache["columns"]

            signature = self._get_db_signature()
            if (
                self._positions_schema_cache
                and self._positions_schema_cache.get("db_signature") == signature
            ):
                self._positions_last_check_ts = now
                return self._positions_schema_cache["columns"]

            columns = await self._get_positions_columns(conn)
            self._positions_schema_cache = {
                "db_signature": signature,
                "columns": columns,
            }
            self._positions_last_check_ts = now
            return columns

    @staticmethod
    def _has_section_content(sections: Dict[str, Optional[str]]) -> bool:
        """Verifica se há conteúdo real em alguma seção (ignora vazios/whitespace)."""
        for value in sections.values():
            if isinstance(value, str):
                if value.strip():
                    return True
            elif value:
                return True
        return False

    @staticmethod
    def _fts_rank_sql(schema: Dict[str, Any]) -> Dict[str, str]:
        """Retorna SQL para selecionar/ordenar por rank de forma portável."""
        if schema.get("supports_rank"):
            return {"select": "rank", "order": "rank"}
        return {"select": "bm25(search_index) AS rank", "order": "bm25(search_index)"}

    @asynccontextmanager
    async def get_connection(self):
        """
        Async Context manager para conexão do pool.
        """
        await self._ensure_pool()
        conn = await self.pool.get()
        try:
            yield conn
        except aiosqlite.Error as e:
            logger.error(f"Erro SQLite: {e}")
            raise DatabaseError(f"Erro na operação de banco: {e}")
        except Exception as e:
            if isinstance(e, DatabaseError):
                raise
            logger.error(f"Erro inesperado no banco: {e}")
            raise DatabaseError(f"Erro inesperado: {e}")
        finally:
            await self.pool.release(conn)

    async def check_connection(self) -> Optional[Dict[str, int]]:
        """
        Verifica integridade e retorna estatísticas do banco.
        """
        if not os.path.exists(self.db_path):
            logger.warning(f"Banco não encontrado: {self.db_path}")
            return None

        try:
            async with self.get_connection() as conn:
                cursor = await conn.execute("SELECT COUNT(*) FROM chapters")
                num_chapters = (await cursor.fetchone())[0]

                cursor = await conn.execute("SELECT COUNT(*) FROM positions")
                num_positions = (await cursor.fetchone())[0]

                stats = {
                    "chapters": num_chapters,
                    "positions": num_positions,
                    "size": os.path.getsize(self.db_path),
                }
                logger.info(f"DB OK: {num_chapters} caps, {num_positions} pos")
                return stats

        except Exception as e:
            logger.error(f"Erro ao verificar DB: {e}")
            return None

    def _build_chapter_sql(
        self, has_sections: bool, has_parsed_notes_json: bool
    ) -> str:
        """Build and cache chapter SQL query (avoids repeated string ops)."""
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
                WHERE c.chapter_num = ?"""
        self._chapter_sql_cache = sql
        self._chapter_sql_has_sections = has_sections
        self._chapter_sql_has_parsed_notes_json = has_parsed_notes_json
        return sql

    async def get_chapter_raw(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        """
        Busca dados brutos de um capítulo (Async).
        """
        logger.debug(f"Buscando capítulo: {chapter_num}")

        # get_connection já trata exceções e lança DatabaseError se falhar
        async with self.get_connection() as conn:
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
                ORDER BY CAST(SUBSTR(codigo, 1, 2) AS INTEGER),
                         CAST(SUBSTR(codigo, 4, 2) AS INTEGER)
            """,
                (chapter_num,),
            )
            pos_rows = await cursor.fetchall()

            positions = [
                {
                    "codigo": r["codigo"],
                    "descricao": r["descricao"],
                    "anchor_id": r["anchor_id"],
                }
                for r in pos_rows
                if r["codigo"] is not None
            ]

            logger.debug(
                f"Capítulo {chapter_num}: {len(positions)} posições (2 queries)"
            )
            sections = {col: first_row[col] for col in CHAPTER_NOTES_SECTION_COLUMNS}
            if not self._has_section_content(sections):
                sections = None

            return {
                "chapter_num": first_row["chapter_num"],
                "content": first_row["content"],
                "positions": positions,
                "notes": first_row["notes_content"],
                "parsed_notes_json": first_row["parsed_notes_json"],
                "sections": sections,
            }

    async def get_all_chapters_list(self) -> List[str]:
        """
        Retorna lista ordenada de números de capítulos (Async).
        """
        async with self.get_connection() as conn:
            cursor = await conn.execute(
                "SELECT chapter_num FROM chapters ORDER BY chapter_num"
            )
            rows = await cursor.fetchall()
            chapters = [row["chapter_num"] for row in rows]
            logger.debug(f"Listados {len(chapters)} capítulos")
            return chapters

    async def fts_search(self, query: str, limit: int = None) -> List[Dict[str, Any]]:
        """
        Executa busca Full-Text Search no índice FTS5 (Async).
        """
        logger.debug(f"FTS search: '{query}'")
        result_limit = limit if limit is not None else SearchConfig.MAX_FTS_RESULTS

        async with self.get_connection() as conn:
            schema = await self._get_fts_schema_cached(conn)
            if not schema.get("available"):
                msg = (
                    f"Busca textual indisponível: {schema.get('reason')}. "
                    "Recrie o índice FTS executando scripts/rebuild_index.py (recomendado)."
                )
                logger.error(msg)
                raise DatabaseError(msg)

            content_col = schema["content_column"]
            rank_sql = self._fts_rank_sql(schema)

            cursor = await conn.execute(
                f"""
                SELECT ncm, display_text, type, description, {rank_sql["select"]}
                FROM search_index
                WHERE {content_col} MATCH ?
                ORDER BY {rank_sql["order"]}
                LIMIT ?
            """,
                (query, result_limit),
            )

            rows = await cursor.fetchall()
            results = [dict(row) for row in rows]

            logger.debug(f"FTS retornou {len(results)} resultados")
            return results

    async def fts_search_scored(
        self,
        query: str,
        tier: int,
        limit: int,
        words_matched: int = 0,
        total_words: int = 1,
    ) -> List[Dict[str, Any]]:
        """
        Executa busca FTS com score calculado por tier (Async).
        """
        tier_bases = {
            1: SearchConfig.TIER1_BASE_SCORE,
            2: SearchConfig.TIER2_BASE_SCORE,
            3: SearchConfig.TIER3_BASE_SCORE,
        }
        base = tier_bases.get(tier, 0)
        coverage_bonus = (words_matched / total_words * 100) if total_words > 0 else 0

        logger.debug(f"FTS scored search tier {tier}: '{query}'")

        async with self.get_connection() as conn:
            schema = await self._get_fts_schema_cached(conn)
            if not schema.get("available"):
                msg = (
                    f"Busca textual indisponível: {schema.get('reason')}. "
                    "Recrie o índice FTS executando scripts/rebuild_index.py (recomendado)."
                )
                logger.error(msg)
                raise DatabaseError(msg)

            content_col = schema["content_column"]
            rank_sql = self._fts_rank_sql(schema)

            cursor = await conn.execute(
                f"""
                SELECT
                    ncm, display_text, type, description, {rank_sql["select"]}
                FROM search_index
                WHERE {content_col} MATCH ?
                ORDER BY {rank_sql["order"]}
                LIMIT ?
            """,
                (query, limit),
            )

            rows = await cursor.fetchall()
            results = []
            for row in rows:
                r = dict(row)
                bm25_normalized = min(100, max(0, -r["rank"] * 10))
                r["score"] = round(base + bm25_normalized + coverage_bonus, 1)
                r["tier"] = tier
                results.append(r)

            logger.debug(f"FTS tier {tier} retornou {len(results)} resultados")
            return results

    async def fts_search_near(
        self, words: List[str], distance: int, limit: int
    ) -> List[Dict[str, Any]]:
        """
        Busca por proximidade usando NEAR do FTS5 (Async).
        """
        if len(words) < 2:
            return []

        near_query = f"NEAR({' '.join(words)}, {distance})"
        logger.debug(f"FTS NEAR search: '{near_query}'")

        # NEAR pode falhar se o índice não suportar ou query for inválida
        # Neste caso, queremos engolir o erro e retornar vazio, pois é um bônus
        try:
            async with self.get_connection() as conn:
                schema = await self._get_fts_schema_cached(conn)
                if not schema.get("available"):
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
                """,
                    (near_query, limit),
                )

                rows = await cursor.fetchall()
                results = [dict(row) for row in rows]
                logger.debug(f"FTS NEAR retornou {len(results)} resultados")
                return results
        except Exception as e:
            logger.debug(f"FTS NEAR falhou (ignorado): {e}")
            return []
