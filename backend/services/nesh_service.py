"""
Serviço principal de busca NCM.
Contém toda a lógica de negócio, isolada de I/O e apresentação.
"""

import asyncio
import hashlib
import re
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Tuple

import orjson

from ..config import CONFIG
from ..config.constants import CacheConfig, RegexPatterns, SearchConfig
from ..config.logging_config import service_logger as logger
from ..domain import SearchResult, ServiceResponse
from ..infrastructure import DatabaseAdapter
from ..infrastructure.redis_client import redis_cache
from ..utils import ncm_utils
from ..utils.payload_cache_metrics import PayloadCacheMetrics

# SQLModel Repository imports (optional - for new code paths)
try:
    from ..infrastructure.db_engine import get_session
    from ..infrastructure.repositories.chapter_repository import ChapterRepository

    _REPO_AVAILABLE = True
except ImportError:
    _REPO_AVAILABLE = False
    ChapterRepository = None

# Import text_processor - using absolute import from project root
try:
    from backend.utils.text_processor import NeshTextProcessor
except ImportError:
    # Fallback for direct module execution
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from backend.utils.text_processor import NeshTextProcessor

from ..utils.id_utils import generate_anchor_id

# Pre-compiled regex patterns for performance
_RE_NOTE_HEADER = re.compile(RegexPatterns.NOTE_HEADER)
# Detect first NCM position line to trim chapter preamble when sections are rendered separately
_RE_FIRST_POSITION = re.compile(
    r"^\s*(?:\*\*|\*)?\d{2}\.\d{2}(?:\*\*|\*)?\s*[-\u2013\u2014:]", re.MULTILINE
)

# Performance: Cache size for FTS results
_FTS_CACHE_SIZE = 64


class NeshService:
    """
    Serviço de busca NCM com lógica de negócio (Async).

    Responsabilidades:
    - Parsing de queries NCM
    - Busca por código (capítulo/posição)
    - Busca Full-Text Search
    - Cache de capítulos
    - Parsing de notas

    Attributes:
        db: Instância do DatabaseAdapter
        processor: Processador de texto para FTS
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
        """
        Inicializa o serviço com adapter de banco ou repository.

        Args:
            db: Instância configurada do DatabaseAdapter (legado)
            repository: ChapterRepository para novo padrão SQLModel

        Note:
            Use um ou outro. Se ambos forem passados, repository tem prioridade.
        """
        self.db = db  # Legado
        self._repository = repository  # Novo padrão
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None

        self.processor = NeshTextProcessor(list(CONFIG.stopwords))

        # Async-friendly manual cache for FTS results using OrderedDict as LRU
        self._fts_cache: OrderedDict = OrderedDict()
        self._chapter_cache: OrderedDict = OrderedDict()
        self._fts_cache_metrics = PayloadCacheMetrics("nesh_fts_cache")
        self._chapter_cache_metrics = PayloadCacheMetrics("nesh_chapter_cache")
        self._cache_lock: Optional[asyncio.Lock] = None  # Lazy init

        mode = "Repository" if self._use_repository else "DatabaseAdapter"
        logger.info(f"NeshService inicializado (modo: {mode})")

    @classmethod
    async def create_with_repository(cls) -> "NeshService":
        """
        Factory assíncrono para criar NeshService com ChapterRepository.

        Uso:
            service = await NeshService.create_with_repository()
            results = await service.search_full_text("bomba")
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
        """Lazy initialization do lock para evitar criação fora do event loop."""
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    @staticmethod
    def _fts_cache_key(
        query: str, tier: int, limit: int, words_matched: int, total_words: int
    ) -> str:
        raw = f"{query}|{tier}|{limit}|{words_matched}|{total_words}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

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
    def _strip_chapter_preamble(content: str) -> str:
        """
        Remove chapter preamble (title/notes/consideracoes) so body starts at first NCM position.
        Only used when structured sections are rendered separately.
        """
        if not content:
            return content
        match = _RE_FIRST_POSITION.search(content)
        if not match:
            return content
        return content[match.start() :].lstrip()

    def parse_chapter_notes(self, notes_content: str) -> Dict[str, str]:
        """
        Parseia notas de capítulo em dicionário estruturado.
        """
        if not notes_content:
            return {}

        notes = {}
        lines = notes_content.split("\n")
        current_num = None
        buffer = []
        pattern = _RE_NOTE_HEADER

        for line in lines:
            cleaned = line.strip()
            match = pattern.match(cleaned)
            if match:
                if current_num:
                    notes[current_num] = "\n".join(buffer).strip()
                current_num = match.group(1)
                buffer = [cleaned]
            else:
                if current_num:
                    buffer.append(cleaned)

        if current_num:
            notes[current_num] = "\n".join(buffer).strip()

        logger.debug(f"Parseadas {len(notes)} notas")
        return notes

    async def _get_cached_chapter(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        """Retorna capítulo do cache L1 em memória quando disponível."""
        async with self._get_cache_lock():
            cached = self._chapter_cache.get(chapter_num)
            if not cached:
                return None
            self._chapter_cache.move_to_end(chapter_num)
            self._chapter_cache_metrics.record_hit()
            return cached

    async def _store_chapter_in_cache(
        self, chapter_num: str, payload: Dict[str, Any]
    ) -> None:
        """Armazena capítulo no cache L1 e aplica política LRU."""
        async with self._get_cache_lock():
            self._chapter_cache[chapter_num] = payload
            self._chapter_cache_metrics.record_set()
            if len(self._chapter_cache) > CacheConfig.CHAPTER_CACHE_SIZE:
                self._chapter_cache.popitem(last=False)
                self._chapter_cache_metrics.record_eviction()

    async def _get_cached_chapter_from_redis(
        self, chapter_num: str
    ) -> Optional[Dict[str, Any]]:
        """Retorna capítulo do cache L2 (Redis) e hidrata cache local."""
        if not redis_cache.available:
            return None
        cached = await redis_cache.get_chapter(chapter_num)
        if not cached:
            return None
        await self._store_chapter_in_cache(chapter_num, cached)
        return cached

    async def _fetch_chapter_raw_data(
        self, chapter_num: str
    ) -> Optional[Dict[str, Any]]:
        """Busca dados brutos do capítulo no Repository/DatabaseAdapter."""
        if self._use_repository:
            async with self._get_repo() as repo:
                if not repo:
                    raise RuntimeError("Repository não disponível")
                chapter = await repo.get_by_num(chapter_num)
                if not chapter:
                    return None
                notes = chapter.notes
                sections = (
                    {
                        "titulo": notes.titulo,
                        "notas": notes.notas,
                        "consideracoes": notes.consideracoes,
                        "definicoes": notes.definicoes,
                    }
                    if notes
                    else None
                )
                return {
                    "chapter_num": chapter.chapter_num,
                    "content": chapter.content,
                    "notes": notes.notes_content if notes else None,
                    "parsed_notes_json": (
                        getattr(notes, "parsed_notes_json", None) if notes else None
                    ),
                    "positions": [
                        {
                            "codigo": p.codigo,
                            "descricao": p.descricao,
                            "anchor_id": p.anchor_id,
                        }
                        for p in chapter.positions
                    ],
                    "sections": sections,
                }

        if not self.db:
            raise RuntimeError("DatabaseAdapter não configurado")
        return await self.db.get_chapter_raw(chapter_num)

    def _hydrate_chapter_payload(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Completa payload do capítulo com parsed_notes e anchor_id."""
        precomputed_json = raw_data.pop("parsed_notes_json", None)
        if precomputed_json:
            try:
                raw_data["parsed_notes"] = (
                    orjson.loads(precomputed_json)
                    if isinstance(precomputed_json, (str, bytes))
                    else precomputed_json
                )
            except Exception:
                raw_data["parsed_notes"] = self.parse_chapter_notes(raw_data["notes"])
        else:
            raw_data["parsed_notes"] = self.parse_chapter_notes(raw_data["notes"])

        raw_data["positions"] = self._enrich_positions_with_id(
            raw_data.get("positions", [])
        )
        return raw_data

    async def fetch_chapter_data(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        """
        Busca dados de capítulo com cache LRU (Async).

        Args:
            chapter_num: Número do capítulo (ex: "73")

        Returns:
            Dict com dados do capítulo incluindo parsed_notes,
            ou None se não encontrar
        """
        cached = await self._get_cached_chapter(chapter_num)
        if cached is not None:
            return cached
        self._chapter_cache_metrics.record_miss()

        redis_cached = await self._get_cached_chapter_from_redis(chapter_num)
        if redis_cached is not None:
            return redis_cached

        logger.debug(f"Fetching capítulo {chapter_num} (cache miss)")

        raw_data = await self._fetch_chapter_raw_data(chapter_num)
        if not raw_data:
            return None
        hydrated = self._hydrate_chapter_payload(raw_data)

        if redis_cache.available:
            await redis_cache.set_chapter(chapter_num, hydrated)

        await self._store_chapter_in_cache(chapter_num, hydrated)

        return hydrated

    def _enrich_positions_with_id(
        self, positions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Adiciona anchor_id a cada posição (usa precomputed se disponível)."""
        for i, pos in enumerate(positions):
            if pos.get("anchor_id"):
                continue
            codigo = pos.get("codigo")
            anchor_id = generate_anchor_id(codigo)
            pos["anchor_id"] = anchor_id
        return positions

    def normalize_query(self, text: str) -> str:
        """
        Normaliza query para busca FTS.
        Otimização: Remove duplicatas e limita termos.
        """
        processed = self.processor.process_query_for_fts(text)
        if not processed:
            return ""

        # Deduplica termos ("ma* ma*" -> "ma*") para otimizar busca AND
        parts = processed.split()
        unique = list(dict.fromkeys(parts))
        # Limita quantidade de tokens para evitar DoS
        unique = unique[:20]

        return " ".join(unique)

    def normalize_query_raw(self, text: str) -> str:
        """
        Normaliza query para FTS sem stemming agressivo.
        Usado como fallback quando stemming não encontra resultados.
        """
        normalized = self.processor.normalize(text)
        words = re.findall(r"\b\w+\b", normalized)

        processed = []
        for w in words:
            if w in self.processor.stopwords:
                continue
            if len(w) < 2:
                continue
            processed.append(f"{w}*")

        if not processed:
            return ""

        unique = list(dict.fromkeys(processed))[:20]
        return " ".join(unique)

    async def _fts_scored_cached(
        self, query: str, tier: int, limit: int, words_matched: int, total_words: int
    ) -> List[Dict[str, Any]]:
        """
        Async wrapper for FTS scored search with manual LRU cache.
        """
        key = (query, tier, limit, words_matched, total_words)

        async with self._get_cache_lock():
            if key in self._fts_cache:
                self._fts_cache.move_to_end(key)
                self._fts_cache_metrics.record_hit()
                return list(self._fts_cache[key])
        self._fts_cache_metrics.record_miss()

        if redis_cache.available:
            redis_key = self._fts_cache_key(
                query, tier, limit, words_matched, total_words
            )
            cached = await redis_cache.get_fts(redis_key)
            if cached:
                async with self._get_cache_lock():
                    self._fts_cache[key] = cached
                    self._fts_cache_metrics.record_set()
                    if len(self._fts_cache) > _FTS_CACHE_SIZE:
                        self._fts_cache.popitem(last=False)
                        self._fts_cache_metrics.record_eviction()
                return list(cached)

        # Use repository if available, otherwise fallback to legacy adapter
        if self._use_repository:
            async with self._get_repo() as repo:
                if not repo:
                    raise RuntimeError("Repository não disponível")
                results = await repo.search_scored(
                    query,
                    tier=tier,
                    limit=limit,
                    words_matched=words_matched,
                    total_words=total_words,
                )
                # Convert SearchResultItem to dict for compatibility
                results = [
                    {
                        "ncm": r.ncm,
                        "display_text": r.display_text,
                        "type": r.type,
                        "description": r.description,
                        "score": r.score,
                        "tier": r.tier,
                        "rank": r.score,  # Compatibility
                    }
                    for r in results
                ]
        else:
            if not self.db:
                raise RuntimeError("DatabaseAdapter não configurado")
            results = await self.db.fts_search_scored(
                query,
                tier=tier,
                limit=limit,
                words_matched=words_matched,
                total_words=total_words,
            )

        async with self._get_cache_lock():
            self._fts_cache[key] = results
            self._fts_cache_metrics.record_set()
            if len(self._fts_cache) > _FTS_CACHE_SIZE:
                self._fts_cache.popitem(last=False)
                self._fts_cache_metrics.record_eviction()

        if redis_cache.available:
            redis_key = self._fts_cache_key(
                query, tier, limit, words_matched, total_words
            )
            await redis_cache.set_fts(redis_key, results)

        return results

    @staticmethod
    def _empty_text_search_response(query: str) -> ServiceResponse:
        return {
            "success": True,
            "type": "text",
            "query": query,
            "normalized": "",
            "match_type": "none",
            "warning": None,
            "results": [],
            "total_capitulos": 0,
        }

    @staticmethod
    def _row_identity(row: Dict[str, Any]) -> Tuple[str, str, str]:
        return (row["ncm"], row["type"], row["display_text"])

    def _add_unique_rows(
        self,
        target: List[Dict[str, Any]],
        seen: set[Tuple[str, str, str]],
        rows: List[Dict[str, Any]],
    ) -> None:
        for row in rows:
            key = self._row_identity(row)
            if key in seen:
                continue
            seen.add(key)
            target.append(row)

    async def _search_tier1(
        self, exact_q: str, total_words: int
    ) -> List[Dict[str, Any]]:
        phrase_query = f'"{exact_q}"'
        return await self._fts_scored_cached(
            phrase_query,
            tier=1,
            limit=SearchConfig.TIER1_LIMIT,
            words_matched=total_words,
            total_words=total_words,
        )

    async def _search_tier2(
        self, normalized_q: str, normalized_raw_q: str, total_words: int
    ) -> List[Dict[str, Any]]:
        and_results = await self._fts_scored_cached(
            normalized_q,
            tier=2,
            limit=SearchConfig.TIER2_LIMIT,
            words_matched=total_words,
            total_words=total_words,
        )
        if and_results or not normalized_raw_q or normalized_raw_q == normalized_q:
            return and_results
        return await self._fts_scored_cached(
            normalized_raw_q,
            tier=2,
            limit=SearchConfig.TIER2_LIMIT,
            words_matched=total_words,
            total_words=total_words,
        )

    def _build_tier3_query(self, original_words: List[str]) -> str:
        unique_words = list(dict.fromkeys(original_words))[:20]
        or_parts = []
        for word in unique_words:
            word_normalized = self.processor.process_query_for_fts(word)
            if word_normalized:
                or_parts.append(word_normalized)
        return " OR ".join(or_parts)

    async def _search_tier3(
        self, original_words: List[str], normalized_raw_q: str, total_words: int
    ) -> List[Dict[str, Any]]:
        or_query = self._build_tier3_query(original_words)
        if not or_query:
            return []

        partial_results = await self._fts_scored_cached(
            or_query,
            tier=3,
            limit=SearchConfig.TIER3_LIMIT,
            words_matched=max(1, total_words // 2),
            total_words=total_words,
        )
        if partial_results or not normalized_raw_q:
            return partial_results

        raw_or_query = " OR ".join(normalized_raw_q.split())
        if raw_or_query == or_query:
            return partial_results
        return await self._fts_scored_cached(
            raw_or_query,
            tier=3,
            limit=SearchConfig.TIER3_LIMIT,
            words_matched=max(1, total_words // 2),
            total_words=total_words,
        )

    async def _apply_near_bonus_if_needed(
        self, all_results: List[Dict[str, Any]], stemmed_words: List[str]
    ) -> None:
        if self._use_repository or len(stemmed_words) < 2 or not all_results:
            return
        if not self.db:
            return
        near_results = await self.db.fts_search_near(
            stemmed_words,
            distance=SearchConfig.NEAR_DISTANCE,
            limit=SearchConfig.TIER1_LIMIT + SearchConfig.TIER2_LIMIT,
        )
        near_ncms = {r["ncm"] for r in near_results}
        for row in all_results:
            if row["ncm"] not in near_ncms:
                continue
            row["score"] += SearchConfig.NEAR_BONUS
            row["near_bonus"] = True
            logger.debug(f"NEAR bonus aplicado: {row['ncm']}")

    @staticmethod
    def _resolve_match_metadata(
        all_results: List[Dict[str, Any]], query: str, original_words: List[str]
    ) -> Tuple[str, Optional[str], int]:
        best_tier = min(r.get("tier", 3) for r in all_results)
        if best_tier == 1:
            return "exact", None, best_tier
        if best_tier == 2:
            return "all_words", None, best_tier
        warning = (
            f'Não encontrei "{query}" exato. '
            f"Mostrando aproximações para: {', '.join(original_words)}"
        )
        return "partial", warning, best_tier

    async def search_full_text(self, query: str) -> ServiceResponse:
        """
        Executa busca Full-Text Search (FTS) com sistema de ranking por tiers (Async).
        """
        logger.info(f"Busca FTS: '{query}'")

        original_words = [w.strip() for w in query.split() if w.strip()]
        total_words = len(original_words)

        normalized_q = self.normalize_query(query)
        normalized_raw_q = self.normalize_query_raw(query)

        if not normalized_q:
            logger.debug("Query vazia após normalização")
            return self._empty_text_search_response(query)

        exact_q = self.processor.process_query_exact(query)
        stemmed_words = exact_q.split() if exact_q else []

        all_results: List[Dict[str, Any]] = []
        seen: set[Tuple[str, str, str]] = set()

        if len(original_words) > 1 and exact_q:
            exact_results = await self._search_tier1(exact_q, total_words)
            if exact_results:
                logger.info(f"FTS TIER1 (exato): {len(exact_results)} resultados")
                self._add_unique_rows(all_results, seen, exact_results)

        and_results = await self._search_tier2(normalized_q, normalized_raw_q, total_words)
        if and_results:
            logger.info(f"FTS TIER2 (AND): {len(and_results)} resultados")
            self._add_unique_rows(all_results, seen, and_results)

        await self._apply_near_bonus_if_needed(all_results, stemmed_words)

        if len(original_words) > 1:
            partial_results = await self._search_tier3(
                original_words, normalized_raw_q, total_words
            )
            if partial_results:
                logger.info(f"FTS TIER3 (OR): {len(partial_results)} resultados")
                self._add_unique_rows(all_results, seen, partial_results)

        all_results.sort(key=lambda x: x.get("score", 0), reverse=True)

        if not all_results:
            logger.info("FTS: 0 resultados em todos os níveis")
            return self._build_fts_response(
                query,
                normalized_q,
                [],
                match_type="none",
                warning=f'Nenhum resultado encontrado para "{query}"',
            )

        match_type, match_warning, best_tier = self._resolve_match_metadata(
            all_results, query, original_words
        )
        logger.info(
            f"FTS total: {len(all_results)} resultados, melhor tier: {best_tier}"
        )
        return self._build_fts_response(
            query,
            normalized_q,
            all_results,
            match_type=match_type,
            warning=match_warning,
        )

    def _build_fts_response(
        self,
        query: str,
        normalized: str,
        rows: list,
        match_type: str,
        warning: Optional[str],
    ) -> ServiceResponse:
        """Constrói resposta padronizada para busca FTS com scores."""

        tier_labels = {1: "Exato", 2: "Todas palavras", 3: "Parcial"}

        results = []
        for row in rows:
            tier = row.get("tier", 3)
            score = row.get("score", 0)
            has_near_bonus = row.get("near_bonus", False)

            results.append(
                {
                    "ncm": row["ncm"],
                    "descricao": row["display_text"],
                    "tipo": row["type"],
                    "relevancia": row.get("rank", 0),
                    "score": score,
                    "tier": tier,
                    "tier_label": tier_labels.get(tier, "Parcial"),
                    "near_bonus": has_near_bonus,
                }
            )

        return {
            "success": True,
            "type": "text",
            "query": query,
            "normalized": normalized,
            "match_type": match_type,
            "warning": warning,
            "results": results,
            "total_capitulos": 0,
        }

    def _extract_chapter_targets(
        self, ncms: List[str]
    ) -> OrderedDict[str, Tuple[str, Optional[str]]]:
        chapter_targets: OrderedDict[str, Tuple[str, Optional[str]]] = OrderedDict()
        for ncm in ncms:
            chapter_num, target_pos = ncm_utils.extract_chapter_from_ncm(ncm)
            if not chapter_num:
                logger.debug(f"NCM inválido ignorado: '{ncm}'")
                continue
            chapter_targets.setdefault(chapter_num, (ncm, target_pos))
        return chapter_targets

    @staticmethod
    def _has_structured_sections(sections: Dict[str, Any]) -> bool:
        return any(
            (sections.get(key) or "").strip()
            for key in ("titulo", "notas", "consideracoes", "definicoes")
        )

    @staticmethod
    def _build_sections_payload(sections: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "titulo": sections.get("titulo"),
            "notas": sections.get("notas"),
            "consideracoes": sections.get("consideracoes"),
            "definicoes": sections.get("definicoes"),
        }

    def _build_found_chapter_search_result(
        self,
        chapter_num: str,
        ncm_buscado: str,
        target_pos: Optional[str],
        data: Dict[str, Any],
    ) -> SearchResult:
        sections = data.get("sections") or {}
        has_sections = self._has_structured_sections(sections)
        content = (
            self._strip_chapter_preamble(data["content"])
            if has_sections
            else data["content"]
        )
        return {
            "ncm_buscado": ncm_buscado,
            "capitulo": chapter_num,
            "posicao_alvo": target_pos,
            "posicoes": data["positions"],
            "notas_gerais": data["notes"],
            "notas_parseadas": data["parsed_notes"],
            "conteudo": content,
            "real_content_found": True,
            "erro": None,
            "secoes": self._build_sections_payload(sections) if has_sections else None,
        }

    @staticmethod
    def _build_missing_chapter_search_result(
        chapter_num: str, ncm_buscado: str
    ) -> SearchResult:
        return {
            "ncm_buscado": ncm_buscado,
            "capitulo": chapter_num,
            "real_content_found": False,
            "erro": f"Capítulo {chapter_num} não encontrado",
            "conteudo": "",
            "posicoes": [],
            "notas_gerais": None,
            "notas_parseadas": {},
            "posicao_alvo": None,
        }

    async def search_by_code(self, ncm_query: str) -> ServiceResponse:
        """
        Busca capítulos por código NCM (Async).

        Args:
            ncm_query: String de NCMs (ex: "85,73.18,0101")

        Returns:
            ServiceResponse com type='code' e dict de resultados
        """
        logger.debug(f"Busca por código: '{ncm_query}'")

        results: Dict[str, SearchResult] = {}
        ncms = ncm_utils.split_ncm_query(ncm_query)
        chapter_targets = self._extract_chapter_targets(ncms)
        if not chapter_targets:
            logger.debug("Retornando 0 capítulos")
            return {
                "success": True,
                "type": "code",
                "query": ncm_query,
                "normalized": None,
                "results": results,
                "total_capitulos": 0,
            }

        ordered_chapters = list(chapter_targets.keys())
        chapter_payloads = await asyncio.gather(
            *(self.fetch_chapter_data(chapter_num) for chapter_num in ordered_chapters)
        )

        for chapter_num, data in zip(ordered_chapters, chapter_payloads):
            ncm_buscado, target_pos = chapter_targets[chapter_num]
            if data:
                results[chapter_num] = self._build_found_chapter_search_result(
                    chapter_num, ncm_buscado, target_pos, data
                )
                continue
            logger.warning(f"Capítulo não encontrado: {chapter_num}")
            results[chapter_num] = self._build_missing_chapter_search_result(
                chapter_num, ncm_buscado
            )

        logger.debug(f"Retornando {len(results)} capítulos")
        return {
            "success": True,
            "type": "code",
            "query": ncm_query,
            "normalized": None,
            "results": results,
            "total_capitulos": len(results),
        }

    async def process_request(self, query: str) -> ServiceResponse:
        """
        Facade principal de processamento de busca (Async).
        """
        # Heurística: só dígitos/pontuação = código NCM
        is_ncm = ncm_utils.is_code_query(query)

        if is_ncm:
            return await self.search_by_code(query)
        else:
            return await self.search_full_text(query)

    async def prewarm_cache(
        self, chapter_nums: Optional[List[str]] = None, concurrency: int = 10
    ) -> int:
        """
        Pre-warm chapter cache (L1/L2) to reduce cold latency.
        """
        if chapter_nums is None:
            if self._use_repository:
                async with self._get_repo() as repo:
                    if not repo:
                        return 0
                    chapter_nums = await repo.get_all_nums()
            else:
                if not self.db:
                    return 0
                chapter_nums = await self.db.get_all_chapters_list()

        if not chapter_nums:
            return 0

        sem = asyncio.Semaphore(concurrency)

        async def _warm(chapter_num: str) -> None:
            async with sem:
                try:
                    await self.fetch_chapter_data(chapter_num)
                except Exception as exc:
                    logger.debug("Prewarm failed for %s: %s", chapter_num, exc)

        await asyncio.gather(*(_warm(num) for num in chapter_nums))
        return len(chapter_nums)

    async def get_internal_cache_metrics(self) -> Dict[str, Any]:
        """
        Snapshot dos caches internos (L1) do serviço.
        """
        async with self._get_cache_lock():
            chapter_snapshot = self._chapter_cache_metrics.snapshot(
                current_size=len(self._chapter_cache),
                max_size=CacheConfig.CHAPTER_CACHE_SIZE,
            )
            fts_snapshot = self._fts_cache_metrics.snapshot(
                current_size=len(self._fts_cache),
                max_size=_FTS_CACHE_SIZE,
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
