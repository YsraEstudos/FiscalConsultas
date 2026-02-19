from contextlib import asynccontextmanager

import pytest

import backend.services.nesh_service as nesh_service_module
from backend.services.nesh_service import NeshService


pytestmark = pytest.mark.unit


class _FakeDb:
    def __init__(self, chapters=None, *, fts_rows=None, near_rows=None):
        self._chapters = chapters or {}
        self._fts_rows = fts_rows or []
        self._near_rows = near_rows or []
        self.chapter_calls = 0
        self.fts_calls = 0

    async def get_chapter_raw(self, chapter_num: str):
        self.chapter_calls += 1
        payload = self._chapters.get(chapter_num)
        if payload is None:
            return None
        return dict(payload)

    async def fts_search_scored(self, query, tier, limit, words_matched, total_words):
        del query, tier, limit, words_matched, total_words
        self.fts_calls += 1
        return list(self._fts_rows)

    async def fts_search_near(self, stemmed_words, distance, limit):
        del stemmed_words, distance, limit
        return list(self._near_rows)

    async def get_all_chapters_list(self):
        return list(self._chapters.keys())


def _disable_redis(monkeypatch):
    monkeypatch.setattr(nesh_service_module.redis_cache, "_client", None)


@pytest.mark.asyncio
async def test_create_with_repository_raises_when_repo_is_unavailable(monkeypatch):
    monkeypatch.setattr(nesh_service_module, "_REPO_AVAILABLE", False)
    with pytest.raises(RuntimeError, match="Repository não disponível"):
        await NeshService.create_with_repository()


def test_fts_cache_key_is_deterministic():
    key_a = NeshService._fts_cache_key("foo", 1, 10, 2, 3)
    key_b = NeshService._fts_cache_key("foo", 1, 10, 2, 3)
    key_c = NeshService._fts_cache_key("foo", 2, 10, 2, 3)

    assert key_a == key_b
    assert key_a != key_c


@pytest.mark.asyncio
async def test_get_repo_supports_repository_factory_and_none():
    service_with_repo = NeshService(repository="repo-instance")
    async with service_with_repo._get_repo() as repo:
        assert repo == "repo-instance"

    @asynccontextmanager
    async def _factory():
        yield "repo-from-factory"

    service_with_factory = NeshService(repository_factory=_factory)
    async with service_with_factory._get_repo() as repo:
        assert repo == "repo-from-factory"

    service_without_repo = NeshService(db=_FakeDb())
    async with service_without_repo._get_repo() as repo:
        assert repo is None


def test_strip_chapter_preamble_and_parse_notes():
    content = "Capítulo 85\nNotas iniciais\n85.17 - Conteúdo principal"
    stripped = NeshService._strip_chapter_preamble(content)
    assert stripped.startswith("85.17 -")

    assert NeshService._strip_chapter_preamble("") == ""
    assert (
        NeshService._strip_chapter_preamble("Sem posição NCM aqui")
        == "Sem posição NCM aqui"
    )

    service = NeshService(db=_FakeDb())
    parsed = service.parse_chapter_notes("1 - Nota um\ncontinua\n2. Nota dois")
    assert parsed["1"].startswith("1 - Nota um")
    assert parsed["2"].startswith("2. Nota dois")
    assert service.parse_chapter_notes("") == {}


@pytest.mark.asyncio
async def test_fetch_chapter_data_populates_cache_and_reuses_cached_value(monkeypatch):
    _disable_redis(monkeypatch)
    db = _FakeDb(
        chapters={
            "85": {
                "chapter_num": "85",
                "content": "85.17 - Conteúdo",
                "notes": "1 - Nota principal",
                "parsed_notes_json": None,
                "positions": [{"codigo": "85.17", "descricao": "Posição"}],
                "sections": None,
            }
        }
    )
    service = NeshService(db=db)

    first = await service.fetch_chapter_data("85")
    second = await service.fetch_chapter_data("85")

    assert db.chapter_calls == 1
    assert first == second
    assert first["positions"][0]["anchor_id"] == "pos-85-17"
    assert "1" in first["parsed_notes"]


@pytest.mark.asyncio
async def test_fetch_chapter_data_uses_precomputed_json_and_fallback_parse(monkeypatch):
    _disable_redis(monkeypatch)
    db = _FakeDb(
        chapters={
            "85": {
                "chapter_num": "85",
                "content": "85.17 - Conteúdo",
                "notes": "1 - Nota de fallback",
                "parsed_notes_json": b'{"1":"precomputada"}',
                "positions": [{"codigo": "85.17", "descricao": "Posição"}],
                "sections": None,
            },
            "86": {
                "chapter_num": "86",
                "content": "86.01 - Conteúdo",
                "notes": "1 - Nota de fallback",
                "parsed_notes_json": "{json invalido",
                "positions": [{"codigo": "86.01", "descricao": "Posição"}],
                "sections": None,
            },
        }
    )
    service = NeshService(db=db)

    chapter_85 = await service.fetch_chapter_data("85")
    chapter_86 = await service.fetch_chapter_data("86")

    assert chapter_85["parsed_notes"] == {"1": "precomputada"}
    assert chapter_86["parsed_notes"]["1"].startswith("1 - Nota de fallback")


@pytest.mark.asyncio
async def test_fetch_chapter_data_raises_when_db_adapter_is_missing(monkeypatch):
    _disable_redis(monkeypatch)
    service = NeshService(db=None)
    with pytest.raises(RuntimeError, match="DatabaseAdapter não configurado"):
        await service.fetch_chapter_data("85")


def test_normalize_query_and_normalize_query_raw_apply_filters(monkeypatch):
    service = NeshService(db=_FakeDb())

    tokens = " ".join(f"w{i}*" for i in range(30))
    monkeypatch.setattr(
        service.processor, "process_query_for_fts", lambda _text: f"{tokens} w1*"
    )
    normalized = service.normalize_query("qualquer")
    assert len(normalized.split()) == 20
    assert normalized.split()[1] == "w1*"

    monkeypatch.setattr(
        service.processor, "normalize", lambda _text: "de a x motor motor bomba"
    )
    monkeypatch.setattr(service.processor, "stopwords", {"de", "a"})
    normalized_raw = service.normalize_query_raw("qualquer")
    assert normalized_raw == "motor* bomba*"


@pytest.mark.asyncio
async def test_fts_scored_cached_uses_db_once_and_then_hits_memory_cache(monkeypatch):
    _disable_redis(monkeypatch)
    db = _FakeDb(
        fts_rows=[
            {
                "ncm": "85.17",
                "display_text": "85.17 - Telefones",
                "type": "position",
                "description": "desc",
                "rank": 100,
            }
        ]
    )
    service = NeshService(db=db)

    first = await service._fts_scored_cached(
        "foo*", tier=2, limit=10, words_matched=1, total_words=1
    )
    second = await service._fts_scored_cached(
        "foo*", tier=2, limit=10, words_matched=1, total_words=1
    )

    assert db.fts_calls == 1
    assert first == second

    service_without_db = NeshService(db=None)
    _disable_redis(monkeypatch)
    with pytest.raises(RuntimeError, match="DatabaseAdapter não configurado"):
        await service_without_db._fts_scored_cached(
            "foo*", tier=2, limit=10, words_matched=1, total_words=1
        )


@pytest.mark.asyncio
async def test_search_full_text_returns_none_match_when_query_becomes_empty(
    monkeypatch,
):
    service = NeshService(db=_FakeDb())
    monkeypatch.setattr(service, "normalize_query", lambda _query: "")
    monkeypatch.setattr(service, "normalize_query_raw", lambda _query: "")

    payload = await service.search_full_text("x")

    assert payload["match_type"] == "none"
    assert payload["results"] == []
    assert payload["warning"] is None


@pytest.mark.asyncio
async def test_search_full_text_combines_tiers_and_applies_near_bonus(monkeypatch):
    _disable_redis(monkeypatch)
    db = _FakeDb(
        near_rows=[{"ncm": "85.17"}],
    )
    service = NeshService(db=db)

    monkeypatch.setattr(service, "normalize_query", lambda _query: "motor* bomba*")
    monkeypatch.setattr(service, "normalize_query_raw", lambda _query: "motor* bomba*")
    monkeypatch.setattr(
        service.processor, "process_query_exact", lambda _query: "motor bomba"
    )
    monkeypatch.setattr(
        service.processor, "process_query_for_fts", lambda word: f"{word.lower()}*"
    )

    async def _fake_fts(query, tier, limit, words_matched, total_words):
        del limit, words_matched, total_words
        if tier == 1:
            return [
                {
                    "ncm": "85.17",
                    "display_text": "85.17 - Telefones",
                    "type": "position",
                    "description": "A",
                    "score": 1000,
                    "tier": 1,
                    "rank": 1000,
                }
            ]
        if tier == 2:
            return [
                {
                    "ncm": "85.17",
                    "display_text": "85.17 - Telefones",
                    "type": "position",
                    "description": "A",
                    "score": 500,
                    "tier": 2,
                    "rank": 500,
                },
                {
                    "ncm": "84.13",
                    "display_text": "84.13 - Bombas",
                    "type": "position",
                    "description": "B",
                    "score": 450,
                    "tier": 2,
                    "rank": 450,
                },
            ]
        if tier == 3 and "OR" in query:
            return [
                {
                    "ncm": "73.18",
                    "display_text": "73.18 - Parafusos",
                    "type": "position",
                    "description": "C",
                    "score": 200,
                    "tier": 3,
                    "rank": 200,
                }
            ]
        return []

    monkeypatch.setattr(service, "_fts_scored_cached", _fake_fts)

    payload = await service.search_full_text("motor bomba")

    assert payload["match_type"] == "exact"
    assert payload["warning"] is None
    assert len(payload["results"]) == 3
    assert any(item["near_bonus"] for item in payload["results"])


@pytest.mark.asyncio
async def test_search_full_text_returns_warning_when_no_results(monkeypatch):
    service = NeshService(db=_FakeDb())
    monkeypatch.setattr(service, "normalize_query", lambda _query: "foo*")
    monkeypatch.setattr(service, "normalize_query_raw", lambda _query: "foo*")
    monkeypatch.setattr(service.processor, "process_query_exact", lambda _query: "foo")
    monkeypatch.setattr(service.processor, "process_query_for_fts", lambda _word: None)

    async def _empty_fts(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "_fts_scored_cached", _empty_fts)

    payload = await service.search_full_text("foo")

    assert payload["match_type"] == "none"
    assert "Nenhum resultado encontrado" in payload["warning"]
    assert payload["results"] == []


@pytest.mark.asyncio
async def test_search_by_code_builds_found_and_not_found_chapters(monkeypatch):
    service = NeshService(db=_FakeDb())

    monkeypatch.setattr(
        nesh_service_module.ncm_utils,
        "split_ncm_query",
        lambda _query: ["8517", "invalido", "7301"],
    )
    monkeypatch.setattr(
        nesh_service_module.ncm_utils,
        "extract_chapter_from_ncm",
        lambda value: {
            "8517": ("85", "85.17"),
            "invalido": (None, None),
            "7301": ("73", "73.01"),
        }[value],
    )

    async def _fake_fetch(chapter_num):
        if chapter_num == "85":
            return {
                "content": "Preâmbulo\n85.17 - Corpo",
                "positions": [{"codigo": "85.17", "descricao": "Telefone"}],
                "notes": "1 - Nota",
                "parsed_notes": {"1": "nota"},
                "sections": {
                    "titulo": "Titulo",
                    "notas": "",
                    "consideracoes": "",
                    "definicoes": "",
                },
            }
        return None

    monkeypatch.setattr(service, "fetch_chapter_data", _fake_fetch)

    payload = await service.search_by_code("8517,invalido,7301")

    assert payload["type"] == "code"
    assert payload["total_capitulos"] == 2
    assert payload["results"]["85"]["real_content_found"] is True
    assert payload["results"]["85"]["conteudo"].startswith("85.17 - Corpo")
    assert payload["results"]["73"]["real_content_found"] is False
    assert "não encontrado" in payload["results"]["73"]["erro"]


@pytest.mark.asyncio
async def test_process_request_dispatches_between_code_and_text(monkeypatch):
    service = NeshService(db=_FakeDb())

    async def _search_by_code(_query):
        return {"origin": "code"}

    async def _search_full_text(_query):
        return {"origin": "text"}

    monkeypatch.setattr(service, "search_by_code", _search_by_code)
    monkeypatch.setattr(service, "search_full_text", _search_full_text)

    monkeypatch.setattr(
        nesh_service_module.ncm_utils, "is_code_query", lambda _query: True
    )
    assert await service.process_request("8517") == {"origin": "code"}

    monkeypatch.setattr(
        nesh_service_module.ncm_utils, "is_code_query", lambda _query: False
    )
    assert await service.process_request("telefone") == {"origin": "text"}


@pytest.mark.asyncio
async def test_prewarm_cache_covers_empty_sources_and_exception_path(monkeypatch):
    service_without_sources = NeshService(db=None)
    assert await service_without_sources.prewarm_cache() == 0

    service = NeshService(db=_FakeDb())
    calls = []

    async def _fake_fetch(chapter_num):
        calls.append(chapter_num)
        if chapter_num == "02":
            raise RuntimeError("boom")

    monkeypatch.setattr(service, "fetch_chapter_data", _fake_fetch)
    warmed = await service.prewarm_cache(["01", "02", "03"], concurrency=2)

    assert warmed == 3
    assert calls == ["01", "02", "03"]


@pytest.mark.asyncio
async def test_get_internal_cache_metrics_returns_current_snapshots():
    service = NeshService(db=_FakeDb())
    service._chapter_cache["85"] = {"dummy": True}
    service._fts_cache[("q", 1, 10, 1, 1)] = [{"ncm": "85.17"}]
    service._chapter_cache_metrics.record_hit()
    service._fts_cache_metrics.record_miss()

    payload = await service.get_internal_cache_metrics()

    assert payload["chapter_cache"]["current_size"] == 1
    assert payload["chapter_cache"]["hits"] >= 1
    assert payload["fts_cache"]["current_size"] == 1
    assert payload["fts_cache"]["misses"] >= 1
