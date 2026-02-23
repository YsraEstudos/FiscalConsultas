import pytest
from backend.presentation.routes import system
from starlette.requests import Request

pytestmark = pytest.mark.unit


def _build_request(headers: dict[str, str] | None = None) -> Request:
    headers = headers or {}
    scope_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()
    ]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/admin/reload-secrets",
        "headers": scope_headers,
    }
    return Request(scope)


def test_normalize_db_status_with_missing_payload_returns_error_contract():
    payload = system._normalize_db_status(None, latency_ms=12.34)
    assert payload == {
        "status": "error",
        "chapters": 0,
        "positions": 0,
        "latency_ms": 12.34,
        "error": "Database unavailable",
    }


def test_normalize_db_status_with_valid_stats_coerces_values():
    payload = system._normalize_db_status(
        {"status": "online", "chapters": "10", "positions": "20"},
        latency_ms=5.5,
    )
    assert payload == {
        "status": "online",
        "chapters": 10,
        "positions": 20,
        "latency_ms": 5.5,
    }


def test_normalize_tipi_status_handles_online_and_error_states():
    online_payload = system._normalize_tipi_status(
        {"ok": True, "chapters": "3", "positions": "7"}
    )
    error_payload = system._normalize_tipi_status(
        {"status": "error", "error": "db down"}
    )

    assert online_payload == {
        "status": "online",
        "chapters": 3,
        "positions": 7,
    }
    assert error_payload == {
        "status": "error",
        "chapters": 0,
        "positions": 0,
        "error": "db down",
    }


@pytest.mark.asyncio
async def test_is_admin_request_accepts_valid_admin_token(monkeypatch):
    request = _build_request(headers={"X-Admin-Token": "token123"})
    monkeypatch.setattr(
        system, "is_valid_admin_token", lambda token: token == "token123"
    )

    assert (await system._is_admin_request(request)) is True


@pytest.mark.asyncio
async def test_is_admin_request_accepts_admin_role_in_jwt(monkeypatch):
    request = _build_request(headers={"Authorization": "Bearer jwt-token"})
    monkeypatch.setattr(system, "is_valid_admin_token", lambda _token: False)

    async def _mock_decode(_t):  # NOSONAR
        return {"role": "admin"}

    monkeypatch.setattr(system, "decode_clerk_jwt", _mock_decode)

    assert (await system._is_admin_request(request)) is True


@pytest.mark.asyncio
async def test_is_admin_request_rejects_non_admin_user(monkeypatch):
    request = _build_request(headers={"Authorization": "Bearer jwt-token"})
    monkeypatch.setattr(system, "is_valid_admin_token", lambda _token: False)

    async def _mock_decode(_t):  # NOSONAR
        return {"role": "user"}

    monkeypatch.setattr(system, "decode_clerk_jwt", _mock_decode)

    assert (await system._is_admin_request(request)) is False
