import pytest

from backend.server import middleware


pytestmark = pytest.mark.unit


def test_cached_token_is_rejected_when_expired(monkeypatch):
    token = "cached-expired-token"
    token_hash = middleware._token_cache_key(token)

    middleware._jwt_decode_cache.clear()
    middleware._jwt_decode_cache[token_hash] = (
        {"sub": "user_1", "exp": 100.0},
        10.0,
        100.0,
    )

    monkeypatch.setattr(middleware.time, "monotonic", lambda: 10.1)
    monkeypatch.setattr(middleware.time, "time", lambda: 101.0)

    assert middleware.decode_clerk_jwt(token) is None
    assert token_hash not in middleware._jwt_decode_cache


def test_expired_payload_is_not_cached_in_development(monkeypatch):
    token = "expired-dev-token"
    token_hash = middleware._token_cache_key(token)

    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: None)
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda _token, *args, **kwargs: {"sub": "user_1", "exp": 120.0},
    )
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 15.0)
    monkeypatch.setattr(middleware.time, "time", lambda: 121.0)

    assert middleware.decode_clerk_jwt(token) is None
    assert token_hash not in middleware._jwt_decode_cache


def test_public_path_matching_does_not_allow_similar_prefixes():
    assert middleware.TenantMiddleware._is_public_path("/api/webhooks/asaas") is True
    assert middleware.TenantMiddleware._is_public_path("/api/webhooks-malicious") is False
