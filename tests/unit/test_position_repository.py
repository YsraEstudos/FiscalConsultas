from types import SimpleNamespace

import pytest

from backend.infrastructure.db_engine import tenant_context
from backend.infrastructure.repositories.position_repository import PositionRepository


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


def test_init_uses_tenant_context_when_tenant_not_passed(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    token = tenant_context.set("org_ctx")
    try:
        repo = PositionRepository(_FakeSession([]))
        assert repo.tenant_id == "org_ctx"
    finally:
        tenant_context.reset(token)


@pytest.mark.asyncio
async def test_get_by_codigo_returns_scalar_and_applies_tenant_filter(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    obj = object()
    session = _FakeSession([_FakeResult(scalar_one=obj)])
    repo = PositionRepository(session, tenant_id="org_x")

    got = await repo.get_by_codigo("8517.12.31")
    assert got is obj
    assert len(session.calls) == 1
    stmt, _ = session.calls[0]
    assert "tenant_id" in str(stmt)


@pytest.mark.asyncio
async def test_get_by_chapter_maps_to_position_read(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    positions = [
        SimpleNamespace(codigo="85.17", descricao="Telefone"),
        SimpleNamespace(codigo="85.18", descricao="Microfone"),
    ]
    session = _FakeSession([_FakeResult(scalars=positions)])
    repo = PositionRepository(session)

    items = await repo.get_by_chapter("85")
    assert [i.codigo for i in items] == ["85.17", "85.18"]
    assert items[0].anchor_id == "pos-85-17"
    stmt, _ = session.calls[0]
    assert "positions.chapter_num" in str(stmt)


@pytest.mark.asyncio
async def test_search_by_prefix_normalizes_prefix_and_respects_limit(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    session = _FakeSession([_FakeResult(scalars=[SimpleNamespace(codigo="8517.10.00", descricao="Desc")])])
    repo = PositionRepository(session, tenant_id="org_x")

    items = await repo.search_by_prefix("85.17", limit=12)
    assert len(items) == 1
    assert items[0].anchor_id == "pos-8517-10-00"
    stmt, _ = session.calls[0]
    stmt_text = str(stmt)
    assert "LIKE" in stmt_text
    assert "LIMIT" in stmt_text
    assert "tenant_id" in stmt_text


@pytest.mark.asyncio
async def test_search_fulltext_dispatches_by_engine(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "postgresql")
    repo = PositionRepository(_FakeSession([]))

    called = {}

    async def _pg(_query, _limit):
        called["pg"] = True
        return []

    async def _sqlite(_query, _limit):
        called["sqlite"] = True
        return []

    monkeypatch.setattr(repo, "_fts_postgres", _pg)
    monkeypatch.setattr(repo, "_fts_sqlite", _sqlite)
    await repo.search_fulltext("motor", 5)
    assert called == {"pg": True}

    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    repo2 = PositionRepository(_FakeSession([]))
    called.clear()
    monkeypatch.setattr(repo2, "_fts_postgres", _pg)
    monkeypatch.setattr(repo2, "_fts_sqlite", _sqlite)
    await repo2.search_fulltext("motor", 5)
    assert called == {"sqlite": True}


@pytest.mark.asyncio
async def test_fts_postgres_maps_score_and_sends_tenant_param(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "postgresql")
    rows = [SimpleNamespace(ncm="8517", display_text="Display", type="position", description="Desc", score=0.42)]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = PositionRepository(session, tenant_id="org_pg")

    items = await repo._fts_postgres("motor", 7)
    assert len(items) == 1
    assert items[0].score == 42.0
    stmt, params = session.calls[0]
    assert "tenant_id" in str(stmt)
    assert params == {"query": "motor", "limit": 7, "tenant_id": "org_pg"}


@pytest.mark.asyncio
async def test_fts_sqlite_maps_rank_to_positive_score(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.position_repository.settings.database.engine", "sqlite")
    rows = [SimpleNamespace(ncm="8517", display_text="Display", type="position", description="Desc", rank=-2.5)]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = PositionRepository(session)

    items = await repo._fts_sqlite("motor", 3)
    assert len(items) == 1
    assert items[0].score == 25.0
    _stmt, params = session.calls[0]
    assert params == {"query": "motor", "limit": 3}

