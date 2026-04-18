"""
Configuração de logging estruturado do Nesh.
Fornece loggers configurados para cada módulo.
"""

import logging
import re
import sys
from typing import Any, Optional

_REDACTED = "[REDACTED]"
NESH_MANAGED_HANDLER_ATTR = "_nesh_managed_handler"
# Sentinel used to identify handlers created by setup_logging without touching user-managed handlers.
_SENSITIVE_KEY_TOKENS = (
    "authorization",
    "token",
    "secret",
    "password",
    "api_key",
    "apikey",
    "access_key",
    "access_token",
    "refresh_token",
    "redis_url",
    "postgres_url",
)
_SENSITIVE_STRING_PATTERNS = (
    re.compile(r"(?i)\b(authorization)\b(\s*[:=]\s*)(bearer\s+[^\s,]+|[^\s,]+)"),
    re.compile(
        r"(?i)\b(x-admin-token|x-asaas-access-token|asaas-access-token|api[_-]?key|secret|password|token)\b(\s*[:=]\s*)([^\s,]+)"
    ),
)


def _is_sensitive_key(key: str) -> bool:
    normalized = key.strip().lower().replace("-", "_")
    return any(token in normalized for token in _SENSITIVE_KEY_TOKENS)


def _sanitize_string(value: str) -> str:
    sanitized = value
    sanitized = _SENSITIVE_STRING_PATTERNS[0].sub(
        lambda match: f"{match.group(1)}{match.group(2)}{_REDACTED}",
        sanitized,
    )
    sanitized = _SENSITIVE_STRING_PATTERNS[1].sub(
        lambda match: f"{match.group(1)}{match.group(2)}{_REDACTED}",
        sanitized,
    )
    return sanitized


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (_REDACTED if _is_sensitive_key(str(key)) else _sanitize_value(item))
            for key, item in value.items()
        }
    if isinstance(value, tuple):
        return tuple(_sanitize_value(item) for item in value)
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, str):
        return _sanitize_string(value)
    return value


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            record.args = _sanitize_value(record.args)
        if isinstance(record.msg, (dict, list, tuple, str)):
            record.msg = _sanitize_value(record.msg)
        return True


def _resolve_logging_level(level: int | str | None) -> int:
    if isinstance(level, int):
        return level
    if isinstance(level, str):
        return getattr(logging, level.strip().upper(), logging.INFO)
    return logging.INFO


def _remove_managed_handlers(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        if getattr(handler, NESH_MANAGED_HANDLER_ATTR, False):
            logger.removeHandler(handler)
            try:
                handler.close()
            except Exception:
                pass


def setup_logging(
    level: int | str = logging.INFO,
    log_file: Optional[str] = None,
    *,
    redact_sensitive_data: bool = True,
) -> None:
    """
    Configura o logging global da aplicação.

    Args:
        level: Nível de logging (default: INFO)
        log_file: Caminho opcional para arquivo de log
        redact_sensitive_data: Redige segredos e tokens antes de enviar ao log.
    """
    # Formato com timestamp, nível e módulo
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    resolved_level = _resolve_logging_level(level)
    active_filters: list[logging.Filter] = []
    if redact_sensitive_data:
        active_filters.append(SensitiveDataFilter())

    # Handler para console (colorido e seguro para UTF-8)
    if sys.platform == "win32":
        # Windows requires specific handling or reconfiguring stdout
        # Using sys.stdout directly often fails with Unicode if not configured
        # Simple fix: Use UTF-8 encoding for file handlers, but for stream rely on python's new utf-8 mode
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    setattr(console_handler, NESH_MANAGED_HANDLER_ATTR, True)
    for active_filter in active_filters:
        console_handler.addFilter(active_filter)

    # Configura root logger
    root_logger = logging.getLogger("nesh")
    _remove_managed_handlers(root_logger)
    root_logger.setLevel(resolved_level)
    root_logger.propagate = False
    root_logger.addHandler(console_handler)

    # Handler para arquivo (opcional)
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        setattr(file_handler, NESH_MANAGED_HANDLER_ATTR, True)
        for active_filter in active_filters:
            file_handler.addFilter(active_filter)
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
    return logging.getLogger(f"nesh.{name}")


# Loggers pré-configurados para importação direta
config_logger = get_logger("config")
db_logger = get_logger("database")
service_logger = get_logger("service")
renderer_logger = get_logger("renderer")
server_logger = get_logger("server")
