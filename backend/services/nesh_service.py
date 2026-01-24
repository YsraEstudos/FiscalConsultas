"""
Serviço principal de busca NCM.
Contém toda a lógica de negócio, isolada de I/O e apresentação.
"""

import re
import asyncio
from collections import OrderedDict
from typing import Dict, List, Optional, Any, Tuple

from ..config import CONFIG
from ..utils import ncm_utils
from ..config.constants import CacheConfig, RegexPatterns, SearchConfig
from ..config.logging_config import service_logger as logger
from ..config.exceptions import ChapterNotFoundError, DatabaseError
from ..domain import SearchResult, ServiceResponse
from ..infrastructure import DatabaseAdapter

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
    
    def __init__(self, db: DatabaseAdapter):
        """
        Inicializa o serviço com adapter de banco.
        
        Args:
            db: Instância configurada do DatabaseAdapter
        """
        self.db = db
        self.processor = NeshTextProcessor(list(CONFIG.stopwords))
        
        # Async-friendly manual cache for FTS results using OrderedDict as LRU
        self._fts_cache: OrderedDict = OrderedDict()
        self._chapter_cache: OrderedDict = OrderedDict()
        self._cache_lock: Optional[asyncio.Lock] = None  # Lazy init
        
        logger.info("NeshService inicializado")
    
    def _get_cache_lock(self) -> asyncio.Lock:
        """Lazy initialization do lock para evitar criação fora do event loop."""
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    def parse_chapter_notes(self, notes_content: str) -> Dict[str, str]:
        """
        Parseia notas de capítulo em dicionário estruturado.
        """
        if not notes_content:
            return {}
            
        notes = {}
        lines = notes_content.split('\n')
        current_num = None
        buffer = []
        pattern = _RE_NOTE_HEADER

        for line in lines:
            cleaned = line.strip()
            match = pattern.match(cleaned)
            if match:
                if current_num:
                    notes[current_num] = '\n'.join(buffer).strip()
                current_num = match.group(1)
                buffer = [cleaned]
            else:
                if current_num:
                    buffer.append(cleaned)
        
        if current_num:
            notes[current_num] = '\n'.join(buffer).strip()
        
        logger.debug(f"Parseadas {len(notes)} notas")
        return notes

    async def fetch_chapter_data(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        """
        Busca dados de capítulo com cache LRU (Async).
        
        Args:
            chapter_num: Número do capítulo (ex: "73")
            
        Returns:
            Dict com dados do capítulo incluindo parsed_notes,
            ou None se não encontrar
        """
        async with self._get_cache_lock():
            # Check cache
            if chapter_num in self._chapter_cache:
                self._chapter_cache.move_to_end(chapter_num)
                return self._chapter_cache[chapter_num]

        logger.debug(f"Fetching capítulo {chapter_num} (cache miss)")
        
        raw_data = await self.db.get_chapter_raw(chapter_num)
        if not raw_data:
            return None
            
        raw_data['parsed_notes'] = self.parse_chapter_notes(raw_data['notes'])
        raw_data['positions'] = self._enrich_positions_with_id(raw_data.get('positions', []))
        
        async with self._get_cache_lock():
            # Update cache
            self._chapter_cache[chapter_num] = raw_data
            if len(self._chapter_cache) > CacheConfig.CHAPTER_CACHE_SIZE:
                self._chapter_cache.popitem(last=False)
            
        return raw_data

    def _enrich_positions_with_id(self, positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Adiciona anchor_id a cada posição."""
        for i, pos in enumerate(positions):
            codigo = pos.get('codigo')
            anchor_id = generate_anchor_id(codigo)
            pos['anchor_id'] = anchor_id
        return positions

    def normalize_query(self, text: str) -> str:
        """
        Normaliza query para busca FTS.
        """
        return self.processor.process_query_for_fts(text)

    async def _fts_scored_cached(self, query: str, tier: int, limit: int,
                           words_matched: int, total_words: int) -> List[Dict[str, Any]]:
        """
        Async wrapper for FTS scored search with manual LRU cache.
        """
        key = (query, tier, limit, words_matched, total_words)
        
        async with self._get_cache_lock():
            if key in self._fts_cache:
                self._fts_cache.move_to_end(key)
                return list(self._fts_cache[key])

        results = await self.db.fts_search_scored(
            query, tier=tier, limit=limit,
            words_matched=words_matched, total_words=total_words
        )
        
        async with self._get_cache_lock():
            self._fts_cache[key] = results
            if len(self._fts_cache) > _FTS_CACHE_SIZE:
                self._fts_cache.popitem(last=False)
            
        return results

    async def search_full_text(self, query: str) -> ServiceResponse:
        """
        Executa busca Full-Text Search (FTS) com sistema de ranking por tiers (Async).
        """
        logger.info(f"Busca FTS: '{query}'")
        
        original_words = [w.strip() for w in query.split() if w.strip()]
        total_words = len(original_words)
        
        normalized_q = self.normalize_query(query)
        
        if not normalized_q:
            logger.debug("Query vazia após normalização")
            return {
                "success": True, 
                "type": "text", 
                "query": query,
                "normalized": "",
                "match_type": "none",
                "warning": None,
                "results": [],
                "total_capitulos": 0
            }
        
        exact_q = self.processor.process_query_exact(query)
        stemmed_words = exact_q.split() if exact_q else []

        all_results = []
        seen = set()
        
        def add_results(rows):
            """Adiciona resultados evitando duplicatas."""
            for row in rows:
                key = (row['ncm'], row['type'], row['display_text'])
                if key not in seen:
                    seen.add(key)
                    all_results.append(row)

        # ========== TIER 1: Busca Exata (frase) ==========
        if len(original_words) > 1 and exact_q:
            phrase_query = f'"{exact_q}"'
            # DatabaseError will be caught by global handler (503)
            # Other exceptions will be caught by generic handler (500)
            exact_results = await self._fts_scored_cached(
                phrase_query, 
                tier=1, 
                limit=SearchConfig.TIER1_LIMIT,
                words_matched=total_words,
                total_words=total_words
            )
            if exact_results:
                logger.info(f"FTS TIER1 (exato): {len(exact_results)} resultados")
                add_results(exact_results)

        # ========== TIER 2: Todas as palavras (AND com wildcards) ==========
        and_results = await self._fts_scored_cached(
            normalized_q, 
            tier=2, 
            limit=SearchConfig.TIER2_LIMIT,
            words_matched=total_words,
            total_words=total_words
        )
        if and_results:
            logger.info(f"FTS TIER2 (AND): {len(and_results)} resultados")
            add_results(and_results)

        # ========== BÔNUS DE PROXIMIDADE (NEAR) ==========
        if len(stemmed_words) >= 2:
            near_results = await self.db.fts_search_near(
                stemmed_words, 
                distance=SearchConfig.NEAR_DISTANCE,
                limit=SearchConfig.TIER1_LIMIT + SearchConfig.TIER2_LIMIT
            )
            near_ncms = {r['ncm'] for r in near_results}
            
            for r in all_results:
                if r['ncm'] in near_ncms:
                    r['score'] += SearchConfig.NEAR_BONUS
                    r['near_bonus'] = True
                    logger.debug(f"NEAR bonus aplicado: {r['ncm']}")

        # ========== TIER 3: Qualquer palavra (OR com wildcards) ==========
        if len(original_words) > 1:
            or_parts = []
            for word in original_words:
                word_normalized = self.processor.process_query_for_fts(word)
                if word_normalized:
                    or_parts.append(word_normalized)
            
            if or_parts:
                or_query = " OR ".join(or_parts)
                partial_results = await self._fts_scored_cached(
                    or_query, 
                    tier=3, 
                    limit=SearchConfig.TIER3_LIMIT,
                    words_matched=max(1, total_words // 2),
                    total_words=total_words
                )
                if partial_results:
                    logger.info(f"FTS TIER3 (OR): {len(partial_results)} resultados")
                    add_results(partial_results)

        all_results.sort(key=lambda x: x.get('score', 0), reverse=True)

        if all_results:
            best_tier = min(r.get('tier', 3) for r in all_results)
            if best_tier == 1:
                match_type = "exact"
                match_warning = None
            elif best_tier == 2:
                match_type = "all_words"
                match_warning = None
            else:
                match_type = "partial"
                match_warning = (
                    f"Não encontrei \"{query}\" exato. "
                    f"Mostrando aproximações para: {', '.join(original_words)}"
                )
            
            logger.info(f"FTS total: {len(all_results)} resultados, melhor tier: {best_tier}")
            return self._build_fts_response(
                query, normalized_q, all_results,
                match_type=match_type, warning=match_warning
            )

        logger.info("FTS: 0 resultados em todos os níveis")
        return self._build_fts_response(
            query, normalized_q, [],
            match_type="none",
            warning=f"Nenhum resultado encontrado para \"{query}\""
        )

    def _build_fts_response(
        self, 
        query: str, 
        normalized: str, 
        rows: list, 
        match_type: str, 
        warning: Optional[str]
    ) -> ServiceResponse:
        """Constrói resposta padronizada para busca FTS com scores."""
        
        tier_labels = {1: "Exato", 2: "Todas palavras", 3: "Parcial"}
        
        results = []
        for row in rows:
            tier = row.get('tier', 3)
            score = row.get('score', 0)
            has_near_bonus = row.get('near_bonus', False)
            
            results.append({
                "ncm": row['ncm'],
                "descricao": row['display_text'],
                "tipo": row['type'],
                "relevancia": row.get('rank', 0),
                "score": score,
                "tier": tier,
                "tier_label": tier_labels.get(tier, "Parcial"),
                "near_bonus": has_near_bonus
            })
        
        return {
            "success": True, 
            "type": "text", 
            "query": query, 
            "normalized": normalized,
            "match_type": match_type,
            "warning": warning,
            "results": results,
            "total_capitulos": 0
        }

    async def search_by_code(self, ncm_query: str) -> ServiceResponse:
        """
        Busca capítulos por código NCM (Async).
        
        Args:
            ncm_query: String de NCMs (ex: "85,73.18,0101")
            
        Returns:
            ServiceResponse com type='code' e dict de resultados
        """
        logger.info(f"Busca por código: '{ncm_query}'")
        
        results: Dict[str, SearchResult] = {}
        ncms = ncm_utils.split_ncm_query(ncm_query)
        
        for ncm in ncms:
            chapter_num, target_pos = ncm_utils.extract_chapter_from_ncm(ncm)
            
            if not chapter_num:
                logger.debug(f"NCM inválido ignorado: '{ncm}'")
                continue
            
            data = await self.fetch_chapter_data(chapter_num)
            
            if data:
                if chapter_num not in results:
                    results[chapter_num] = {
                        "ncm_buscado": ncm,
                        "capitulo": chapter_num,
                        "posicao_alvo": target_pos,
                        "posicoes": data['positions'],
                        "notas_gerais": data['notes'],
                        "notas_parseadas": data['parsed_notes'],
                        "conteudo": data['content'],
                        "real_content_found": True,
                        "erro": None
                    }
            else:
                logger.warning(f"Capítulo não encontrado: {chapter_num}")
                results[chapter_num] = {
                    "ncm_buscado": ncm,
                    "capitulo": chapter_num,
                    "real_content_found": False,
                    "erro": f"Capítulo {chapter_num} não encontrado",
                    "conteudo": "",
                    "posicoes": [],
                    "notas_gerais": None,
                    "notas_parseadas": {},
                    "posicao_alvo": None
                }

        logger.info(f"Retornando {len(results)} capítulos")
        return {
            "success": True,
            "type": "code",
            "query": ncm_query,
            "normalized": None,
            "results": results,
            "total_capitulos": len(results)
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
