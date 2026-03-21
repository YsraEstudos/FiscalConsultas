import json
from pathlib import Path

import pytest

from test_support import sqlite_test_environment
from tests.shared_fixtures import (  # noqa: F401
    _cleanup_app_state,
    _reset_rate_limiters,
    client,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_PATH = PROJECT_ROOT / "snapshots" / "baseline_v1.json"


@pytest.fixture(scope="session", autouse=True)
def _integration_environment():
    with sqlite_test_environment() as environment:
        yield environment


@pytest.fixture(scope="session")
def snapshot_data():
    if not SNAPSHOT_PATH.exists():
        pytest.fail(f"Snapshot file not found at {SNAPSHOT_PATH}")

    with SNAPSHOT_PATH.open("r", encoding="utf-8") as snapshot_file:
        return json.load(snapshot_file)
