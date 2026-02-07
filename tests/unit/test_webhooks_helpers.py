from datetime import datetime

from starlette.requests import Request
import pytest

from backend.config.settings import settings
from backend.presentation.routes import webhooks

pytestmark = pytest.mark.unit


def _request_with_headers(headers: dict[str, str] | None = None) -> Request:
    headers = headers or {}
    scope_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/webhooks/asaas",
        "headers": scope_headers,
    }
    return Request(scope)


def test_parse_date_handles_valid_and_invalid_values():
    assert webhooks._parse_date("2026-02-07") is not None
    assert webhooks._parse_date("2026-02-07T12:00:00Z").isoformat() == "2026-02-07"
    assert webhooks._parse_date("invalid-date") is None
    assert webhooks._parse_date(None) is None


def test_parse_datetime_normalizes_utc_timezone():
    parsed = webhooks._parse_datetime("2026-02-07T03:04:05Z")
    assert isinstance(parsed, datetime)
    assert parsed.isoformat() == "2026-02-07T03:04:05"


def test_parse_datetime_returns_none_for_invalid_values():
    assert webhooks._parse_datetime("bad-value") is None
    assert webhooks._parse_datetime("") is None
    assert webhooks._parse_datetime(None) is None


def test_is_valid_webhook_without_configured_token(monkeypatch):
    monkeypatch.setattr(settings.billing, "asaas_webhook_token", None)
    request = _request_with_headers()
    assert webhooks._is_valid_asaas_webhook(request) is True


def test_is_valid_webhook_with_required_token(monkeypatch):
    monkeypatch.setattr(settings.billing, "asaas_webhook_token", "secret-token")

    valid_request = _request_with_headers({"x-asaas-access-token": "secret-token"})
    invalid_request = _request_with_headers({"x-asaas-access-token": "wrong-token"})
    missing_request = _request_with_headers()

    assert webhooks._is_valid_asaas_webhook(valid_request) is True
    assert webhooks._is_valid_asaas_webhook(invalid_request) is False
    assert webhooks._is_valid_asaas_webhook(missing_request) is False
