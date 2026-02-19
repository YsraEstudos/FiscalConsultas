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

    async def set(self, key, value, ex):
        if self.fail_set:
            raise RuntimeError("set failed")
        self.set_calls.append((key, value, ex))
        self.store[key] = value


def _cache() -> redis_mod.RedisCache:
    return redis_mod.RedisCache(
        url="redis://localhost:6379/0",
        enabled=True,
        chapter_ttl=120,
        fts_ttl=60,
    )


@pytest.mark.asyncio
async def test_connect_skips_when_disabled():
    cache = redis_mod.RedisCache("redis://localhost", enabled=False, chapter_ttl=1, fts_ttl=1)
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

    monkeypatch.setattr(redis_mod.orjson, "dumps", lambda _value: (_ for _ in ()).throw(TypeError("bad")))
    await cache.set_json("k2", {"x": 1}, 10)


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
