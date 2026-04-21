from __future__ import annotations

import hashlib
import re
from typing import TYPE_CHECKING

from ...config.constants import SearchConfig
from ...config.logging_config import service_logger as logger
from ...infrastructure.redis_client import redis_cache
from .types import (
    NeshFtsCacheKey,
    NeshFtsMatchMetadata,
    NeshFtsResponseItem,
    NeshFtsScoredRow,
    NeshFtsSearchResponse,
)

if TYPE_CHECKING:
    from ..nesh_service import NeshService


NESH_FTS_CACHE_SIZE = 64


def build_nesh_fts_cache_key(
    query: str, tier: int, limit: int, words_matched: int, total_words: int
) -> str:
    raw = f"{query}|{tier}|{limit}|{words_matched}|{total_words}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_nesh_fts_query(service: "NeshService", text: str) -> str:
    processed = service.processor.process_query_for_fts(text)
    if not processed:
        return ""
    parts = processed.split()
    unique = list(dict.fromkeys(parts))[:20]
    return " ".join(unique)


def normalize_nesh_raw_fts_query(service: "NeshService", text: str) -> str:
    normalized = service.processor.normalize(text)
    words = re.findall(r"\b\w+\b", normalized)

    processed: list[str] = []
    for word in words:
        if word in service.processor.stopwords:
            continue
        if len(word) < 2:
            continue
        processed.append(f"{word}*")

    if not processed:
        return ""
    unique = list(dict.fromkeys(processed))[:20]
    return " ".join(unique)


async def fetch_nesh_fts_scored_rows_cached(
    service: "NeshService",
    query: str,
    tier: int,
    limit: int,
    words_matched: int,
    total_words: int,
) -> list[NeshFtsScoredRow]:
    key: NeshFtsCacheKey = (query, tier, limit, words_matched, total_words)

    async with service._get_cache_lock():
        if key in service._fts_cache:
            service._fts_cache.move_to_end(key)
            service._fts_cache_metrics.record_hit()
            return list(service._fts_cache[key])
    service._fts_cache_metrics.record_miss()

    if redis_cache.available:
        redis_key = build_nesh_fts_cache_key(
            query, tier, limit, words_matched, total_words
        )
        cached = await redis_cache.get_fts(redis_key)
        if cached:
            async with service._get_cache_lock():
                service._fts_cache[key] = cached
                service._fts_cache_metrics.record_set()
                if len(service._fts_cache) > NESH_FTS_CACHE_SIZE:
                    service._fts_cache.popitem(last=False)
                    service._fts_cache_metrics.record_eviction()
            return list(cached)

    if service._use_repository:
        async with service._get_repo() as repo:
            if not repo:
                raise RuntimeError("Repository não disponível")
            results = await repo.search_scored(
                query,
                tier=tier,
                limit=limit,
                words_matched=words_matched,
                total_words=total_words,
            )
            rows: list[NeshFtsScoredRow] = [
                {
                    "ncm": row.ncm,
                    "display_text": row.display_text,
                    "type": row.type,
                    "description": row.description,
                    "score": row.score,
                    "tier": row.tier,
                    "rank": row.score,
                }
                for row in results
            ]
    else:
        if not service.db:
            raise RuntimeError("DatabaseAdapter não configurado")
        rows = await service.db.fts_search_scored(
            query,
            tier=tier,
            limit=limit,
            words_matched=words_matched,
            total_words=total_words,
        )

    async with service._get_cache_lock():
        service._fts_cache[key] = rows
        service._fts_cache_metrics.record_set()
        if len(service._fts_cache) > NESH_FTS_CACHE_SIZE:
            service._fts_cache.popitem(last=False)
            service._fts_cache_metrics.record_eviction()

    if redis_cache.available:
        redis_key = build_nesh_fts_cache_key(
            query, tier, limit, words_matched, total_words
        )
        await redis_cache.set_fts(redis_key, rows)

    return rows


def build_nesh_empty_fts_search_response(query: str) -> NeshFtsSearchResponse:
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


def build_nesh_fts_row_identity(row: NeshFtsScoredRow) -> tuple[str, str, str]:
    return (row["ncm"], row["type"], row["display_text"])


def append_unique_nesh_fts_rows(
    target: list[NeshFtsScoredRow],
    seen: set[tuple[str, str, str]],
    rows: list[NeshFtsScoredRow],
) -> None:
    for row in rows:
        key = build_nesh_fts_row_identity(row)
        if key in seen:
            continue
        seen.add(key)
        target.append(row)


async def fetch_nesh_fts_exact_rows(
    service: "NeshService", exact_q: str, total_words: int
) -> list[NeshFtsScoredRow]:
    phrase_query = f'"{exact_q}"'
    return await service._fts_scored_cached(
        phrase_query,
        tier=1,
        limit=SearchConfig.TIER1_LIMIT,
        words_matched=total_words,
        total_words=total_words,
    )


async def fetch_nesh_fts_all_words_rows(
    service: "NeshService",
    normalized_q: str,
    normalized_raw_q: str,
    total_words: int,
) -> list[NeshFtsScoredRow]:
    and_results = await service._fts_scored_cached(
        normalized_q,
        tier=2,
        limit=SearchConfig.TIER2_LIMIT,
        words_matched=total_words,
        total_words=total_words,
    )
    if and_results or not normalized_raw_q or normalized_raw_q == normalized_q:
        return and_results
    return await service._fts_scored_cached(
        normalized_raw_q,
        tier=2,
        limit=SearchConfig.TIER2_LIMIT,
        words_matched=total_words,
        total_words=total_words,
    )


def build_nesh_fts_or_query(service: "NeshService", original_words: list[str]) -> str:
    unique_words = list(dict.fromkeys(original_words))[:20]
    or_parts: list[str] = []
    for word in unique_words:
        word_normalized = service.processor.process_query_for_fts(word)
        if word_normalized:
            or_parts.append(word_normalized)
    return " OR ".join(or_parts)


async def fetch_nesh_fts_any_words_rows(
    service: "NeshService",
    original_words: list[str],
    normalized_raw_q: str,
    total_words: int,
) -> list[NeshFtsScoredRow]:
    or_query = build_nesh_fts_or_query(service, original_words)
    if not or_query:
        return []

    partial_results = await service._fts_scored_cached(
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
    return await service._fts_scored_cached(
        raw_or_query,
        tier=3,
        limit=SearchConfig.TIER3_LIMIT,
        words_matched=max(1, total_words // 2),
        total_words=total_words,
    )


async def apply_nesh_near_bonus_if_needed(
    service: "NeshService",
    all_results: list[NeshFtsScoredRow],
    stemmed_words: list[str],
) -> None:
    if service._use_repository or len(stemmed_words) < 2 or not all_results:
        return
    if not service.db:
        return
    near_results = await service.db.fts_search_near(
        stemmed_words,
        distance=SearchConfig.NEAR_DISTANCE,
        limit=SearchConfig.TIER1_LIMIT + SearchConfig.TIER2_LIMIT,
    )
    near_ncms = {row["ncm"] for row in near_results}
    for row in all_results:
        if row["ncm"] not in near_ncms:
            continue
        row["score"] += SearchConfig.NEAR_BONUS
        row["near_bonus"] = True
        logger.debug("NEAR bonus aplicado: %s", row["ncm"])


def resolve_nesh_fts_match_metadata(
    all_results: list[NeshFtsScoredRow], query: str, original_words: list[str]
) -> NeshFtsMatchMetadata:
    best_tier = min(row.get("tier", 3) for row in all_results)
    if best_tier == 1:
        return {"match_type": "exact", "warning": None, "best_tier": best_tier}
    if best_tier == 2:
        return {"match_type": "all_words", "warning": None, "best_tier": best_tier}
    warning = (
        f'Não encontrei "{query}" exato. '
        f"Mostrando aproximações para: {', '.join(original_words)}"
    )
    return {"match_type": "partial", "warning": warning, "best_tier": best_tier}


def build_nesh_fts_response(
    query: str,
    normalized: str,
    rows: list[NeshFtsScoredRow],
    match_type: str,
    warning: str | None,
) -> NeshFtsSearchResponse:
    tier_labels = {1: "Exato", 2: "Todas palavras", 3: "Parcial"}
    results: list[NeshFtsResponseItem] = []
    for row in rows:
        tier = row.get("tier", 3)
        score = row.get("score", 0)
        results.append(
            {
                "ncm": row["ncm"],
                "descricao": row["display_text"],
                "tipo": row["type"],
                "relevancia": row.get("rank", 0),
                "score": score,
                "tier": tier,
                "tier_label": tier_labels.get(tier, "Parcial"),
                "near_bonus": row.get("near_bonus", False),
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


async def search_nesh_fts_text(service: "NeshService", query: str) -> NeshFtsSearchResponse:
    logger.info("Busca FTS: '%s'", query)

    original_words = [word.strip() for word in query.split() if word.strip()]
    total_words = len(original_words)
    normalized_q = service.normalizeNeshQuery(query)
    normalized_raw_q = service.normalizeNeshRawQuery(query)

    if not normalized_q:
        logger.debug("Query vazia após normalização")
        return build_nesh_empty_fts_search_response(query)

    exact_q = service.processor.process_query_exact(query)
    stemmed_words = exact_q.split() if exact_q else []
    all_results: list[NeshFtsScoredRow] = []
    seen: set[tuple[str, str, str]] = set()

    if len(original_words) > 1 and exact_q:
        exact_results = await fetch_nesh_fts_exact_rows(service, exact_q, total_words)
        if exact_results:
            logger.info("FTS TIER1 (exato): %s resultados", len(exact_results))
            append_unique_nesh_fts_rows(all_results, seen, exact_results)

    and_results = await fetch_nesh_fts_all_words_rows(
        service, normalized_q, normalized_raw_q, total_words
    )
    if and_results:
        logger.info("FTS TIER2 (AND): %s resultados", len(and_results))
        append_unique_nesh_fts_rows(all_results, seen, and_results)

    await apply_nesh_near_bonus_if_needed(service, all_results, stemmed_words)

    if len(original_words) > 1:
        partial_results = await fetch_nesh_fts_any_words_rows(
            service, original_words, normalized_raw_q, total_words
        )
        if partial_results:
            logger.info("FTS TIER3 (OR): %s resultados", len(partial_results))
            append_unique_nesh_fts_rows(all_results, seen, partial_results)

    all_results.sort(key=lambda row: row.get("score", 0), reverse=True)

    if not all_results:
        logger.info("FTS: 0 resultados em todos os níveis")
        return build_nesh_fts_response(
            query,
            normalized_q,
            [],
            match_type="none",
            warning=f'Nenhum resultado encontrado para "{query}"',
        )

    match_metadata = resolve_nesh_fts_match_metadata(
        all_results, query, original_words
    )
    logger.info(
        "FTS total: %s resultados, melhor tier: %s",
        len(all_results),
        match_metadata["best_tier"],
    )
    return build_nesh_fts_response(
        query,
        normalized_q,
        all_results,
        match_type=match_metadata["match_type"],
        warning=match_metadata["warning"],
    )


def snapshot_nesh_fts_cache_metrics(service: "NeshService") -> tuple[int, int]:
    return len(service._fts_cache), NESH_FTS_CACHE_SIZE
