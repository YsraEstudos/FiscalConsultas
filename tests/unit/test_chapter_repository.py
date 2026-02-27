from types import SimpleNamespace

import pytest
from backend.infrastructure.repositories.chapter_repository import ChapterRepository

pytestmark = pytest.mark.unit


class _FakeScalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeResult:
    def __init__(self, *, scalar_one=None, scalars=None, rows=None):
        self._scalar_one = scalar_one
        self._scalars = scalars or []
        self._rows = rows or []

    def unique(self):
        return self

    def scalar_one_or_none(self):
        return self._scalar_one

    def scalars(self):
        return _FakeScalars(self._scalars)

    def __iter__(self):
        return iter(self._rows)


class _FakeSession:
    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    async def execute(self, stmt, params=None):
        self.calls.append((stmt, params))
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_get_by_num_returns_loaded_chapter_and_applies_tenant_filter(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    chapter = SimpleNamespace(chapter_num="85", content="x", positions=[], notes=None)
    session = _FakeSession([_FakeResult(scalar_one=chapter)])
    repo = ChapterRepository(session, tenant_id="org_x")

    got = await repo.get_by_num("85")
    assert got is chapter
    stmt, _ = session.calls[0]
    assert "tenant_id" in str(stmt)


@pytest.mark.asyncio
async def test_get_by_num_as_read_returns_none_when_missing(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    session = _FakeSession([_FakeResult(scalar_one=None)])
    repo = ChapterRepository(session)

    got = await repo.get_by_num_as_read("99")
    assert got is None


def test_to_read_model_maps_positions_and_notes_with_anchor_fallback(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    repo = ChapterRepository(_FakeSession([]))

    chapter = SimpleNamespace(
        chapter_num="85",
        content="Conteudo",
        positions=[
            SimpleNamespace(codigo="85.17", descricao="Telefone", anchor_id=None),
            SimpleNamespace(
                codigo="85.18", descricao="Audio", anchor_id="custom-anchor"
            ),
        ],
        notes=SimpleNamespace(
            notes_content="Notas",
            titulo="Titulo",
            notas="n1",
            consideracoes="c1",
            definicoes="d1",
        ),
    )

    out = repo._to_read_model(chapter)
    assert out.chapter_num == "85"
    assert len(out.positions) == 2
    assert out.positions[0].anchor_id == "pos-85-17"
    assert out.positions[1].anchor_id == "custom-anchor"
    assert out.notes and out.notes.titulo == "Titulo"


@pytest.mark.asyncio
async def test_get_all_nums_returns_scalar_list(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    session = _FakeSession([_FakeResult(scalars=["01", "85"])])
    repo = ChapterRepository(session)

    got = await repo.get_all_nums()
    assert got == ["01", "85"]


@pytest.mark.asyncio
async def test_search_fulltext_dispatches_by_engine(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "postgresql",
    )
    repo = ChapterRepository(_FakeSession([]))
    called = {}

    async def _pg(_q, _l):
        called["pg"] = True
        return []

    async def _sqlite(_q, _l):
        called["sqlite"] = True
        return []

    monkeypatch.setattr(repo, "_fts_postgres", _pg)
    monkeypatch.setattr(repo, "_fts_sqlite", _sqlite)
    await repo.search_fulltext("motor", 5)
    assert called == {"pg": True}

    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    repo2 = ChapterRepository(_FakeSession([]))
    called.clear()
    monkeypatch.setattr(repo2, "_fts_postgres", _pg)
    monkeypatch.setattr(repo2, "_fts_sqlite", _sqlite)
    await repo2.search_fulltext("motor", 5)
    assert called == {"sqlite": True}


@pytest.mark.asyncio
async def test_fts_postgres_maps_rows_and_tenant_params(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "postgresql",
    )
    rows = [
        SimpleNamespace(
            ncm="85.17",
            display_text="Tel",
            type="position",
            description="Desc",
            score=0.5,
        )
    ]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = ChapterRepository(session, tenant_id="org_pg")

    out = await repo._fts_postgres("telefone", 3)
    assert len(out) == 1
    assert out[0].score == pytest.approx(50.0)
    stmt, params = session.calls[0]
    assert "tenant_id" in str(stmt)
    assert params == {"query": "telefone", "limit": 3, "tenant_id": "org_pg"}


@pytest.mark.asyncio
async def test_fts_sqlite_maps_rank(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    rows = [
        SimpleNamespace(
            ncm="85.17",
            display_text="Tel",
            type="position",
            description="Desc",
            rank=-1.2,
        )
    ]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = ChapterRepository(session)

    out = await repo._fts_sqlite("telefone", 9)
    assert len(out) == 1
    assert out[0].score == pytest.approx(12.0)
    _stmt, params = session.calls[0]
    assert params == {"query": "telefone", "limit": 9}


@pytest.mark.asyncio
async def test_search_scored_applies_tier_base_and_coverage_bonus(monkeypatch):
    monkeypatch.setattr(
        "backend.infrastructure.repositories.chapter_repository.settings.database.engine",
        "sqlite",
    )
    repo = ChapterRepository(_FakeSession([]))

    async def _fake_search(_q, _limit):
        return [SimpleNamespace(score=10.0, tier=0), SimpleNamespace(score=1.0, tier=0)]

    monkeypatch.setattr(repo, "search_fulltext", _fake_search)
    out = await repo.search_scored(
        "abc", tier=2, limit=20, words_matched=2, total_words=4
    )

    # Base tier=2 -> 500, coverage bonus=50
    assert out[0].score == pytest.approx(560.0)
    assert out[1].score == pytest.approx(551.0)
    assert all(item.tier == 2 for item in out)
