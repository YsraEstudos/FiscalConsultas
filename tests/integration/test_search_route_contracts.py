import pytest
from fastapi.testclient import TestClient

from backend.presentation.routes import search as search_route
from backend.server.app import app
from backend.server.dependencies import get_nesh_service, get_tipi_service


pytestmark = pytest.mark.integration


def _vary_tokens(response) -> set[str]:
    vary = response.headers.get("Vary", "")
    return {token.strip() for token in vary.split(",") if token.strip()}


class _FakeNeshServiceCode:
    async def process_request(self, query: str):
        return {
            "success": True,
            "type": "code",
            "query": query,
            "results": {"85": {"capitulo": "85"}},
            "total_capitulos": 1,
        }


class _FakeNeshServiceText:
    async def process_request(self, query: str):
        return {
            "success": True,
            "type": "text",
            "query": query,
            "results": [],
            "total_capitulos": 0,
        }


class _FakeNeshServiceInvalid:
    async def process_request(self, _query: str):
        return []


class _FakeNeshServiceCodeEmptyResults:
    async def process_request(self, query: str):
        return {
            "success": True,
            "type": "code",
            "query": query,
            "results": {},
            "resultados": {"85": {"capitulo": "85"}},
            "total_capitulos": 0,
        }


class _FakeTipiServiceCode:
    def is_code_query(self, _query: str) -> bool:
        return True

    async def search_by_code(self, _query: str, view_mode: str = "family"):
        return {
            "success": True,
            "type": "code",
            "query": "8517",
            "resultados": {"85": {"capitulo": "85", "posicoes": []}},
        }


class _FakeTipiServiceText:
    def is_code_query(self, _query: str) -> bool:
        return False

    async def search_text(self, query: str):
        return {
            "success": True,
            "type": "text",
            "query": query,
            "results": [],
        }


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    with search_route._code_payload_cache_lock:
        search_route._code_payload_cache.clear()
    app.dependency_overrides.clear()
    yield
    with search_route._code_payload_cache_lock:
        search_route._code_payload_cache.clear()
    app.dependency_overrides.clear()


def test_search_code_response_keeps_resultados_alias(client):
    app.dependency_overrides[get_nesh_service] = lambda: _FakeNeshServiceCode()

    response = client.get("/api/search?ncm=8517")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "code"
    assert payload["resultados"] == payload["results"]
    assert payload["total_capitulos"] == 1
    assert response.headers["Cache-Control"].startswith("private")
    assert "ETag" in response.headers
    vary_tokens = _vary_tokens(response)
    assert {"Authorization", "X-Tenant-Id", "Accept-Encoding"}.issubset(vary_tokens)


def test_search_text_response_does_not_inject_resultados(client):
    app.dependency_overrides[get_nesh_service] = lambda: _FakeNeshServiceText()

    response = client.get("/api/search?ncm=texto")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert "resultados" not in payload


def test_search_code_prefers_results_key_even_when_empty(client):
    app.dependency_overrides[get_nesh_service] = lambda: _FakeNeshServiceCodeEmptyResults()

    response = client.get("/api/search?ncm=8517")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "code"
    assert payload["results"] == {}
    assert payload["resultados"] == {}
    assert payload["total_capitulos"] == 0


def test_search_invalid_service_response_returns_500_with_cors_header(client):
    app.dependency_overrides[get_nesh_service] = lambda: _FakeNeshServiceInvalid()

    response = client.get(
        "/api/search?ncm=texto-invalido",
        headers={"Origin": "http://127.0.0.1:5173"},
    )
    assert response.status_code == 500
    assert response.json()["detail"] == "Formato de resposta inválido do serviço"
    assert response.headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:5173"


def test_tipi_code_response_enforces_compatibility_fields(client):
    app.dependency_overrides[get_tipi_service] = lambda: _FakeTipiServiceCode()

    response = client.get("/api/tipi/search?ncm=8517")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "code"
    assert payload["results"] == payload["resultados"]
    assert payload["total_capitulos"] == 1
    assert response.headers["Cache-Control"].startswith("private")
    assert "ETag" in response.headers
    vary_tokens = _vary_tokens(response)
    assert {"Authorization", "X-Tenant-Id", "Accept-Encoding"}.issubset(vary_tokens)


def test_tipi_text_response_sets_route_defaults(client):
    app.dependency_overrides[get_tipi_service] = lambda: _FakeTipiServiceText()

    response = client.get("/api/tipi/search?ncm=motor")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert payload["normalized"] == "motor"
    assert payload["warning"] is None
    assert payload["match_type"] == "text"
