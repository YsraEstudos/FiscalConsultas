import pytest
from backend.server import middleware

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_cached_token_is_rejected_when_expired(monkeypatch):
    sample_jwt = "cached-expired-token"
    token_hash = middleware._token_cache_key(sample_jwt)

    middleware._jwt_decode_cache.clear()
    middleware._jwt_decode_cache[token_hash] = (
        {"sub": "user_1", "exp": 100.0},
        10.0,
        100.0,
    )

    monkeypatch.setattr(middleware.time, "monotonic", lambda: 10.1)
    monkeypatch.setattr(middleware.time, "time", lambda: 101.0)

    assert (await middleware.decode_clerk_jwt(sample_jwt)) is None
    assert token_hash not in middleware._jwt_decode_cache


@pytest.mark.asyncio
async def test_no_jwks_in_development_rejects_without_decoding(monkeypatch):
    sample_jwt = "dev-token-no-jwks"
    token_hash = middleware._token_cache_key(sample_jwt)

    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: None)
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.features, "debug_mode", True, raising=False)

    decode_called = {"value": False}

    def _should_not_decode(*_args, **_kwargs):
        decode_called["value"] = True
        raise AssertionError("jwt.decode should not run when JWKS is unavailable")

    monkeypatch.setattr(middleware.jwt, "decode", _should_not_decode)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 15.0)
    monkeypatch.setattr(middleware.time, "time", lambda: 121.0)

    assert (await middleware.decode_clerk_jwt(sample_jwt)) is None
    assert decode_called["value"] is False
    assert token_hash not in middleware._jwt_decode_cache


def test_public_path_matching_does_not_allow_similar_prefixes():
    assert middleware.TenantMiddleware._is_public_path("/api/webhooks/asaas") is True
    assert (
        middleware.TenantMiddleware._is_public_path("/api/webhooks-malicious") is False
    )
