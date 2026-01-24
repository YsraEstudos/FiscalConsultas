"""Script de teste para o novo sistema de ranking."""
import time
import os
import asyncio

async def main() -> None:
    # Ajuste de path para rodar da raiz ou da pasta tests
    current_dir = os.path.basename(os.getcwd())
    if current_dir == "scripts":
        os.chdir("../..")
    elif current_dir == "tests":
        os.chdir("..")
    elif current_dir == "Fiscal":
        pass # estamos na raiz
        
    import sys
    sys.path.append(os.getcwd())
    
    from backend.infrastructure.database import DatabaseAdapter
    from backend.services.nesh_service import NeshService

    db = DatabaseAdapter("nesh.db")
    svc = NeshService(db)

    # Teste com "bomba submersivel" - medir tempo
    print("Medindo performance...")
    
    try:
        times = []
        for i in range(5):
            start = time.perf_counter()
            resp = await svc.search_full_text("bomba submersivel")
            elapsed = (time.perf_counter() - start) * 1000
            times.append(elapsed)
            print(f"  Run {i+1}: {elapsed:.1f}ms")

        avg = sum(times) / len(times)
        print(f"\nMédia: {avg:.1f}ms")
        print(f"Total results: {len(resp['results'])}")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
