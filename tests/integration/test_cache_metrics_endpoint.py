import pytest

from backend.presentation.routes import system


pytestmark = pytest.mark.integration


def test_cache_metrics_requires_admin(client):
    response = client.get("/api/cache-metrics")
    assert response.status_code == 403


def test_cache_metrics_reports_payload_cache_activity(client, monkeypatch):
    monkeypatch.setattr(system, "is_valid_admin_token", lambda token: token == "admin-ok")

    # Warm + hit for search payload cache
    first_search = client.get("/api/search?ncm=8517")
    second_search = client.get("/api/search?ncm=8517")
    assert first_search.status_code == 200
    assert second_search.status_code == 200
    assert first_search.headers.get("X-Payload-Cache") == "MISS"
    assert second_search.headers.get("X-Payload-Cache") == "HIT"

    # Warm + hit for TIPI payload cache
    first_tipi = client.get("/api/tipi/search?ncm=8517")
    second_tipi = client.get("/api/tipi/search?ncm=8517")
    assert first_tipi.status_code == 200
    assert second_tipi.status_code == 200
    assert first_tipi.headers.get("X-Payload-Cache") == "MISS"
    assert second_tipi.headers.get("X-Payload-Cache") == "HIT"

    # Force chapter_positions cache activity using distinct code_search keys
    # over the same chapter ("85"): first call warms chapter cache, second should hit it.
    warm_chapter = client.get("/api/tipi/search?ncm=85&view_mode=chapter")
    hit_chapter = client.get("/api/tipi/search?ncm=85&view_mode=family")
    assert warm_chapter.status_code == 200
    assert hit_chapter.status_code == 200

    response = client.get("/api/cache-metrics", headers={"X-Admin-Token": "admin-ok"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["status"] == "ok"

    search_metrics = payload["search_code_payload_cache"]
    tipi_metrics = payload["tipi_code_payload_cache"]
    nesh_internal = payload["nesh_internal_caches"]
    tipi_internal = payload["tipi_internal_caches"]

    assert search_metrics["current_size"] >= 1
    assert search_metrics["hits"] >= 1
    assert search_metrics["misses"] >= 1
    assert 0 <= search_metrics["hit_rate"] <= 1

    assert tipi_metrics["current_size"] >= 1
    assert tipi_metrics["hits"] >= 1
    assert tipi_metrics["misses"] >= 1
    assert 0 <= tipi_metrics["hit_rate"] <= 1

    assert "chapter_cache" in nesh_internal
    assert "fts_cache" in nesh_internal
    assert nesh_internal["chapter_cache"]["hits"] >= 1
    assert nesh_internal["chapter_cache"]["misses"] >= 1
    assert 0 <= nesh_internal["chapter_cache"]["hit_rate"] <= 1

    assert "code_search_cache" in tipi_internal
    assert "chapter_positions_cache" in tipi_internal
    assert tipi_internal["code_search_cache"]["hits"] >= 1
    assert tipi_internal["code_search_cache"]["misses"] >= 1
    assert 0 <= tipi_internal["code_search_cache"]["hit_rate"] <= 1
    assert tipi_internal["chapter_positions_cache"]["hits"] >= 1
    assert tipi_internal["chapter_positions_cache"]["misses"] >= 1
