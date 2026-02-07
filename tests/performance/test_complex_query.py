
import pytest
import time
import asyncio
import sys
import os

# Ensure root is in path
sys.path.insert(0, os.getcwd())

from backend.infrastructure.database import DatabaseAdapter
from backend.services.nesh_service import NeshService
from backend.config import CONFIG

@pytest.mark.asyncio
async def test_complex_query_performance():
    """
    Tests performance of complex/edge-case queries.
    """
    db = DatabaseAdapter(CONFIG.db_path)
    await db._ensure_pool()
    service = NeshService(db)
    
    # query with max length (500 chars) consisting of many common words
    # "de " is 3 chars. 500/3 = 166 occurances.
    # "de" is a stopword? Check config. 
    # If it is stopword, it gets removed.
    # Let's use a non-stopword common prefix like "ma" -> matches "madeira", "maquina", etc.
    
    long_query = "ma " * 160
    
    print(f"\nLength: {len(long_query)}")
    
    start = time.perf_counter()
    try:
        # We expect this to be fast or fail fast. 
        # If it takes > 20s, it's a bug.
        await service.process_request(long_query)
    except Exception as e:
        print(f"Error: {e}")
    
    duration = time.perf_counter() - start
    print(f"Long Query Duration: {duration:.4f}s")
    
    await db.close()
    
    if duration > 1.0:
        pytest.fail(f"Complex query took too long: {duration:.4f}s")

if __name__ == "__main__":
    asyncio.run(test_complex_query_performance())
