
import asyncio
import sys
import os
import logging

# Setup path
sys.path.insert(0, os.getcwd())

from backend.config import CONFIG, setup_logging
from backend.infrastructure import DatabaseAdapter
from backend.services import NeshService
from backend.presentation import HtmlRenderer
from backend.data.glossary_manager import init_glossary

# Configure logging to stdout
logging.basicConfig(level=logging.DEBUG)

async def reproduce():
    print("--- Starting Reproduction for 8413 ---")
    
    # Init Glossary (IMPORTANT: Match app.py behavior)
    project_root = os.getcwd() # Assumption: running from root
    print(f"Project Root: {project_root}")
    init_glossary(project_root)
    
    # Init DB
    db_path = CONFIG.db_path
    print(f"DB Path: {db_path}")
    if not os.path.exists(db_path):
        print("ERROR: DB not found")
        return

    db = DatabaseAdapter(db_path)
    await db._ensure_pool()
    
    service = NeshService(db)
    
    try:
        query = "8413"
        print(f"Processing request for: {query}")
        
        # 1. Test Service Layer
        response = await service.process_request(query)
        print("Service response received")
        
        # 2. Test Rendering Layer (mimic app.py)
        if response.get('type') == 'code':
            print("Rendering response...")
            html = HtmlRenderer.render_full_response(response['results'])
            print("Render successful")
            print(f"HTML Length: {len(html)}")
        else:
            print("Response type is not code")
            
    except Exception as e:
        print(f"!!! CRASH DETECTED !!!")
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await db.close()

if __name__ == "__main__":
    asyncio.run(reproduce())
