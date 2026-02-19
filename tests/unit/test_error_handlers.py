import pytest
from starlette.requests import Request

from backend.config.exceptions import ValidationError
from backend.server import error_handlers


pytestmark = pytest.mark.unit


def _request(path: str = "/api/test") -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_nesh_exception_handler_uses_warning_for_4xx(monkeypatch):
    calls = []
    monkeypatch.setattr(error_handlers.logger, "warning", lambda msg: calls.append(("warning", msg)))
    monkeypatch.setattr(error_handlers.logger, "error", lambda msg: calls.append(("error", msg)))

    exc = ValidationError("invalid", field="ncm")
    response = await error_handlers.nesh_exception_handler(_request("/api/search"), exc)

    payload = response.body.decode("utf-8")
    assert response.status_code == 400
    assert '"code":"VALIDATION_ERROR"' in payload
    assert '"field":"ncm"' in payload
    assert calls and calls[0][0] == "warning"


@pytest.mark.asyncio
async def test_nesh_exception_handler_uses_error_for_5xx(monkeypatch):
    calls = []
    monkeypatch.setattr(error_handlers.logger, "warning", lambda msg: calls.append(("warning", msg)))
    monkeypatch.setattr(error_handlers.logger, "error", lambda msg: calls.append(("error", msg)))

    exc = ValidationError("boom")
    exc.status_code = 500
    response = await error_handlers.nesh_exception_handler(_request("/api/status"), exc)

    assert response.status_code == 500
    assert calls and calls[0][0] == "error"


@pytest.mark.asyncio
async def test_generic_exception_handler_returns_sanitized_payload(monkeypatch):
    captured = []
    monkeypatch.setattr(error_handlers.logger, "exception", lambda msg: captured.append(msg))

    response = await error_handlers.generic_exception_handler(
        _request("/api/unknown"),
        RuntimeError("internal stack"),
    )

    payload = response.body.decode("utf-8")
    assert response.status_code == 500
    assert '"code":"INTERNAL_ERROR"' in payload
    assert '"details":null' in payload
    assert captured
