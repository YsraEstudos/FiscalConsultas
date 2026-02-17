import asyncio
import sys
import os
sys.path.append(os.getcwd())
from backend.infrastructure.redis_client import redis_cache
from backend.config.settings import settings

async def main():
    print(f"Settings Redis Enabled: {settings.cache.enable_redis}")
    print(f"Settings Redis URL: {settings.cache.redis_url}")
    await redis_cache.connect()
    print(f"Redis Available after connect: {redis_cache.available}")
    if redis_cache.available:
        await redis_cache.set_json("benchmark_test", {"foo": "bar"}, 60)
        val = await redis_cache.get_json("benchmark_test")
        print(f"Redis Set/Get Test: {val}")
    await redis_cache.close()

if __name__ == "__main__":
    asyncio.run(main())
