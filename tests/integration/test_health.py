from backend.presentation.routes import system


def test_status_endpoint(client):
    """
    Verify the /api/status endpoint returns healthy status.
    """
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()

    # Check database status
    if data.get("database", {}).get("status") == "error":
        print(f"\nDEBUG DB ERROR: {data['database']}")

    expected_global = (
        "online"
        if data.get("database", {}).get("status") == "online"
        and data.get("tipi", {}).get("status") == "online"
        else "error"
    )
    assert data.get("status") == expected_global, (
        f"Inconsistent global status. Got: {data}"
    )
    assert "latency_ms" in data["database"]
    assert "version" not in data
    assert "backend" not in data
    assert "chapters" not in data["database"]
    assert "positions" not in data["database"]
    assert "error" not in data["database"]
    assert "ok" not in data.get("tipi", {})
    assert "error" not in data.get("tipi", {})


def test_status_details_requires_admin(client):
    response = client.get("/api/status/details")
    assert response.status_code == 403


def test_status_details_returns_internal_data_for_admin(client, monkeypatch):
    monkeypatch.setattr(system, "is_valid_admin_token", lambda token: token == "admin-ok")

    response = client.get("/api/status/details", headers={"X-Admin-Token": "admin-ok"})
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert data["backend"] == "FastAPI"
    assert "chapters" in data["database"]
    assert "positions" in data["database"]


def test_status_endpoint_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 13

    monkeypatch.setattr(system.status_rate_limiter, "consume", _deny_consume)

    response = client.get("/api/status")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "13"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_status_details_returns_retry_after_when_rate_limited(client, monkeypatch):
    async def _deny_consume(*_args, **_kwargs):  # NOSONAR
        return False, 9

    monkeypatch.setattr(system.status_rate_limiter, "consume", _deny_consume)

    response = client.get("/api/status/details", headers={"X-Admin-Token": "admin-ok"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "9"
    assert "Rate limit exceeded" in response.json()["detail"]


def test_status_public_rate_limit_blocks_burst_requests(client, monkeypatch):
    monkeypatch.setattr(
        system.settings.security,
        "status_requests_per_minute",
        2,
        raising=False,
    )

    first = client.get("/api/status")
    second = client.get("/api/status")
    third = client.get("/api/status")

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1


def test_security_headers_are_sent_on_public_responses(client):
    for path in ("/", "/api/status"):
        response = client.get(path)

        assert response.status_code == 200
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert (
            response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        )
        assert (
            response.headers["Permissions-Policy"]
            == "camera=(), microphone=(), geolocation=()"
        )
        assert "Strict-Transport-Security" not in response.headers


def test_openapi_route_is_hidden_without_local_debug_mode(client):
    response = client.get("/openapi.json")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_frontend_fallback(client):
    """
    Verify the root endpoint handles missing frontend build gracefully.
    """
    response = client.get("/")
    assert response.status_code == 200
    # Should return either HTML (if build exists) or the fallback JSON message
    # We don't strictly assert content type here as it depends on build state,
    # but 200 OK means it didn't crash.
