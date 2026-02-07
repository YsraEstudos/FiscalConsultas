import pytest
from fastapi.testclient import TestClient
import json
from pathlib import Path

from backend.config.settings import settings
from backend.presentation.routes import webhooks
from backend.server.app import app


pytestmark = pytest.mark.integration

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def asaas_payment_confirmed_payload():
    fixture_path = FIXTURES_DIR / "asaas_payment_confirmed.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_webhook_rejects_invalid_json_payload(client):
    response = client.post(
        "/api/webhooks/asaas",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid JSON payload"


def test_webhook_requires_event_field(client):
    response = client.post("/api/webhooks/asaas", json={"payment": {"id": "pay_1"}})
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing event in payload"


def test_webhook_ignores_non_confirmed_event(client):
    response = client.post("/api/webhooks/asaas", json={"event": "PAYMENT_RECEIVED"})
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "processed": False,
        "ignored_event": "PAYMENT_RECEIVED",
    }


def test_webhook_requires_configured_token_when_present(client, monkeypatch):
    monkeypatch.setattr(settings.billing, "asaas_webhook_token", "expected-token")

    response = client.post("/api/webhooks/asaas", json={"event": "PAYMENT_RECEIVED"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Asaas webhook token"


def test_webhook_payment_confirmed_calls_processor(client, monkeypatch, asaas_payment_confirmed_payload):
    monkeypatch.setattr(settings.billing, "asaas_webhook_token", "expected-token")

    async def fake_processor(payload):
        assert payload["event"] == "PAYMENT_CONFIRMED"
        return {
            "processed": True,
            "tenant_id": "org_test",
            "plan_name": "pro",
            "status": "CONFIRMED",
        }

    monkeypatch.setattr(webhooks, "process_asaas_payment_confirmed", fake_processor)

    response = client.post(
        "/api/webhooks/asaas",
        json=asaas_payment_confirmed_payload,
        headers={"x-asaas-access-token": "expected-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "processed": True,
        "tenant_id": "org_test",
        "plan_name": "pro",
        "status": "CONFIRMED",
    }
