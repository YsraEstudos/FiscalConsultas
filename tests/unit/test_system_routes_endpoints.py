from contextlib import asynccontextmanager
from types import SimpleNamespace

import asyncio
import backend.infrastructure.db_engine as db_engine
import pytest
from backend.presentation.routes import system
from fastapi import HTTPException
from starlette.requests import Request

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
    scope_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()
    ]
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
        self.calls = 0

    async def check_connection(self):  # NOSONAR
        self.calls += 1
        return self.payload


class _FakeTipiService:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload or {}
        self.error = error
        self.calls = 0

    async def check_connection(self):  # NOSONAR
        self.calls += 1
        if self.error:
            raise self.error
        return self.payload

    async def get_internal_cache_metrics(self):  # NOSONAR
        return {"cache": "tipi"}


class _FakeNbsService:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload or {}
        self.error = error
        self.calls = 0

    async def check_connection(self):  # NOSONAR
        self.calls += 1
        if self.error:
            raise self.error
        return self.payload


class _FakeNeshService:
    def __init__(self, response):
        self.response = response

    async def get_internal_cache_metrics(self):  # NOSONAR
        return {"cache": "nesh"}

    async def process_request(self, _ncm: str, **kwargs):  # NOSONAR
        return self.response


def test_to_int_returns_default_on_invalid_values():
    assert system._to_int("abc", default=7) == 7
    assert system._to_int(None, default=9) == 9


@pytest.fixture(autouse=True)
def _reset_status_cache():
    system._reset_status_cache_for_tests()
    yield
    system._reset_status_cache_for_tests()


@pytest.mark.asyncio
async def test_get_status_uses_app_state_services_when_available():
    request = _build_request(
        "/api/status",
        state={
            "db": _FakeDb({"status": "online", "chapters": "5", "positions": "9"}),
            "tipi_service": _FakeTipiService(
                {"ok": True, "chapters": "3", "positions": "4"}
            ),
            "nbs_service": _FakeNbsService(
                {
                    "status": "online",
                    "nbs_items": "6",
                    "nebs_entries": "2",
                }
            ),
        },
        version="9.9.9",
    )

    payload = await system.get_status(request)

    assert payload["status"] == "online"
    assert payload["database"]["status"] == "online"
    assert payload["tipi"]["status"] == "online"
    assert payload["nbs"]["status"] == "online"
    assert payload["nebs"]["status"] == "online"
    assert payload["catalogs"]["nesh"]["status"] == "online"
    assert "version" not in payload
    assert "chapters" not in payload["database"]


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
    async def _fake_get_session():  # NOSONAR
        yield _Session()

    monkeypatch.setattr(db_engine, "get_session", _fake_get_session)
    request = _build_request(
        "/api/status",
        state={
            "db": None,
            "tipi_service": _FakeTipiService(
                {"ok": True, "chapters": "2", "positions": "7"}
            ),
            "nbs_service": _FakeNbsService(
                {"status": "online", "nbs_items": "10", "nebs_entries": "3"}
            ),
        },
    )

    payload = await system.get_status(request)

    assert payload["status"] == "online"
    assert payload["database"]["status"] == "online"
    assert payload["tipi"]["status"] == "online"
    assert payload["nbs"]["status"] == "online"
    assert payload["nebs"]["status"] == "online"


@pytest.mark.asyncio
async def test_get_status_handles_db_and_tipi_exceptions(monkeypatch):
    class _BrokenSession:
        async def execute(self, _query):  # NOSONAR
            raise RuntimeError("db down")

    @asynccontextmanager
    async def _broken_get_session():  # NOSONAR
        yield _BrokenSession()

    monkeypatch.setattr(db_engine, "get_session", _broken_get_session)
    request = _build_request(
        "/api/status",
        state={
            "db": None,
            "tipi_service": _FakeTipiService(error=RuntimeError("tipi down")),
            "nbs_service": _FakeNbsService(error=RuntimeError("nbs down")),
        },
    )

    payload = await system.get_status(request)

    assert payload["status"] == "error"
    assert payload["database"]["status"] == "error"
    assert payload["tipi"]["status"] == "error"
    assert payload["nbs"]["status"] == "error"
    assert payload["nebs"]["status"] == "error"
    assert "error" not in payload["database"]
    assert "error" not in payload["tipi"]


@pytest.mark.asyncio
async def test_get_status_reuses_cached_snapshot_within_ttl(monkeypatch):
    async def _noop_rate_limit(_request):
        return None

    monkeypatch.setattr(system, "_apply_status_rate_limit", _noop_rate_limit)
    monkeypatch.setattr(system.settings.cache, "status_cache_ttl", 30, raising=False)

    db = _FakeDb({"status": "online", "chapters": "5", "positions": "9"})
    tipi = _FakeTipiService({"ok": True, "chapters": "3", "positions": "4"})
    nbs = _FakeNbsService({"status": "online", "nbs_items": "6", "nebs_entries": "2"})
    request = _build_request(
        "/api/status",
        state={"db": db, "tipi_service": tipi, "nbs_service": nbs},
    )

    first = await system.get_status(request)
    second = await system.get_status(request)

    assert first == second
    assert db.calls == 1
    assert tipi.calls == 1
    assert nbs.calls == 1


@pytest.mark.asyncio
async def test_get_status_deduplicates_concurrent_refresh(monkeypatch):
    class _SlowFakeDb(_FakeDb):
        async def check_connection(self):  # NOSONAR
            self.calls += 1
            await asyncio.sleep(0.05)
            return self.payload

    class _SlowFakeTipiService(_FakeTipiService):
        async def check_connection(self):  # NOSONAR
            self.calls += 1
            await asyncio.sleep(0.05)
            return self.payload

    class _SlowFakeNbsService(_FakeNbsService):
        async def check_connection(self):  # NOSONAR
            self.calls += 1
            await asyncio.sleep(0.05)
            return self.payload

    async def _noop_rate_limit(_request):
        return None

    monkeypatch.setattr(system, "_apply_status_rate_limit", _noop_rate_limit)
    monkeypatch.setattr(system.settings.cache, "status_cache_ttl", 30, raising=False)

    db = _SlowFakeDb({"status": "online", "chapters": "5", "positions": "9"})
    tipi = _SlowFakeTipiService({"ok": True, "chapters": "3", "positions": "4"})
    nbs = _SlowFakeNbsService(
        {"status": "online", "nbs_items": "6", "nebs_entries": "2"}
    )
    request = _build_request(
        "/api/status",
        state={"db": db, "tipi_service": tipi, "nbs_service": nbs},
    )

    first, second = await asyncio.gather(
        system.get_status(request),
        system.get_status(request),
    )

    assert first == second
    assert db.calls == 1
    assert tipi.calls == 1
    assert nbs.calls == 1


@pytest.mark.asyncio
async def test_get_status_details_returns_sensitive_fields_for_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request(
        "/api/status/details",
        state={
            "db": _FakeDb({"status": "online", "chapters": "5", "positions": "9"}),
            "tipi_service": _FakeTipiService(
                {
                    "ok": True,
                    "chapters": "3",
                    "positions": "4",
                    "metadata": {"tipi_updated_at": "2026-03-25T10:00:00+00:00"},
                }
            ),
            "nbs_service": _FakeNbsService(
                {
                    "status": "online",
                    "nbs_items": "6",
                    "nebs_entries": "2",
                    "metadata": {
                        "nbs_updated_at": "2026-03-25T10:00:00+00:00",
                        "nebs_updated_at": "2026-03-25T10:05:00+00:00",
                    },
                }
            ),
        },
        version="9.9.9",
    )

    payload = await system.get_status_details(request)

    assert payload["status"] == "online"
    assert payload["version"] == "9.9.9"
    assert payload["backend"] == "FastAPI"
    assert payload["database"]["chapters"] == 5
    assert payload["database"]["positions"] == 9
    assert payload["tipi"]["chapters"] == 3
    assert payload["nbs"]["items"] == 6
    assert payload["nebs"]["entries"] == 2
    assert payload["catalogs"]["nbs"]["status"] == "online"
    assert (
        payload["catalogs"]["nebs"]["metadata"]["updated_at"]
        == "2026-03-25T10:05:00+00:00"
    )


@pytest.mark.asyncio
async def test_get_status_details_rejects_non_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/status/details")

    with pytest.raises(HTTPException) as exc:
        await system.get_status_details(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_cache_metrics_rejects_non_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/cache-metrics")

    with pytest.raises(HTTPException) as exc:
        await system.get_cache_metrics(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_cache_metrics_returns_payload_for_admin(monkeypatch):
    from backend.presentation.routes import search as search_route
    from backend.presentation.routes import tipi as tipi_route

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    monkeypatch.setattr(
        search_route, "get_payload_cache_metrics", lambda: {"hits": 1, "misses": 2}
    )
    monkeypatch.setattr(
        tipi_route, "get_payload_cache_metrics", lambda: {"hits": 3, "misses": 4}
    )

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

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/debug/anchors")

    with pytest.raises(HTTPException) as exc:
        await system.debug_anchors(
            request=request, ncm="8517", service=_FakeNeshService({})
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_debug_anchors_returns_403_for_non_admin(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", True, raising=False)

    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/debug/anchors")

    with pytest.raises(HTTPException) as exc:
        await system.debug_anchors(
            request=request, ncm="8517", service=_FakeNeshService({})
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_debug_anchors_filters_position_related_ids(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", True, raising=False)

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)

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

    payload = await system.debug_anchors(request=request, ncm="8517", service=service)

    assert payload["query"] == "8517"
    assert payload["normalized"] == "8517"
    assert payload["scroll_to_anchor"] == "pos-85-17"
    assert payload["total_ids"] == 2
    assert payload["all_position_ids"] == ["pos-85-17", "cap-85"]
    assert payload["html_preview"] is not None


@pytest.mark.asyncio
async def test_reload_secrets_rejects_non_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/admin/reload-secrets", method="POST")

    with pytest.raises(HTTPException) as exc:
        await system.reload_secrets(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_reload_secrets_calls_reload_for_admin(monkeypatch):
    called = {"value": False}

    def _fake_reload():
        called["value"] = True

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    monkeypatch.setattr(system, "reload_settings", _fake_reload)
    request = _build_request("/api/admin/reload-secrets", method="POST")

    payload = await system.reload_secrets(request)

    assert payload == {"success": True}
    assert called["value"] is True
