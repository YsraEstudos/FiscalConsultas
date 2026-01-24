"""Teste direto do TipiService para verificar se o filtro de prefixo funciona."""
import sys
sys.path.insert(0, '.')

from backend.services.tipi_service import TipiService

service = TipiService()

# Teste 1: Busca por "8413" deve retornar ~35 itens (apenas subníveis de 84.13)
result = service.search_by_code("8413")
posicoes = result.get('resultados', {}).get('84', {}).get('posicoes', [])

print(f"=== Teste: Busca por '8413' ===")
print(f"Total de posições: {len(posicoes)}")
print(f"\nPrimeiros 15 NCMs:")
for p in posicoes[:15]:
    print(f"  {p['ncm']:18} | nv{p.get('nivel',0)} | {p['descricao'][:40]}")

# Teste 2: Busca por "84.13" deve ter o mesmo resultado
result2 = service.search_by_code("84.13")
posicoes2 = result2.get('resultados', {}).get('84', {}).get('posicoes', [])

print(f"\n=== Teste: Busca por '84.13' ===")
print(f"Total de posições: {len(posicoes2)}")

# Verificar se 84.14 está no resultado (não deveria!)
has_8414 = any('8414' in service._clean_ncm(p['ncm']) for p in posicoes)
print(f"\nContém 84.14? {'SIM (ERRO!)' if has_8414 else 'NÃO (correto)'}")

service.close()
