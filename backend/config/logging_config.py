"""
Configuração de logging estruturado do Nesh.
Fornece loggers configurados para cada módulo.
"""

import logging
import sys
from typing import Optional


def setup_logging(level: int = logging.INFO, log_file: Optional[str] = None) -> None:
    """
    Configura o logging global da aplicação.
    
    Args:
        level: Nível de logging (default: INFO)
        log_file: Caminho opcional para arquivo de log
    """
    # Formato com timestamp, nível e módulo
    formatter = logging.Formatter(
        fmt='%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Handler para console (colorido e seguro para UTF-8)
    if sys.platform == "win32":
        # Windows requires specific handling or reconfiguring stdout
        # Using sys.stdout directly often fails with Unicode if not configured
        # Simple fix: Use UTF-8 encoding for file handlers, but for stream rely on python's new utf-8 mode
        # or just fallback to 'replace' error handler for safety
        sys.stdout.reconfigure(encoding='utf-8')
        
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    
    # Configura root logger
    root_logger = logging.getLogger('nesh')
    root_logger.setLevel(level)
    root_logger.addHandler(console_handler)
    
    # Handler para arquivo (opcional)
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """
    Retorna logger para um módulo específico.
    
    Args:
        name: Nome do módulo (ex: 'database', 'service')
        
    Returns:
        Logger configurado com prefixo 'nesh.'
        
    Example:
        >>> logger = get_logger('database')
        >>> logger.info("Conectado ao banco")
        # Output: 2026-01-09 17:30:00 | INFO     | nesh.database | Conectado ao banco
    """
    return logging.getLogger(f'nesh.{name}')


# Loggers pré-configurados para importação direta
config_logger = get_logger('config')
db_logger = get_logger('database')
service_logger = get_logger('service')
renderer_logger = get_logger('renderer')
server_logger = get_logger('server')
