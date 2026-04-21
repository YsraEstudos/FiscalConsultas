from __future__ import annotations

import pytest
from starlette.requests import Request

from backend.config.settings import settings
from backend.utils import auth

pytestmark = pytest.mark.unit


def _build_request(
    headers: dict[str, str] | None = None, client_host: str | None = None
) -> Request:
    scope_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope: dict[str, object] = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": scope_headers,
    }
    if client_host is not None:
        scope["client"] = (client_host, 12345)
    return Request(scope)


def test_extract_bearer_token_returns_token_or_none() -> None:
    request = _build_request(headers={"Authorization": "Bearer abc.def"})
    assert auth.extract_bearer_token(request) == "abc.def"

    request = _build_request(headers={"Authorization": "Basic abc"})
    assert auth.extract_bearer_token(request) is None


def test_role_helpers_detect_admin_roles() -> None:
    payload = {
        "role": "Admin",
        "org_role": "Owner",
        "roles": ["viewer", "superadmin"],
    }

    assert auth._iter_roles(payload) == ["admin", "owner", "viewer", "superadmin"]
    assert auth.is_admin_payload(payload) is True
    assert auth._iter_roles({"roles": "Owner"}) == ["owner"]
    assert auth.is_admin_payload({"roles": ["viewer"]}) is False
    assert auth.is_admin_payload(None) is False


def test_trusted_proxy_resolution_and_client_ip(monkeypatch) -> None:
    original_trusted = list(settings.security.trusted_proxy_ips)
    original_env = settings.server.env
    try:
        settings.security.trusted_proxy_ips = ["", "10.0.0.0/8", "invalid", " "]
        settings.server.env = "production"

        assert auth.is_trusted_proxy("10.1.2.3") is True
        assert auth.is_trusted_proxy("203.0.113.5") is False
        assert auth.is_trusted_proxy(None) is False

        request = _build_request(
            headers={"X-Forwarded-For": "198.51.100.7, 10.0.0.1"},
            client_host="10.1.2.3",
        )
        assert auth.extract_client_ip(request) == "198.51.100.7"

        request = _build_request(
            headers={"X-Forwarded-For": "198.51.100.7"},
            client_host="203.0.113.9",
        )
        assert auth.extract_client_ip(request) == "203.0.113.9"

        request = _build_request(
            headers={"X-Forwarded-For": "not-an-ip"},
            client_host="10.1.2.3",
        )
        assert auth.extract_client_ip(request) == "10.1.2.3"
    finally:
        settings.security.trusted_proxy_ips = original_trusted
        settings.server.env = original_env
