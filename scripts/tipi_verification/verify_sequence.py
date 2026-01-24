
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.append(str(PROJECT_ROOT))

from backend.services.tipi_service import TipiService

def verify_sequence():
    service = TipiService()
    print("Fetching Chapter 84...")
    # view_mode='chapter' fetches all items in strict order
    resp = service.search_by_code("84", view_mode="chapter")
    
    posicoes = resp['results']['84']['posicoes']
    
    # Locate index of 84.13
    idx_8413 = -1
    for i, p in enumerate(posicoes):
        if p['ncm'] == '84.13':
            idx_8413 = i
            break
            
    if idx_8413 == -1:
        print("Error: 84.13 not found")
        return

    print(f"Found 84.13 at index {idx_8413}")
    
    # Print next 20 items
    print("--- Sequence after 84.13 ---")
    for i in range(idx_8413, min(idx_8413 + 20, len(posicoes))):
        print(f"{posicoes[i]['ncm']}")

if __name__ == "__main__":
    verify_sequence()
