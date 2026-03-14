import builtins
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import backend.infrastructure.db_engine as db_engine
import backend.server.app as app_module
import backend.services.nesh_service as nesh_service_module
import pytest
from fastapi import FastAPI
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


def _make_fake_fastapi() -> FastAPI:
    return cast(FastAPI, _FakeApp())


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


class _FakeNbsService:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


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
    monkeypatch.setattr(app_module, "NbsService", _FakeNbsService)

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

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is False
        assert app.state.service.db is fake_db
        assert app.state.tipi_service.mode == "sqlite"
        assert isinstance(app.state.nbs_service, _FakeNbsService)
        assert isinstance(app.state.ai_service, _FakeAiService)
        assert fake_db.pool_ready is True
        assert core_mocks["glossary"] is True
        assert core_mocks["frontend"] is True

    assert fake_db.closed is True
    assert app.state.nbs_service.closed is True
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

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is False
        assert fake_db.pool_ready is True

    assert fake_db.closed is True
    assert app.state.nbs_service.closed is True


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

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is True

    assert fake_db.closed is True
    assert app.state.nbs_service.closed is True
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

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.db is None
        assert app.state.sqlmodel_enabled is True
        assert isinstance(app.state.service, _FailingPrewarmNeshService)
        assert app.state.tipi_service.mode == "repo"
        assert isinstance(app.state.nbs_service, _FakeNbsService)
        assert core_mocks["redis_connected"] is True

    assert app.state.nbs_service.closed is True
    assert core_mocks["redis_closed"] is True


@pytest.mark.asyncio
async def test_lifespan_postgres_tipi_count_failure_falls_back_to_sqlite_mode(
    monkeypatch, core_mocks
):
    class _BrokenSession:
        async def execute(self, _query):
            raise RuntimeError("tipi count failed")

    @asynccontextmanager
    async def _broken_get_session():
        yield _BrokenSession()

    async def _close_db_ok():
        return None

    monkeypatch.setattr(app_module.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(db_engine, "get_session", _broken_get_session)
    monkeypatch.setattr(db_engine, "close_db", _close_db_ok)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is True
        assert app.state.tipi_service.mode == "sqlite"
        assert app.state.tipi_service.created_repo is False


@pytest.mark.asyncio
async def test_init_cache_warmup_handles_redis_connect_exception(monkeypatch):
    warnings = []

    async def _connect_fail():
        raise RuntimeError("redis unavailable")

    def _capture_warning(msg, *args):
        warnings.append(msg % args)

    monkeypatch.setattr(app_module.settings.cache, "enable_redis", True)
    monkeypatch.setattr(app_module.redis_cache, "connect", _connect_fail)
    monkeypatch.setattr(app_module.logger, "warning", _capture_warning)

    app = _make_fake_fastapi()
    app.state.service = _FakeNeshService()

    await app_module._init_cache_warmup(app)

    assert warnings == ["Redis connect failed during startup: redis unavailable"]


@pytest.mark.asyncio
async def test_lifespan_runs_shutdown_when_startup_raises(monkeypatch):
    calls = {"shutdown": False}

    init_fail = AsyncMock(side_effect=RuntimeError("startup failed"))
    shutdown_mock = AsyncMock(
        side_effect=lambda _app: calls.__setitem__("shutdown", True)
    )

    monkeypatch.setattr(app_module, "_init_primary_database", init_fail)
    monkeypatch.setattr(app_module, "_shutdown_resources", shutdown_mock)

    app = _make_fake_fastapi()

    with pytest.raises(RuntimeError, match="startup failed"):
        async with app_module.lifespan(app):
            pytest.fail("lifespan yielded unexpectedly")

    assert calls["shutdown"] is True


@pytest.mark.asyncio
async def test_lifespan_postgres_import_error_still_enables_sqlmodel(
    monkeypatch, core_mocks
):
    real_import = builtins.__import__

    def _fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "backend.infrastructure.db_engine" and "init_db" in (fromlist or ()):
            raise ImportError("simulated missing db_engine")
        return real_import(name, globals, locals, fromlist, level)

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Session:
        async def execute(self, _query):
            return _ScalarResult(True)

    @asynccontextmanager
    async def _fake_get_session():
        yield _Session()

    async def _close_db_ok():
        return None

    monkeypatch.setattr(app_module.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(db_engine, "get_session", _fake_get_session)
    monkeypatch.setattr(db_engine, "close_db", _close_db_ok)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)
    monkeypatch.setattr(builtins, "__import__", _fake_import)

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.sqlmodel_enabled is True
        assert app.state.tipi_service.mode == "repo"


def test_validate_dev_tenant_override_safety_allows_localhost(monkeypatch):
    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(app_module.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(app_module.settings.server, "host", "127.0.0.1", raising=False)

    app_module._validate_dev_tenant_override_safety()


@pytest.mark.asyncio
async def test_lifespan_rejects_non_local_debug_tenant_override(monkeypatch):
    shutdown_called = {"value": False}

    async def _shutdown(_app):
        shutdown_called["value"] = True

    init_db_mock = AsyncMock()

    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(app_module.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(app_module.settings.server, "host", "0.0.0.0", raising=False)
    monkeypatch.setattr(app_module, "_init_primary_database", init_db_mock)
    monkeypatch.setattr(app_module, "_shutdown_resources", _shutdown)

    app = _make_fake_fastapi()

    with pytest.raises(RuntimeError, match="localhost-only host binding"):
        async with app_module.lifespan(app):
            pytest.fail("lifespan yielded unexpectedly")

    init_db_mock.assert_not_awaited()
    assert shutdown_called["value"] is True


@pytest.mark.asyncio
async def test_shutdown_resources_continues_after_db_close_failure(monkeypatch):
    warnings = []
    close_db_called = {"value": False}

    class _BrokenDb:
        async def close(self):
            raise RuntimeError("db close failed")

    async def _redis_close():
        return None

    async def _close_db():
        close_db_called["value"] = True

    def _capture_warning(msg, *args):
        warnings.append(msg % args)

    monkeypatch.setattr(app_module.redis_cache, "close", _redis_close)
    monkeypatch.setattr(app_module.logger, "warning", _capture_warning)
    monkeypatch.setattr(db_engine, "close_db", _close_db)

    app = _make_fake_fastapi()
    app.state.db = _BrokenDb()
    app.state.sqlmodel_enabled = True

    await app_module._shutdown_resources(app)

    assert "Error closing DatabaseAdapter: db close failed" in warnings
    assert close_db_called["value"] is True


@pytest.mark.asyncio
async def test_shutdown_resources_continues_after_redis_close_failure(monkeypatch):
    warnings = []
    close_db_called = {"value": False}

    async def _redis_close():
        raise RuntimeError("redis close failed")

    async def _close_db():
        close_db_called["value"] = True

    def _capture_warning(msg, *args):
        warnings.append(msg % args)

    monkeypatch.setattr(app_module.redis_cache, "close", _redis_close)
    monkeypatch.setattr(app_module.logger, "warning", _capture_warning)
    monkeypatch.setattr(db_engine, "close_db", _close_db)

    app = _make_fake_fastapi()
    app.state.db = None
    app.state.sqlmodel_enabled = True

    await app_module._shutdown_resources(app)

    assert "Error closing Redis cache: redis close failed" in warnings
    assert close_db_called["value"] is True
