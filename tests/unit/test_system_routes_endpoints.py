from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import backend.infrastructure.db_engine as db_engine
from backend.presentation.routes import system


pytestmark = pytest.mark.unit


def _build_request(
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    state: dict | None = None,
    version: str = "4.2-test",
) -> Request:
    headers = headers or {}
    scope_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
    app = SimpleNamespace(state=SimpleNamespace(**(state or {})), version=version)
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": scope_headers,
        "app": app,
    }
    return Request(scope)


class _FakeDb:
    def __init__(self, payload):
        self.payload = payload

    async def check_connection(self):
        return self.payload


class _FakeTipiService:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload or {}
        self.error = error

    async def check_connection(self):
        if self.error:
            raise self.error
        return self.payload

    async def get_internal_cache_metrics(self):
        return {"cache": "tipi"}


class _FakeNeshService:
    def __init__(self, response):
        self.response = response

    async def get_internal_cache_metrics(self):
        return {"cache": "nesh"}

    async def process_request(self, _ncm: str):
        return self.response


def test_to_int_returns_default_on_invalid_values():
    assert system._to_int("abc", default=7) == 7
    assert system._to_int(None, default=9) == 9


@pytest.mark.asyncio
async def test_get_status_uses_app_state_services_when_available():
    request = _build_request(
        "/api/status",
        state={
            "db": _FakeDb({"status": "online", "chapters": "5", "positions": "9"}),
            "tipi_service": _FakeTipiService({"ok": True, "chapters": "3", "positions": "4"}),
        },
        version="9.9.9",
    )

    payload = await system.get_status(request)

    assert payload["status"] == "online"
    assert payload["version"] == "9.9.9"
    assert payload["database"]["status"] == "online"
    assert payload["database"]["chapters"] == 5
    assert payload["tipi"]["status"] == "online"


@pytest.mark.asyncio
async def test_get_status_uses_db_engine_fallback_when_db_not_in_state(monkeypatch):
    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Session:
        def __init__(self):
            self.calls = 0

        async def execute(self, _query):
            self.calls += 1
            return _ScalarResult(12 if self.calls == 1 else 34)

    @asynccontextmanager
    async def _fake_get_session():
        yield _Session()

    monkeypatch.setattr(db_engine, "get_session", _fake_get_session)
    request = _build_request("/api/status", state={"db": None, "tipi_service": None})

    payload = await system.get_status(request)

    assert payload["database"]["status"] == "online"
    assert payload["database"]["chapters"] == 12
    assert payload["database"]["positions"] == 34
    assert payload["tipi"]["status"] == "error"
    assert "TIPI service unavailable" in payload["tipi"]["error"]


@pytest.mark.asyncio
async def test_get_status_handles_db_and_tipi_exceptions(monkeypatch):
    @asynccontextmanager
    async def _broken_get_session():
        raise RuntimeError("db down")
        yield

    monkeypatch.setattr(db_engine, "get_session", _broken_get_session)
    request = _build_request(
        "/api/status",
        state={
            "db": None,
            "tipi_service": _FakeTipiService(error=RuntimeError("tipi down")),
        },
    )

    payload = await system.get_status(request)

    assert payload["status"] == "error"
    assert payload["database"]["status"] == "error"
    assert "db down" in payload["database"]["error"]
    assert payload["tipi"]["status"] == "error"
    assert "tipi down" in payload["tipi"]["error"]


@pytest.mark.asyncio
async def test_get_cache_metrics_rejects_non_admin(monkeypatch):
    monkeypatch.setattr(system, "_is_admin_request", lambda _request: False)
    request = _build_request("/api/cache-metrics")

    with pytest.raises(HTTPException) as exc:
        await system.get_cache_metrics(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_cache_metrics_returns_payload_for_admin(monkeypatch):
    from backend.presentation.routes import search as search_route
    from backend.presentation.routes import tipi as tipi_route

    monkeypatch.setattr(system, "_is_admin_request", lambda _request: True)
    monkeypatch.setattr(search_route, "get_payload_cache_metrics", lambda: {"hits": 1, "misses": 2})
    monkeypatch.setattr(tipi_route, "get_payload_cache_metrics", lambda: {"hits": 3, "misses": 4})

    request = _build_request(
        "/api/cache-metrics",
        state={
            "service": _FakeNeshService({}),
            "tipi_service": _FakeTipiService(),
        },
    )

    payload = await system.get_cache_metrics(request)

    assert payload["status"] == "ok"
    assert payload["search_code_payload_cache"] == {"hits": 1, "misses": 2}
    assert payload["tipi_code_payload_cache"] == {"hits": 3, "misses": 4}
    assert payload["nesh_internal_caches"] == {"cache": "nesh"}
    assert payload["tipi_internal_caches"] == {"cache": "tipi"}


@pytest.mark.asyncio
async def test_debug_anchors_returns_404_when_debug_mode_is_disabled(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", False, raising=False)
    monkeypatch.setattr(system, "_is_admin_request", lambda _request: True)
    request = _build_request("/api/debug/anchors")

    with pytest.raises(HTTPException) as exc:
        await system.debug_anchors(request, "8517", _FakeNeshService({}))

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_debug_anchors_returns_403_for_non_admin(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(system, "_is_admin_request", lambda _request: False)
    request = _build_request("/api/debug/anchors")

    with pytest.raises(HTTPException) as exc:
        await system.debug_anchors(request, "8517", _FakeNeshService({}))

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_debug_anchors_filters_position_related_ids(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(system, "_is_admin_request", lambda _request: True)

    service = _FakeNeshService(
        {
            "normalized": "8517",
            "scroll_to_anchor": "pos-85-17",
            "posicao_alvo": "85.17",
            "markdown": (
                '<div id="pos-85-17"></div>'
                '<div id="cap-85"></div>'
                '<div id="random-id"></div>'
            ),
        }
    )
    request = _build_request("/api/debug/anchors")

    payload = await system.debug_anchors(request, "8517", service)

    assert payload["query"] == "8517"
    assert payload["normalized"] == "8517"
    assert payload["scroll_to_anchor"] == "pos-85-17"
    assert payload["total_ids"] == 2
    assert payload["all_position_ids"] == ["pos-85-17", "cap-85"]
    assert payload["html_preview"] is not None


@pytest.mark.asyncio
async def test_reload_secrets_rejects_non_admin(monkeypatch):
    monkeypatch.setattr(system, "_is_admin_request", lambda _request: False)
    request = _build_request("/api/admin/reload-secrets", method="POST")

    with pytest.raises(HTTPException) as exc:
        await system.reload_secrets(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_reload_secrets_calls_reload_for_admin(monkeypatch):
    called = {"value": False}

    def _fake_reload():
        called["value"] = True

    monkeypatch.setattr(system, "_is_admin_request", lambda _request: True)
    monkeypatch.setattr(system, "reload_settings", _fake_reload)
    request = _build_request("/api/admin/reload-secrets", method="POST")

    payload = await system.reload_secrets(request)

    assert payload == {"success": True}
    assert called["value"] is True
