import backend.server.rate_limit as rate_limit
from backend.server.rate_limit import SlidingWindowRateLimiter

import pytest

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
