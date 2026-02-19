import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.getcwd())

from backend.infrastructure.redis_client import redis_cache


async def main():
    print(f"Redis Enabled: {redis_cache.enabled}")
    if not redis_cache.enabled:
        print("Redis is disabled in settings.")
        return

    print("Attempting to connect to Redis...")
    try:
        await redis_cache.connect()
        print("Connected.")

        print("Setting key...")
        await redis_cache.client.set("test_key", "hello")

        print("Getting key...")
        val = await redis_cache.client.get("test_key")
        print(f"Value: {val}")

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback

        traceback.print_exc()
    finally:
        await redis_cache.close()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
