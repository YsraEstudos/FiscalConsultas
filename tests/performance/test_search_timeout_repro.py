import pytest
import time
import asyncio
from backend.services.nesh_service import NeshService
from backend.infrastructure.database import DatabaseAdapter
from backend.config import CONFIG


@pytest.mark.asyncio
async def test_search_performance_repro():
    """
    Reproduces the timeout issue by running searches that might be slow.
    The user reported a 20s timeout. We will check if queries exceed a safe threshold (e.g., 5s).
    """

    # Initialize DB and Service directly to avoid API overhead for this specific perf test
    db = DatabaseAdapter(CONFIG.db_path)
    await db._ensure_pool()
    service = NeshService(db)

    # Common terms that might yield many results and trigger heavy FTS processing
    test_queries = [
        "parafuso",
        "motor",
        "agua",
        "plastico",
        "ferro",
        "veiculo",
        "oleo",
        "gasolina",
        "eletrico",
    ]

    print("\n--- Starting Performance Repro Test ---")

    max_duration = 0.0
    slowest_query = ""

    try:
        for query in test_queries:
            start_time = time.perf_counter()

            # Call the service method directly to isolate business logic perfermance
            await service.process_request(query)

            duration = time.perf_counter() - start_time
            print(f"Query: '{query}' took {duration:.4f}s")

            if duration > max_duration:
                max_duration = duration
                slowest_query = query

            # Assert that no query takes longer than 20s (the user's timeout)
            # We use a tighter bound (5s) to be safe and catch it early
            if duration > 5.0:
                pytest.fail(
                    f"Performance regression: Query '{query}' took {duration:.4f}s (Limit: 5.0s)"
                )

        print(f"Slowest query: '{slowest_query}' ({max_duration:.4f}s)")

    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(test_search_performance_repro())
