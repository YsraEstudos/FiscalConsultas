"""src.services.tipi_service

Serviço de busca na TIPI (Tabela de Incidência do IPI).
Similar ao NeshService, mas usando o banco tipi.db.

Observações de contrato (importante para o frontend):
- Respostas de busca por código sempre incluem: query, results/resultados, total, total_capitulos.
- Estrutura de capítulos/posições é compatível com a navegação do app (posicoes[].codigo).
"""

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator, Dict, List, Optional, Tuple, cast

import aiosqlite

from ..config.constants import CacheConfig
from ..config.exceptions import DatabaseError
from ..config.logging_config import service_logger as logger
from ..utils import ncm_utils
from ..utils.id_utils import generate_anchor_id
from ..utils.payload_cache_metrics import PayloadCacheMetrics

# Caminho do banco de dados TIPI
TIPI_DB_PATH = Path(__file__).parent.parent.parent / "database" / "tipi.db"
TIPI_SORT_WITH_NCM = "ncm_sort, ncm"
TIPI_SORT_FALLBACK = "ncm"
TIPI_ALLOWED_TABLES = {"tipi_positions", "tipi_chapters", "tipi_fts"}

# SQLModel Repository imports (optional - for new code paths)
get_session = None
try:
    from ..infrastructure.db_engine import get_session
    from ..infrastructure.repositories.tipi_repository import TipiRepository

    _REPO_AVAILABLE = True
except ImportError:
    _REPO_AVAILABLE = False
    TipiRepository = None

if TYPE_CHECKING:
    from ..infrastructure.repositories.tipi_repository import (
        TipiRepository as _TipiRepo,
    )


class TipiService:
    """
    Serviço para busca de NCMs na TIPI (Async).

    Features:
    - Busca por código NCM
    - Busca textual (FTS5)
    - Cache em memória
    - Destaque de alíquotas
    - Connection pooling
    """

    # Pool compartilhado (singleton)
    _pool: List[aiosqlite.Connection] = []
    _pool_lock: Optional[asyncio.Lock] = None
    _pool_max_size: int = 3

    def __init__(
        self,
        db_path: Path = TIPI_DB_PATH,
        *,
        repository: "_TipiRepo | None" = None,
        repository_factory=None,
    ):
        """
        Inicializa o serviço com pool aiosqlite ou repository.

        Args:
            db_path: Caminho do banco SQLite (legado)
            repository: TipiRepository para novo padrão SQLModel
            repository_factory: Factory async context manager para criar repos sob demanda
        """
        self.db_path = db_path
        self._schema_columns_cache: Dict[str, set[str]] = {}
        self._repository = repository
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None

        # Performance: LRU caches for search results
        self._code_search_cache: OrderedDict = (
            OrderedDict()
        )  # key: (ncm_query, view_mode) -> result
        self._chapter_positions_cache: OrderedDict = (
            OrderedDict()
        )  # key: chapter_num -> positions
        self._code_search_cache_metrics = PayloadCacheMetrics("tipi_code_search_cache")
        self._chapter_positions_cache_metrics = PayloadCacheMetrics(
            "tipi_chapter_positions_cache"
        )
        self._cache_lock: Optional[asyncio.Lock] = None  # Lazy init

        self.mode = "Repository" if self._use_repository else "aiosqlite"
        logger.info(f"TipiService inicializado (modo: {self.mode})")

    @classmethod
    async def create_with_repository(cls) -> "TipiService":
        """
        Factory assíncrono para criar TipiService com TipiRepository.
        Usa factory pattern para criar repos sob demanda (cada chamada tem sua session).

        Uso:
            service = await TipiService.create_with_repository()
            results = await service.search_text("bomba")
        """
        if not _REPO_AVAILABLE:
            raise RuntimeError("Repository não disponível. Instale sqlmodel.")
        if get_session is None:
            raise RuntimeError("Session factory não disponível.")
        session_factory = get_session
        repository_cls = cast("type[_TipiRepo]", TipiRepository)

        @asynccontextmanager
        async def repo_factory():
            async with session_factory() as session:
                yield repository_cls(session)

        return cls(repository_factory=repo_factory)

    def _get_cache_lock(self) -> asyncio.Lock:
        """Lazy initialization do lock para evitar criação fora do event loop."""
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    @asynccontextmanager
    async def _get_repo(self) -> AsyncIterator["_TipiRepo | None"]:
        """Get repository via direct instance or factory."""
        if self._repository is not None:
            yield self._repository
            return
        if self._repository_factory is not None:
            async with self._repository_factory() as repo:
                yield repo
            return
        yield None

    @classmethod
    def _get_pool_lock(cls) -> asyncio.Lock:
        """Lazy initialization do lock."""
        if cls._pool_lock is None:
            cls._pool_lock = asyncio.Lock()
        return cls._pool_lock

    async def _get_connection(self) -> aiosqlite.Connection:
        """Obtém conexão do pool ou cria nova."""
        async with self._get_pool_lock():
            if self._pool:
                conn = self._pool.pop()
                return conn

        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            return conn
        except Exception as e:
            logger.error(f"Failed to connect to TIPI DB: {e}")
            raise DatabaseError(f"TIPI DB connection failed: {e}")

    async def _release_connection(self, conn: aiosqlite.Connection) -> None:
        """Devolve conexão ao pool."""
        async with self._get_pool_lock():
            if len(self._pool) < self._pool_max_size:
                self._pool.append(conn)
            else:
                try:
                    await conn.close()
                except Exception as e:
                    logger.warning(f"Error closing TIPI connection: {e}")

    async def _get_table_columns(
        self, conn: aiosqlite.Connection, table: str
    ) -> set[str]:
        """Return a cached set of column names for a table."""
        if table not in TIPI_ALLOWED_TABLES:
            raise ValueError(f"Tabela não permitida para inspeção de schema: {table}")
        if table in self._schema_columns_cache:
            return self._schema_columns_cache[table]

        cursor = await conn.execute(f"PRAGMA table_info({table})")
        rows = await cursor.fetchall()
        cols = {row["name"] for row in rows}
        self._schema_columns_cache[table] = cols
        return cols

    def _get_order_by(self, cols: set[str]) -> str:
        """Resolve ORDER BY com base no schema disponível."""
        return TIPI_SORT_WITH_NCM if "ncm_sort" in cols else TIPI_SORT_FALLBACK

    @staticmethod
    def _enforce_cache_limit(
        cache: OrderedDict[Any, Any],
        max_size: int,
        metrics: PayloadCacheMetrics,
    ) -> None:
        """Evict oldest entries until cache reaches max_size."""
        limit = max(max_size, 0)
        while len(cache) > limit:
            cache.popitem(last=False)
            metrics.record_eviction()

    async def close(self):
        """Fecha todas as conexões do pool."""
        async with self._get_pool_lock():
            for conn in self._pool:
                try:
                    await conn.close()
                except Exception as e:
                    logger.warning(f"Error closing TIPI pool connection: {e}")
            self._pool.clear()

    async def check_connection(self) -> Dict[str, Any]:
        """Verifica status do banco TIPI."""
        if not self.db_path.exists():
            # We return a status dict here because often this is used for diagnostic
            # but raising DatabaseError is also fine if caught by the status endpoint.
            # However, status endpoint usually wants to show "error" rather than 503.
            # Let's keep returning dict but logging errors.
            return {"ok": False, "error": f"Banco TIPI não encontrado: {self.db_path}"}

        try:
            conn = await self._get_connection()
            try:
                cursor = await conn.execute("SELECT COUNT(*) FROM tipi_chapters")
                chapters_row = await cursor.fetchone()
                chapters = chapters_row[0] if chapters_row else 0

                cursor = await conn.execute("SELECT COUNT(*) FROM tipi_positions")
                positions_row = await cursor.fetchone()
                positions = positions_row[0] if positions_row else 0

                return {"ok": True, "chapters": chapters, "positions": positions}
            finally:
                await self._release_connection(conn)
        except Exception as e:
            logger.error(f"TIPI Check Connection failed: {e}")
            return {"ok": False, "error": str(e)}

    def _empty_code_response(self, query: str) -> Dict[str, Any]:
        return {
            "success": True,
            "type": "code",
            "query": query,
            "results": {},
            "resultados": {},
            "total": 0,
            "total_capitulos": 0,
        }

    def is_code_query(self, query: str) -> bool:
        """Helper to detect if query is NCM code."""
        return ncm_utils.is_code_query(query)

    async def _get_chapter_positions(self, cap_num: str) -> Tuple[Dict[str, Any], ...]:
        """
        Fetch positions for a chapter.
        Performance: Uses LRU cache for full chapter positions.
        """
        # Performance: Check chapter cache
        async with self._get_cache_lock():
            if cap_num in self._chapter_positions_cache:
                self._chapter_positions_cache.move_to_end(cap_num)
                self._chapter_positions_cache_metrics.record_hit()
                return self._chapter_positions_cache[cap_num]
        self._chapter_positions_cache_metrics.record_miss()

        if self._use_repository:
            async with self._get_repo() as repo:
                if repo:
                    rows_list = await repo.get_by_chapter(cap_num)
                    # Normalize keys to match legacy format
                    rows = tuple(
                        {
                            **r,
                            "capitulo": r.get("capitulo", cap_num),
                            "nivel": r.get("nivel", 0),
                        }
                        for r in rows_list
                    )
                    # Cache result
                    async with self._get_cache_lock():
                        self._chapter_positions_cache[cap_num] = rows
                        self._chapter_positions_cache_metrics.record_set()
                        self._enforce_cache_limit(
                            self._chapter_positions_cache,
                            CacheConfig.TIPI_CHAPTER_CACHE_SIZE,
                            self._chapter_positions_cache_metrics,
                        )
                    return rows

        conn = await self._get_connection()
        try:
            cols = await self._get_table_columns(conn, "tipi_positions")
            order_by = self._get_order_by(cols)
            sql = f"""
                SELECT ncm, capitulo, descricao, aliquota, nivel
                FROM tipi_positions
                WHERE capitulo = ?
                ORDER BY {order_by}
                """  # nosec B608
            cursor = await conn.execute(sql, (cap_num,))
            rows = await cursor.fetchall()
            result = tuple(dict(row) for row in rows)

            # Cache result
            async with self._get_cache_lock():
                self._chapter_positions_cache[cap_num] = result
                self._chapter_positions_cache_metrics.record_set()
                self._enforce_cache_limit(
                    self._chapter_positions_cache,
                    CacheConfig.TIPI_CHAPTER_CACHE_SIZE,
                    self._chapter_positions_cache_metrics,
                )
            return result
        finally:
            await self._release_connection(conn)

    async def _get_family_positions(
        self, cap_num: str, prefix: str, ancestor_prefixes: set
    ) -> Tuple[Dict[str, Any], ...]:
        """
        Fetch positions filtradas por família NCM (otimizado em SQL).

        Args:
            cap_num: Número do capítulo (2 dígitos)
            prefix: Prefixo NCM para filtrar descendentes (ex: "8413")
            ancestor_prefixes: Set de prefixos ancestrais (ex: {"8413", "841391"})
        """
        if self._use_repository:
            async with self._get_repo() as repo:
                if repo:
                    rows_list = await repo.get_family_positions(
                        cap_num, prefix, ancestor_prefixes
                    )
                    return tuple(
                        {
                            **r,
                            "capitulo": r.get("capitulo", cap_num),
                            "nivel": r.get("nivel", 0),
                        }
                        for r in rows_list
                    )

        conn = await self._get_connection()
        try:
            cols = await self._get_table_columns(conn, "tipi_positions")
            order_by = self._get_order_by(cols)

            conditions = ["REPLACE(ncm, '.', '') LIKE ? || '%'"]
            params = [prefix]

            for ancestor in ancestor_prefixes:
                conditions.append("REPLACE(ncm, '.', '') = ?")
                params.append(ancestor)

            where_clause = " OR ".join(conditions)
            sql = f"""
                SELECT ncm, capitulo, descricao, aliquota, nivel
                FROM tipi_positions
                WHERE capitulo = ? AND ({where_clause})
                ORDER BY {order_by}
                """  # nosec B608
            cursor = await conn.execute(sql, (cap_num, *params))
            rows = await cursor.fetchall()
            return tuple(dict(row) for row in rows)
        finally:
            await self._release_connection(conn)

    async def search_by_code(
        self, ncm_query: str, view_mode: str = "family"
    ) -> Dict[str, Any]:
        """
        Busca por código NCM na TIPI (Async).
        Performance: Cacheia resultados por (query, view_mode) com LRU.

        Args:
            ncm_query: Código NCM (ex: "85.17" ou "8517")
            view_mode: 'family' (retorna apenas família NCM) ou 'chapter' (capítulo completo)
        """
        # Performance: Check LRU cache
        cache_key = (ncm_query, view_mode)
        async with self._get_cache_lock():
            if cache_key in self._code_search_cache:
                self._code_search_cache.move_to_end(cache_key)
                self._code_search_cache_metrics.record_hit()
                return self._code_search_cache[cache_key]
        self._code_search_cache_metrics.record_miss()
        # Suporta múltiplos NCMs via vírgula/;
        parts = ncm_utils.split_ncm_query(ncm_query)
        if len(parts) > 1:
            merged: Dict[str, Any] = {}
            total_rows = 0
            for part in parts:
                part_resp = await self.search_by_code(part, view_mode=view_mode)
                total_rows += int(part_resp.get("total", 0) or 0)
                for cap, cap_data in (
                    part_resp.get("resultados") or part_resp.get("results") or {}
                ).items():
                    if cap not in merged:
                        merged[cap] = cap_data
                    else:
                        merged[cap].setdefault("posicoes", [])
                        merged[cap]["posicoes"].extend(
                            cap_data.get("posicoes", []) or []
                        )
            return {
                "success": True,
                "type": "code",
                "query": ncm_query,
                "results": merged,
                "resultados": merged,
                "total": total_rows,
                "total_capitulos": len(merged),
            }

        query_part = parts[0] if parts else (ncm_query or "")
        normalized_query = ncm_utils.format_ncm_tipi(query_part)
        clean_query = ncm_utils.clean_ncm(normalized_query)

        if not clean_query:
            return self._empty_code_response(ncm_query)

        # Extrair capítulo (primeiros 2 dígitos)
        cap_num = clean_query[:2].zfill(2)

        # posicao_alvo para auto-scroll
        posicao_alvo = None
        if len(clean_query) > 2:
            posicao_alvo = (normalized_query or "").strip() or query_part.strip()

        # Se a busca for mais específica que capítulo (ex: 8413), usar filtro SQL otimizado
        # Filtro só se aplica quando view_mode == 'family'
        if view_mode == "family" and len(clean_query) > 2:
            prefix = clean_query  # ex: "8413" ou "84131100"

            # Coletar prefixos ancestrais para incluir hierarquia completa
            # Ex: para "39249000", ancestrais são "3924" e "392490"
            ancestor_prefixes = set()
            if len(prefix) >= 4:
                ancestor_prefixes.add(prefix[:4])  # Posição (XX.XX)
            if len(prefix) >= 6:
                ancestor_prefixes.add(prefix[:6])  # Subposição (XXXX.XX)

            # Filtro otimizado em SQL (evita iteração Python)
            rows = await self._get_family_positions(cap_num, prefix, ancestor_prefixes)
        else:
            # Capítulo completo ou query curta (2 dígitos)
            rows = await self._get_chapter_positions(cap_num)

        if not rows:
            return self._empty_code_response(ncm_query)

        resultados: Dict[str, Any] = {}
        for row in rows:
            cap = row["capitulo"]
            if cap not in resultados:
                cap_posicao_alvo = None
                if posicao_alvo:
                    clean_alvo = ncm_utils.clean_ncm(posicao_alvo)
                    if clean_alvo.startswith(cap):
                        cap_posicao_alvo = posicao_alvo

                resultados[cap] = {
                    "capitulo": cap,
                    "titulo": f"Capítulo {cap}",
                    "notas_gerais": None,
                    "posicao_alvo": cap_posicao_alvo,
                    "posicoes": [],
                }

            codigo = row["ncm"]
            resultados[cap]["posicoes"].append(
                {
                    "ncm": codigo,
                    "codigo": codigo,
                    "descricao": row["descricao"],
                    "aliquota": row["aliquota"] or "0",
                    "nivel": row["nivel"],
                    "anchor_id": generate_anchor_id(codigo),
                }
            )

        result = {
            "success": True,
            "type": "code",
            "query": ncm_query,
            "results": resultados,
            "resultados": resultados,
            "total": len(rows),
            "total_capitulos": len(resultados),
        }

        # Performance: Store in LRU cache
        async with self._get_cache_lock():
            self._code_search_cache[cache_key] = result
            self._code_search_cache_metrics.record_set()
            self._enforce_cache_limit(
                self._code_search_cache,
                CacheConfig.TIPI_RESULT_CACHE_SIZE,
                self._code_search_cache_metrics,
            )

        return result

    async def search_text(self, query: str, limit: int = 50) -> Dict[str, Any]:
        """
        Busca textual via FTS5/tsvector (Async).
        """
        if self._use_repository:
            async with self._get_repo() as repo:
                if repo:
                    results = await repo.search_fulltext(query, limit)
                    return {
                        "success": True,
                        "type": "text",
                        "query": query,
                        "normalized": query,
                        "match_type": "fts",
                        "warning": None,
                        "total": len(results),
                        "results": results,
                    }

        conn = await self._get_connection()
        try:
            # Busca FTS
            escaped_query = query.replace('"', '""')
            fts_query = f'"{escaped_query}"'  # Busca exata primeiro
            cursor = await conn.execute(
                """
                SELECT ncm, capitulo, descricao, aliquota
                FROM tipi_fts
                WHERE tipi_fts MATCH ?
                LIMIT ?
            """,
                (fts_query, limit),
            )

            rows = await cursor.fetchall()
            results = [dict(row) for row in rows]

            # Se poucos resultados, tentar busca mais flexível
            if len(results) < 5:
                words = query.split()
                if len(words) > 1:
                    quoted_tokens = [
                        '"' + word.replace('"', '""') + '"' for word in words
                    ]
                    and_query = " AND ".join(quoted_tokens)
                    cursor = await conn.execute(
                        """
                        SELECT ncm, capitulo, descricao, aliquota
                        FROM tipi_fts
                        WHERE tipi_fts MATCH ?
                        LIMIT ?
                    """,
                        (and_query, limit),
                    )
                    rows = await cursor.fetchall()
                    results = [dict(row) for row in rows]
        finally:
            await self._release_connection(conn)

        return {
            "success": True,
            "type": "text",
            "query": query,
            "normalized": query,
            "match_type": "fts",
            "warning": None,
            "total": len(results),
            "results": [
                {
                    "ncm": r["ncm"],
                    "capitulo": r["capitulo"],
                    "descricao": r["descricao"],
                    "aliquota": r["aliquota"] or "0",
                }
                for r in results
            ],
        }

    async def get_all_chapters(self) -> List[Dict[str, str]]:
        """Retorna lista de todos os capítulos (Async)."""
        if self._use_repository:
            async with self._get_repo() as repo:
                if repo:
                    return await repo.get_all_chapters()

        conn = await self._get_connection()
        try:
            cursor = await conn.execute("""
                SELECT codigo, titulo, secao
                FROM tipi_chapters
                ORDER BY codigo
            """)
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            await self._release_connection(conn)

    async def get_internal_cache_metrics(self) -> Dict[str, Any]:
        """
        Snapshot dos caches internos (L1) do serviço TIPI.
        """
        async with self._get_cache_lock():
            code_snapshot = self._code_search_cache_metrics.snapshot(
                current_size=len(self._code_search_cache),
                max_size=CacheConfig.TIPI_RESULT_CACHE_SIZE,
            )
            chapter_snapshot = self._chapter_positions_cache_metrics.snapshot(
                current_size=len(self._chapter_positions_cache),
                max_size=CacheConfig.TIPI_CHAPTER_CACHE_SIZE,
            )

        return {
            "code_search_cache": {
                "name": self._code_search_cache_metrics.name,
                "hits": code_snapshot.hits,
                "misses": code_snapshot.misses,
                "sets": code_snapshot.sets,
                "evictions": code_snapshot.evictions,
                "served_gzip": code_snapshot.served_gzip,
                "served_identity": code_snapshot.served_identity,
                "current_size": code_snapshot.current_size,
                "max_size": code_snapshot.max_size,
                "hit_rate": code_snapshot.hit_rate,
            },
            "chapter_positions_cache": {
                "name": self._chapter_positions_cache_metrics.name,
                "hits": chapter_snapshot.hits,
                "misses": chapter_snapshot.misses,
                "sets": chapter_snapshot.sets,
                "evictions": chapter_snapshot.evictions,
                "served_gzip": chapter_snapshot.served_gzip,
                "served_identity": chapter_snapshot.served_identity,
                "current_size": chapter_snapshot.current_size,
                "max_size": chapter_snapshot.max_size,
                "hit_rate": chapter_snapshot.hit_rate,
            },
        }
