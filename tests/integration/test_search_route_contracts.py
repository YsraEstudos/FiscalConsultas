import pytest
from fastapi.testclient import TestClient

from backend.server.app import app
from backend.server.dependencies import get_nesh_service, get_tipi_service


pytestmark = pytest.mark.integration


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
    app.dependency_overrides.clear()
    yield
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
    assert response.headers["Vary"] == "Authorization, X-Tenant-Id"


def test_search_text_response_does_not_inject_resultados(client):
    app.dependency_overrides[get_nesh_service] = lambda: _FakeNeshServiceText()

    response = client.get("/api/search?ncm=texto")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert "resultados" not in payload


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
    assert response.headers["Vary"] == "Authorization, X-Tenant-Id"


def test_tipi_text_response_sets_route_defaults(client):
    app.dependency_overrides[get_tipi_service] = lambda: _FakeTipiServiceText()

    response = client.get("/api/tipi/search?ncm=motor")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert payload["normalized"] == "motor"
    assert payload["warning"] is None
    assert payload["match_type"] == "text"
