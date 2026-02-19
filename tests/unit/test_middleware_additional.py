import asyncio
from types import SimpleNamespace

import jwt
import pytest
from fastapi.responses import JSONResponse

from backend.infrastructure.db_engine import tenant_context
from backend.server import middleware


pytestmark = pytest.mark.unit


def _build_scope(path: str, headers: dict[str, str] | None = None, query: str = "") -> dict:
    headers = headers or {}
    scope_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
    return {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": scope_headers,
        "query_string": query.encode("latin-1"),
        "scheme": "http",
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80)
    }


async def _invoke_middleware(mw: middleware.TenantMiddleware, scope: dict) -> tuple[int, list[dict]]:
    sent_messages: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent_messages.append(message)

    await mw(scope, receive, send)
    start_message = next(
        msg for msg in sent_messages if msg.get("type") == "http.response.start"
    )
    return int(start_message["status"]), sent_messages


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
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_authorized_parties", [], raising=False)
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


def test_decode_clerk_jwt_validates_issuer_audience_and_azp(monkeypatch):
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
        lambda *_args, **_kwargs: {
            "sub": "user_ok",
            "org_id": "org_ok",
            "iss": "https://demo.clerk.accounts.dev",
            "aud": "fiscal-api",
            "azp": "http://localhost:5173",
            "exp": 9999999999,
        },
    )
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "https://demo.clerk.accounts.dev", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "fiscal-api", raising=False)
    monkeypatch.setattr(
        middleware.settings.auth,
        "clerk_authorized_parties",
        ["http://localhost:5173"],
        raising=False,
    )

    payload = middleware.decode_clerk_jwt("token-claims-ok")
    assert payload is not None
    assert payload["sub"] == "user_ok"


def test_decode_clerk_jwt_rejects_audience_mismatch(monkeypatch):
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
        lambda *_args, **_kwargs: {
            "sub": "user_bad_aud",
            "org_id": "org_1",
            "iss": "https://demo.clerk.accounts.dev",
            "aud": "wrong-aud",
            "azp": "http://localhost:5173",
            "exp": 9999999999,
        },
    )
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "https://demo.clerk.accounts.dev", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "fiscal-api", raising=False)
    monkeypatch.setattr(
        middleware.settings.auth,
        "clerk_authorized_parties",
        ["http://localhost:5173"],
        raising=False,
    )

    warned: list[str] = []
    monkeypatch.setattr(middleware.logger, "warning", lambda msg: warned.append(msg))

    assert middleware.decode_clerk_jwt("token-bad-aud") is None
    assert any('"reason": "audience_mismatch"' in msg for msg in warned)


def test_decode_clerk_jwt_rejects_issuer_and_azp_mismatch(monkeypatch):
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
        lambda *_args, **_kwargs: {
            "sub": "user_bad_issuer_azp",
            "org_id": "org_1",
            "iss": "https://other-instance.clerk.accounts.dev",
            "aud": "fiscal-api",
            "azp": "http://192.168.0.10:5173",
            "exp": 9999999999,
        },
    )
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "https://demo.clerk.accounts.dev", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "fiscal-api", raising=False)
    monkeypatch.setattr(
        middleware.settings.auth,
        "clerk_authorized_parties",
        ["http://localhost:5173"],
        raising=False,
    )

    warned: list[str] = []
    monkeypatch.setattr(middleware.logger, "warning", lambda msg: warned.append(msg))

    assert middleware.decode_clerk_jwt("token-bad-issuer-azp") is None
    assert any('"reason": "invalid_issuer"' in msg for msg in warned)

    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "user_bad_azp",
            "org_id": "org_1",
            "iss": "https://demo.clerk.accounts.dev",
            "aud": "fiscal-api",
            "azp": "http://192.168.0.10:5173",
            "exp": 9999999999,
        },
    )
    warned.clear()
    assert middleware.decode_clerk_jwt("token-bad-azp") is None
    assert any('"reason": "invalid_token"' in msg for msg in warned)


def test_decode_clerk_jwt_applies_min_clock_skew_in_development(monkeypatch):
    class _SigningKey:
        key = "pub-key"

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    middleware._jwt_decode_cache.clear()
    monkeypatch.setattr(middleware, "get_jwks_client", lambda: _FakeJWKS())
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_clock_skew_seconds", 30, raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_authorized_parties", [], raising=False)

    now = 1_000.0
    monkeypatch.setattr(middleware.time, "time", lambda: now)

    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "user_clock_ok",
            "org_id": "org_1",
            "iat": now + 90,
            "nbf": now + 90,
            "exp": now + 600,
        },
    )
    assert middleware.decode_clerk_jwt("token-clock-ok") is not None

    warned: list[str] = []
    monkeypatch.setattr(middleware.logger, "warning", lambda msg: warned.append(msg))
    monkeypatch.setattr(
        middleware.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "user_clock_bad",
            "org_id": "org_1",
            "iat": now + 200,
            "nbf": now + 200,
            "exp": now + 600,
        },
    )
    assert middleware.decode_clerk_jwt("token-clock-bad") is None
    assert any('"reason": "nbf_in_future"' in msg for msg in warned)


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
    monkeypatch.setattr(middleware.settings.auth, "clerk_issuer", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_audience", "", raising=False)
    monkeypatch.setattr(middleware.settings.auth, "clerk_authorized_parties", [], raising=False)

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
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)

    called = []

    async def app(scope, receive, send):
        called.append(scope["path"])
        response = JSONResponse({"ok": True})
        await response(scope, receive, send)

    mw = middleware.TenantMiddleware(app=app)

    status1, _ = await _invoke_middleware(mw, _build_scope("/"))
    status2, _ = await _invoke_middleware(mw, _build_scope("/api/status"))
    assert status1 == 200
    assert status2 == 200
    assert called == ["/", "/api/status"]


@pytest.mark.asyncio
async def test_dispatch_returns_401_in_prod_postgres_without_tenant(monkeypatch):
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    called = []

    async def app(_scope, _receive, _send):
        called.append("called")

    mw = middleware.TenantMiddleware(app=app)
    status, _ = await _invoke_middleware(mw, _build_scope("/api/search"))
    assert status == 401
    assert called == []


@pytest.mark.asyncio
async def test_dispatch_sets_tenant_from_debug_fallback_and_resets(monkeypatch):
    monkeypatch.setattr(middleware.settings.server, "env", "development", raising=False)
    monkeypatch.setattr(middleware.settings.features, "debug_mode", True, raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)

    seen = []

    async def app(scope, receive, send):
        seen.append(tenant_context.get())
        response = JSONResponse({"ok": True})
        await response(scope, receive, send)

    mw = middleware.TenantMiddleware(app=app)
    status, _ = await _invoke_middleware(mw, _build_scope("/api/search"))
    assert status == 200
    assert seen == ["org_default"]
    assert tenant_context.get() == ""


@pytest.mark.asyncio
async def test_dispatch_sets_tenant_from_bearer_and_schedules_provision(monkeypatch):
    monkeypatch.setattr(middleware.settings.server, "env", "production", raising=False)
    monkeypatch.setattr(middleware.settings.database, "engine", "postgresql", raising=False)
    monkeypatch.setattr(
        middleware,
        "decode_clerk_jwt",
        lambda _token: {"org_id": "org_bearer", "sub": "user_1"},
    )

    created = []

    def _fake_ensure_future(coro):
        created.append(coro)
        coro.close()
        return None

    monkeypatch.setattr(middleware.asyncio, "ensure_future", _fake_ensure_future)

    async def _ensure(*_args, **_kwargs):
        return None

    monkeypatch.setattr(middleware, "ensure_clerk_entities", _ensure)

    seen = []

    async def app(scope, receive, send):
        seen.append(tenant_context.get())
        response = JSONResponse({"ok": True})
        await response(scope, receive, send)

    mw = middleware.TenantMiddleware(app=app)
    status, _ = await _invoke_middleware(
        mw,
        _build_scope("/api/search", headers={"Authorization": "Bearer tkn"}),
    )
    assert status == 200
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
