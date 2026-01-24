
import pytest
from fastapi.testclient import TestClient
import os
import json
import sys

# Ensure src is in path for imports to work
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from backend.server.app import app

@pytest.fixture(scope="module")
def client():
    """
    Shared TestClient for all tests in the module.
    Uses 'module' scope to avoid spinning up app for every function.
    """
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="session")
def snapshot_data():
    """
    Load snapshot data once per session.
    """
    snapshot_path = os.path.join(os.path.dirname(__file__), "..", "snapshots", "baseline_v1.json")
    if not os.path.exists(snapshot_path):
        pytest.fail(f"Snapshot file not found at {snapshot_path}")
    
    with open(snapshot_path, "r", encoding="utf-8") as f:
        return json.load(f)
