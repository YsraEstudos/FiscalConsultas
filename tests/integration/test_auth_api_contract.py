import pytest
from fastapi.testclient import TestClient

from backend.server.app import app
from backend.server.dependencies import get_ai_service
from backend.presentation.routes import auth


pytestmark = pytest.mark.integration


class _FakeAiService:
    async def get_chat_response(self, message: str) -> str:
        return f"echo:{message}"


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def test_auth_me_without_token_returns_not_authenticated(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


def test_ai_chat_requires_authentication(client):
    response = client.post("/api/ai/chat", json={"message": "hello"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_ai_chat_success_response_with_dependency_override(client, monkeypatch):
    monkeypatch.setattr(auth, "decode_clerk_jwt", lambda _token: {"sub": "user_1"})

    async def _allow_consume(key, limit):
        return True, 0

    monkeypatch.setattr(auth.ai_chat_rate_limiter, "consume", _allow_consume)
    app.dependency_overrides[get_ai_service] = lambda: _FakeAiService()

    response = client.post(
        "/api/ai/chat",
        json={"message": "hello"},
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "reply": "echo:hello"}


def test_ai_chat_returns_retry_after_when_rate_limited(client, monkeypatch):
    monkeypatch.setattr(auth, "decode_clerk_jwt", lambda _token: {"sub": "user_1"})

    async def _deny_consume(key, limit):
        return False, 17

    monkeypatch.setattr(auth.ai_chat_rate_limiter, "consume", _deny_consume)
    app.dependency_overrides[get_ai_service] = lambda: _FakeAiService()

    response = client.post(
        "/api/ai/chat",
        json={"message": "hello"},
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "17"
    assert "Rate limit exceeded" in response.json()["detail"]
