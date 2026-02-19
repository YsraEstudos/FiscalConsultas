import builtins

import pytest
from starlette.requests import Request

from backend.utils.cache import cache_scope_key, weak_etag


pytestmark = pytest.mark.unit


def _request(headers: dict[str, str] | None = None) -> Request:
    headers = headers or {}
    scope_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": scope_headers,
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }
    return Request(scope)


def test_cache_scope_key_uses_current_tenant(monkeypatch):
    monkeypatch.setattr("backend.server.middleware.get_current_tenant", lambda: "org_1")
    assert cache_scope_key(_request()) == "tenant:org_1"


def test_cache_scope_key_fallbacks_without_middleware_import(monkeypatch):
    original_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        if name == "backend.server.middleware":
            raise ModuleNotFoundError(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _patched_import)
    assert cache_scope_key(_request(headers={"X-Tenant-Id": " tenant_a "})) == "tenant:tenant_a"
    assert cache_scope_key(_request(headers={"Authorization": "Bearer x"})) == "auth-user"
    assert cache_scope_key(_request()) == "public"


def test_weak_etag_is_stable_and_namespaced():
    e1 = weak_etag("search", "85.17", 10)
    e2 = weak_etag("search", "85.17", 10)
    e3 = weak_etag("tipi", "85.17", 10)

    assert e1 == e2
    assert e1 != e3
    assert e1.startswith('W/"') and e1.endswith('"')

