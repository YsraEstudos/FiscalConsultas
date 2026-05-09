import asyncio
from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.database import DatabaseAdapter
from backend.presentation.routes import search as search_route
from backend.presentation.routes import tipi as tipi_route
from backend.server.app import app
from backend.services.nesh_service import NeshService
from backend.services.tipi_service import TipiService

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skip(
        reason="Online NESH/TIPI search routes were retired; offline bundles now own fiscal search."
    ),
]


def _vary_tokens(response) -> set[str]:
    vary = response.headers.get("Vary", "")
    return {token.strip() for token in vary.split(",") if token.strip()}


class _FakeNeshServiceCode:
    async def executeNeshSearchWithVectorWeights(self, query: str):
        return {
            "success": True,
            "type": "code",
            "query": query,
            "results": {"85": {"capitulo": "85"}},
            "total_capitulos": 1,
        }


def test_search_handler_keeps_legacy_alias_to_canonical_name():
    assert search_route.search is search_route.handleGlobalFiscalSearchRequest


class _FakeNeshServiceText:
    async def executeNeshSearchWithVectorWeights(self, query: str):
        return {
            "success": True,
            "type": "text",
            "query": query,
            "results": [],
            "total_capitulos": 0,
        }


class _FakeNeshServiceInvalid:
    async def executeNeshSearchWithVectorWeights(self, _query: str):
        await asyncio.sleep(0)
        return []


class _FakeNeshChapterService:
    async def fetchNeshChapterData(self, chapter: str):
        await asyncio.sleep(0)
        return {
            "content": f"CAPITULO {chapter}\nConteudo detalhado",
            "parsed_notes": {"N1": "Nota"},
            "notes": "Notas gerais",
            "sections": {"titulo": "Capitulo 84"},
        }

    def stripNeshChapterPreamble(self, content: str) -> str:
        return content.split("\n", 1)[1] if "\n" in content else content


class _FakeNeshServiceCodeEmptyResults:
    async def executeNeshSearchWithVectorWeights(self, query: str):
        await asyncio.sleep(0)
        return {
            "success": True,
            "type": "code",
            "query": query,
            "results": {},
            "resultados": {"85": {"capitulo": "85"}},
            "total_capitulos": 0,
        }


class _FakeTipiServiceCode:
    async def searchTipiByNcmCode(self, _query: str, view_mode: str = "family"):
        return {
            "success": True,
            "type": "code",
            "query": "8517",
            "resultados": {"85": {"capitulo": "85", "posicoes": []}},
        }


class _FakeTipiServiceText:
    async def searchTipiByTextQuery(self, query: str):
        return {
            "success": True,
            "type": "text",
            "query": query,
            "results": [],
        }


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    with search_route._code_payload_cache_lock:
        search_route._code_payload_cache.clear()
    app.dependency_overrides.clear()
    yield
    with search_route._code_payload_cache_lock:
        search_route._code_payload_cache.clear()
    app.dependency_overrides.clear()


def test_search_code_response_keeps_resultados_alias(client, monkeypatch):
    monkeypatch.setattr(
        NeshService,
        "executeNeshSearchWithVectorWeights",
        AsyncMock(
            side_effect=_FakeNeshServiceCode().executeNeshSearchWithVectorWeights
        ),
    )

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


def test_search_text_response_does_not_inject_resultados(client, monkeypatch):
    monkeypatch.setattr(
        NeshService,
        "executeNeshSearchWithVectorWeights",
        AsyncMock(
            side_effect=_FakeNeshServiceText().executeNeshSearchWithVectorWeights
        ),
    )

    response = client.get("/api/search?ncm=texto")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert "resultados" not in payload


def test_search_code_prefers_results_key_even_when_empty(client, monkeypatch):
    monkeypatch.setattr(
        NeshService,
        "executeNeshSearchWithVectorWeights",
        AsyncMock(
            side_effect=_FakeNeshServiceCodeEmptyResults().executeNeshSearchWithVectorWeights
        ),
    )

    response = client.get("/api/search?ncm=8517")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "code"
    assert payload["results"] == {}
    assert payload["resultados"] == {}
    assert payload["total_capitulos"] == 0


def test_search_invalid_service_response_returns_500_with_cors_header(
    client, monkeypatch
):
    monkeypatch.setattr(
        NeshService,
        "executeNeshSearchWithVectorWeights",
        AsyncMock(
            side_effect=_FakeNeshServiceInvalid().executeNeshSearchWithVectorWeights
        ),
    )

    response = client.get(
        "/api/search?ncm=texto-invalido",
        headers={"Origin": "http://127.0.0.1:5173"},
    )
    assert response.status_code == 500
    assert response.json()["detail"] == "Formato de resposta inválido do serviço"
    assert (
        response.headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:5173"
    )


def test_search_chapter_body_allows_anonymous_access(client, monkeypatch):
    fake_service = _FakeNeshChapterService()
    monkeypatch.setattr(
        NeshService,
        "fetchNeshChapterData",
        AsyncMock(side_effect=fake_service.fetchNeshChapterData),
    )
    monkeypatch.setattr(
        NeshService,
        "stripNeshChapterPreamble",
        fake_service.stripNeshChapterPreamble,
    )

    response = client.get("/api/search/chapter/84/body")
    assert response.status_code == 200
    payload = response.json()

    assert payload["success"] is True
    assert payload["capitulo"] == "84"
    assert payload["conteudo"] == "Conteudo detalhado"
    assert payload["notas_parseadas"] == {"N1": "Nota"}
    assert payload["notas_gerais"] == "Notas gerais"


def test_search_chapters_endpoint_returns_available_chapters(client, monkeypatch):
    expected_chapters = ["01", "02", "84"]
    monkeypatch.setattr(
        DatabaseAdapter,
        "get_all_chapters_list",
        AsyncMock(return_value=expected_chapters),
    )

    response = client.get("/api/chapters")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "capitulos": expected_chapters,
    }


def test_nesh_chapter_notes_endpoint_returns_notes_payload(client, monkeypatch):
    monkeypatch.setattr(
        NeshService,
        "fetchNeshChapterData",
        AsyncMock(
            return_value={
                "parsed_notes": {"N1": "Nota 1", "N2": "Nota 2"},
                "notes": "Notas gerais",
            }
        ),
    )

    response = client.get("/api/nesh/chapter/84/notes")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "capitulo": "84",
        "notas_parseadas": {"N1": "Nota 1", "N2": "Nota 2"},
        "notas_gerais": "Notas gerais",
    }


def test_nesh_chapter_notes_endpoint_returns_404_when_chapter_missing(
    client, monkeypatch
):
    monkeypatch.setattr(
        NeshService,
        "fetchNeshChapterData",
        AsyncMock(return_value=None),
    )

    response = client.get("/api/nesh/chapter/99/notes")

    assert response.status_code == 404
    assert response.json()["detail"] == "Capítulo 99 não encontrado"


def test_glossary_endpoint_returns_found_and_not_found_contracts(client, monkeypatch):
    monkeypatch.setattr(
        search_route.glossary_manager,
        "get_definition",
        lambda term: {"definicao": f"def-{term}"} if term == "drawback" else None,
    )

    found = client.get("/api/glossary?term=drawback")
    not_found = client.get("/api/glossary?term=termo-inexistente")

    assert found.status_code == 200
    assert found.json() == {
        "found": True,
        "term": "drawback",
        "data": {"definicao": "def-drawback"},
    }

    assert not_found.status_code == 200
    assert not_found.json() == {
        "found": False,
        "term": "termo-inexistente",
    }


def test_tipi_chapters_endpoint_returns_available_chapters(client, monkeypatch):
    monkeypatch.setattr(
        TipiService,
        "fetchTipiChapterCatalog",
        AsyncMock(return_value=["01", "02", "11"]),
    )

    response = client.get("/api/tipi/chapters")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "capitulos": ["01", "02", "11"],
    }


def test_tipi_code_response_enforces_compatibility_fields(client, monkeypatch):
    fake_service = _FakeTipiServiceCode()
    monkeypatch.setattr(tipi_route.ncm_utils, "is_code_query", lambda _query: True)
    monkeypatch.setattr(
        TipiService,
        "searchTipiByNcmCode",
        AsyncMock(side_effect=fake_service.searchTipiByNcmCode),
    )

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


def test_tipi_text_response_sets_route_defaults(client, monkeypatch):
    fake_service = _FakeTipiServiceText()
    monkeypatch.setattr(tipi_route.ncm_utils, "is_code_query", lambda _query: False)
    monkeypatch.setattr(
        TipiService,
        "searchTipiByTextQuery",
        AsyncMock(side_effect=fake_service.searchTipiByTextQuery),
    )

    response = client.get("/api/tipi/search?ncm=motor")
    assert response.status_code == 200
    payload = response.json()

    assert payload["type"] == "text"
    assert payload["normalized"] == "motor"
    assert payload["warning"] is None
    assert payload["match_type"] == "text"


def test_search_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 19

    monkeypatch.setattr(
        search_route.public_search_rate_limiter, "consume", _deny_consume
    )

    response = client.get("/api/search?ncm=8517")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "19"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_tipi_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 11

    monkeypatch.setattr(tipi_route.public_search_rate_limiter, "consume", _deny_consume)

    response = client.get("/api/tipi/search?ncm=8517")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "11"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_search_public_rate_limit_blocks_burst_requests(client, monkeypatch):
    monkeypatch.setattr(
        search_route.settings.security,
        "public_search_requests_per_minute",
        2,
        raising=False,
    )

    first = client.get("/api/search?ncm=8517")
    second = client.get("/api/search?ncm=8517")
    third = client.get("/api/search?ncm=8517")

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1
