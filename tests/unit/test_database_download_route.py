from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.presentation.routes import database_download

pytestmark = pytest.mark.unit


def _build_request(
    path: str,
    *,
    method: str = "POST",
    headers: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
) -> Request:
    scope_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": scope_headers,
        "scheme": "http",
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "app": SimpleNamespace(state=SimpleNamespace()),
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def _reset_token_store():
    database_download._memory_tokens.clear()
    database_download._token_rate_limiter.reset()
    yield
    database_download._memory_tokens.clear()
    database_download._token_rate_limiter.reset()


@pytest.fixture
def offline_bundle(monkeypatch: pytest.MonkeyPatch):
    bundle_dir = Path.cwd() / ".pytest-temp" / f"database-download-{uuid.uuid4().hex}"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    meta_path = bundle_dir / "fiscal_offline.meta"
    enc_path = bundle_dir / "fiscal_offline.enc"
    meta_path.write_text(
        json.dumps(
            {
                "version": "2026.04.15.001",
                "size_bytes": 128,
                "sha256": "plain-sha",
                "encrypted_sha256": "enc-sha",
                "built_at": "2026-04-15T12:00:00Z",
                "format_version": 1,
                "chunk_size": 65536,
                "pbkdf2_iterations": 600000,
            }
        ),
        encoding="utf-8",
    )
    enc_path.write_bytes(b"encrypted-bundle")

    monkeypatch.setattr(database_download, "META_FILE", meta_path)
    monkeypatch.setattr(database_download, "ENCRYPTED_DB", enc_path)
    monkeypatch.setattr(database_download.settings.server, "env", "development")
    monkeypatch.setattr(database_download.redis_cache, "_client", None)

    try:
        yield meta_path, enc_path
    finally:
        shutil.rmtree(bundle_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_get_database_version_exposes_offline_contract(offline_bundle):
    payload = await database_download.get_database_version()

    assert payload["version"] == "2026.04.15.001"
    assert payload["size_bytes"] == 128
    assert payload["sha256"] == "plain-sha"
    assert payload["encrypted_sha256"] == "enc-sha"
    assert payload["built_at"] == "2026-04-15T12:00:00Z"
    assert payload["format_version"] == 1
    assert payload["chunk_size"] == 65536
    assert payload["pbkdf2_iterations"] == 600000


@pytest.mark.asyncio
async def test_download_requires_same_ip_that_requested_token(offline_bundle):
    token_request = _build_request("/api/database/token")
    token_payload = await database_download.create_download_token(token_request)

    response = await database_download.download_database(
        _build_request("/api/database/download", client_host="127.0.0.1"),
        database_download.DownloadDatabaseRequest(token=token_payload["token"]),
    )

    assert response.body == b"encrypted-bundle"
    assert response.headers["Cross-Origin-Resource-Policy"] == "same-origin"

    with pytest.raises(HTTPException) as exc:
        await database_download.download_database(
            _build_request("/api/database/download", client_host="127.0.0.2"),
            database_download.DownloadDatabaseRequest(token=token_payload["token"]),
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_download_token_cannot_be_reused(offline_bundle):
    token_request = _build_request("/api/database/token")
    token_payload = await database_download.create_download_token(token_request)

    first_response = await database_download.download_database(
        _build_request("/api/database/download", client_host="127.0.0.1"),
        database_download.DownloadDatabaseRequest(token=token_payload["token"]),
    )

    assert first_response.body == b"encrypted-bundle"

    with pytest.raises(HTTPException) as exc:
        await database_download.download_database(
            _build_request("/api/database/download", client_host="127.0.0.1"),
            database_download.DownloadDatabaseRequest(token=token_payload["token"]),
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_download_token_expires_after_ttl(offline_bundle):
    token_request = _build_request("/api/database/token")
    token_payload = await database_download.create_download_token(token_request)
    token = token_payload["token"]
    created_at, stored_ip = database_download._memory_tokens[token]
    database_download._memory_tokens[token] = (
        created_at - database_download._TOKEN_TTL_SECONDS - 1,
        stored_ip,
    )

    with pytest.raises(HTTPException) as exc:
        await database_download.download_database(
            _build_request("/api/database/download", client_host="127.0.0.1"),
            database_download.DownloadDatabaseRequest(token=token),
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_download_token_rate_limit_returns_retry_after(offline_bundle):
    request = _build_request("/api/database/token", client_host="127.0.0.1")

    for _ in range(database_download._TOKEN_LIMIT_PER_HOUR):
        payload = await database_download.create_download_token(request)
        assert payload["token"]

    with pytest.raises(HTTPException) as exc:
        await database_download.create_download_token(request)

    assert exc.value.status_code == 429
    assert int(exc.value.headers["Retry-After"]) >= 1


@pytest.mark.asyncio
async def test_https_is_required_in_production_for_non_local_requests(
    offline_bundle, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(database_download.settings.server, "env", "production")
    request = _build_request(
        "/api/database/token",
        headers={"host": "fiscal.example.com"},
        client_host="203.0.113.10",
    )

    with pytest.raises(HTTPException) as exc:
        await database_download.create_download_token(request)

    assert exc.value.status_code == 400
    assert "HTTPS" in exc.value.detail


@pytest.mark.asyncio
async def test_untrusted_forwarded_proto_does_not_bypass_https_requirement(
    offline_bundle, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(database_download.settings.server, "env", "production")
    request = _build_request(
        "/api/database/token",
        headers={
            "host": "fiscal.example.com",
            "x-forwarded-proto": "https",
        },
        client_host="203.0.113.10",
    )

    with pytest.raises(HTTPException) as exc:
        await database_download.create_download_token(request)

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_trusted_forwarded_proto_is_accepted_in_production(
    offline_bundle, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(database_download.settings.server, "env", "production")
    monkeypatch.setattr(
        database_download.settings.security,
        "trusted_proxy_ips",
        ["203.0.113.10/32"],
    )
    request = _build_request(
        "/api/database/token",
        headers={
            "host": "fiscal.example.com",
            "x-forwarded-proto": "https",
        },
        client_host="203.0.113.10",
    )

    payload = await database_download.create_download_token(request)

    assert payload["token"]
