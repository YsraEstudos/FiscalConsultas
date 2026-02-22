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

import os
import sys

import uvicorn
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
    project_root = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(project_root, "backend")

    # Hot reload controlado:
    # - Evita watcher global em todo o projeto (muito pesado no Windows/OneDrive)
    # - Pode ser desabilitado com NESH_RELOAD=0
    reload_enabled = os.getenv("NESH_RELOAD", "1").lower() not in {"0", "false", "no"}

    print(f"Starting Nesh Server on http://{HOST}:{PORT}")

    # Executa Uvicorn
    uvicorn.run(
        "backend.server.app:app",
        host=HOST,
        port=PORT,
        reload=reload_enabled,
        reload_dirs=[backend_dir],
        reload_excludes=[
            "client/node_modules/*",
            "client/dist/*",
            ".venv/*",
            ".git/*",
            "data/*",
            "raw_data/*",
            "database/*",
            "snapshots/*",
            "__pycache__/*",
        ],
    )


if __name__ == "__main__":
    main()
