#!/usr/bin/env python3
"""
Nesh - Servidor de Busca NCM
============================

Entry point da aplicação.
Execute com: python Nesh.py

Para setup inicial, execute primeiro:
    python scripts/setup_database.py

Arquitetura:
    backend/
    ├── config/         # Configuração (settings.json)
    ├── domain/         # Modelos de dados (TypedDicts)
    ├── infrastructure/ # Acesso a dados (SQLite)
    ├── services/       # Lógica de negócio
    ├── presentation/   # Renderização HTML/Markdown
    └── server/         # Handler HTTP

Versão: 4.0 (Modular Architecture)
"""


import uvicorn
import os
import sys
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def main():
    """
    Função principal que configura e inicia o servidor Uvicorn.
    
    Adiciona o diretório raiz ao PYTHONPATH e inicia o servidor
    escutando em 127.0.0.1:8000 com reload automático ativado.
    """
    # Adiciona diretório atual ao path para garantir imports corretos
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    
    # Configurações do servidor (pode vir do config.py se necessário)
    HOST = "127.0.0.1"
    PORT = 8000
    
    print(f"Starting Nesh Server on http://{HOST}:{PORT}")
    
    # Executa Uvicorn
    # reload=True ajuda no desenvolvimento (hot reload)
    uvicorn.run("backend.server.app:app", host=HOST, port=PORT, reload=True)

if __name__ == "__main__":
    main()
