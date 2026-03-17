import json
from pathlib import Path

import pytest

from test_support import reset_all_rate_limiters, sqlite_test_environment

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_PATH = PROJECT_ROOT / "snapshots" / "baseline_v1.json"


@pytest.fixture(scope="session", autouse=True)
def _integration_environment():
    with sqlite_test_environment() as environment:
        yield environment


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


@pytest.fixture(scope="session")
def snapshot_data():
    if not SNAPSHOT_PATH.exists():
        pytest.fail(f"Snapshot file not found at {SNAPSHOT_PATH}")

    with SNAPSHOT_PATH.open("r", encoding="utf-8") as snapshot_file:
        return json.load(snapshot_file)
