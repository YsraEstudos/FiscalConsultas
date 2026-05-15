from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.presentation.routes import admin_dashboard
from backend.presentation.routes.admin_dashboard import (
    SearchEventRequest,
    _telemetry_rate_limiter,
)

pytestmark = pytest.mark.unit


def _build_request(
    path: str,
    *,
    method: str = "POST",
    headers: dict[str, str] | None = None,
    auth_header: str | None = None,
    client_host: str = "127.0.0.1",
) -> Request:
    headers = {
        **({"Authorization": auth_header} if auth_header else {}),
        **(headers or {}),
    }
    scope_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in headers.items()
    ]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": scope_headers,
        "client": (client_host, 12345),
        "app": SimpleNamespace(state=SimpleNamespace()),
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    _telemetry_rate_limiter.reset()
    yield
    _telemetry_rate_limiter.reset()


class FakeSession:
    def __init__(self):
        self.added = []
        self.executed = []

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, stmt, *args, **kwargs):
        self.executed.append(stmt)

        # return a fake result that can be iterated or fetchall'd
        class FakeResult:
            def __iter__(self):
                return iter([])

            def one_or_none(self):
                return None

        return FakeResult()


@pytest.fixture
def fake_db(monkeypatch):
    session = FakeSession()

    @asynccontextmanager
    async def fake_get_session():
        yield session

    monkeypatch.setattr(admin_dashboard, "get_session", fake_get_session)
    return session


@pytest.mark.asyncio
async def test_log_search_event_success(fake_db, monkeypatch):
    req = _build_request("/admin/search-event", auth_header=None)
    body = SearchEventRequest(
        search_type="nesh",
        search_query="test",
        device_fingerprint="fp123",
        device_label="my-pc",
    )

    # Disable random cleanup for reliable tests
    monkeypatch.setattr("secrets.randbelow", lambda _: 1)

    res = await admin_dashboard.log_search_event(body, req)
    assert res is None

    assert len(fake_db.added) == 1
    event = fake_db.added[0]
    assert event.search_type == "nesh"
    assert event.device_fingerprint == "fp123"
    assert event.device_label == "my-pc"
    assert event.user_email is None


@pytest.mark.asyncio
async def test_log_search_event_invalid_type():
    req = _build_request("/admin/search-event")
    body = SearchEventRequest(
        search_type="invalid_type", search_query="test", device_fingerprint="fp123"
    )

    with pytest.raises(HTTPException) as exc:
        await admin_dashboard.log_search_event(body, req)

    assert exc.value.status_code == 422
    assert "Invalid search_type" in exc.value.detail


@pytest.mark.asyncio
async def test_log_search_event_rate_limiting(fake_db, monkeypatch):
    req = _build_request("/admin/search-event", client_host="192.168.1.1")
    body = SearchEventRequest(
        search_type="nesh", search_query="test", device_fingerprint="fp123"
    )
    monkeypatch.setattr("secrets.randbelow", lambda _: 1)

    # Exhaust the rate limit (60 requests)
    for _ in range(60):
        await admin_dashboard.log_search_event(body, req)

    # The 61st request should be blocked
    with pytest.raises(HTTPException) as exc:
        await admin_dashboard.log_search_event(body, req)

    assert exc.value.status_code == 429
    assert "Too many requests" in exc.value.detail

    # But another IP or fingerprint should be allowed
    req2 = _build_request("/admin/search-event", client_host="192.168.1.2")
    await admin_dashboard.log_search_event(body, req2)  # Success

    body2 = SearchEventRequest(
        search_type="nesh", search_query="test", device_fingerprint="fp456"
    )
    await admin_dashboard.log_search_event(body2, req)  # Success


@pytest.mark.asyncio
async def test_dashboard_routes_require_admin(fake_db):
    req = _build_request("/admin/dashboard", auth_header=None)

    with pytest.raises(HTTPException) as exc:
        await admin_dashboard.get_admin_dashboard(req)
    assert exc.value.status_code == 403

    req2 = _build_request("/admin/device/fp123/history", auth_header=None)
    with pytest.raises(HTTPException) as exc:
        await admin_dashboard.get_device_history("fp123", req2)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_dashboard_routes_allow_admin(fake_db, monkeypatch):
    async def fake_decode_jwt(token: str) -> dict[str, Any]:
        return {
            "email": "admin@example.com",
            "sub": "admin123",
            "org_role": "org:admin",
        }

    monkeypatch.setattr(admin_dashboard, "decode_clerk_jwt", fake_decode_jwt)
    monkeypatch.setattr(
        admin_dashboard, "extract_bearer_token", lambda req: "fake-token"
    )

    req = _build_request("/admin/dashboard", auth_header="Bearer fake-token")

    res = await admin_dashboard.get_admin_dashboard(req)
    assert res.total_active_devices == 0
    assert res.devices == []


@pytest.mark.asyncio
async def test_dashboard_device_query_uses_retention_window(fake_db, monkeypatch):
    async def fake_decode_jwt(token: str) -> dict[str, Any]:
        return {
            "email": "admin@example.com",
            "sub": "admin123",
            "org_role": "org:admin",
        }

    monkeypatch.setattr(admin_dashboard, "decode_clerk_jwt", fake_decode_jwt)
    monkeypatch.setattr(
        admin_dashboard, "extract_bearer_token", lambda req: "fake-token"
    )

    req = _build_request("/admin/dashboard", auth_header="Bearer fake-token")

    await admin_dashboard.get_admin_dashboard(req)

    device_query = next(
        (
            str(stmt)
            for stmt in fake_db.executed
            if "GROUP BY search_events.device_fingerprint" in str(stmt)
            and "search_events.created_at" in str(stmt)
        ),
        "",
    )
    assert device_query
    assert "search_events.created_at >= " in device_query
    assert "IN (SELECT" in device_query
