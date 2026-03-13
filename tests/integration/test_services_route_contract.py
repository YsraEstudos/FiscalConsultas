import pytest
from fastapi.testclient import TestClient

import backend.presentation.routes.services as services_routes
from backend.server.app import app
from backend.server.dependencies import get_nbs_service

pytestmark = pytest.mark.integration


class _FakeServicesCatalog:
    async def search(self, query: str):
        return {
            "success": True,
            "query": query,
            "normalized": query,
            "results": [{"code": "1.01", "description": "Serviços de construção"}],
            "total": 1,
        }

    async def get_item_details(self, code: str):
        item = {
            "code": code,
            "code_clean": "101",
            "description": "Serviços de construção",
            "parent_code": None,
            "level": 0,
            "has_nebs": False,
        }
        child = {
            "code": "1.0101",
            "code_clean": "10101",
            "description": "Serviços de construção de edificações",
            "parent_code": code,
            "level": 1,
            "has_nebs": True,
        }
        return {
            "success": True,
            "item": item,
            "ancestors": [],
            "children": [child],
            "chapter_root": item,
            "chapter_items": [item, child],
            "nebs": None,
        }

    async def search_nebs(self, query: str):
        return {
            "success": True,
            "query": query,
            "normalized": query,
            "results": [
                {
                    "code": "1.0102.61",
                    "title": "Serviços de construção de usinas de geração de energia",
                    "excerpt": "Esta subposição inclui serviços de construção de usinas.",
                    "page_start": 21,
                    "page_end": 22,
                    "section_title": "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                }
            ],
            "total": 1,
        }

    async def get_nebs_details(self, code: str):
        return {
            "success": True,
            "item": {
                "code": code,
                "description": "Serviços de construção de usinas de geração de energia",
            },
            "ancestors": [
                {
                    "code": "1.0102.6",
                    "description": "Serviços de construção de instalações industriais",
                }
            ],
            "entry": {
                "code": code,
                "code_clean": "1010261",
                "title": "Serviços de construção de usinas de geração de energia",
                "title_normalized": "servicos de construcao de usinas de geracao de energia",
                "body_text": "Esta subposição inclui serviços de construção de usinas.",
                "body_markdown": "Esta subposição inclui serviços de construção de usinas.",
                "body_normalized": "esta subposicao inclui servicos de construcao de usinas",
                "section_title": "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                "page_start": 21,
                "page_end": 22,
            },
        }


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _mock_route_auth(monkeypatch):
    async def _fake_decode(_token: str):
        return {"sub": "user_1", "org_id": "org_1"}

    monkeypatch.setattr(services_routes, "decode_clerk_jwt", _fake_decode)
    monkeypatch.setattr(services_routes, "get_last_jwt_failure_reason", lambda: None)

    async def _allow_consume(*, key: str, limit: int):
        return True, 0

    monkeypatch.setattr(
        services_routes.services_search_rate_limiter, "consume", _allow_consume
    )
    monkeypatch.setattr(
        services_routes.services_detail_rate_limiter, "consume", _allow_consume
    )


def test_services_routes_require_authorization_header(client):
    app.dependency_overrides[get_nbs_service] = lambda: _FakeServicesCatalog()

    endpoints = (
        "/api/services/nbs/search?q=construcao",
        "/api/services/nbs/1.01",
        "/api/services/nebs/search?q=energia",
        "/api/services/nebs/1.0102.61",
    )

    for endpoint in endpoints:
        response = client.get(endpoint)
        assert response.status_code == 401
        assert response.json()["detail"] == "Token ausente"


@pytest.mark.parametrize(
    "failure_reason",
    [
        "token expirado",
        "assinatura inválida",
    ],
)
def test_services_routes_reject_invalid_or_expired_tokens(
    client, monkeypatch, failure_reason
):
    app.dependency_overrides[get_nbs_service] = lambda: _FakeServicesCatalog()
    headers = {"Authorization": "Bearer broken-token"}

    async def _reject_decode(_token: str):
        return None

    monkeypatch.setattr(services_routes, "decode_clerk_jwt", _reject_decode)
    monkeypatch.setattr(
        services_routes, "get_last_jwt_failure_reason", lambda: failure_reason
    )

    endpoints = (
        "/api/services/nbs/search?q=construcao",
        "/api/services/nbs/1.01",
        "/api/services/nebs/search?q=energia",
        "/api/services/nebs/1.0102.61",
    )

    for endpoint in endpoints:
        response = client.get(endpoint, headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"] == "Token inválido ou expirado"


def test_services_routes_expose_nbs_and_nebs_contracts(client):
    app.dependency_overrides[get_nbs_service] = lambda: _FakeServicesCatalog()
    headers = {"Authorization": "Bearer test-token"}

    nbs_search = client.get("/api/services/nbs/search?q=construcao", headers=headers)
    nbs_detail = client.get("/api/services/nbs/1.01", headers=headers)
    nebs_search = client.get("/api/services/nebs/search?q=energia", headers=headers)
    nebs_detail = client.get("/api/services/nebs/1.0102.61", headers=headers)

    assert nbs_search.status_code == 200
    assert nbs_detail.status_code == 200
    assert nebs_search.status_code == 200
    assert nebs_detail.status_code == 200

    assert nbs_search.json()["results"][0]["code"] == "1.01"
    assert nbs_detail.json()["item"]["code"] == "1.01"
    assert nbs_detail.json()["children"][0]["code"] == "1.0101"
    assert nbs_detail.json()["chapter_root"]["code"] == "1.01"
    assert [item["code"] for item in nbs_detail.json()["chapter_items"]] == [
        "1.01",
        "1.0101",
    ]
    assert nebs_search.json()["results"][0]["page_start"] == 21
    assert nebs_detail.json()["entry"]["page_end"] == 22
    assert "parser_status" not in nebs_detail.json()["entry"]
    assert "parse_warnings" not in nebs_detail.json()["entry"]
    assert "source_hash" not in nebs_detail.json()["entry"]
    assert "updated_at" not in nebs_detail.json()["entry"]


def test_services_routes_document_auth_and_rate_limit_responses():
    openapi = app.openapi()
    expected_paths = {
        "/api/services/nbs/search": "Limite de requisições para busca de serviços excedido.",
        "/api/services/nebs/search": "Limite de requisições para busca de serviços excedido.",
        "/api/services/nbs/{code}": "Limite de requisições para detalhes de serviços excedido.",
        "/api/services/nebs/{code}": "Limite de requisições para detalhes de serviços excedido.",
    }

    for path, expected_429 in expected_paths.items():
        responses = openapi["paths"][path]["get"]["responses"]
        assert responses["401"]["description"] == (
            "Token Bearer ausente, inválido ou expirado."
        )
        assert responses["429"]["description"] == expected_429


def test_services_search_returns_retry_after_when_rate_limited(client, monkeypatch):
    app.dependency_overrides[get_nbs_service] = lambda: _FakeServicesCatalog()
    headers = {"Authorization": "Bearer test-token"}

    async def _deny_consume(*, key: str, limit: int):
        return False, 23

    monkeypatch.setattr(
        services_routes.services_search_rate_limiter, "consume", _deny_consume
    )

    response = client.get("/api/services/nebs/search?q=energia", headers=headers)

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "23"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_services_detail_returns_retry_after_when_rate_limited(client, monkeypatch):
    app.dependency_overrides[get_nbs_service] = lambda: _FakeServicesCatalog()
    headers = {"Authorization": "Bearer test-token"}

    async def _deny_detail(*, key: str, limit: int):
        return False, 11

    monkeypatch.setattr(
        services_routes.services_detail_rate_limiter, "consume", _deny_detail
    )

    nbs_response = client.get("/api/services/nbs/1.01", headers=headers)
    nebs_response = client.get("/api/services/nebs/1.0102.61", headers=headers)

    assert nbs_response.status_code == 429
    assert nbs_response.headers["Retry-After"] == "11"
    assert "Rate limit exceeded for services detail" in nbs_response.json()["detail"]

    assert nebs_response.status_code == 429
    assert nebs_response.headers["Retry-After"] == "11"
    assert "Rate limit exceeded for services detail" in nebs_response.json()["detail"]
