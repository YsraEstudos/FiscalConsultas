"""
Serviço principal de busca NCM.
Contém a fachada do domínio NESH e delega responsabilidades pesadas a módulos menores.
"""

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Callable, Optional

from ..config import CONFIG
from ..config.constants import CacheConfig
from ..config.logging_config import service_logger as logger
from ..domain import ServiceResponse
from ..infrastructure import DatabaseAdapter
from ..infrastructure.redis_client import redis_cache  # noqa: F401
from ..utils import ncm_utils
from ..utils.payload_cache_metrics import PayloadCacheMetrics
from ..utils.text_processor import NeshTextProcessor
from .nesh.chapters import (
    fetch_nesh_chapter_payload,
    parse_nesh_chapter_notes,
    prewarm_nesh_chapter_cache,
    search_nesh_chapters_by_ncm_code,
    strip_nesh_chapter_preamble,
)
from .nesh.fts import (
    build_nesh_fts_cache_key,
    fetch_nesh_fts_scored_rows_cached,
    normalize_nesh_fts_query,
    normalize_nesh_raw_fts_query,
    search_nesh_fts_text,
    snapshot_nesh_fts_cache_metrics,
)
from .nesh.types import NeshChapterRawPayload, NeshFtsCacheKey, NeshFtsScoredRow

try:
    from ..infrastructure.db_engine import get_session
    from ..infrastructure.repositories.chapter_repository import ChapterRepository

    _REPO_AVAILABLE = True
except ImportError:
    _REPO_AVAILABLE = False
    ChapterRepository = None


class NeshService:
    """
    Serviço de busca NCM com lógica de negócio (Async).

    Responsabilidades:
    - Orquestrar busca por código e FTS
    - Expor fachada estável para rotas e testes
    - Coordenar caches L1 e bootstrap do repository
    """

    def __init__(
        self,
        db: DatabaseAdapter = None,
        *,
        repository: "ChapterRepository" = None,
        repository_factory: Optional[
            Callable[[], AsyncGenerator["ChapterRepository", None]]
        ] = None,
    ):
        self.db = db
        self._repository = repository
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None

        self.processor = NeshTextProcessor(list(CONFIG.stopwords))
        self._fts_cache: OrderedDict[NeshFtsCacheKey, list[NeshFtsScoredRow]] = (
            OrderedDict()
        )
        self._chapter_cache: OrderedDict[str, dict] = OrderedDict()
        self._fts_cache_metrics = PayloadCacheMetrics("nesh_fts_cache")
        self._chapter_cache_metrics = PayloadCacheMetrics("nesh_chapter_cache")
        self._cache_lock: Optional[asyncio.Lock] = None

        logger.info(
            "NeshService inicializado (modo: %s)",
            "Repository" if self._use_repository else "DatabaseAdapter",
        )

    @classmethod
    async def initializeNeshServiceWithRepositoryFactory(cls) -> "NeshService":
        """
        Cria `NeshService` com `ChapterRepository` via SQLModel.

        Exemplo:
            service = await NeshService.initializeNeshServiceWithRepositoryFactory()
            results = await service.executeNeshSearchWithVectorWeights("bomba")
        """
        if not _REPO_AVAILABLE:
            raise RuntimeError(
                "Repository não disponível. Instale sqlmodel e configure db_engine."
            )

        @asynccontextmanager
        async def repo_factory():
            async with get_session() as session:
                yield ChapterRepository(session)

        return cls(repository_factory=repo_factory)

    def _get_cache_lock(self) -> asyncio.Lock:
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    @staticmethod
    def _fts_cache_key(
        query: str, tier: int, limit: int, words_matched: int, total_words: int
    ) -> str:
        return build_nesh_fts_cache_key(query, tier, limit, words_matched, total_words)

    @asynccontextmanager
    async def _get_repo(self):
        if self._repository is not None:
            yield self._repository
            return
        if self._repository_factory is not None:
            async with self._repository_factory() as repo:
                yield repo
            return
        yield None

    @staticmethod
    def stripNeshChapterPreamble(content: str) -> str:
        """
        Remove o preâmbulo textual até a primeira posição NCM.

        Exemplo:
            snippet = service.stripNeshChapterPreamble(chapter.content)
        """
        return strip_nesh_chapter_preamble(content)

    @staticmethod
    def parseNeshChapterNotes(notes_content: str) -> dict[str, str]:
        """
        Analisa o bloco de notas do capítulo em um mapa estruturado.

        Exemplo:
            notes = service.parseNeshChapterNotes(raw_notes)
        """
        return parse_nesh_chapter_notes(notes_content)

    async def fetchNeshChapterData(
        self, chapter_num: str
    ) -> NeshChapterRawPayload | None:
        """
        Recupera os dados hidratados de um capítulo NESH.

        Exemplo:
            chapter = await service.fetchNeshChapterData("85")
        """
        return await fetch_nesh_chapter_payload(self, chapter_num)

    def normalizeNeshQuery(self, text: str) -> str:
        """
        Normaliza uma consulta textual para FTS.

        Exemplo:
            query = service.normalizeNeshQuery("motor bomba")
        """
        return normalize_nesh_fts_query(self, text)

    def normalizeNeshRawQuery(self, text: str) -> str:
        """
        Normaliza a consulta textual preservando termos crus relevantes.

        Exemplo:
            query = service.normalizeNeshRawQuery("motor bomba")
        """
        return normalize_nesh_raw_fts_query(self, text)

    async def _fts_scored_cached(
        self, query: str, tier: int, limit: int, words_matched: int, total_words: int
    ):
        return await fetch_nesh_fts_scored_rows_cached(
            self, query, tier, limit, words_matched, total_words
        )

    async def searchNeshByTextQuery(self, query: str) -> ServiceResponse:
        """
        Executa busca textual FTS sobre o conteúdo NESH.

        Exemplo:
            payload = await service.searchNeshByTextQuery("motor bomba")
        """
        return await search_nesh_fts_text(self, query)

    async def searchNeshByNcmCode(self, ncm_query: str) -> ServiceResponse:
        """
        Busca capítulos NESH a partir de uma query NCM normalizada.

        Exemplo:
            payload = await service.searchNeshByNcmCode("85.17")
        """
        return await search_nesh_chapters_by_ncm_code(self, ncm_query)

    async def executeNeshSearchWithVectorWeights(self, query: str) -> ServiceResponse:
        """
        Decide entre busca por código NCM e busca textual ponderada.

        Exemplo:
            payload = await service.executeNeshSearchWithVectorWeights("85.17")
        """
        is_ncm = ncm_utils.is_code_query(query)
        if is_ncm:
            return await self.searchNeshByNcmCode(query)
        return await self.searchNeshByTextQuery(query)

    async def process_request(self, query: str) -> ServiceResponse:
        """
        Backward-compatible alias for the legacy request-processing entrypoint.

        Exemplo:
            payload = await service.process_request("85.17")
        """
        return await self.executeNeshSearchWithVectorWeights(query)

    async def prewarmNeshChapterCache(
        self, chapter_nums: Optional[list[str]] = None, concurrency: int = 10
    ) -> int:
        """
        Faz o aquecimento do cache de capítulos NESH.

        Exemplo:
            warmed = await service.prewarmNeshChapterCache(["85", "86"])
        """
        return await prewarm_nesh_chapter_cache(
            self, chapter_nums=chapter_nums, concurrency=concurrency
        )

    async def prewarm_cache(
        self, chapter_nums: Optional[list[str]] = None, concurrency: int = 10
    ) -> int:
        """Alias compatível com a API anterior do serviço."""
        return await self.prewarmNeshChapterCache(
            chapter_nums=chapter_nums, concurrency=concurrency
        )

    async def snapshotNeshInternalCacheMetrics(self) -> dict:
        """
        Captura as métricas atuais dos caches internos do serviço.

        Exemplo:
            snapshot = await service.snapshotNeshInternalCacheMetrics()
        """
        async with self._get_cache_lock():
            chapter_snapshot = self._chapter_cache_metrics.snapshot(
                current_size=len(self._chapter_cache),
                max_size=CacheConfig.CHAPTER_CACHE_SIZE,
            )
            fts_current_size, fts_max_size = snapshot_nesh_fts_cache_metrics(self)
            fts_snapshot = self._fts_cache_metrics.snapshot(
                current_size=fts_current_size,
                max_size=fts_max_size,
            )

        return {
            "chapter_cache": {
                "name": self._chapter_cache_metrics.name,
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
            "fts_cache": {
                "name": self._fts_cache_metrics.name,
                "hits": fts_snapshot.hits,
                "misses": fts_snapshot.misses,
                "sets": fts_snapshot.sets,
                "evictions": fts_snapshot.evictions,
                "served_gzip": fts_snapshot.served_gzip,
                "served_identity": fts_snapshot.served_identity,
                "current_size": fts_snapshot.current_size,
                "max_size": fts_snapshot.max_size,
                "hit_rate": fts_snapshot.hit_rate,
            },
        }

    async def get_internal_cache_metrics(self) -> dict:
        """Alias compatível com a API anterior do serviço."""
        return await self.snapshotNeshInternalCacheMetrics()
