"""
Testes de contrato para a API de Perfil de Usuário.

Segue o padrão de test_comments_api_contract.py:
- Mock de decode_clerk_jwt e get_current_tenant via monkeypatch
- Override de _get_service com _FakeProfileService
"""

from types import SimpleNamespace
from datetime import datetime, timezone

import pytest
from backend.presentation.routes import profile
from backend.server.app import app
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


class _FakeProfileService:
    """Fake service para testes de contrato — sem acesso ao banco."""

    async def get_profile(self, user_id: str, tenant_id: str, image_url=None):
        return {
            "user_id": user_id,
            "email": "test@example.com",
            "full_name": "Test User",
            "bio": "Uma bio de teste",
            "image_url": image_url,
            "tenant_id": tenant_id,
            "org_name": "Test Org",
            "is_active": True,
            "comment_count": 5,
            "approved_comment_count": 3,
            "pending_comment_count": 2,
        }

    async def update_bio(self, user_id: str, tenant_id: str, data, image_url=None):
        profile = await self.get_profile(user_id, tenant_id, image_url=image_url)
        profile["bio"] = data.bio
        return profile

    async def get_contributions(
        self, user_id, tenant_id, page=1, page_size=20, search=None, status_filter=None
    ):
        now = datetime.now(timezone.utc)
        items = [
            SimpleNamespace(
                id=1,
                type="comment",
                anchor_key="ncm-8517.12.31",
                selected_text="texto selecionado",
                body="comentário de teste",
                status="approved",
                created_at=now,
                updated_at=now,
            ),
        ]
        return {
            "items": items,
            "total": 1,
            "page": page,
            "page_size": page_size,
            "has_next": False,
        }

    async def get_user_card(self, user_id: str, tenant_id: str):
        return {
            "user_id": user_id,
            "full_name": "Card User",
            "bio": "Bio do card",
            "image_url": None,
            "comment_count": 10,
        }

    async def delete_account(self, user_id: str, tenant_id: str):
        return None


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


# ─── Helpers ───────────────────────────────────────────────────────────────


async def _mock_decode_valid(_t):
    return {
        "sub": "user_test_123",
        "org_id": "org_test",
        "picture": "https://img.clerk.com/avatar.png",
    }


async def _mock_decode_none(_t):
    return None


async def _mock_decode_without_sub(_t):
    return {"org_id": "org_test"}


async def _mock_decode_tenant_mismatch(_t):
    return {
        "sub": "user_test_123",
        "org_id": "org_other",
        "picture": "https://img.clerk.com/avatar.png",
    }


def _setup_mocks(monkeypatch):
    """Configura mocks padrão de JWT e tenant para testes autenticados."""
    monkeypatch.setattr(profile, "decode_clerk_jwt", _mock_decode_valid)
    monkeypatch.setattr(profile, "get_current_tenant", lambda: "org_test")
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()


# ─── Tests: GET /api/profile/me ────────────────────────────────────────────


def test_get_profile_requires_token(client):
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()

    response = client.get("/api/profile/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Token ausente"


def test_get_profile_returns_200_with_profile_data(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.get(
        "/api/profile/me",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == "user_test_123"
    assert body["email"] == "test@example.com"
    assert body["full_name"] == "Test User"
    assert body["bio"] == "Uma bio de teste"
    assert body["tenant_id"] == "org_test"
    assert body["comment_count"] == 5
    assert body["approved_comment_count"] == 3
    assert body["image_url"] == "https://img.clerk.com/avatar.png"


# ─── Tests: PATCH /api/profile/me ──────────────────────────────────────────


def test_update_profile_bio(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.patch(
        "/api/profile/me",
        json={"bio": "Nova bio atualizada"},
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["bio"] == "Nova bio atualizada"


def test_update_profile_bio_empty_string_becomes_none(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.patch(
        "/api/profile/me",
        json={"bio": "   "},
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["bio"] is None


# ─── Tests: GET /api/profile/me/contributions ──────────────────────────────


def test_get_contributions_returns_paginated_list(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.get(
        "/api/profile/me/contributions",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["has_next"] is False
    assert len(body["items"]) == 1
    assert body["items"][0]["anchor_key"] == "ncm-8517.12.31"
    assert body["items"][0]["type"] == "comment"


# ─── Tests: GET /api/profile/{user_id}/card ────────────────────────────────


def test_get_user_card_returns_mini_profile(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.get(
        "/api/profile/user_other_456/card",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == "user_other_456"
    assert body["full_name"] == "Card User"
    assert body["bio"] == "Bio do card"
    assert body["comment_count"] == 10


# ─── Tests: DELETE /api/profile/me ─────────────────────────────────────────


def test_delete_account_returns_success(client, monkeypatch):
    _setup_mocks(monkeypatch)

    response = client.delete(
        "/api/profile/me",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True


def test_delete_account_requires_token(client):
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()

    response = client.delete("/api/profile/me")

    assert response.status_code == 401


# ─── Tests: tenant resolution from JWT org_id ──────────────────────────────


def test_get_profile_uses_org_id_when_tenant_context_missing(client, monkeypatch):
    monkeypatch.setattr(profile, "decode_clerk_jwt", _mock_decode_valid)
    monkeypatch.setattr(profile, "get_current_tenant", lambda: None)
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()

    response = client.get(
        "/api/profile/me",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == "org_test"


def test_get_profile_rejects_payload_without_sub(client, monkeypatch):
    monkeypatch.setattr(profile, "decode_clerk_jwt", _mock_decode_without_sub)
    monkeypatch.setattr(profile, "get_current_tenant", lambda: "org_test")
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()

    response = client.get(
        "/api/profile/me",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 401


def test_get_profile_rejects_tenant_mismatch_between_context_and_jwt(client, monkeypatch):
    monkeypatch.setattr(profile, "decode_clerk_jwt", _mock_decode_tenant_mismatch)
    monkeypatch.setattr(profile, "get_current_tenant", lambda: "org_test")
    app.dependency_overrides[profile._get_service] = lambda: _FakeProfileService()

    response = client.get(
        "/api/profile/me",
        headers={"Authorization": "Bearer mock-token"},
    )

    assert response.status_code == 403
