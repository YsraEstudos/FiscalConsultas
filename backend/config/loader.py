"""
Carregador de configuração (Refatorado para usar Pydantic).
Mantém a interface 'CONFIG' para compatibilidade.
"""

from .settings import settings

# Alias para manter compatibilidade com código antigo
CONFIG = settings
