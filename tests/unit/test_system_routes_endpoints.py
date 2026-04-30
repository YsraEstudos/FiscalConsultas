import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import backend.infrastructure.db_engine as db_engine
from backend.presentation.routes import system
from backend.presentation.routes import system_status

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

    async def probeTipiCatalogHealth(self):  # NOSONAR
        self.calls += 1
        if self.error:
            raise self.error
        return self.payload

    async def snapshotTipiInternalCacheMetrics(self):  # NOSONAR
        return {"cache": "tipi"}


class _FakeNbsService:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload or {}
        self.error = error
        self.calls = 0

    async def probeNbsCatalogHealth(self):  # NOSONAR
        self.calls += 1
        if self.error:
            raise self.error
        return self.payload


class _FakeNeshService:
    def __init__(self, response):
        self.response = response

    async def snapshotNeshInternalCacheMetrics(self):  # NOSONAR
        return {"cache": "nesh"}

    async def executeNeshSearchWithVectorWeights(  # NOSONAR
        self, _ncm: str, **kwargs
    ):
        return self.response


def test_to_int_returns_default_on_invalid_values():
    assert system.coerce_int("abc", default=7) == 7
    assert system.coerce_int(None, default=9) == 9


@pytest.fixture(autouse=True)
def _reset_status_cache():
    system.reset_status_cache_for_tests()
    yield
    system.reset_status_cache_for_tests()


@pytest.mark.asyncio
async def test_reset_status_cache_for_tests_clears_lock():
    from backend.presentation.routes import system_status

    system.get_status_cache_lock()
    assert system_status._STATUS_CACHE_LOCK is not None

    system.reset_status_cache_for_tests()

    assert system_status._STATUS_CACHE_LOCK is None


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

    payload = await system.fetch_system_status(request)

    assert payload["status"] == "online"
    assert payload["database"]["status"] == "online"
    assert payload["tipi"]["status"] == "online"
    assert payload["nbs"]["status"] == "online"
    assert payload["catalogs"]["nesh"]["status"] == "online"
    assert "nebs" not in payload
    assert "nebs" not in payload["catalogs"]
    assert "version" not in payload
    assert "chapters" not in payload["database"]


def test_status_payloads_tolerate_legacy_empty_nebs_snapshot():
    normalized_db = {"status": "online", "chapters": 5, "positions": 9}
    normalized_tipi = {"status": "online", "chapters": 3, "positions": 4}
    normalized_nbs = {"status": "online", "items": 6}
    normalized_nebs = {}

    public_payload = system_status.build_public_status_payload(
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        "online",
    )
    detailed_payload = system_status.build_detailed_status_payload(
        _build_request("/api/status/details"),
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        "online",
    )

    assert public_payload["nbs"]["status"] == "online"
    assert public_payload["catalogs"]["nbs"]["status"] == "online"
    assert detailed_payload["nbs"]["status"] == "online"
    assert detailed_payload["nbs"]["explanatory_entries"] == 0
    assert detailed_payload["catalogs"]["nbs"]["status"] == "online"


def test_nbs_public_status_ignores_empty_explanatory_entries():
    normalized_nbs = {"status": "online", "items": 6}
    normalized_nebs = {"status": "error", "entries": 0}

    assert (
        system_status.resolve_nbs_public_status(normalized_nbs, normalized_nebs)
        == "online"
    )


def test_nbs_public_status_fails_on_explanatory_service_error():
    normalized_nbs = {"status": "online", "items": 6}
    normalized_nebs = {"status": "error", "entries": 0, "error": "db down"}

    assert (
        system_status.resolve_nbs_public_status(normalized_nbs, normalized_nebs)
        == "error"
    )


@pytest.mark.asyncio
async def test_get_status_uses_db_engine_fallback_when_db_not_in_state(monkeypatch):
    monkeypatch.setattr(system, "_pg_stats_cache", {})
    monkeypatch.setattr(system, "_pg_stats_last_check_ts", 0.0)

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Session:
        async def execute(self, query):
            query_str = str(query)
            if "SELECT 1" in query_str:
                return _ScalarResult(1)
            if "SELECT COUNT(*) FROM chapters" in query_str:
                return _ScalarResult(12)
            if "SELECT COUNT(*) FROM positions" in query_str:
                return _ScalarResult(34)
            return _ScalarResult(0)

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

    payload = await system.fetch_system_status(request)

    assert payload["status"] == "online"
    assert payload["database"]["status"] == "online"
    assert payload["tipi"]["status"] == "online"
    assert payload["nbs"]["status"] == "online"
    assert "nebs" not in payload


@pytest.mark.asyncio
async def test_get_status_fallback_uses_lightweight_check_and_caches_counts(
    monkeypatch,
):
    monkeypatch.setattr(system, "_pg_stats_cache", {})
    monkeypatch.setattr(system, "_pg_stats_last_check_ts", 0.0)

    class _ScalarResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    executed_queries = []

    class _Session:
        async def execute(self, query):
            query_str = str(query)
            executed_queries.append(query_str)
            if "SELECT 1" in query_str:
                return _ScalarResult(1)
            if "SELECT COUNT(*) FROM chapters" in query_str:
                return _ScalarResult(12)
            if "SELECT COUNT(*) FROM positions" in query_str:
                return _ScalarResult(34)
            return _ScalarResult(0)

    @asynccontextmanager
    async def _fake_get_session():  # NOSONAR
        yield _Session()

    time_points = iter([100.0, 120.0])
    monkeypatch.setattr(db_engine, "get_session", _fake_get_session)
    monkeypatch.setattr(system.time, "time", lambda: next(time_points))
    request = _build_request("/api/status", state={"db": None, "tipi_service": None})

    first = await system.get_status(request)
    second = await system.get_status(request)

    assert first["database"]["status"] == "online"
    assert second["database"]["status"] == "online"
    assert executed_queries == [
        "SELECT 1",
        "SELECT COUNT(*) FROM chapters",
        "SELECT COUNT(*) FROM positions",
        "SELECT 1",
    ]


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

    payload = await system.fetch_system_status(request)

    assert payload["status"] == "error"
    assert payload["database"]["status"] == "error"
    assert payload["tipi"]["status"] == "error"
    assert payload["nbs"]["status"] == "error"
    assert "nebs" not in payload
    assert "error" not in payload["database"]
    assert "error" not in payload["tipi"]


@pytest.mark.asyncio
async def test_get_status_reuses_cached_snapshot_within_ttl(monkeypatch):
    async def _noop_rate_limit(_request):  # NOSONAR
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

    first = await system.fetch_system_status(request)
    second = await system.fetch_system_status(request)

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
        async def probeTipiCatalogHealth(self):  # NOSONAR
            self.calls += 1
            await asyncio.sleep(0.05)
            return self.payload

    class _SlowFakeNbsService(_FakeNbsService):
        async def probeNbsCatalogHealth(self):  # NOSONAR
            self.calls += 1
            await asyncio.sleep(0.05)
            return self.payload

    async def _noop_rate_limit(_request):  # NOSONAR
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
        system.fetch_system_status(request),
        system.fetch_system_status(request),
    )

    assert first == second
    assert db.calls == 1
    assert tipi.calls == 1
    assert nbs.calls == 1


@pytest.mark.asyncio
async def test_refresh_status_snapshot_ignores_redis_write_failures(monkeypatch):
    async def _fake_collect(_request):
        await asyncio.sleep(0)
        return (
            {"status": "online", "chapters": 5, "positions": 9},
            {"status": "online", "chapters": 3, "positions": 4},
            {"status": "online", "items": 6},
            {"status": "online", "entries": 2},
            "online",
        )

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(
        system_status, "collect_status_payloads_uncached", _fake_collect
    )
    monkeypatch.setattr(system_status.redis_cache, "_client", object(), raising=False)
    monkeypatch.setattr(system_status.redis_cache, "set_status_snapshot", _boom)

    snapshot = await system_status.refresh_status_snapshot(
        _build_request("/api/status"),
        ttl_seconds=30,
    )

    assert snapshot["overall_status"] == "online"
    assert system_status.read_l1_status_snapshot() == snapshot


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

    payload = await system.fetch_system_status_details(request)

    assert payload["status"] == "online"
    assert payload["version"] == "9.9.9"
    assert payload["backend"] == "FastAPI"
    assert payload["database"]["chapters"] == 5
    assert payload["database"]["positions"] == 9
    assert payload["tipi"]["chapters"] == 3
    assert payload["nbs"]["items"] == 6
    assert payload["nbs"]["explanatory_entries"] == 2
    assert payload["catalogs"]["nbs"]["status"] == "online"
    assert "nebs" not in payload
    assert "nebs" not in payload["catalogs"]


@pytest.mark.asyncio
async def test_get_status_details_rejects_non_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/status/details")

    with pytest.raises(HTTPException) as exc:
        await system.fetch_system_status_details(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_cache_metrics_rejects_non_admin(monkeypatch):
    async def _mock_admin(_request):  # NOSONAR
        return False

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/cache-metrics")

    with pytest.raises(HTTPException) as exc:
        await system.fetch_system_cache_metrics(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_cache_metrics_returns_payload_for_admin(monkeypatch):
    from backend.presentation.routes import search as search_route
    from backend.presentation.routes import tipi as tipi_route

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    monkeypatch.setattr(
        search_route,
        "snapshotSearchCodePayloadCacheMetrics",
        lambda: {"hits": 1, "misses": 2},
    )
    monkeypatch.setattr(
        tipi_route,
        "snapshotTipiCodePayloadCacheMetrics",
        lambda: {"hits": 3, "misses": 4},
    )

    request = _build_request(
        "/api/cache-metrics",
        state={
            "service": _FakeNeshService({}),
            "tipi_service": _FakeTipiService(),
        },
    )

    payload = await system.fetch_system_cache_metrics(request)

    assert payload["status"] == "ok"
    assert payload["search_code_payload_cache"] == {"hits": 1, "misses": 2}
    assert payload["tipi_code_payload_cache"] == {"hits": 3, "misses": 4}
    assert payload["nesh_internal_caches"] == {"cache": "nesh"}
    assert payload["tipi_internal_caches"] == {"cache": "tipi"}


@pytest.mark.asyncio
async def test_get_metrics_returns_404_when_disabled(monkeypatch):
    monkeypatch.setattr(
        system.settings.observability, "metrics_token", "", raising=False
    )
    request = _build_request("/api/metrics")

    with pytest.raises(HTTPException) as exc:
        await system.fetch_system_metrics(request)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_metrics_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(
        system.settings.observability, "metrics_token", "metrics-secret", raising=False
    )
    request = _build_request("/api/metrics", headers={"X-Metrics-Token": "wrong"})

    with pytest.raises(HTTPException) as exc:
        await system.fetch_system_metrics(request)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_metrics_returns_prometheus_payload(monkeypatch):
    monkeypatch.setattr(
        system.settings.observability, "metrics_token", "metrics-secret", raising=False
    )
    request = _build_request(
        "/api/metrics",
        headers={"X-Metrics-Token": "metrics-secret"},
        state={
            "db": _FakeDb({"status": "online", "chapters": "5", "positions": "9"}),
            "tipi_service": _FakeTipiService(
                {"ok": True, "chapters": "3", "positions": "4"}
            ),
            "nbs_service": _FakeNbsService(
                {"status": "online", "nbs_items": "6", "nebs_entries": "2"}
            ),
            "service": _FakeNeshService({}),
        },
    )

    async def _fake_collect_cache_metrics(_request):  # NOSONAR
        return {
            "status": "ok",
            "search_code_payload_cache": {"hits": 1, "misses": 2},
            "tipi_code_payload_cache": {"hits": 3, "misses": 4},
            "nesh_internal_caches": {"chapter_cache": {"hit_rate": 0.5}},
            "tipi_internal_caches": {"code_search_cache": {"hit_rate": 0.75}},
        }

    monkeypatch.setattr(
        system, "_collect_system_cache_metrics_payload", _fake_collect_cache_metrics
    )

    response = await system.fetch_system_metrics(request)

    assert response.status_code == 200
    body = response.body.decode("utf-8")
    assert (
        "# HELP nesh_catalog_status Catalog health status (1=online, 0=error)." in body
    )
    assert 'nesh_catalog_status{catalog="nesh"} 1' in body
    assert 'nesh_payload_cache_hits{cache="search_code_payload_cache"} 1' in body
    assert (
        'nesh_internal_cache_hit_rate{cache="chapter_cache",service="nesh_internal_caches"} 0.5'
        in body
    )


@pytest.mark.asyncio
async def test_debug_anchors_returns_404_when_debug_mode_is_disabled(monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", False, raising=False)

    async def _mock_admin(_request):  # NOSONAR
        return True

    monkeypatch.setattr(system, "_is_admin_request", _mock_admin)
    request = _build_request("/api/debug/anchors")

    with pytest.raises(HTTPException) as exc:
        await system.debug_nesh_anchors(
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
        await system.debug_nesh_anchors(
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

    payload = await system.debug_nesh_anchors(
        request=request, ncm="8517", service=service
    )

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
        await system.reload_system_secrets(request)

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

    payload = await system.reload_system_secrets(request)

    assert payload == {"success": True}
    assert called["value"] is True
