from __future__ import annotations

import asyncio
import re
from collections import OrderedDict
from typing import TYPE_CHECKING, Any

import orjson

from ...config.constants import CacheConfig, RegexPatterns
from ...config.logging_config import service_logger as logger
from ...infrastructure.redis_client import redis_cache
from ...utils import ncm_utils
from ...utils.id_utils import generate_anchor_id
from .types import (
    NeshChapterRawPayload,
    NeshChapterSearchResponse,
    NeshChapterSearchResult,
    NeshChapterSearchResultMap,
)

if TYPE_CHECKING:
    from ..nesh_service import NeshService


NESH_RE_NOTE_HEADER = re.compile(RegexPatterns.NOTE_HEADER)
NESH_RE_FIRST_POSITION = re.compile(
    r"^\s*(?:\*\*|\*)?\d{2}\.\d{2}(?:\*\*|\*)?\s*[-\u2013\u2014:]",
    re.MULTILINE,
)


def strip_nesh_chapter_preamble(content: str) -> str:
    if not content:
        return content
    match = NESH_RE_FIRST_POSITION.search(content)
    if not match:
        return content
    return content[match.start() :].lstrip()


def parse_nesh_chapter_notes(notes_content: str) -> dict[str, str]:
    if not notes_content:
        return {}

    notes: dict[str, str] = {}
    current_num: str | None = None
    buffer: list[str] = []

    for line in notes_content.split("\n"):
        cleaned = line.strip()
        match = NESH_RE_NOTE_HEADER.match(cleaned)
        if match:
            if current_num:
                notes[current_num] = "\n".join(buffer).strip()
            current_num = match.group(1)
            buffer = [cleaned]
            continue
        if current_num:
            buffer.append(cleaned)

    if current_num:
        notes[current_num] = "\n".join(buffer).strip()

    logger.debug("Parseadas %s notas", len(notes))
    return notes


def enrich_nesh_positions_with_anchor_ids(
    positions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    for pos in positions:
        if pos.get("anchor_id"):
            continue
        codigo = pos.get("codigo")
        pos["anchor_id"] = generate_anchor_id(codigo)
    return positions


async def read_nesh_chapter_cache(
    service: "NeshService", chapter_num: str
) -> NeshChapterRawPayload | None:
    async with service._get_cache_lock():
        cached = service._chapter_cache.get(chapter_num)
        if not cached:
            return None
        service._chapter_cache.move_to_end(chapter_num)
        service._chapter_cache_metrics.record_hit()
        return cached


async def write_nesh_chapter_cache(
    service: "NeshService", chapter_num: str, payload: NeshChapterRawPayload
) -> None:
    async with service._get_cache_lock():
        service._chapter_cache[chapter_num] = payload
        service._chapter_cache_metrics.record_set()
        if len(service._chapter_cache) > CacheConfig.CHAPTER_CACHE_SIZE:
            service._chapter_cache.popitem(last=False)
            service._chapter_cache_metrics.record_eviction()


async def read_nesh_chapter_cache_from_redis(
    service: "NeshService", chapter_num: str
) -> NeshChapterRawPayload | None:
    if not redis_cache.available:
        return None
    cached = await redis_cache.get_chapter(chapter_num)
    if not cached:
        return None
    await write_nesh_chapter_cache(service, chapter_num, cached)
    return cached


async def load_nesh_chapter_raw_data(
    service: "NeshService", chapter_num: str
) -> NeshChapterRawPayload | None:
    if service._use_repository:
        async with service._get_repo() as repo:
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
                        "codigo": position.codigo,
                        "descricao": position.descricao,
                        "anchor_id": position.anchor_id,
                    }
                    for position in chapter.positions
                ],
                "sections": sections,
            }

    if not service.db:
        raise RuntimeError("DatabaseAdapter não configurado")
    return await service.db.get_chapter_raw(chapter_num)


def hydrate_nesh_chapter_payload(
    raw_data: NeshChapterRawPayload,
) -> NeshChapterRawPayload:
    precomputed_json = raw_data.pop("parsed_notes_json", None)
    if precomputed_json:
        try:
            raw_data["parsed_notes"] = (
                orjson.loads(precomputed_json)
                if isinstance(precomputed_json, (str, bytes))
                else precomputed_json
            )
        except Exception:
            logger.warning(
                "Failed to parse precomputed notes JSON for chapter, falling back to parser",
                exc_info=True,
            )
            raw_data["parsed_notes"] = parse_nesh_chapter_notes(raw_data["notes"])
    else:
        raw_data["parsed_notes"] = parse_nesh_chapter_notes(raw_data["notes"])

    raw_data["positions"] = enrich_nesh_positions_with_anchor_ids(
        raw_data.get("positions", [])
    )
    return raw_data


async def fetch_nesh_chapter_payload(
    service: "NeshService", chapter_num: str
) -> NeshChapterRawPayload | None:
    cached = await read_nesh_chapter_cache(service, chapter_num)
    if cached is not None:
        return cached
    service._chapter_cache_metrics.record_miss()

    redis_cached = await read_nesh_chapter_cache_from_redis(service, chapter_num)
    if redis_cached is not None:
        return redis_cached

    logger.debug("Fetching capítulo %s (cache miss)", chapter_num)
    raw_data = await load_nesh_chapter_raw_data(service, chapter_num)
    if not raw_data:
        return None
    hydrated = hydrate_nesh_chapter_payload(raw_data)

    if redis_cache.available:
        await redis_cache.set_chapter(chapter_num, hydrated)

    await write_nesh_chapter_cache(service, chapter_num, hydrated)
    return hydrated


def extract_nesh_chapter_targets(
    ncms: list[str],
) -> OrderedDict[str, tuple[str, str | None]]:
    chapter_targets: OrderedDict[str, tuple[str, str | None]] = OrderedDict()
    for ncm in ncms:
        chapter_num, target_pos = ncm_utils.extract_chapter_from_ncm(ncm)
        if not chapter_num:
            logger.debug("NCM inválido ignorado: '%s'", ncm)
            continue
        chapter_targets.setdefault(chapter_num, (ncm, target_pos))
    return chapter_targets


def has_nesh_structured_sections(sections: dict[str, Any]) -> bool:
    return any(
        (sections.get(key) or "").strip()
        for key in ("titulo", "notas", "consideracoes", "definicoes")
    )


def build_nesh_sections_payload(sections: dict[str, Any]) -> dict[str, Any]:
    return {
        "titulo": sections.get("titulo"),
        "notas": sections.get("notas"),
        "consideracoes": sections.get("consideracoes"),
        "definicoes": sections.get("definicoes"),
    }


def build_nesh_found_chapter_search_result(
    chapter_num: str,
    ncm_buscado: str,
    target_pos: str | None,
    data: NeshChapterRawPayload,
) -> NeshChapterSearchResult:
    sections = data.get("sections") or {}
    has_sections = has_nesh_structured_sections(sections)
    content = (
        strip_nesh_chapter_preamble(data["content"])
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
        "secoes": build_nesh_sections_payload(sections) if has_sections else None,
    }


def build_nesh_missing_chapter_search_result(
    chapter_num: str, ncm_buscado: str
) -> NeshChapterSearchResult:
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


async def search_nesh_chapters_by_ncm_code(
    service: "NeshService", ncm_query: str
) -> NeshChapterSearchResponse:
    logger.debug("Busca por código: '%s'", ncm_query)

    results: NeshChapterSearchResultMap = {}
    ncms = ncm_utils.split_ncm_query(ncm_query)
    chapter_targets = extract_nesh_chapter_targets(ncms)
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
        *(service.fetchNeshChapterData(chapter_num) for chapter_num in ordered_chapters)
    )

    for chapter_num, data in zip(ordered_chapters, chapter_payloads):
        ncm_buscado, target_pos = chapter_targets[chapter_num]
        if data:
            results[chapter_num] = build_nesh_found_chapter_search_result(
                chapter_num, ncm_buscado, target_pos, data
            )
            continue
        logger.warning("Capítulo não encontrado: %s", chapter_num)
        results[chapter_num] = build_nesh_missing_chapter_search_result(
            chapter_num, ncm_buscado
        )

    logger.debug("Retornando %s capítulos", len(results))
    return {
        "success": True,
        "type": "code",
        "query": ncm_query,
        "normalized": None,
        "results": results,
        "total_capitulos": len(results),
    }


async def prewarm_nesh_chapter_cache(
    service: "NeshService",
    chapter_nums: list[str] | None = None,
    concurrency: int = 10,
) -> int:
    if chapter_nums is None:
        if service._use_repository:
            async with service._get_repo() as repo:
                if not repo:
                    return 0
                chapter_nums = await repo.get_all_nums()
        else:
            if not service.db:
                return 0
            chapter_nums = await service.db.get_all_chapters_list()

    if not chapter_nums:
        return 0

    sem = asyncio.Semaphore(concurrency)

    async def _warm(chapter_num: str) -> None:
        async with sem:
            try:
                await service.fetchNeshChapterData(chapter_num)
            except Exception as exc:
                logger.debug("Prewarm failed for %s: %s", chapter_num, exc)

    await asyncio.gather(*(_warm(num) for num in chapter_nums))
    return len(chapter_nums)
