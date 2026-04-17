import importlib
import os
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.presentation.routes import system

pytestmark = pytest.mark.integration


@pytest.fixture
def fallback_client():
    import backend.server.app as app_module

    static_dir = (
        Path(app_module.__file__).resolve().parents[2] / "client" / "dist"
    ).resolve()
    real_exists = os.path.exists

    def _fake_exists(path):
        try:
            if Path(path).resolve() == static_dir:
                return False
        except OSError:
            pass
        return real_exists(path)

    with patch("os.path.exists", side_effect=_fake_exists):
        reloaded_app_module = importlib.reload(app_module)
        with TestClient(reloaded_app_module.app) as test_client:
            yield test_client
    importlib.reload(app_module)


def test_status_endpoint(client):
    """
    Verify the /api/status endpoint returns healthy status.
    """
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()

    # Check database status
    if data.get("database", {}).get("status") == "error":
        print(f"\nDEBUG DB ERROR: {data['database']}")

    expected_global = (
        "online"
        if data.get("database", {}).get("status") == "online"
        and data.get("tipi", {}).get("status") == "online"
        and data.get("nbs", {}).get("status") == "online"
        and data.get("nebs", {}).get("status") == "online"
        else "error"
    )
    assert data.get("status") == expected_global, (
        f"Inconsistent global status. Got: {data}"
    )
    assert "version" not in data
    assert "backend" not in data
    assert "chapters" not in data["database"]
    assert "positions" not in data["database"]
    assert "error" not in data["database"]
    assert "ok" not in data.get("tipi", {})
    assert "error" not in data.get("tipi", {})
    assert "items" not in data.get("nbs", {})
    assert "entries" not in data.get("nebs", {})
    assert "catalogs" in data
    assert set(data["catalogs"].keys()) == {"nesh", "tipi", "nbs", "nebs"}


def test_status_details_requires_admin(client):
    response = client.get("/api/status/details")
    assert response.status_code == 403


def test_status_details_returns_internal_data_for_admin(client, monkeypatch):
    monkeypatch.setattr(
        system, "is_valid_admin_token", lambda token: token == "admin-ok"
    )

    response = client.get("/api/status/details", headers={"X-Admin-Token": "admin-ok"})
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert data["backend"] == "FastAPI"
    assert "chapters" in data["database"]
    assert "positions" in data["database"]
    assert "items" in data["nbs"]
    assert "entries" in data["nebs"]
    assert "catalogs" in data


def test_status_endpoint_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 13

    monkeypatch.setattr(system.status_rate_limiter, "consume", _deny_consume)

    response = client.get("/api/status")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "13"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_status_details_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 9

    monkeypatch.setattr(system, "is_valid_admin_token", lambda _token: True)
    monkeypatch.setattr(system.status_rate_limiter, "consume", _deny_consume)

    response = client.get("/api/status/details", headers={"X-Admin-Token": "admin-ok"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "9"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_status_public_rate_limit_blocks_burst_requests(client, monkeypatch):
    monkeypatch.setattr(
        system.settings.security,
        "status_requests_per_minute",
        2,
        raising=False,
    )
    system.status_rate_limiter.reset()
    unique_ip = f"198.51.100.{uuid.uuid4().int % 250 + 1}"
    request_headers = {"X-Forwarded-For": unique_ip}

    first = client.get("/api/status", headers=request_headers)
    second = client.get("/api/status", headers=request_headers)
    third = client.get("/api/status", headers=request_headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1


def test_security_headers_are_sent_on_public_responses(client):
    for path in ("/", "/api/status"):
        response = client.get(path)

        assert response.status_code == 200
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert (
            response.headers["Permissions-Policy"]
            == "camera=(), microphone=(), geolocation=()"
        )
        assert "Strict-Transport-Security" not in response.headers


def test_production_csp_does_not_expose_local_connect_sources(client, monkeypatch):
    monkeypatch.setattr(system.settings.server, "env", "production", raising=False)

    response = client.get("/api/status")

    assert response.status_code == 200
    csp = response.headers["Content-Security-Policy"]
    assert "localhost" not in csp
    assert "127.0.0.1" not in csp
    assert "connect-src 'self' https: wss:" in csp


def test_openapi_route_is_hidden_without_local_debug_mode(client, monkeypatch):
    monkeypatch.setattr(system.settings.features, "debug_mode", False, raising=False)

    response = client.get("/openapi.json")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_frontend_fallback(client):
    """
    Verify the root endpoint handles missing frontend build gracefully.
    """
    response = client.get("/")
    assert response.status_code == 200
    # Should return either HTML (if build exists) or the fallback JSON message
    # We don't strictly assert content type here as it depends on build state,
    # but 200 OK means it didn't crash.


def test_root_and_status_support_head_requests(fallback_client):
    root_response = fallback_client.head("/")
    status_response = fallback_client.head("/api/status")

    assert root_response.status_code == 200
    assert status_response.status_code == 200


def test_status_head_skips_rate_limit(client, monkeypatch):
    monkeypatch.setattr(
        system.status_rate_limiter,
        "consume",
        AsyncMock(return_value=(False, 7)),
    )

    response = client.head("/api/status")

    assert response.status_code == 200


def test_cors_exposes_request_id_header(client):
    response = client.get(
        "/api/status",
        headers={"Origin": "https://ysraestudos.github.io"},
    )

    assert response.status_code == 200
    exposed_headers = response.headers.get("Access-Control-Expose-Headers", "")
    assert "X-Request-Id" in exposed_headers


def test_metrics_endpoint_requires_token(client, monkeypatch):
    monkeypatch.setattr(
        system.settings.observability, "metrics_token", "metrics-secret", raising=False
    )

    response = client.get("/api/metrics")

    assert response.status_code == 403


def test_metrics_endpoint_returns_prometheus_payload_with_token(client, monkeypatch):
    monkeypatch.setattr(
        system.settings.observability, "metrics_token", "metrics-secret", raising=False
    )

    response = client.get("/api/metrics", headers={"X-Metrics-Token": "metrics-secret"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "nesh_catalog_status" in response.text
    assert "nesh_payload_cache_hits" in response.text
