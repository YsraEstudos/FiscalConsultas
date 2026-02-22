from contextlib import asynccontextmanager

import pytest

import backend.services.tipi_service as tipi_module
from backend.config.exceptions import DatabaseError
from backend.services.tipi_service import TipiService


pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_pool_state():
    TipiService._pool = []
    TipiService._pool_lock = None
    yield
    TipiService._pool = []
    TipiService._pool_lock = None


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def fetchall(self):
        return self._rows

    async def fetchone(self):
        return self._rows[0]


class _FakeConn:
    def __init__(self, scripted_rows=None, *, close_error: Exception | None = None):
        self.scripted_rows = list(scripted_rows or [])
        self.executed: list[tuple[str, tuple]] = []
        self.close_error = close_error
        self.closed = False

    async def execute(self, query, params=()):
        self.executed.append((" ".join(str(query).split()), tuple(params)))
        rows = self.scripted_rows.pop(0) if self.scripted_rows else []
        return _FakeCursor(rows)

    async def close(self):
        self.closed = True
        if self.close_error:
            raise self.close_error


class _FakeRepo:
    async def get_by_chapter(self, cap_num):
        return [
            {
                "ncm": "85.17",
                "descricao": "Telefone",
                "aliquota": "0",
                "capitulo": cap_num,
            }
        ]

    async def get_family_positions(self, cap_num, prefix, ancestor_prefixes):
        del prefix, ancestor_prefixes
        return [
            {
                "ncm": "85.17",
                "descricao": "Telefone",
                "aliquota": "0",
                "capitulo": cap_num,
            }
        ]

    async def search_fulltext(self, query, limit):
        del query, limit
        return [{"ncm": "85.17", "descricao": "Telefone"}]

    async def get_all_chapters(self):
        return [{"codigo": "85", "titulo": "Capítulo 85", "secao": "XVI"}]


@pytest.mark.asyncio
async def test_create_with_repository_raises_when_repo_unavailable(monkeypatch):
    monkeypatch.setattr(tipi_module, "_REPO_AVAILABLE", False)
    with pytest.raises(RuntimeError, match="Repository não disponível"):
        await TipiService.create_with_repository()


@pytest.mark.asyncio
async def test_create_with_repository_success_uses_factory(monkeypatch):
    class _RepoFromFactory:
        def __init__(self, session):
            self.session = session

    @asynccontextmanager
    async def _fake_get_session():
        yield "session-1"

    monkeypatch.setattr(tipi_module, "_REPO_AVAILABLE", True)
    monkeypatch.setattr(tipi_module, "get_session", _fake_get_session)
    monkeypatch.setattr(tipi_module, "TipiRepository", _RepoFromFactory)

    service = await TipiService.create_with_repository()
    async with service._get_repo() as repo:
        assert isinstance(repo, _RepoFromFactory)
        assert repo.session == "session-1"


@pytest.mark.asyncio
async def test_get_repo_handles_direct_factory_and_none():
    direct = TipiService(repository="direct-repo")
    async with direct._get_repo() as repo:
        assert repo == "direct-repo"

    @asynccontextmanager
    async def _factory():
        yield "factory-repo"

    from_factory = TipiService(repository_factory=_factory)
    async with from_factory._get_repo() as repo:
        assert repo == "factory-repo"

    no_repo = TipiService()
    async with no_repo._get_repo() as repo:
        assert repo is None


@pytest.mark.asyncio
async def test_get_connection_raises_database_error_when_connect_fails(monkeypatch):
    service = TipiService()

    async def _boom(_path):
        raise RuntimeError("connect failed")

    monkeypatch.setattr(tipi_module.aiosqlite, "connect", _boom)

    with pytest.raises(DatabaseError, match="TIPI DB connection failed"):
        await service._get_connection()


@pytest.mark.asyncio
async def test_release_connection_closes_when_pool_is_full_and_close_fails(monkeypatch):
    service = TipiService()
    conn = _FakeConn(close_error=RuntimeError("close failed"))
    monkeypatch.setattr(service, "_pool_max_size", 0)

    await service._release_connection(conn)
    assert conn.closed is True


@pytest.mark.asyncio
async def test_close_handles_pool_connection_close_errors():
    service = TipiService()
    failing_conn = _FakeConn(close_error=RuntimeError("boom"))
    TipiService._pool = [failing_conn]

    await service.close()

    assert TipiService._pool == []
    assert failing_conn.closed is True


@pytest.mark.asyncio
async def test_check_connection_returns_error_when_db_missing(tmp_path):
    service = TipiService(db_path=tmp_path / "missing-tipi.db")
    payload = await service.check_connection()
    assert payload["ok"] is False
    assert "Banco TIPI não encontrado" in payload["error"]


@pytest.mark.asyncio
async def test_check_connection_returns_error_when_query_fails(tmp_path, monkeypatch):
    db_file = tmp_path / "tipi.db"
    db_file.write_text("x", encoding="utf-8")
    service = TipiService(db_path=db_file)

    async def _boom():
        raise RuntimeError("db broken")

    monkeypatch.setattr(service, "_get_connection", _boom)
    payload = await service.check_connection()

    assert payload["ok"] is False
    assert "db broken" in payload["error"]


@pytest.mark.asyncio
async def test_get_table_columns_uses_cache(monkeypatch):
    service = TipiService()
    conn = _FakeConn(scripted_rows=[[{"name": "ncm_sort"}, {"name": "ncm"}]])

    first = await service._get_table_columns(conn, "tipi_positions")
    second = await service._get_table_columns(conn, "tipi_positions")

    assert first == {"ncm_sort", "ncm"}
    assert second == {"ncm_sort", "ncm"}
    assert len(conn.executed) == 1


@pytest.mark.asyncio
async def test_get_chapter_positions_repository_mode_normalizes_and_evicts(monkeypatch):
    service = TipiService(repository=_FakeRepo())
    monkeypatch.setattr(tipi_module.CacheConfig, "TIPI_CHAPTER_CACHE_SIZE", 0)

    rows = await service._get_chapter_positions("85")
    assert rows[0]["capitulo"] == "85"
    assert rows[0]["nivel"] == 0
    assert service._chapter_positions_cache == {}


@pytest.mark.asyncio
async def test_get_chapter_positions_sqlite_mode_evicts_cache(monkeypatch):
    service = TipiService()
    conn = _FakeConn(
        scripted_rows=[
            [{"name": "ncm_sort"}],
            [
                {
                    "ncm": "85.17",
                    "capitulo": "85",
                    "descricao": "Telefone",
                    "aliquota": "0",
                    "nivel": 1,
                }
            ],
        ]
    )

    async def _fake_get_connection():
        return conn

    async def _fake_release(_conn):
        return None

    monkeypatch.setattr(service, "_get_connection", _fake_get_connection)
    monkeypatch.setattr(service, "_release_connection", _fake_release)
    monkeypatch.setattr(tipi_module.CacheConfig, "TIPI_CHAPTER_CACHE_SIZE", 0)

    rows = await service._get_chapter_positions("85")
    assert len(rows) == 1
    assert service._chapter_positions_cache == {}


@pytest.mark.asyncio
async def test_get_family_positions_repository_mode():
    service = TipiService(repository=_FakeRepo())
    rows = await service._get_family_positions("85", "8517", {"8517"})
    assert len(rows) == 1
    assert rows[0]["capitulo"] == "85"


@pytest.mark.asyncio
async def test_search_by_code_handles_multi_part_merge_with_same_chapter(monkeypatch):
    service = TipiService()

    async def _fake_family(cap_num, prefix, ancestors):
        del prefix, ancestors
        return (
            {
                "ncm": "85.17",
                "capitulo": cap_num,
                "descricao": "Telefone",
                "aliquota": "0",
                "nivel": 1,
            },
        )

    async def _fake_chapter(cap_num):
        return (
            {
                "ncm": "85.10",
                "capitulo": cap_num,
                "descricao": "Outro item",
                "aliquota": "5",
                "nivel": 1,
            },
        )

    monkeypatch.setattr(service, "_get_family_positions", _fake_family)
    monkeypatch.setattr(service, "_get_chapter_positions", _fake_chapter)

    payload = await service.search_by_code("85,8517", view_mode="family")

    cap = payload["resultados"]["85"]
    assert payload["total"] == 2
    assert len(cap["posicoes"]) == 2
    assert {p["ncm"] for p in cap["posicoes"]} == {"85.10", "85.17"}


@pytest.mark.asyncio
async def test_search_by_code_returns_empty_when_query_has_no_digits(monkeypatch):
    service = TipiService()
    monkeypatch.setattr(tipi_module.ncm_utils, "format_ncm_tipi", lambda _value: "")
    monkeypatch.setattr(tipi_module.ncm_utils, "clean_ncm", lambda _value: "")

    payload = await service.search_by_code("abc")

    assert payload["total"] == 0
    assert payload["resultados"] == {}


@pytest.mark.asyncio
async def test_search_by_code_evicts_code_cache_when_limit_is_zero(monkeypatch):
    service = TipiService()

    async def _fake_chapter_positions(_cap_num):
        return (
            {
                "ncm": "85.17",
                "capitulo": "85",
                "descricao": "Telefone",
                "aliquota": "0",
                "nivel": 1,
            },
        )

    monkeypatch.setattr(service, "_get_chapter_positions", _fake_chapter_positions)
    monkeypatch.setattr(tipi_module.CacheConfig, "TIPI_RESULT_CACHE_SIZE", 0)

    payload = await service.search_by_code("85")
    assert payload["total"] == 1
    assert service._code_search_cache == {}


@pytest.mark.asyncio
async def test_search_text_repository_mode_returns_repo_payload():
    service = TipiService(repository=_FakeRepo())
    payload = await service.search_text("telefone", limit=10)
    assert payload["type"] == "text"
    assert payload["total"] == 1
    assert payload["results"][0]["ncm"] == "85.17"


@pytest.mark.asyncio
async def test_search_text_sqlite_mode_runs_and_query_fallback(monkeypatch):
    service = TipiService()
    conn = _FakeConn(
        scripted_rows=[
            [
                {
                    "ncm": "85.17",
                    "capitulo": "85",
                    "descricao": "Telefone",
                    "aliquota": None,
                }
            ],
            [
                {
                    "ncm": "84.13",
                    "capitulo": "84",
                    "descricao": "Bomba",
                    "aliquota": "0",
                },
                {
                    "ncm": "84.14",
                    "capitulo": "84",
                    "descricao": "Compressor",
                    "aliquota": "0",
                },
            ],
        ]
    )

    async def _fake_get_connection():
        return conn

    async def _fake_release(_conn):
        return None

    monkeypatch.setattr(service, "_get_connection", _fake_get_connection)
    monkeypatch.setattr(service, "_release_connection", _fake_release)

    payload = await service.search_text("motor bomba", limit=10)

    assert payload["total"] == 2
    assert payload["results"][0]["ncm"] == "84.13"
    assert any(params and "AND" in str(params[0]) for _query, params in conn.executed)


@pytest.mark.asyncio
async def test_get_all_chapters_repository_and_sqlite_modes(monkeypatch):
    repo_service = TipiService(repository=_FakeRepo())
    repo_payload = await repo_service.get_all_chapters()
    assert repo_payload == [{"codigo": "85", "titulo": "Capítulo 85", "secao": "XVI"}]

    sqlite_service = TipiService()
    conn = _FakeConn(
        scripted_rows=[[{"codigo": "01", "titulo": "Animais", "secao": "I"}]]
    )

    async def _fake_get_connection():
        return conn

    async def _fake_release(_conn):
        return None

    monkeypatch.setattr(sqlite_service, "_get_connection", _fake_get_connection)
    monkeypatch.setattr(sqlite_service, "_release_connection", _fake_release)

    sqlite_payload = await sqlite_service.get_all_chapters()
    assert sqlite_payload == [{"codigo": "01", "titulo": "Animais", "secao": "I"}]


@pytest.mark.asyncio
async def test_get_internal_cache_metrics_reports_snapshots():
    service = TipiService()
    service._code_search_cache[("85", "family")] = {"ok": True}
    service._chapter_positions_cache["85"] = ({"ncm": "85.17"},)
    service._code_search_cache_metrics.record_hit()
    service._chapter_positions_cache_metrics.record_miss()

    payload = await service.get_internal_cache_metrics()

    assert payload["code_search_cache"]["current_size"] == 1
    assert payload["code_search_cache"]["hits"] >= 1
    assert payload["chapter_positions_cache"]["current_size"] == 1
    assert payload["chapter_positions_cache"]["misses"] >= 1
