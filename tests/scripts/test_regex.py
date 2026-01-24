import re

# Simular a limpeza
RE_STANDALONE_NCM = re.compile(r'^\s*\d{2}\.\d{2}(?:\.\d{2})?\s*$', re.MULTILINE)
RE_NESH_INTERNAL_REF = re.compile(r'^\s*XV-\d{4}-\d+\s*$', re.MULTILINE)

test_content = """
73.24
XV-7324-1
73.24 - Artigos de higiene ou de toucador, e suas partes, de ferro fundido, ferro ou aço.

7324.10 - Pias e lavatórios, de aço inoxidável

73.25
XV-7325-1
73.25 - Outra posição de exemplo
"""

print("=== Conteúdo Original ===")
print(test_content)

# Aplicar filtros
content = RE_NESH_INTERNAL_REF.sub('', test_content)
content = RE_STANDALONE_NCM.sub('', content)

# Limpar espaços extras
content = re.sub(r'\n\n\n+', '\n\n', content)

print("\n=== Após Limpeza ===")
print(content)
