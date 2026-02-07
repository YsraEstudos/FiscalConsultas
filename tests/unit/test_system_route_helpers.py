from backend.presentation.routes import system
import pytest

pytestmark = pytest.mark.unit


def test_normalize_db_status_with_missing_payload_returns_error_contract():
    payload = system._normalize_db_status(None, latency_ms=12.34)
    assert payload == {
        "status": "error",
        "chapters": 0,
        "positions": 0,
        "latency_ms": 12.34,
        "error": "Database unavailable",
    }


def test_normalize_db_status_with_valid_stats_coerces_values():
    payload = system._normalize_db_status(
        {"status": "online", "chapters": "10", "positions": "20"},
        latency_ms=5.5,
    )
    assert payload == {
        "status": "online",
        "chapters": 10,
        "positions": 20,
        "latency_ms": 5.5,
    }


def test_normalize_tipi_status_handles_online_and_error_states():
    online_payload = system._normalize_tipi_status({"ok": True, "chapters": "3", "positions": "7"})
    error_payload = system._normalize_tipi_status({"status": "error", "error": "db down"})

    assert online_payload == {
        "status": "online",
        "chapters": 3,
        "positions": 7,
    }
    assert error_payload == {
        "status": "error",
        "chapters": 0,
        "positions": 0,
        "error": "db down",
    }
