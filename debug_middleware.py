import asyncio
import sys
import os
import time

# Add project root to path
sys.path.insert(0, os.getcwd())

from backend.server.middleware import TenantMiddleware


async def mock_app(scope, receive, send):
    print("  [Mock App] Reached inside app!")
    await send({"type": "http.response.start", "status": 200})
    await send({"type": "http.response.body", "body": b"ok"})


async def main():
    print("Initializing Middleware...")
    middleware = TenantMiddleware(mock_app)

    scope = {
        "type": "http",
        "path": "/api/search",
        "method": "GET",
        "headers": [
            (b"host", b"localhost:8000"),
            # No auth header to trigger dev fallback or 401
        ],
    }

    async def receive():
        return {"type": "body", "body": b""}

    async def send(message):
        print(f"  [Send] {message}")

    print("\n--- Test 1: No Auth (Should fail or use dev fallback) ---")
    try:
        await middleware(scope, receive, send)
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()

    print("\n--- Test 2: Mock Auth Header (Simulated) ---")
    # This might fail actual decoding but we want to see if it hangs
    scope["headers"].append((b"authorization", b"Bearer test.token.here"))
    try:
        await middleware(scope, receive, send)
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
