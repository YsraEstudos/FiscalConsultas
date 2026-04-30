"""SQLite database adapter for the Nesh backend."""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import aiosqlite

from ..config.exceptions import DatabaseError, DatabaseNotFoundError
from ..config.logging_config import db_logger as logger
from ..config.settings import settings
from .database_search import DatabaseSearchQueries


class ConnectionPool:
    """Thread-safe async pool for reusable SQLite connections."""

    def __init__(self, db_path: str, max_size: int = 5):
        self.db_path = db_path
        self.max_size = max_size
        self._pool: List[aiosqlite.Connection] = []
        self._lock = asyncio.Lock()
        self._created = 0
        logger.info(f"ConnectionPool inicializado (max={max_size})")

    async def _create_connection(self) -> aiosqlite.Connection:
        """Creates a configured SQLite connection."""
        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute("PRAGMA synchronous=NORMAL")
            await conn.execute("PRAGMA cache_size=10000")
            self._created += 1
            logger.debug(f"Nova conexão criada (total: {self._created})")
            return conn
        except Exception as exc:
            logger.error(f"Falha ao criar conexão: {exc}")
            raise DatabaseError(f"Falha ao conectar ao banco: {exc}")

    async def get(self) -> aiosqlite.Connection:
        """Returns an existing connection or creates a new one."""
        async with self._lock:
            if self._pool:
                conn = self._pool.pop()
                logger.debug(
                    f"Conexão reutilizada do pool ({len(self._pool)} restantes)"
                )
                return conn
        return await self._create_connection()

    async def release(self, conn: aiosqlite.Connection) -> None:
        """Returns a connection to the pool or closes it when full."""
        async with self._lock:
            if len(self._pool) < self.max_size:
                self._pool.append(conn)
                logger.debug(f"Conexão devolvida ao pool ({len(self._pool)} total)")
            else:
                try:
                    await conn.close()
                except Exception as exc:
                    logger.warning(f"Erro ao fechar conexão excedente: {exc}")
                logger.debug("Pool cheio, conexão fechada")

    async def close_all(self) -> None:
        """Closes all pooled connections."""
        async with self._lock:
            for conn in self._pool:
                try:
                    await conn.close()
                except Exception as exc:
                    logger.warning(f"Erro ao fechar conexão do pool: {exc}")
            self._pool.clear()
            logger.info("Pool de conexões fechado")


class DatabaseAdapter:
    """Async SQLite adapter with shared pools and query helpers."""

    _pools: Dict[str, ConnectionPool] = {}
    _pools_lock: Optional[asyncio.Lock] = None

    @classmethod
    def _get_pools_lock(cls) -> asyncio.Lock:
        """Lazy initialization of the shared pool lock."""
        if cls._pools_lock is None:
            cls._pools_lock = asyncio.Lock()
        return cls._pools_lock

    def __init__(self, db_path: str, pool_size: int = 5):
        self.db_path = db_path
        self.is_postgres = settings.database.is_postgres
        self.pool_size = pool_size
        self.pool: ConnectionPool | None = None
        self._search = DatabaseSearchQueries(self)
        self._stats_cache: Optional[Dict[str, int]] = None
        self._stats_last_check_ts = 0.0
        logger.debug(f"DatabaseAdapter inicializado: {db_path}")

    async def _ensure_pool(self) -> None:
        """Ensures the pool exists for this database path."""
        if self.pool:
            return

        if not os.path.exists(self.db_path):
            raise DatabaseNotFoundError(self.db_path)

        async with self._get_pools_lock():
            if self.db_path not in self._pools:
                self._pools[self.db_path] = ConnectionPool(self.db_path, self.pool_size)
            self.pool = self._pools[self.db_path]

    async def close(self) -> None:
        """Closes pooled connections."""
        if self.pool:
            await self.pool.close_all()

    @asynccontextmanager
    async def get_connection(self):
        """Async context manager for a pooled connection."""
        await self._ensure_pool()
        pool = self.pool
        if pool is None:
            raise DatabaseError("Pool de conexões não inicializado")
        conn = await pool.get()
        try:
            yield conn
        except aiosqlite.Error as exc:
            logger.error(f"Erro SQLite: {exc}")
            raise DatabaseError(f"Erro na operação de banco: {exc}")
        except Exception as exc:
            if isinstance(exc, DatabaseError):
                raise
            logger.error(f"Erro inesperado no banco: {exc}")
            raise DatabaseError(f"Erro inesperado: {exc}")
        finally:
            await pool.release(conn)

    async def check_connection(self) -> Optional[Dict[str, int]]:
        """Checks the database integrity and returns basic stats."""
        if not os.path.exists(self.db_path):
            logger.warning(f"Banco não encontrado: {self.db_path}")
            return None

        try:
            async with self.get_connection() as conn:
                await conn.execute("SELECT 1")

                now = time.time()
                if not self._stats_cache or (now - self._stats_last_check_ts) > 60:
                    cursor = await conn.execute("SELECT COUNT(*) FROM chapters")
                    chapter_row = await cursor.fetchone()
                    if chapter_row is None:
                        return None
                    num_chapters = chapter_row[0]

                    cursor = await conn.execute("SELECT COUNT(*) FROM positions")
                    positions_row = await cursor.fetchone()
                    if positions_row is None:
                        return None
                    num_positions = positions_row[0]

                    self._stats_cache = {
                        "chapters": num_chapters,
                        "positions": num_positions,
                        "size": os.path.getsize(self.db_path),
                    }
                    self._stats_last_check_ts = now
                    logger.info(f"DB OK: {num_chapters} caps, {num_positions} pos")

                return self._stats_cache

        except Exception as exc:
            logger.error(f"Erro ao verificar DB: {exc}")
            return None

    async def get_all_chapters_list(self) -> List[str]:
        """Returns the ordered list of chapter numbers."""
        async with self.get_connection() as conn:
            cursor = await conn.execute(
                "SELECT chapter_num FROM chapters ORDER BY chapter_num"
            )
            rows = await cursor.fetchall()
            chapters = [row["chapter_num"] for row in rows]
            logger.debug(f"Listados {len(chapters)} capítulos")
            return chapters

    async def get_chapter_raw(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        return await self._search.get_chapter_raw(chapter_num)

    async def fts_search(
        self, query: str, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        return await self._search.fts_search(query, limit)

    async def fts_search_scored(
        self,
        query: str,
        tier: int,
        limit: int,
        words_matched: int = 0,
        total_words: int = 1,
    ) -> List[Dict[str, Any]]:
        return await self._search.fts_search_scored(
            query,
            tier,
            limit,
            words_matched,
            total_words,
        )

    async def fts_search_near(
        self, words: List[str], distance: int, limit: int
    ) -> List[Dict[str, Any]]:
        return await self._search.fts_search_near(words, distance, limit)

    @staticmethod
    def _sanitize_fts_token(token: str) -> str:
        return DatabaseSearchQueries._sanitize_fts_token(token)
