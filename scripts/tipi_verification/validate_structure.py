
import sys
from pathlib import Path
import json

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.append(str(PROJECT_ROOT))

from backend.services.tipi_service import TipiService

def validate_structure():
    service = TipiService()
    
    print("\n--- Teste 1: Busca '84.13' em Modo FAMILIA (Esperado: Detalhado) ---")
    resp_family = service.search_by_code("84.13", view_mode="family")
    print_hierarchy(resp_family)

    print("\n--- Teste 2: Busca '84.13' em Modo CAPITULO (Esperado: Detalhado dentro do capítulo) ---")
    # O usuário reclamou que ao buscar 84.13 com 'capitulo inteiro', ele fica incorreto.
    # Vamos buscar '84' ou '84.13' com view_mode='chapter'
    resp_chapter = service.search_by_code("84.13", view_mode="chapter")
    
    # Filtrar apenas o trecho 84.13 para comparação
    print_hierarchy(resp_chapter, filter_prefix="84.13")
    print_hierarchy(resp_chapter, filter_prefix="8413")

def print_hierarchy(response, filter_prefix=None):
    results = response.get('results', {})
    found_any = False
    
    for cap, data in results.items():
        posicoes = data.get('posicoes', [])
        for p in posicoes:
            ncm = p['ncm']
            # Se tiver filtro, só mostra se começar com o prefixo (normalizado ou não)
            if filter_prefix:
                clean_ncm = ncm.replace(".", "")
                clean_prefix = filter_prefix.replace(".", "")
                if not clean_ncm.startswith(clean_prefix):
                    continue
            
            found_any = True
            indent = "  " * p['nivel']
            print(f"{indent}{ncm} - {p['descricao'][:60]}... (Alíquota: {p['aliquota']})")
    
    if not found_any and filter_prefix:
        print(f"  (Nenhum item encontrado com prefixo {filter_prefix})")

if __name__ == "__main__":
    validate_structure()
