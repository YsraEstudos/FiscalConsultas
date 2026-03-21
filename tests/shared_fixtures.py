import pytest

from test_support import reset_all_rate_limiters


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from backend.server.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _cleanup_app_state():
    from backend.server.app import app

    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    reset_all_rate_limiters()
    yield
    reset_all_rate_limiters()
