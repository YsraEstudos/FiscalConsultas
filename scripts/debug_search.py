
import asyncio
import time
import sys
import os

# Add root to path
sys.path.insert(0, os.getcwd())

from backend.infrastructure.database import DatabaseAdapter
from backend.services.nesh_service import NeshService
from backend.config import CONFIG

async def main():
    print("Initializing Database...")
    db = DatabaseAdapter(CONFIG.db_path)
    await db._ensure_pool()
    print("Database Initialized.")
    
    service = NeshService(db)
    print("Service Initialized.")
    
    queries = [
        "parafuso",
        "motor",
        "agua",
        "plastico",
        "ferro",
        "veiculo",
        "oleo",
        "gasolina",
        "eletrico"
    ]
    
    for q in queries:
        print(f"Searching for '{q}'...")
        start = time.perf_counter()
        try:
            res = await service.process_request(q)
            duration = time.perf_counter() - start
            count = len(res.get('results', []))
            print(f"Query: '{q}' | Time: {duration:.4f}s | Results: {count}")
        except Exception as e:
            print(f"Query '{q}' FAILED: {e}")
            import traceback
            traceback.print_exc()

    await db.close()

if __name__ == "__main__":
    asyncio.run(main())
