import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from backend.config.settings import settings
from sqlalchemy import text


async def run_rls():
    engine = create_async_engine(settings.database.postgres_url)
    with open("scripts/setup_postgres_rls.sql", "r", encoding="utf-8") as f:
        sql = f.read()

    async with engine.begin() as conn:
        raw_conn = await conn.get_raw_connection()
        await raw_conn.driver_connection.execute(sql)  # NOSONAR

    print("RLS applied successfully.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_rls())
