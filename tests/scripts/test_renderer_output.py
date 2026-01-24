"""Test renderer output in isolation."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.presentation.renderer import HtmlRenderer

# Simulate chapter data
sample_data = {
    "capitulo": "85",
    "conteudo": """**85.03 - Partes reconhecíveis como exclusiva ou principalmente destinadas às máquinas**

Ressalvadas as disposições gerais relativas à classificação das partes.

**85.04 - Transformadores elétricos, conversores elétricos estáticos (retificadores, por exemplo)**

Bobinas de reatância e de autoindução.

8504.10 - Reatores (Balastros*) para lâmpadas ou tubos de descarga

Etc.""",
    "notas_gerais": "Notas do capítulo",
    "posicoes": [
        {"codigo": "85.03", "descricao": "Partes"},
        {"codigo": "85.04", "descricao": "Transformadores"}
    ],
    "real_content_found": True
}

result = HtmlRenderer.render_chapter(sample_data)

print("=== RENDERED OUTPUT (first 2000 chars) ===")
print(result[:2000])

print("\n=== CHECKING FOR <details> TAGS ===")
print(f"Contains <details>: {'<details' in result}")
print(f"Contains <summary>: {'<summary' in result}")
print(f"Contains </details>: {'</details>' in result}")
