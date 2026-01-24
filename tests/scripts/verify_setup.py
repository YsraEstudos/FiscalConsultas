
import sys
import os
import asyncio

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.config import CONFIG
from backend.infrastructure.database import DatabaseAdapter

async def verify():
    print(f"Config DB Path: {CONFIG.db_path}")
    
    if not os.path.exists(CONFIG.db_path):
        print("❌ DB file does not exist at config path!")
        return 1
        
    db = DatabaseAdapter(CONFIG.db_path)
    try:
        stats = await db.check_connection()
        if stats:
             print("✅ Connection Successful!")
             print(f"Stats: {stats}")
             return 0
        else:
             print("❌ Connection failed (stats returned None)")
             return 1
    except Exception as e:
        print(f"❌ Exception: {e}")
        return 1
    finally:
        await db.close()

if __name__ == "__main__":
    exit(asyncio.run(verify()))
