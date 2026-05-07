import asyncio
import builtins
import re
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
        await asyncio.sleep(0)
        self.pool_ready = True

    async def close(self):
        await asyncio.sleep(0)
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

    async def prewarmNeshChapterCache(self):
        await asyncio.sleep(0)
        return 0

    @classmethod
    async def initializeNeshServiceWithRepositoryFactory(cls):
        await asyncio.sleep(0)
        return cls()


class _FakeTipiService:
    def __init__(self):
        self.mode = "sqlite"
        self.created_repo = False

    @classmethod
    def initializeTipiServiceWithRepositoryFactory(cls):
        obj = cls()
        obj.created_repo = True
        obj.mode = "repo"
        return obj


class _FakeNbsService:
    def __init__(self):
        self.closed = False
        self.mode = "sqlite"
        self.created_repo = False

    async def shutdownNbsServiceResources(self):
        await asyncio.sleep(0)
        self.closed = True

    async def close(self):
        await self.shutdownNbsServiceResources()

    @classmethod
    async def initializeNbsServiceWithPostgresRepository(cls):
        await asyncio.sleep(0)
        obj = cls()
        obj.mode = "repo"
        obj.created_repo = True
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
        await asyncio.sleep(0)
        fake_calls["redis_closed"] = True
        app_module.redis_cache._client = None

    async def _redis_connect():
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
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
    assert html_response.headers["X-Frame-Options"] == "DENY"
    assert html_response.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in html_response.headers["Content-Security-Policy"]
    assert api_response.headers["X-Frame-Options"] == "DENY"
    assert "Cache-Control" not in api_response.headers


@pytest.mark.asyncio
async def test_no_cache_html_hides_api_docs_without_debug_mode(monkeypatch):
    called = {"value": False}

    async def _next(_request):
        await asyncio.sleep(0)
        called["value"] = True
        return Response("ok")

    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(
        app_module.settings.features, "debug_mode", False, raising=False
    )

    response = await app_module.no_cache_html(_request_for_path("/openapi.json"), _next)

    assert response.status_code == 404
    assert response.body == b'{"detail":"Not Found"}'
    assert called["value"] is False
    assert response.headers["X-Frame-Options"] == "DENY"


def test_configure_routes_keeps_fallback_when_frontend_index_missing(tmp_path):
    app = FastAPI()
    static_root = tmp_path / "client" / "dist"
    static_root.mkdir(parents=True)

    app_module._configure_routes(app, str(tmp_path), app_module.logger)

    assert not any(
        getattr(route, "name", None) == "static" for route in app.router.routes
    )
    assert any(
        getattr(route, "path", None) == "/"
        and getattr(route, "name", None) == "_read_root"
        for route in app.router.routes
    )


@pytest.mark.asyncio
async def test_lifespan_sqlite_init_db_failure_keeps_startup_and_shutdown(
    monkeypatch, core_mocks
):
    fake_db = _FakeDbAdapter("db.sqlite")

    async def _init_db_fail():
        await asyncio.sleep(0)
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
async def test_lifespan_records_release_metadata(monkeypatch, core_mocks):
    fake_db = _FakeDbAdapter("db.sqlite")

    monkeypatch.setattr(app_module.settings.database, "engine", "sqlite")
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", False)
    monkeypatch.setattr(app_module, "DatabaseAdapter", lambda _path: fake_db)
    monkeypatch.setattr(nesh_service_module, "NeshService", _FakeNeshService)
    monkeypatch.setenv("RENDER_SERVICE_ID", "srv-test")
    monkeypatch.setenv("RENDER_GIT_COMMIT", "commit-test")
    monkeypatch.setenv("RENDER_GIT_BRANCH", "main")

    app = _make_fake_fastapi()
    async with app_module.lifespan(app):
        assert app.state.release_metadata["render_service_id"] == "srv-test"
        assert app.state.release_metadata["git_commit"] == "commit-test"
        assert app.state.release_metadata["git_branch"] == "main"
        assert (
            app.state.release_metadata["server_env"] == app_module.settings.server.env
        )

    assert fake_db.closed is True
    assert app.state.nbs_service.closed is True


@pytest.mark.asyncio
async def test_lifespan_sqlite_init_db_success_closes_sqlmodel_engine(
    monkeypatch, core_mocks
):
    fake_db = _FakeDbAdapter("db.sqlite")
    close_db_called = {"value": False}

    async def _init_db_ok():
        await asyncio.sleep(0)
        return None

    async def _close_db_ok():
        await asyncio.sleep(0)
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
        async def prewarmNeshChapterCache(self):
            await asyncio.sleep(0)
            raise RuntimeError("prewarm failed")

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Session:
        async def execute(self, _query):
            await asyncio.sleep(0)
            return _ScalarResult(123)

    @asynccontextmanager
    async def _fake_get_session():
        yield _Session()

    async def _close_db_fail():
        await asyncio.sleep(0)
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
        assert app.state.nbs_service.mode == "repo"
        assert app.state.nbs_service.created_repo is True
        assert isinstance(app.state.nbs_service, _FakeNbsService)
        assert core_mocks["redis_connected"] is True

    assert app.state.nbs_service.closed is True
    assert core_mocks["redis_closed"] is True


@pytest.mark.asyncio
async def test_lifespan_postgres_tipi_count_failure_falls_back_to_sqlite_mode(
    monkeypatch, core_mocks
):
    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _BrokenSession:
        async def execute(self, query):
            await asyncio.sleep(0)
            if "tipi_positions" in str(query):
                raise RuntimeError("tipi count failed")
            return _ScalarResult(True)

    @asynccontextmanager
    async def _broken_get_session():
        yield _BrokenSession()

    async def _close_db_ok():
        await asyncio.sleep(0)
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
        assert app.state.nbs_service.mode == "repo"


@pytest.mark.asyncio
async def test_init_cache_warmup_handles_redis_connect_exception(monkeypatch):
    warnings = []

    async def _connect_fail():
        await asyncio.sleep(0)
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
            await asyncio.sleep(0)
            return _ScalarResult(True)

    @asynccontextmanager
    async def _fake_get_session():
        yield _Session()

    async def _close_db_ok():
        await asyncio.sleep(0)
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


def test_build_content_security_policy_drops_local_origins_in_production(monkeypatch):
    monkeypatch.setattr(app_module.settings.server, "env", "production", raising=False)

    csp = app_module._build_content_security_policy()

    assert "connect-src 'self' https: wss:" in csp
    assert "localhost" not in csp
    assert "127.0.0.1" not in csp
    assert (
        "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com"
        in csp
    )


def test_build_content_security_policy_keeps_local_origins_in_development(monkeypatch):
    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)

    csp = app_module._build_content_security_policy()

    assert "http://localhost:8000" in csp
    assert "http://127.0.0.1:8000" in csp
    assert "ws://localhost:*" in csp
    assert "ws://127.0.0.1:*" in csp
    assert "https://cdn.jsdelivr.net" in csp


def test_build_cors_configuration_defaults_to_localhost_only_in_development(
    monkeypatch,
):
    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(
        app_module.settings.server, "cors_allowed_origins", None, raising=False
    )
    monkeypatch.setattr(
        app_module.settings.server, "cors_allowed_origin_regex", None, raising=False
    )

    origins, cors_regex = app_module._build_cors_configuration()

    assert origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert cors_regex is not None
    assert "localhost" in cors_regex


def test_build_cors_configuration_fails_closed_in_production(monkeypatch):
    monkeypatch.setattr(app_module.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(
        app_module.settings.server, "cors_allowed_origins", [], raising=False
    )
    monkeypatch.setattr(
        app_module.settings.server, "cors_allowed_origin_regex", None, raising=False
    )

    origins, cors_regex = app_module._build_cors_configuration()

    assert origins == []
    assert cors_regex is None


def test_build_cors_configuration_accepts_cloudflare_pages_previews(monkeypatch):
    monkeypatch.setattr(app_module.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(
        app_module.settings.server,
        "cors_allowed_origins",
        ["https://fiscalconsultas.pages.dev"],
        raising=False,
    )
    monkeypatch.setattr(
        app_module.settings.server,
        "cors_allowed_origin_regex",
        r"^https://[a-z0-9-]+\.fiscalconsultas\.pages\.dev$",
        raising=False,
    )

    origins, cors_regex = app_module._build_cors_configuration()

    assert origins == ["https://fiscalconsultas.pages.dev"]
    assert cors_regex is not None
    compiled = re.compile(cors_regex)
    assert compiled.fullmatch("https://3fbcaa44.fiscalconsultas.pages.dev")
    assert not compiled.fullmatch("https://attacker.example.com")


def test_log_runtime_security_warnings_for_production_misconfiguration(monkeypatch):
    warnings = []

    monkeypatch.setattr(app_module.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(app_module.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(
        app_module.settings.server,
        "cors_allowed_origins",
        ["http://localhost:5173"],
        raising=False,
    )
    monkeypatch.setattr(app_module.settings.cache, "enable_redis", True, raising=False)
    monkeypatch.setattr(
        app_module.settings.cache,
        "redis_url",
        "redis://localhost:6379/0",
        raising=False,
    )
    monkeypatch.setattr(app_module.settings.database, "engine", "sqlite", raising=False)
    monkeypatch.setattr(
        app_module.logger,
        "warning",
        lambda message, *args: warnings.append(message % args),
    )

    app_module._log_runtime_security_warnings()

    assert any("FEATURES__DEBUG_MODE=true" in warning for warning in warnings)
    assert any("localhost/loopback" in warning for warning in warnings)
    assert any(
        "CACHE__REDIS_URL apontando para localhost" in warning for warning in warnings
    )
    assert any(
        "DATABASE__ENGINE não está em postgresql" in warning for warning in warnings
    )


@pytest.mark.asyncio
async def test_lifespan_rejects_non_local_debug_tenant_override(monkeypatch):
    shutdown_called = {"value": False}

    async def _shutdown(_app):
        await asyncio.sleep(0)
        shutdown_called["value"] = True

    init_db_mock = AsyncMock()

    monkeypatch.setattr(app_module.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(app_module.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(
        app_module.settings.server,
        "host",
        "debug-security.example.com",
        raising=False,
    )
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
            await asyncio.sleep(0)
            raise RuntimeError("db close failed")

    async def _redis_close():
        await asyncio.sleep(0)
        return None

    async def _close_db():
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
        raise RuntimeError("redis close failed")

    async def _close_db():
        await asyncio.sleep(0)
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
