import pytest
from backend.presentation.routes import auth
from starlette.requests import Request

pytestmark = pytest.mark.unit


def _build_request(
    headers: dict[str, str] | None = None, client_host: str | None = None
) -> Request:
    headers = headers or {}
    scope_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()
    ]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": scope_headers,
    }
    if client_host is not None:
        scope["client"] = (client_host, 12345)
    return Request(scope)


def test_extract_client_ip_prefers_forwarded_for_header():
    from backend.config.settings import settings

    original = list(settings.security.trusted_proxy_ips)
    settings.security.trusted_proxy_ips = ["127.0.0.1"]
    request = _build_request(
        headers={"X-Forwarded-For": "198.51.100.7, 10.0.0.1"}, client_host="127.0.0.1"
    )
    try:
        assert auth._extract_client_ip(request) == "198.51.100.7"
    finally:
        settings.security.trusted_proxy_ips = original


def test_extract_client_ip_ignores_forwarded_for_when_proxy_not_trusted():
    request = _build_request(
        headers={"X-Forwarded-For": "198.51.100.7"}, client_host="203.0.113.9"
    )
    assert auth._extract_client_ip(request) == "203.0.113.9"


def test_extract_client_ip_falls_back_to_request_client():
    request = _build_request(client_host="203.0.113.9")
    assert auth._extract_client_ip(request) == "203.0.113.9"


def test_extract_client_ip_returns_unknown_when_not_available():
    request = _build_request()
    assert auth._extract_client_ip(request) == "unknown"


@pytest.mark.asyncio
async def test_build_limiter_key_uses_user_id_when_token_has_sub(monkeypatch):
    request = _build_request(client_host="203.0.113.12")

    async def _mock_decode(_token):  # NOSONAR
        return {"sub": "user_abc"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)

    sample_jwt = "token-value"
    key = await auth._build_limiter_key(request, token=sample_jwt)
    assert key == "ai:user:user_abc"


@pytest.mark.asyncio
async def test_build_limiter_key_falls_back_to_ip_when_sub_missing(monkeypatch):
    request = _build_request(client_host="203.0.113.12")

    async def _mock_decode(_token):  # NOSONAR
        return {"org_id": "org_123"}

    monkeypatch.setattr(auth, "decode_clerk_jwt", _mock_decode)

    sample_jwt = "token-value"
    key = await auth._build_limiter_key(request, token=sample_jwt)
    assert key == "ai:ip:203.0.113.12"
