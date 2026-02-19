import asyncio
from types import SimpleNamespace

import jwt
import pytest
from fastapi import Request
from fastapi.responses import JSONResponse

from backend.infrastructure.db_engine import tenant_context
from backend.server import middleware


pytestmark = pytest.mark.unit


def _build_request(path: str, headers: dict[str, str] | None = None, query: str = "") -> Request:
    headers = headers or {}
    scope_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": scope_headers,
        "query_string": query.encode("latin-1"),
        "scheme": "http",
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


def test_get_payload_exp_variants():
    assert middleware._get_payload_exp({"exp": 123}) == 123.0
    assert middleware._get_payload_exp({"exp": "123.5"}) == 123.5
    assert middleware._get_payload_exp({"exp": "abc"}) is None
    assert middleware._get_payload_exp({}) is None


def test_is_payload_expired_variants(monkeypatch):
    monkeypatch.setattr(middleware.time, "time", lambda: 100.0)
    assert middleware._is_payload_expired({"exp": 99}) is True
    assert middleware._is_payload_expired({"exp": 101}) is False
    assert middleware._is_payload_expired({"exp": "bad"}) is True
    assert middleware._is_payload_expired({}) is False


def test_token_cache_key_is_stable():
    k1 = middleware._token_cache_key("abc")
    k2 = middleware._token_cache_key("abc")
    k3 = middleware._token_cache_key("abcd")
    assert k1 == k2
    assert k1 != k3


def test_get_jwks_client_caches_instance(monkeypatch):
    class _FakeJWKS:
        def __init__(self, url):
            self.url = url

    middleware._jwks_client = None
    monkeypatch.setattr(middleware.settings.auth, "clerk_domain", "demo.clerk.accounts.dev", raising=False)
    monkeypatch.setattr(middleware, "PyJWKClient", _FakeJWKS)

    first = middleware.get_jwks_client()
    second = middleware.get_jwks_client()
    assert first is second
    assert "demo.clerk.accounts.dev" in first.url


def test_decode_clerk_jwt_jwks_path_and_cache(monkeypatch):
    class _SigningKey:
        key = "pub-key"

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: _FakeJWKS())
    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: {"sub": "user_1", "org_id": "org_1", "exp": 9999999999},
    )

    payload = middleware.decode_clerk_jwt("token-ok")
    assert payload and payload["sub"] == "user_1"
    # Cached branch should return a copy
    cached = middleware.decode_clerk_jwt("token-ok")
    assert cached == payload
    assert cached is not payload


def test_decode_clerk_jwt_drops_stale_cache_entry(monkeypatch):
    token = "stale-token"
    key = middleware._token_cache_key(token)
    middleware._jwt_decode_cache.clear()
    middleware._jwt_decode_cache[key] = ({"sub": "u"}, 0.0, None)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: middleware._JWT_CACHE_TTL + 100.0)
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: None)
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.logger, "error", lambda _msg: None)

    assert middleware.decode_clerk_jwt(token) is None
    assert key not in middleware._jwt_decode_cache


def test_decode_clerk_jwt_evicts_old_entries_when_cache_is_full(monkeypatch):
    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "_JWT_CACHE_MAX_SIZE", 1)

    class _SigningKey:
        key = "pub-key"

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    monkeypatch.setattr(middleware, "get_jwks_client", lambda: _FakeJWKS())
    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: {"sub": "user_2", "org_id": "org_2", "exp": 9999999999},
    )

    old_key = middleware._token_cache_key("old-token")
    middleware._jwt_decode_cache[old_key] = ({"sub": "old"}, 1.0, None)
    middleware.decode_clerk_jwt("new-token")
    assert old_key not in middleware._jwt_decode_cache


def test_decode_clerk_jwt_rejects_when_not_development_and_no_jwks(monkeypatch):
    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: None)
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.logger, "error", lambda _msg: None)

    assert middleware.decode_clerk_jwt("token") is None


def test_decode_clerk_jwt_rejects_dev_without_debug(monkeypatch):
    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: None)
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.features, "debug_mode", False, raising=False)
    monkeypatch.setattr(middleware.logger, "error", lambda _msg: None)

    assert middleware.decode_clerk_jwt("token") is None


def test_decode_clerk_jwt_handles_invalid_and_expired_exceptions(monkeypatch):
    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: object())

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, _token):
            return type("K", (), {"key": "k"})()

    monkeypatch.setattr(middleware, "get_jwks_client", lambda: _FakeJWKS())
    monkeypatch.setattr(middleware.logger, "warning", lambda _msg: None)
    monkeypatch.setattr(middleware.logger, "error", lambda _msg: None)

    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(jwt.InvalidTokenError("bad")),
    )
    assert middleware.decode_clerk_jwt("tok1") is None

    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(jwt.ExpiredSignatureError("exp")),
    )
    assert middleware.decode_clerk_jwt("tok2") is None

    class _BoomJWKS:
        def get_signing_key_from_jwt(self, _token):
            raise RuntimeError("boom")

    monkeypatch.setattr(middleware, "get_jwks_client", lambda: _BoomJWKS())
    assert middleware.decode_clerk_jwt("tok3") is None


def test_extract_org_from_jwt_and_get_current_tenant(monkeypatch):
    monkeypatch.setattr(middleware, "decode_clerk_jwt", lambda _token: {"org_id": "org_123"})
    assert middleware.extract_org_from_jwt("tok") == "org_123"

    monkeypatch.setattr(middleware, "decode_clerk_jwt", lambda _token: None)
    assert middleware.extract_org_from_jwt("tok") is None

    token = tenant_context.set("org_ctx")
    try:
        assert middleware.get_current_tenant() == "org_ctx"
    finally:
        tenant_context.reset(token)


def test_is_clerk_token_valid_delegates_to_decode(monkeypatch):
    monkeypatch.setattr(middleware, "decode_clerk_jwt", lambda _token: {"sub": "u"})
    assert middleware.is_clerk_token_valid("ok") is True
    monkeypatch.setattr(middleware, "decode_clerk_jwt", lambda _token: None)
    assert middleware.is_clerk_token_valid("bad") is False


@pytest.mark.asyncio
async def test_dispatch_skips_non_api_and_public_paths(monkeypatch):
    mw = middleware.TenantMiddleware(app=lambda scope, receive, send: None)
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)

    called = []

    async def call_next(_request):
        called.append("ok")
        return JSONResponse({"ok": True})

    resp1 = await mw.dispatch(_build_request("/"), call_next)
    resp2 = await mw.dispatch(_build_request("/api/status"), call_next)
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert called == ["ok", "ok"]


@pytest.mark.asyncio
async def test_dispatch_returns_401_in_prod_postgres_without_tenant(monkeypatch):
    mw = middleware.TenantMiddleware(app=lambda scope, receive, send: None)
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(middleware, "decode_clerk_jwt", lambda _token: None)

    async def call_next(_request):
        return JSONResponse({"ok": True})

    resp = await mw.dispatch(_build_request("/api/search"), call_next)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_dispatch_sets_tenant_from_debug_fallback_and_resets(monkeypatch):
    mw = middleware.TenantMiddleware(app=lambda scope, receive, send: None)
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)

    seen = []

    async def call_next(_request):
        seen.append(tenant_context.get())
        return JSONResponse({"ok": True})

    resp = await mw.dispatch(_build_request("/api/search"), call_next)
    assert resp.status_code == 200
    assert seen == ["org_default"]
    assert tenant_context.get() == ""


@pytest.mark.asyncio
async def test_dispatch_sets_tenant_from_bearer_and_schedules_provision(monkeypatch):
    mw = middleware.TenantMiddleware(app=lambda scope, receive, send: None)
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(
        middleware,
        "decode_clerk_jwt",
        lambda _token: {"org_id": "org_bearer", "sub": "user_1"},
    )

    created = []

    def _fake_create_task(coro):
        created.append(coro)
        coro.close()
        return None

    monkeypatch.setattr(asyncio, "create_task", _fake_create_task)

    async def _ensure(*_args, **_kwargs):
        return None

    monkeypatch.setattr(middleware, "ensure_clerk_entities", _ensure)

    seen = []

    async def call_next(_request):
        seen.append(tenant_context.get())
        return JSONResponse({"ok": True})

    resp = await mw.dispatch(
        _build_request("/api/search", headers={"Authorization": "Bearer tkn"}),
        call_next,
    )
    assert resp.status_code == 200
    assert seen == ["org_bearer"]
    assert len(created) == 1


class _FakeProvisionSession:
    def __init__(self, tenant=None, user=None):
        self._tenant = tenant
        self._user = user
        self.added = []

    async def get(self, model, pk):
        name = getattr(model, "__name__", "")
        if name == "Tenant":
            return self._tenant
        if name == "User":
            return self._user
        return None

    def add(self, obj):
        self.added.append(obj)


class _FakeSessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _install_fake_get_session(monkeypatch, session):
    monkeypatch.setattr(
        "backend.infrastructure.db_engine.get_session",
        lambda: _FakeSessionContext(session),
    )


@pytest.mark.asyncio
async def test_ensure_clerk_entities_returns_early_for_non_postgres(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "sqlite", raising=False)
    middleware._provisioned_entities_cache.clear()
    await middleware.ensure_clerk_entities({"sub": "u1"}, "org1")
    assert middleware._provisioned_entities_cache == {}


@pytest.mark.asyncio
async def test_ensure_clerk_entities_returns_early_without_user(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    middleware._provisioned_entities_cache.clear()
    await middleware.ensure_clerk_entities({}, "org1")
    assert middleware._provisioned_entities_cache == {}


@pytest.mark.asyncio
async def test_ensure_clerk_entities_skips_when_recently_cached(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 100.0)
    middleware._provisioned_entities_cache.clear()
    middleware._provisioned_entities_cache[("org1", "u1")] = 90.0

    # Would fail if DB path was reached
    monkeypatch.setattr(
        "backend.infrastructure.db_engine.get_session",
        lambda: (_ for _ in ()).throw(RuntimeError("should not use db")),
    )
    await middleware.ensure_clerk_entities({"sub": "u1"}, "org1")


@pytest.mark.asyncio
async def test_ensure_clerk_entities_creates_tenant_and_user(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 123.0)
    middleware._provisioned_entities_cache.clear()

    session = _FakeProvisionSession(tenant=None, user=None)
    _install_fake_get_session(monkeypatch, session)

    payload = {"sub": "user_1", "org_name": "Org Name", "email": "u@x.com", "name": "User Name"}
    await middleware.ensure_clerk_entities(payload, "org_1")

    assert any(obj.__class__.__name__ == "Tenant" for obj in session.added)
    assert any(obj.__class__.__name__ == "User" for obj in session.added)
    assert middleware._provisioned_entities_cache[("org_1", "user_1")] == 123.0


@pytest.mark.asyncio
async def test_ensure_clerk_entities_updates_existing_records(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 200.0)
    middleware._provisioned_entities_cache.clear()

    tenant = SimpleNamespace(name="Old Org")
    user = SimpleNamespace(tenant_id="old_org", email="old@x.com", full_name="Old")
    session = _FakeProvisionSession(tenant=tenant, user=user)
    _install_fake_get_session(monkeypatch, session)

    payload = {
        "sub": "user_2",
        "org_name": "New Org",
        "email_address": "new@x.com",
        "given_name": "New",
        "family_name": "Name",
    }
    await middleware.ensure_clerk_entities(payload, "org_2")
    assert tenant.name == "New Org"
    assert user.tenant_id == "org_2"
    assert user.email == "new@x.com"
    assert user.full_name == "New Name"


@pytest.mark.asyncio
async def test_ensure_clerk_entities_eviction_and_exception_path(monkeypatch):
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(middleware.time, "monotonic", lambda: 500.0)
    monkeypatch.setattr(middleware, "_PROVISION_CACHE_MAX_SIZE", 1)
    middleware._provisioned_entities_cache.clear()
    middleware._provisioned_entities_cache[("o1", "u1")] = 1.0

    session = _FakeProvisionSession(tenant=None, user=None)
    _install_fake_get_session(monkeypatch, session)
    await middleware.ensure_clerk_entities({"sub": "u2"}, "o2")
    assert ("o1", "u1") not in middleware._provisioned_entities_cache

    monkeypatch.setattr(
        "backend.infrastructure.db_engine.get_session",
        lambda: (_ for _ in ()).throw(RuntimeError("db explode")),
    )
    warned = []
    monkeypatch.setattr(middleware.logger, "warning", lambda msg: warned.append(msg))
    await middleware.ensure_clerk_entities({"sub": "u3"}, "o3")
    assert warned
