import pytest

from backend.infrastructure import redis_client as redis_mod

pytestmark = pytest.mark.unit


class _FakeRedis:
    def __init__(self):
        self.store = {}
        self.set_calls = []
        self.closed = False
        self.fail_get = False
        self.fail_set = False
        self.fail_ping = False
        self.fail_close = False

    async def ping(self):
        if self.fail_ping:
            raise RuntimeError("ping failed")

    async def aclose(self):
        if self.fail_close:
            raise RuntimeError("close failed")
        self.closed = True

    async def get(self, key):
        if self.fail_get:
            raise RuntimeError("get failed")
        return self.store.get(key)

    async def set(self, key, value, ex=None, nx=False, px=None):
        if self.fail_set:
            raise RuntimeError("set failed")
        if nx and key in self.store:
            return False
        self.set_calls.append((key, value, ex, nx, px))
        self.store[key] = value
        return True

    async def delete(self, key):
        self.store.pop(key, None)

    async def incr(self, key):
        current = int(self.store.get(key, b"0"))
        current += 1
        self.store[key] = str(current).encode()
        return current


def _cache() -> redis_mod.RedisCache:
    return redis_mod.RedisCache(
        url="redis://localhost:6379/0",
        enabled=True,
        max_payload_bytes=32_768,
        chapter_ttl=120,
        fts_ttl=60,
        services_search_ttl=300,
        services_detail_ttl=900,
        status_ttl=20,
    )


@pytest.mark.asyncio
async def test_connect_skips_when_disabled():
    cache = redis_mod.RedisCache(
        "redis://localhost",
        enabled=False,
        max_payload_bytes=32_768,
        chapter_ttl=1,
        fts_ttl=1,
        services_search_ttl=1,
        services_detail_ttl=1,
        status_ttl=1,
    )
    await cache.connect()
    assert cache.available is False


@pytest.mark.asyncio
async def test_connect_skips_when_dependency_unavailable(monkeypatch):
    cache = _cache()
    warnings = []
    monkeypatch.setattr(redis_mod, "_REDIS_AVAILABLE", False)
    monkeypatch.setattr(redis_mod.logger, "warning", lambda msg: warnings.append(msg))

    await cache.connect()
    assert cache.available is False
    assert warnings


@pytest.mark.asyncio
async def test_connect_success_and_idempotent(monkeypatch):
    cache = _cache()
    fake = _FakeRedis()
    monkeypatch.setattr(redis_mod, "_REDIS_AVAILABLE", True)
    monkeypatch.setattr(redis_mod.aioredis, "from_url", lambda *_args, **_kwargs: fake)
    monkeypatch.setattr(redis_mod.logger, "info", lambda _msg: None)

    await cache.connect()
    assert cache.available is True
    await cache.connect()
    assert cache.available is True


@pytest.mark.asyncio
async def test_connect_resets_client_on_ping_failure(monkeypatch):
    cache = _cache()
    fake = _FakeRedis()
    fake.fail_ping = True
    monkeypatch.setattr(redis_mod, "_REDIS_AVAILABLE", True)
    monkeypatch.setattr(redis_mod.aioredis, "from_url", lambda *_args, **_kwargs: fake)
    monkeypatch.setattr(redis_mod.logger, "warning", lambda *_args, **_kwargs: None)

    await cache.connect()
    assert cache.available is False


@pytest.mark.asyncio
async def test_close_handles_success_and_failure(monkeypatch):
    cache = _cache()
    fake = _FakeRedis()
    cache._client = fake

    await cache.close()
    assert cache.available is False
    assert fake.closed is True

    cache._client = _FakeRedis()
    cache._client.fail_close = True
    monkeypatch.setattr(redis_mod.logger, "warning", lambda *_args, **_kwargs: None)
    await cache.close()
    assert cache.available is False


@pytest.mark.asyncio
async def test_get_json_and_set_json_happy_path():
    cache = _cache()
    fake = _FakeRedis()
    cache._client = fake

    await cache.set_json("k1", {"ok": True}, 10)
    got = await cache.get_json("k1")
    assert got == {"ok": True}


@pytest.mark.asyncio
async def test_get_json_returns_none_on_absent_or_error(monkeypatch):
    cache = _cache()
    fake = _FakeRedis()
    cache._client = fake
    assert await cache.get_json("missing") is None

    fake.fail_get = True
    monkeypatch.setattr(redis_mod.logger, "debug", lambda *_args, **_kwargs: None)
    assert await cache.get_json("k2") is None


@pytest.mark.asyncio
async def test_set_json_handles_serialize_or_write_errors(monkeypatch):
    cache = _cache()
    fake = _FakeRedis()
    fake.fail_set = True
    cache._client = fake
    monkeypatch.setattr(redis_mod.logger, "debug", lambda *_args, **_kwargs: None)

    await cache.set_json("k1", {"x": 1}, 10)
    assert fake.set_calls == []

    monkeypatch.setattr(
        redis_mod.orjson,
        "dumps",
        lambda _value: (_ for _ in ()).throw(TypeError("bad")),
    )
    await cache.set_json("k2", {"x": 1}, 10)


@pytest.mark.asyncio
async def test_set_json_skips_payloads_above_limit():
    cache = _cache()
    cache.max_payload_bytes = 8
    fake = _FakeRedis()
    cache._client = fake

    await cache.set_json("big", {"payload": "123456789"}, 10)

    assert "big" not in fake.store
    assert fake.set_calls == []


@pytest.mark.asyncio
async def test_chapter_and_fts_helpers_use_expected_keys(monkeypatch):
    cache = _cache()

    seen = {}

    async def _fake_get(key):
        seen["get"] = key
        return {"k": "v"}

    async def _fake_set(key, value, ttl):
        seen["set"] = (key, value, ttl)

    monkeypatch.setattr(cache, "get_json", _fake_get)
    monkeypatch.setattr(cache, "set_json", _fake_set)

    got_ch = await cache.get_chapter("85")
    assert got_ch == {"k": "v"}
    assert seen["get"] == "nesh:chapter:85"

    await cache.set_chapter("85", {"a": 1})
    assert seen["set"] == ("nesh:chapter:85", {"a": 1}, cache.chapter_ttl)

    got_fts = await cache.get_fts("motor")
    assert got_fts == {"k": "v"}
    assert seen["get"] == "nesh:fts:motor"

    await cache.set_fts("motor", [1, 2])
    assert seen["set"] == ("nesh:fts:motor", [1, 2], cache.fts_ttl)


@pytest.mark.asyncio
async def test_services_and_status_helpers_use_expected_keys(monkeypatch):
    cache = _cache()

    seen = {}

    async def _fake_get(key):
        seen["get"] = key
        return {"ok": True}

    async def _fake_set(key, value, ttl):
        seen["set"] = (key, value, ttl)

    versions = {
        "meta:catalog-version:nbs:tenant-a": "v7",
        "meta:catalog-version:nebs:tenant-b": "v3",
    }

    async def _fake_get_version(key):
        if key in versions:
            return versions[key]
        return await _fake_get(key)

    monkeypatch.setattr(cache, "get_json", _fake_get)
    monkeypatch.setattr(cache, "set_json", _fake_set)
    monkeypatch.setattr(
        cache,
        "get_catalog_version",
        lambda catalog, scope="public": _fake_get_version(
            f"meta:catalog-version:{catalog}:{scope}"
        ),
    )

    got_search = await cache.get_services_search("nbs", "tenant-a", "search-key")
    assert got_search == {"ok": True}
    assert seen["get"] == "services:nbs:search:v7:tenant-a:search-key"

    await cache.set_services_search("nbs", "tenant-a", "search-key", {"items": 1})
    assert seen["set"] == (
        "services:nbs:search:v7:tenant-a:search-key",
        {"items": 1},
        cache.services_search_ttl,
    )

    got_detail = await cache.get_services_detail("nebs", "tenant-b", "detail-key")
    assert got_detail == {"ok": True}
    assert seen["get"] == "services:nebs:detail:v3:tenant-b:detail-key"

    await cache.set_services_detail("nebs", "tenant-b", "detail-key", {"entry": 1})
    assert seen["set"] == (
        "services:nebs:detail:v3:tenant-b:detail-key",
        {"entry": 1},
        cache.services_detail_ttl,
    )

    got_status = await cache.get_status_snapshot("public")
    assert got_status == {"ok": True}
    assert seen["get"] == "system:status:public"

    await cache.set_status_snapshot("public", {"status": "online"})
    assert seen["set"] == (
        "system:status:public",
        {"status": "online"},
        cache.status_ttl,
    )


@pytest.mark.asyncio
async def test_catalog_version_helpers_and_token_normalization():
    cache = _cache()
    fake = _FakeRedis()
    cache._client = fake

    assert (
        redis_mod.RedisCache.normalize_cache_token("  Motor   Eletrico ")
        == "motor eletrico"
    )
    assert len(redis_mod.RedisCache.hash_cache_token("Motor")) == 64

    assert await cache.get_catalog_version("nbs") == "v1"
    bumped = await cache.bump_catalog_version("nbs")
    assert bumped == "v1"
    assert await cache.get_catalog_version("nbs") == "v1"


@pytest.mark.asyncio
async def test_cached_json_uses_fill_retry_and_stale_paths():
    cache = _cache()
    fake = _FakeRedis()
    cache._client = fake

    loader_calls = {"count": 0}

    async def _loader():
        loader_calls["count"] += 1
        return {"value": 42}

    first, stats_first = await cache.cached_json(
        "services:nbs:test",
        ttl_seconds=30,
        loader=_loader,
    )
    assert first == {"value": 42}
    assert stats_first["cache_status"] == "fill"
    assert loader_calls["count"] == 1

    second, stats_second = await cache.cached_json(
        "services:nbs:test",
        ttl_seconds=30,
        loader=_loader,
    )
    assert second == {"value": 42}
    assert stats_second["cache_status"] == "hit"
    assert loader_calls["count"] == 1

    fake.store.pop("services:nbs:test", None)
    fake.store["stale:services:nbs:test"] = redis_mod.orjson.dumps({"value": 7})

    async def _fake_set_if_not_exists(_key, _value, *, ttl_ms):
        del ttl_ms
        return False

    cache.set_if_not_exists = _fake_set_if_not_exists  # type: ignore[method-assign]
    stale_value, stale_stats = await cache.cached_json(
        "services:nbs:test",
        ttl_seconds=30,
        loader=_loader,
    )
    assert stale_value == {"value": 7}
    assert stale_stats["cache_status"] == "stale"
    assert stale_stats["stale_served"] is True
