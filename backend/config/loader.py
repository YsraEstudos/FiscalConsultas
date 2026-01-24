"""
Carregador de configuração do Nesh.
Implementa padrão Singleton para acesso global à configuração.
"""

import os
import json
from typing import Set

# Diretório raiz do projeto (2 níveis acima: backend/config -> backend -> raiz)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class ConfigLoader:
    """
    Singleton que gerencia a configuração do servidor.
    
    Carrega settings.json do diretório config/ na raiz do projeto.
    Fornece valores default caso o arquivo não exista.
    
    Attributes:
        port: Porta do servidor HTTP (default: 8000)
        db_path: Caminho absoluto para o banco SQLite
        stopwords: Set de palavras a ignorar na busca FTS
    """
    
    _instance = None
    _config = {}
    
    @classmethod
    def get_instance(cls) -> 'ConfigLoader':
        """Retorna a instância única do ConfigLoader."""
        if cls._instance is None:
            cls._instance = ConfigLoader()
        return cls._instance
    
    def __init__(self):
        if ConfigLoader._instance is not None:
            raise Exception("ConfigLoader é um Singleton! Use get_instance().")
        self.load_config()
    
    def load_config(self) -> None:
        """Carrega configuração do arquivo JSON."""
        config_path = os.path.join(PROJECT_ROOT, "backend", "config", "settings.json")
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                self._config = json.load(f)
        except Exception as e:
            print(f"⚠️ Erro ao carregar config ({e}). Usando defaults.")
            self._config = self._get_defaults()

    @staticmethod
    def _get_defaults() -> dict:
        """Retorna configuração padrão."""
        return {
            "server": {"port": 8000},
            "database": {"filename": "database/nesh.db"},
            "search": {"stopwords": []},
            "features": {"enable_fts": True}
        }

    @property
    def port(self) -> int:
        """Porta do servidor HTTP."""
        return self._config.get("server", {}).get("port", 8000)

    @property
    def db_path(self) -> str:
        """Caminho absoluto para o banco de dados SQLite."""
        filename = self._config.get("database", {}).get("filename", "nesh.db")
        return os.path.join(PROJECT_ROOT, filename)

    @property
    def stopwords(self) -> Set[str]:
        """Set de stopwords para busca FTS."""
        return set(self._config.get("search", {}).get("stopwords", []))


# Instância global para import direto
CONFIG = ConfigLoader.get_instance()
