from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from backend.presentation.routes import comments
from backend.server.app import app
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


class _FakeCommentService:
    async def create_comment(self, payload, tenant_id: str, user_id: str):  # NOSONAR
        """
        Create a comment object representing a newly created comment using the supplied payload and identifiers.

        Parameters:
            payload: An object with attributes `anchor_key`, `selected_text`, `body`, `user_name`, and `user_image_url`.
            tenant_id (str): Tenant identifier to associate with the comment.
            user_id (str): User identifier of the comment author.

        Returns:
            SimpleNamespace: An object with the following attributes:
                id (int): Comment identifier (1).
                tenant_id (str): The provided tenant_id.
                user_id (str): The provided user_id.
                anchor_key (str): From payload.anchor_key.
                selected_text (str): From payload.selected_text.
                body (str): From payload.body.
                status (str): "pending".
                created_at (datetime): UTC timestamp when the comment was created.
                updated_at (datetime): UTC timestamp equal to created_at.
                moderated_by: None.
                moderated_at: None.
                user_name (str): From payload.user_name.
                user_image_url (str): From payload.user_image_url.
        """
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=1,
            tenant_id=tenant_id,
            user_id=user_id,
            anchor_key=payload.anchor_key,
            selected_text=payload.selected_text,
            body=payload.body,
            status="pending",
            created_at=now,
            updated_at=now,
            moderated_by=None,
            moderated_at=None,
            user_name=payload.user_name,
            user_image_url=payload.user_image_url,
        )

    async def get_commented_anchors(self, tenant_id: str):  # NOSONAR
        """
        Return a list of commented anchor keys for the given tenant.

        Parameters:
            tenant_id (str): Tenant identifier used to determine which anchor keys to return.

        Returns:
            list[str]: Anchor key strings for the tenant. Returns ["auto-anchor-1"] when tenant_id is "org_fallback", otherwise returns ["pos-84-07"].
        """
        if tenant_id == "org_fallback":
            return ["auto-anchor-1"]
        return ["pos-84-07"]


@pytest.fixture()
def client():
    """
    Provide a TestClient instance configured for the FastAPI application for use in tests.

    Yields:
        test_client (TestClient): A TestClient connected to the app; the client is created and closed automatically.
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    """
    Ensure FastAPI dependency overrides are cleared before and after each test.

    This fixture clears app.dependency_overrides before yielding to the test and again after the test completes, preventing state leakage between tests.
    """
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def test_create_comment_requires_token(client):
    app.dependency_overrides[comments._get_service] = lambda: _FakeCommentService()

    response = client.post(
        "/api/comments/",
        json={
            "anchor_key": "pos-84-07",
            "selected_text": "texto selecionado",
            "body": "comentario",
            "is_private": False,
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Token ausente"


def test_create_comment_returns_201_with_expected_payload(client, monkeypatch):
    async def _mock_decode(_t):  # NOSONAR
        """
        Return a fixed JWT-like payload containing the subject claim used in tests.

        Parameters:
            _t (str): Incoming token value (ignored).

        Returns:
            dict: A payload with the `sub` claim set to `"user_test_123"`.
        """
        return {"sub": "user_test_123"}

    monkeypatch.setattr(comments, "decode_clerk_jwt", _mock_decode)
    monkeypatch.setattr(comments, "get_current_tenant", lambda: "org_test")
    app.dependency_overrides[comments._get_service] = lambda: _FakeCommentService()

    response = client.post(
        "/api/comments/",
        json={
            "anchor_key": "pos-84-07",
            "selected_text": "texto selecionado",
            "body": "comentario teste",
            "is_private": False,
            "user_name": "Test User",
            "user_image_url": "https://example.com/avatar.png",
        },
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 201
    body = response.json()

    assert body["id"] == 1
    assert body["tenant_id"] == "org_test"
    assert body["user_id"] == "user_test_123"
    assert body["anchor_key"] == "pos-84-07"
    assert body["status"] == "pending"
    assert body["user_name"] == "Test User"
    assert body["user_image_url"] == "https://example.com/avatar.png"

    created_at = datetime.fromisoformat(body["created_at"].replace("Z", "+00:00"))
    updated_at = datetime.fromisoformat(body["updated_at"].replace("Z", "+00:00"))
    assert created_at.tzinfo is not None
    assert updated_at.tzinfo is not None


def test_create_comment_uses_org_id_claim_when_tenant_context_is_missing(
    client, monkeypatch
):
    """
    Ensure the API uses the JWT `org_id` claim as the tenant_id when no tenant context is available.

    Sends a POST to /api/comments/ with an Authorization header and no resolved tenant, then verifies the created comment's `tenant_id` equals the `org_id` value from the decoded JWT.
    """

    async def _mock_decode(_t):  # NOSONAR
        return {"sub": "user_test_123", "org_id": "org_fallback"}

    monkeypatch.setattr(comments, "decode_clerk_jwt", _mock_decode)
    monkeypatch.setattr(comments, "get_current_tenant", lambda: None)
    app.dependency_overrides[comments._get_service] = lambda: _FakeCommentService()

    response = client.post(
        "/api/comments/",
        json={
            "anchor_key": "auto-anchor-1",
            "selected_text": "texto selecionado",
            "body": "comentario fallback",
            "is_private": False,
        },
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 201
    assert response.json()["tenant_id"] == "org_fallback"


def test_list_commented_anchors_uses_org_id_claim_when_tenant_context_is_missing(
    client, monkeypatch
):
    async def _mock_decode(_t):  # NOSONAR
        """
        Provide a fixed JWT claim dictionary for tests.

        Parameters:
            _t (str): Ignored token input.

        Returns:
            dict: A dictionary with `sub` set to "user_test_123" and `org_id` set to "org_fallback".
        """
        return {"sub": "user_test_123", "org_id": "org_fallback"}

    monkeypatch.setattr(comments, "decode_clerk_jwt", _mock_decode)
    monkeypatch.setattr(comments, "get_current_tenant", lambda: None)
    app.dependency_overrides[comments._get_service] = lambda: _FakeCommentService()

    response = client.get(
        "/api/comments/anchors",
        headers={"Authorization": "Bearer mock-auth-header"},
    )

    assert response.status_code == 200
    assert response.json() == ["auto-anchor-1"]
