import builtins
from contextlib import asynccontextmanager
from types import SimpleNamespace

import backend.infrastructure.db_engine as db_engine
import backend.server.app as app_module
import backend.services.nesh_service as nesh_service_module
import pytest
from starlette.requests import Request
from starlette.responses import Response

pytestmark = pytest.mark.unit


class _FakeDbAdapter:
    def __init__(self, db_path):
        self.db_path = db_path
        self.pool_ready = False
        self.closed = False

    async def _ensure_pool(self):
        self.pool_ready = True

    async def close(self):
        self.closed = True


class _FakeApp:
    def __init__(self):
        self.state = SimpleNamespace()


def _request_for_path(path: str) -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "headers": []})


class _FakeNeshService:
    def __init__(self, db=None):
        self.db = db

    async def prewarm_cache(self):
        return 0

    @classmethod
    async def create_with_repository(cls):
        return cls()


class _FakeTipiService:
    def __init__(self):
        self.mode = "sqlite"
        self.created_repo = False

    @classmethod
    async def create_with_repository(cls):
        obj = cls()
        obj.created_repo = True
        obj.mode = "repo"
        return obj


class _FakeAiService:
    pass


@pytest.fixture
def core_mocks(monkeypatch):
    fake_calls = {
        "glossary": False,
        "frontend": False,
        "redis_closed": False,
        "redis_connected": False,
    }

    async def _redis_close():
        fake_calls["redis_closed"] = True
        app_module.redis_cache._client = None

    async def _redis_connect():
        fake_calls["redis_connected"] = True
        app_module.redis_cache._client = object()

    monkeypatch.setattr(app_module, "AiService", _FakeAiService)
    monkeypatch.setattr(
        app_module,
        "init_glossary",
        lambda _root: fake_calls.__setitem__("glossary", True),
    )
    monkeypatch.setattr(
        app_module,
        "verify_frontend_build",
        lambda _root: fake_calls.__setitem__("frontend", True),
    )
    monkeypatch.setattr(app_module.redis_cache, "close", _redis_close)
    monkeypatch.setattr(app_module.redis_cache, "connect", _redis_connect)

    if hasattr(app_module, "tipi_service_module"):
        monkeypatch.setattr(
            app_module.tipi_service_module, "TipiService", _FakeTipiService
        )
    else:
        monkeypatch.setattr(app_module, "TipiService", _FakeTipiService)

    return fake_calls


@pytest.mark.asyncio
async def test_no_cache_html_sets_headers_for_html_paths_only():
    async def _next(_request):
        return Response("ok")

    html_response = await app_module.no_cache_html(
        _request_for_path("/index.html"), _next
    )
    root_response = await app_module.no_cache_html(_request_for_path("/"), _next)
    api_response = await app_module.no_cache_html(
        _request_for_path("/api/status"), _next
    )

    assert (
        html_response.headers["Cache-Control"]
        == "no-store, no-cache, must-revalidate, max-age=0"
    )
    assert root_response.headers["Pragma"] == "no-cache"
    assert "Cache-Control" not in api_response.headers


@pytest.mark.asyncio
async def test_lifespan_sqlite_init_db_failure_keeps_startup_and_shutdown(
    monkeypatch, core_mocks
):
    fake_db = _FakeDbAdapter("db.sqlite")

    async def _init_db_fail():
        raise RuntimeError("unsupported sqlite extension")

    monkeypatch.setattr(app_module.settings.database, "engine", "sqlite")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(app_module, "DatabaseAdapter", lambda _path: fake_db)
    monkeypatch.setattr(db_engine, "init_db", _init_db_fail)
    monkeypatch.setattr(db_engine, "close_db", lambda: None)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)

    app = _FakeApp()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is False
        assert app.state.service.db is fake_db
        assert app.state.tipi_service.mode == "sqlite"
        assert isinstance(app.state.ai_service, _FakeAiService)
        assert fake_db.pool_ready is True
        assert core_mocks["glossary"] is True
        assert core_mocks["frontend"] is True

    assert fake_db.closed is True
    assert core_mocks["redis_closed"] is True


@pytest.mark.asyncio
async def test_lifespan_sqlite_handles_import_error_for_db_engine(
    monkeypatch, core_mocks
):
    fake_db = _FakeDbAdapter("db.sqlite")

    real_import = builtins.__import__

    def _fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "backend.infrastructure.db_engine" and "init_db" in (fromlist or ()):
            raise ImportError("simulated missing db_engine")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(app_module.settings.database, "engine", "sqlite")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(app_module, "DatabaseAdapter", lambda _path: fake_db)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)
    monkeypatch.setattr(builtins, "__import__", _fake_import)

    app = _FakeApp()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is False
        assert fake_db.pool_ready is True

    assert fake_db.closed is True


@pytest.mark.asyncio
async def test_lifespan_sqlite_init_db_success_closes_sqlmodel_engine(
    monkeypatch, core_mocks
):
    fake_db = _FakeDbAdapter("db.sqlite")
    close_db_called = {"value": False}

    async def _init_db_ok():
        return None

    async def _close_db_ok():
        close_db_called["value"] = True

    monkeypatch.setattr(app_module.settings.database, "engine", "sqlite")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(app_module, "DatabaseAdapter", lambda _path: fake_db)
    monkeypatch.setattr(db_engine, "init_db", _init_db_ok)
    monkeypatch.setattr(db_engine, "close_db", _close_db_ok)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)

    app = _FakeApp()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is True

    assert fake_db.closed is True
    assert close_db_called["value"] is True


@pytest.mark.asyncio
async def test_lifespan_postgres_redis_prewarm_failure_and_tipi_repository(
    monkeypatch, core_mocks
):
    class _FailingPrewarmNeshService(_FakeNeshService):
        async def prewarm_cache(self):
            raise RuntimeError("prewarm failed")

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Session:
        async def execute(self, _query):
            return _ScalarResult(123)

    @asynccontextmanager
    async def _fake_get_session():
        yield _Session()

    async def _close_db_fail():
        raise RuntimeError("close failed")

    monkeypatch.setattr(app_module.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", True)
    monkeypatch.setattr(db_engine, "get_session", _fake_get_session)
    monkeypatch.setattr(db_engine, "close_db", _close_db_fail)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FailingPrewarmNeshService)

    app = _FakeApp()
    async with app_module.lifespan(app):
        assert app.state.db is None
        assert app.state.sqlmodel_enabled is True
        assert isinstance(app.state.service, _FailingPrewarmNeshService)
        assert app.state.tipi_service.mode == "repo"
        assert core_mocks["redis_connected"] is True

    assert core_mocks["redis_closed"] is True


@pytest.mark.asyncio
async def test_lifespan_postgres_tipi_count_failure_falls_back_to_sqlite_mode(
    monkeypatch, core_mocks
):
    @asynccontextmanager
    async def _broken_get_session():
        raise RuntimeError("tipi count failed")
        yield

    async def _close_db_ok():
        return None

    monkeypatch.setattr(app_module.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(db_engine, "get_session", _broken_get_session)
    monkeypatch.setattr(db_engine, "close_db", _close_db_ok)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)

    app = _FakeApp()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is True
        assert app.state.tipi_service.mode == "sqlite"
        assert app.state.tipi_service.created_repo is False
