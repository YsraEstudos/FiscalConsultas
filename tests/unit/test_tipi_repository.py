from types import SimpleNamespace

import pytest

from backend.infrastructure.repositories.tipi_repository import TipiRepository


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


class _RowMapping:
    def __init__(self, mapping):
        self._mapping = mapping


@pytest.mark.asyncio
async def test_get_by_codigo_returns_scalar(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    expected = object()
    session = _FakeSession([_FakeResult(scalar_one=expected)])
    repo = TipiRepository(session)

    got = await repo.get_by_codigo("8517")
    assert got is expected


@pytest.mark.asyncio
async def test_get_by_chapter_maps_defaults_and_anchor(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    positions = [
        SimpleNamespace(codigo="85.17", chapter_num="85", descricao="Telefone", aliquota=None, nivel=None, parent_ncm=None),
        SimpleNamespace(codigo="85.18", chapter_num="85", descricao="Audio", aliquota="5", nivel=2, parent_ncm="85"),
    ]
    session = _FakeSession([_FakeResult(scalars=positions)])
    repo = TipiRepository(session)

    out = await repo.get_by_chapter("85")
    assert len(out) == 2
    assert out[0]["aliquota"] == "0"
    assert out[0]["nivel"] == 0
    assert out[0]["anchor_id"] == "pos-85-17"
    assert out[1]["aliquota"] == "5"


@pytest.mark.asyncio
async def test_get_family_positions_postgres_builds_named_params(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "postgresql")
    rows = [
        SimpleNamespace(codigo="85.17.10", chapter_num="85", descricao="Desc", aliquota=None, nivel=1, parent_ncm=None),
    ]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = TipiRepository(session)

    out = await repo.get_family_positions("85", "8517", {"85", "851"})
    assert len(out) == 1
    assert out[0]["anchor_id"] == "pos-85-17-10"
    stmt, params = session.calls[0]
    assert "tipi_positions" in str(stmt)
    assert params["chapter_num"] == "85"
    assert params["prefix"] == "8517"
    assert any(k.startswith("ancestor") for k in params)


@pytest.mark.asyncio
async def test_get_family_positions_sqlite_builds_tuple_params(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    rows = [
        SimpleNamespace(codigo="85.17.10", chapter_num="85", descricao="Desc", aliquota="10", nivel=2, parent_ncm="85"),
    ]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = TipiRepository(session)

    out = await repo.get_family_positions("85", "8517", {"85"})
    assert len(out) == 1
    assert out[0]["aliquota"] == "10"
    _stmt, params = session.calls[0]
    assert isinstance(params, tuple)
    assert params[0] == "85"
    assert params[1] == "8517"


@pytest.mark.asyncio
async def test_search_fulltext_dispatches_by_engine(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "postgresql")
    repo = TipiRepository(_FakeSession([]))
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

    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    repo2 = TipiRepository(_FakeSession([]))
    called.clear()
    monkeypatch.setattr(repo2, "_fts_postgres", _pg)
    monkeypatch.setattr(repo2, "_fts_sqlite", _sqlite)
    await repo2.search_fulltext("motor", 5)
    assert called == {"sqlite": True}


@pytest.mark.asyncio
async def test_fts_postgres_maps_rows(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "postgresql")
    rows = [SimpleNamespace(ncm="8517", capitulo="85", descricao="Desc", aliquota=None)]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = TipiRepository(session)

    out = await repo._fts_postgres("motor", 11)
    assert out == [{"ncm": "8517", "capitulo": "85", "descricao": "Desc", "aliquota": "0"}]
    _stmt, params = session.calls[0]
    assert params == {"query": "motor", "limit": 11}


@pytest.mark.asyncio
async def test_fts_sqlite_quotes_query(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    rows = [SimpleNamespace(ncm="8517", capitulo="85", descricao="Desc", aliquota="7")]
    session = _FakeSession([_FakeResult(rows=rows)])
    repo = TipiRepository(session)

    out = await repo._fts_sqlite("motor eletrico", 4)
    assert out == [{"ncm": "8517", "capitulo": "85", "descricao": "Desc", "aliquota": "7"}]
    _stmt, params = session.calls[0]
    assert params == {"query": '"motor eletrico"', "limit": 4}


@pytest.mark.asyncio
async def test_get_all_chapters_supports_postgres_and_sqlite(monkeypatch):
    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "postgresql")
    pg_rows = [_RowMapping({"codigo": "85", "titulo": "85"})]
    session_pg = _FakeSession([_FakeResult(rows=pg_rows)])
    repo_pg = TipiRepository(session_pg)
    out_pg = await repo_pg.get_all_chapters()
    assert out_pg == [{"codigo": "85", "titulo": "85"}]

    monkeypatch.setattr("backend.infrastructure.repositories.tipi_repository.settings.database.engine", "sqlite")
    sqlite_rows = [_RowMapping({"codigo": "01", "titulo": "Animais", "secao": "I"})]
    session_sqlite = _FakeSession([_FakeResult(rows=sqlite_rows)])
    repo_sqlite = TipiRepository(session_sqlite)
    out_sqlite = await repo_sqlite.get_all_chapters()
    assert out_sqlite == [{"codigo": "01", "titulo": "Animais", "secao": "I"}]

