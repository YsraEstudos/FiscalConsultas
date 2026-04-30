import pytest
from backend.config.settings import settings
from backend.presentation.routes import auth
from backend.server.app import app
from backend.server.dependencies import get_ai_service

pytestmark = pytest.mark.integration


class _FakeAiService:
    async def get_chat_response(self, message: str) -> str:  # NOSONAR
        return f"echo:{message}"


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_security_allowlists():
    original_ai_chat = list(settings.security.ai_chat_allowed_emails)
    original_restricted_ui = (
        None
        if settings.security.restricted_ui_allowed_emails is None
        else list(settings.security.restricted_ui_allowed_emails)
    )
    yield
    settings.security.ai_chat_allowed_emails = original_ai_chat
    settings.security.restricted_ui_allowed_emails = original_restricted_ui


def test_auth_me_without_token_returns_not_authenticated(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {
        "authenticated": False,
        "can_use_ai_chat": False,
        "can_use_restricted_ui": False,
    }


def test_auth_me_returns_capabilities_for_allowlisted_user(client, monkeypatch):
    settings.security.ai_chat_allowed_emails = ["allow@example.com"]
    settings.security.restricted_ui_allowed_emails = ["allow@example.com"]

    async def _mock_decode(_t):  # NOSONAR
        return {"sub": "user_1", "email": "allow@example.com"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": True,
        "can_use_ai_chat": True,
        "can_use_restricted_ui": True,
    }


def test_ai_chat_requires_authentication(client):
    response = client.post("/api/ai/chat", json={"message": "hello"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_ai_chat_success_response_with_dependency_override(client, monkeypatch):
    settings.security.ai_chat_allowed_emails = ["allow@example.com"]

    async def _mock_decode(_t):  # NOSONAR
        return {"sub": "user_1", "email": "allow@example.com"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)

    async def _allow_consume(key, limit):  # NOSONAR
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


def test_ai_chat_returns_forbidden_when_user_is_not_allowlisted(client, monkeypatch):
    settings.security.ai_chat_allowed_emails = ["allow@example.com"]

    async def _mock_decode(_t):  # NOSONAR
        return {"sub": "user_1", "email": "blocked@example.com"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)
    app.dependency_overrides[get_ai_service] = lambda: _FakeAiService()

    response = client.post(
        "/api/ai/chat",
        json={"message": "hello"},
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 403
    assert "AI chat access" in response.json()["detail"]


def test_ai_chat_returns_retry_after_when_rate_limited(client, monkeypatch):
    settings.security.ai_chat_allowed_emails = ["allow@example.com"]

    async def _mock_decode(_t):  # NOSONAR
        return {"sub": "user_1", "email": "allow@example.com"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)

    async def _deny_consume(key, limit):  # NOSONAR
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
