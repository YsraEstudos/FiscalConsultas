import pytest

import backend.server.rate_limit as rate_limit
from backend.server.rate_limit import RedisBackedRateLimiter, SlidingWindowRateLimiter

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_rate_limiter_blocks_after_limit_and_reports_retry(monkeypatch):
    now = {"value": 100.0}
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now["value"])

    limiter = SlidingWindowRateLimiter(window_seconds=10)

    assert await limiter.consume("user-1", limit=2) == (True, 0)
    assert await limiter.consume("user-1", limit=2) == (True, 0)

    allowed, retry_after = await limiter.consume("user-1", limit=2)
    assert allowed is False
    assert retry_after == 10

    now["value"] = 105.0
    allowed, retry_after = await limiter.consume("user-1", limit=2)
    assert allowed is False
    assert retry_after == 5


@pytest.mark.asyncio
async def test_rate_limiter_window_expires_requests(monkeypatch):
    now = {"value": 50.0}
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now["value"])

    limiter = SlidingWindowRateLimiter(window_seconds=5)

    assert await limiter.consume("user-1", limit=1) == (True, 0)
    assert (await limiter.consume("user-1", limit=1))[0] is False

    now["value"] = 56.0
    assert await limiter.consume("user-1", limit=1) == (True, 0)


@pytest.mark.asyncio
async def test_rate_limiter_uses_isolated_buckets_per_key():
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    assert await limiter.consume("user-1", limit=1) == (True, 0)
    assert await limiter.consume("user-2", limit=1) == (True, 0)


@pytest.mark.asyncio
async def test_rate_limiter_reset_clears_state():
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    assert await limiter.consume("user-1", limit=1) == (True, 0)
    assert (await limiter.consume("user-1", limit=1))[0] is False
    limiter.reset()
    assert await limiter.consume("user-1", limit=1) == (True, 0)


@pytest.mark.asyncio
async def test_rate_limiter_drops_stale_empty_buckets(monkeypatch):
    now = {"value": 10.0}
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now["value"])

    limiter = SlidingWindowRateLimiter(window_seconds=5)
    assert await limiter.consume("user-1", limit=1) == (True, 0)
    assert "user-1" in limiter._buckets

    now["value"] = 20.0
    assert await limiter.consume("user-2", limit=1) == (True, 0)
    assert "user-1" not in limiter._buckets


class _FakeRedisSortedSet:
    def __init__(self):
        self.buckets = {}

    async def zremrangebyscore(self, key, _minimum, maximum):
        cutoff = float(maximum)
        bucket = self.buckets.get(key, [])
        self.buckets[key] = [
            (member, score) for member, score in bucket if score > cutoff
        ]

    async def zcard(self, key):
        return len(self.buckets.get(key, []))

    async def zrange(self, key, start, stop, *, withscores=False):
        bucket = sorted(self.buckets.get(key, []), key=lambda item: item[1])
        if stop == 0:
            items = bucket[:1]
        else:
            items = bucket[start : stop + 1]
        if withscores:
            return items
        return [member for member, _score in items]

    async def zadd(self, key, mapping):
        bucket = self.buckets.setdefault(key, [])
        for member, score in mapping.items():
            bucket.append((member, score))

    async def expire(self, _key, _seconds):
        return True


@pytest.mark.asyncio
async def test_redis_backed_rate_limiter_uses_redis_when_available(monkeypatch):
    now = {"value": 100.0}
    fake_redis = _FakeRedisSortedSet()
    monkeypatch.setattr(rate_limit.time, "time", lambda: now["value"])
    monkeypatch.setattr(rate_limit.redis_cache, "_client", fake_redis)

    limiter = RedisBackedRateLimiter(window_seconds=10, redis_prefix="test")

    assert await limiter.consume("user-1", limit=2) == (True, 0)
    assert await limiter.consume("user-1", limit=2) == (True, 0)

    allowed, retry_after = await limiter.consume("user-1", limit=2)
    assert allowed is False
    assert retry_after == 10


@pytest.mark.asyncio
async def test_redis_backed_rate_limiter_falls_back_to_memory_when_redis_unavailable(
    monkeypatch,
):
    now = {"value": 50.0}
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(rate_limit.redis_cache, "_client", None)

    fallback = SlidingWindowRateLimiter(window_seconds=5)
    limiter = RedisBackedRateLimiter(
        window_seconds=5,
        redis_prefix="test",
        fallback=fallback,
    )

    assert await limiter.consume("user-1", limit=1) == (True, 0)
    assert (await limiter.consume("user-1", limit=1))[0] is False
