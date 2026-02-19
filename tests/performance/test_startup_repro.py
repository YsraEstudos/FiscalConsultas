import pytest
import time
from fastapi.testclient import TestClient
from backend.server.app import app


def test_startup_performance():
    """
    Test ensuring the application starts up within an acceptable timeframe (2 seconds).
    User reported regression where it takes much longer or hangs.
    """
    start_time = time.perf_counter()

    # This triggers the lifespan startup event
    with TestClient(app) as client:
        # Just check health to ensure it's up
        response = client.get("/api/status")
        assert response.status_code == 200

    duration = time.perf_counter() - start_time

    print(f"\nStartup took: {duration:.4f} seconds")

    # Fail if it takes longer than 2.5 seconds (giving 0.5s buffer)
    assert duration < 2.5, f"Startup took too long: {duration:.4f}s (Limit: 2.5s)"
