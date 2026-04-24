from unittest.mock import AsyncMock

import pytest

import backend.presentation.routes.services as services_routes
from backend.services.nbs_service import NbsService
from backend.server.app import app

pytestmark = pytest.mark.integration


class _FakeServicesCatalog:
    async def search_nbs_catalog_entries(self, query: str):
        return {
            "success": True,
            "query": query,
            "normalized": query,
            "results": [{"code": "1.01", "description": "Serviços de construção"}],
            "total": 1,
        }

    async def fetch_nbs_catalog_item_details(
        self,
        code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = 50,
    ):
        del page, page_size
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
            "chapter_items": [item, child] if include_tree else [],
            "nebs": None,
        }

    async def search_nbs_explanatory_entries(self, query: str):
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

    async def fetch_nbs_catalog_tree_page(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = 50,
    ):
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
        items = [item, child]
        normalized_page = max(page, 1)
        normalized_page_size = max(page_size, 1)
        start = (normalized_page - 1) * normalized_page_size
        paginated_items = items[start : start + normalized_page_size]
        return {
            "success": True,
            "item": item,
            "chapter_root": item,
            "chapter_page": {
                "items": paginated_items,
                "page": normalized_page,
                "page_size": normalized_page_size,
                "total": len(items),
                "has_more": (start + len(paginated_items)) < len(items),
            },
        }

    async def fetch_nbs_explanatory_entry_details(self, code: str):
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


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _mock_rate_limits(monkeypatch):
    async def _allow_consume(*, key: str, limit: int):
        return True, 0

    monkeypatch.setattr(
        services_routes.services_search_rate_limiter, "consume", _allow_consume
    )
    monkeypatch.setattr(
        services_routes.services_detail_rate_limiter, "consume", _allow_consume
    )


def _setup_fake_services_catalog(monkeypatch):
    fake_service = _FakeServicesCatalog()
    monkeypatch.setattr(
        NbsService,
        "searchNbsCatalogEntries",
        AsyncMock(side_effect=fake_service.search_nbs_catalog_entries),
    )
    monkeypatch.setattr(
        NbsService,
        "fetchNbsCatalogItemDetails",
        AsyncMock(side_effect=fake_service.fetch_nbs_catalog_item_details),
    )
    monkeypatch.setattr(
        NbsService,
        "searchNbsExplanatoryEntries",
        AsyncMock(side_effect=fake_service.search_nbs_explanatory_entries),
    )
    monkeypatch.setattr(
        NbsService,
        "fetchNbsCatalogTreePage",
        AsyncMock(side_effect=fake_service.fetch_nbs_catalog_tree_page),
    )
    monkeypatch.setattr(
        NbsService,
        "fetchNbsExplanatoryEntryDetails",
        AsyncMock(side_effect=fake_service.fetch_nbs_explanatory_entry_details),
    )


def test_services_routes_allow_anonymous_access(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)
    nbs_search = client.get("/api/services/nbs/search?q=construcao")
    nbs_detail = client.get("/api/services/nbs/1.01")
    nbs_tree = client.get("/api/services/nbs/1.01/tree")
    nebs_search = client.get("/api/services/nebs/search?q=energia")
    nebs_detail = client.get("/api/services/nebs/1.0102.61")

    assert nbs_search.status_code == 200
    assert nbs_detail.status_code == 200
    assert nbs_tree.status_code == 200
    assert nebs_search.status_code == 200
    assert nebs_detail.status_code == 200


def test_services_routes_ignore_invalid_authorization_headers(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)
    headers = {"Authorization": "Bearer broken-token"}

    nbs_search = client.get("/api/services/nbs/search?q=construcao", headers=headers)
    nbs_detail = client.get("/api/services/nbs/1.01", headers=headers)
    nbs_tree = client.get("/api/services/nbs/1.01/tree", headers=headers)
    nebs_search = client.get("/api/services/nebs/search?q=energia", headers=headers)
    nebs_detail = client.get("/api/services/nebs/1.0102.61", headers=headers)

    assert nbs_search.status_code == 200
    assert nbs_detail.status_code == 200
    assert nbs_tree.status_code == 200
    assert nebs_search.status_code == 200
    assert nebs_detail.status_code == 200


def test_services_routes_rate_limit_anonymous_requests(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)
    consumed_keys: list[str] = []

    def _deny_consume(*, key: str, limit: int):
        consumed_keys.append(key)
        return False, 7

    monkeypatch.setattr(
        services_routes.services_search_rate_limiter,
        "consume",
        AsyncMock(side_effect=_deny_consume),
    )

    response = client.get("/api/services/nbs/search?q=construcao")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "7"
    assert consumed_keys == ["services:ip:testclient"]


def test_services_routes_expose_nbs_and_nebs_contracts(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)

    nbs_search = client.get("/api/services/nbs/search?q=construcao")
    nbs_detail = client.get("/api/services/nbs/1.01")
    nbs_tree_page_1 = client.get("/api/services/nbs/1.01/tree?page=1&page_size=1")
    nbs_tree_page_2 = client.get("/api/services/nbs/1.01/tree?page=2&page_size=1")
    nebs_search = client.get("/api/services/nebs/search?q=energia")
    nebs_detail = client.get("/api/services/nebs/1.0102.61")

    assert nbs_search.status_code == 200
    assert nbs_detail.status_code == 200
    assert nbs_tree_page_1.status_code == 200
    assert nbs_tree_page_2.status_code == 200
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
    assert nbs_tree_page_1.json()["success"] is True
    assert nbs_tree_page_1.json()["item"]["code"] == "1.01"
    assert nbs_tree_page_1.json()["chapter_root"]["code"] == "1.01"
    assert nbs_tree_page_1.json()["chapter_page"]["page"] == 1
    assert nbs_tree_page_1.json()["chapter_page"]["page_size"] == 1
    assert nbs_tree_page_1.json()["chapter_page"]["has_more"] is True
    assert nbs_tree_page_1.json()["chapter_page"]["total"] == 2
    assert [
        item["code"] for item in nbs_tree_page_1.json()["chapter_page"]["items"]
    ] == [
        "1.01",
    ]
    assert nbs_tree_page_2.json()["success"] is True
    assert nbs_tree_page_2.json()["chapter_page"]["page"] == 2
    assert nbs_tree_page_2.json()["chapter_page"]["page_size"] == 1
    assert nbs_tree_page_2.json()["chapter_page"]["has_more"] is False
    assert nbs_tree_page_2.json()["chapter_page"]["total"] == 2
    assert [
        item["code"] for item in nbs_tree_page_2.json()["chapter_page"]["items"]
    ] == [
        "1.0101",
    ]
    assert nebs_search.json()["results"][0]["page_start"] == 21
    assert nebs_detail.json()["entry"]["page_end"] == 22
    assert "parser_status" not in nebs_detail.json()["entry"]
    assert "parse_warnings" not in nebs_detail.json()["entry"]
    assert "source_hash" not in nebs_detail.json()["entry"]
    assert "updated_at" not in nebs_detail.json()["entry"]


def test_services_routes_document_public_rate_limit_responses():
    openapi = app.openapi()
    expected_paths = {
        "/api/services/nbs/search": "Limite de requisições para busca de serviços excedido.",
        "/api/services/nebs/search": "Limite de requisições para busca de serviços excedido.",
        "/api/services/nbs/{code}": "Limite de requisições para detalhes de serviços excedido.",
        "/api/services/nbs/{code}/tree": "Limite de requisições para detalhes de serviços excedido.",
        "/api/services/nebs/{code}": "Limite de requisições para detalhes de serviços excedido.",
    }

    for path, expected_429 in expected_paths.items():
        responses = openapi["paths"][path]["get"]["responses"]
        assert "401" not in responses
        assert responses["429"]["description"] == expected_429


@pytest.mark.parametrize(
    ("endpoint", "service_method"),
    [
        ("/api/services/nbs/{code}", "fetchNbsCatalogItemDetails"),
        ("/api/services/nbs/{code}/tree", "fetchNbsCatalogTreePage"),
        ("/api/services/nebs/{code}", "fetchNbsExplanatoryEntryDetails"),
    ],
)
def test_services_detail_rejects_overly_long_code(
    client, endpoint, service_method, monkeypatch
):
    _setup_fake_services_catalog(monkeypatch)
    oversized_code = "1" * (services_routes.MAX_SERVICE_CODE_LENGTH + 1)
    called = {"value": False}

    def _unexpected_call(*args, **kwargs):
        called["value"] = True
        raise AssertionError(f"{service_method} should not be called")

    monkeypatch.setattr(
        NbsService,
        service_method,
        AsyncMock(side_effect=_unexpected_call),
    )

    response = client.get(
        endpoint.format(code=oversized_code),
    )

    assert response.status_code == 400
    assert "máximo" in response.json()["error"]["message"]
    assert called["value"] is False


def test_services_search_returns_retry_after_when_rate_limited(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)

    async def _deny_consume(*, key: str, limit: int):
        return False, 23

    monkeypatch.setattr(
        services_routes.services_search_rate_limiter, "consume", _deny_consume
    )

    response = client.get("/api/services/nebs/search?q=energia")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "23"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_services_detail_returns_retry_after_when_rate_limited(client, monkeypatch):
    _setup_fake_services_catalog(monkeypatch)

    async def _deny_detail(*, key: str, limit: int):
        return False, 11

    monkeypatch.setattr(
        services_routes.services_detail_rate_limiter, "consume", _deny_detail
    )

    nbs_response = client.get("/api/services/nbs/1.01")
    nbs_tree_response = client.get("/api/services/nbs/1.01/tree")
    nebs_response = client.get("/api/services/nebs/1.0102.61")

    assert nbs_response.status_code == 429
    assert nbs_response.headers["Retry-After"] == "11"
    assert "Rate limit exceeded for services detail" in nbs_response.json()["detail"]

    assert nbs_tree_response.status_code == 429
    assert nbs_tree_response.headers["Retry-After"] == "11"
    assert (
        "Rate limit exceeded for services detail" in nbs_tree_response.json()["detail"]
    )

    assert nebs_response.status_code == 429
    assert nebs_response.headers["Retry-After"] == "11"
    assert "Rate limit exceeded for services detail" in nebs_response.json()["detail"]
