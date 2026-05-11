from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from backend.presentation.routes import security

pytestmark = pytest.mark.unit


def _build_request(client_host: str = "203.0.113.10") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/security/incident",
        "headers": [(b"user-agent", b"test-agent/1.0")],
        "scheme": "https",
        "client": (client_host, 12345),
        "server": ("testserver", 443),
        "app": SimpleNamespace(state=SimpleNamespace()),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_report_security_incident_logs_warning(monkeypatch, caplog):
    async def allow_once(*, key: str, limit: int) -> tuple[bool, int]:
        assert key == "203.0.113.10:devtools"
        assert limit == security._INCIDENT_THRESHOLD
        return True, 0

    monkeypatch.setattr(security._incident_tracker, "consume", allow_once)

    with caplog.at_level(logging.WARNING, logger="routes.security"):
        payload = await security.report_security_incident(
            _build_request(),
            security.SecurityIncidentReport(type="devtools", ts=123),
        )

    assert payload == {"acknowledged": True}
    assert "SECURITY_INCIDENT received" in caplog.text


@pytest.mark.asyncio
async def test_report_security_incident_escalates_after_threshold(monkeypatch, caplog):
    async def reject_after_threshold(*, key: str, limit: int) -> tuple[bool, int]:
        assert key == "203.0.113.10:tamper"
        assert limit == security._INCIDENT_THRESHOLD
        return False, 60

    monkeypatch.setattr(security._incident_tracker, "consume", reject_after_threshold)

    with caplog.at_level(logging.CRITICAL, logger="routes.security"):
        payload = await security.report_security_incident(
            _build_request(),
            security.SecurityIncidentReport(type="tamper", ts=456),
        )

    assert payload == {"acknowledged": True}
    assert "SECURITY_ESCALATION threshold_exceeded=true" in caplog.text
