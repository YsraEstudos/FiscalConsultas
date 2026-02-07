import pytest
from fastapi.testclient import TestClient
import json
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select

from backend.config.settings import settings
from backend.domain.sqlmodels import Subscription, Tenant
from backend.infrastructure.db_engine import get_session
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


async def _read_subscription_state(tenant_id: str):
    async with get_session() as session:
        tenant = await session.get(Tenant, tenant_id)
        result = await session.execute(
            select(Subscription).where(
                Subscription.provider == "asaas",
                Subscription.tenant_id == tenant_id,
            )
        )
        subscriptions = result.scalars().all()
        return tenant, subscriptions


async def _cleanup_subscription_state(tenant_id: str):
    async with get_session() as session:
        await session.execute(
            delete(Subscription).where(Subscription.tenant_id == tenant_id)
        )
        await session.execute(delete(Tenant).where(Tenant.id == tenant_id))


@pytest.mark.asyncio
async def test_process_payment_confirmed_requires_external_reference(asaas_payment_confirmed_payload):
    payload = deepcopy(asaas_payment_confirmed_payload)
    payload["payment"].pop("externalReference", None)

    result = await webhooks.process_asaas_payment_confirmed(payload)

    assert result == {"processed": False, "reason": "missing_external_reference"}


@pytest.mark.asyncio
async def test_process_payment_confirmed_rejects_invalid_tenant_id(asaas_payment_confirmed_payload):
    payload = deepcopy(asaas_payment_confirmed_payload)
    payload["payment"]["externalReference"] = "tenant invalido"

    result = await webhooks.process_asaas_payment_confirmed(payload)

    assert result == {"processed": False, "reason": "invalid_tenant_id"}


@pytest.mark.asyncio
async def test_process_payment_confirmed_rejects_non_positive_amount(asaas_payment_confirmed_payload):
    payload = deepcopy(asaas_payment_confirmed_payload)
    payload["payment"]["externalReference"] = f"org_test_{uuid4().hex[:8]}"
    payload["payment"]["value"] = -1

    result = await webhooks.process_asaas_payment_confirmed(payload)

    assert result == {"processed": False, "reason": "invalid_amount"}


@pytest.mark.asyncio
async def test_process_payment_confirmed_is_idempotent_for_same_subscription(asaas_payment_confirmed_payload):
    tenant_id = f"org_test_{uuid4().hex[:8]}"
    provider_subscription_id = f"sub_{uuid4().hex[:8]}"

    payload = deepcopy(asaas_payment_confirmed_payload)
    payload["payment"]["externalReference"] = tenant_id
    payload["payment"]["subscription"] = provider_subscription_id
    payload["payment"]["id"] = f"pay_{uuid4().hex[:8]}"

    try:
        first = await webhooks.process_asaas_payment_confirmed(payload)
        second = await webhooks.process_asaas_payment_confirmed(payload)

        assert first["processed"] is True
        assert second["processed"] is True

        tenant, subscriptions = await _read_subscription_state(tenant_id)
        assert tenant is not None
        assert tenant.is_active is True
        assert len(subscriptions) == 1
        assert subscriptions[0].provider_subscription_id == provider_subscription_id
    finally:
        await _cleanup_subscription_state(tenant_id)
