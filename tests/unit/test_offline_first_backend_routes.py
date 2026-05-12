import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.server.app_routes import _configure_routes

logger = logging.getLogger(__name__)


def test_fiscal_backend_routes_are_not_registered(tmp_path):
    app = FastAPI()
    _configure_routes(app, str(tmp_path), logger)
    client = TestClient(app)

    retired_routes = [
        "/api/search?ncm=8517",
        "/api/search/chapter/84/body",
        "/api/tipi/search?ncm=8517",
        "/api/tipi/chapters",
        "/api/services/nbs/search?q=construcao",
        "/api/services/nbs/1.01",
        "/api/services/nbs/1.01/tree",
    ]

    for route in retired_routes:
        assert client.get(route).status_code == 404


def test_account_and_system_routes_remain_registered(tmp_path):
    app = FastAPI()
    _configure_routes(app, str(tmp_path), logger)
    paths = {
        route.path
        for route in app.routes
        if getattr(route, "path", "").startswith("/api")
    }

    assert "/api/auth/me" in paths
    assert "/api/status" in paths
    assert "/api/database/version" in paths
    assert "/api/database/token" in paths
    assert "/api/database/download" in paths
    assert "/api/webhooks/asaas" in paths
    assert "/api/comments/" in paths
    assert "/api/profile/me" in paths
