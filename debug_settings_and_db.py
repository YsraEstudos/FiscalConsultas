import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.getcwd())

from backend.config.settings import settings
from backend.infrastructure.db_engine import get_session
from sqlalchemy import text


async def main():
    print(f"Database Engine: {settings.database.engine}")
    print(f"Async URL: {settings.database.async_url}")
    print(f"Is Postgres: {settings.database.is_postgres}")

    print("\nAttempting to connect to database...")
    try:
        async with get_session() as session:
            print("Session acquired.")
            result = await session.execute(text("SELECT 1"))
            print(f"Query result: {result.scalar()}")

            print("\nChecking tables...")
            result = await session.execute(
                text(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
                )
            )
            print(f"Table count: {result.scalar()}")
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
