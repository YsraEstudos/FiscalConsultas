"""
Exceções customizadas do Nesh.
Hierarquia de exceções para tratamento de erros consistente.

Cada exceção define:
- message: Mensagem legível para o usuário
- code: Código de erro para programático (ex: "VALIDATION_ERROR")
- status_code: Código HTTP padrão para a exceção
"""


class NeshError(Exception):
    """Exceção base do Nesh. Todas as exceções customizadas herdam desta."""

    status_code: int = 500  # Default para erros internos

    def __init__(self, message: str, code: str = None):
        self.message = message
        self.code = code or "NESH_ERROR"
        super().__init__(self.message)


class ConfigurationError(NeshError):
    """Erro de configuração (arquivo não encontrado, formato inválido, etc.)."""

    status_code = 500

    def __init__(self, message: str):
        super().__init__(message, "CONFIG_ERROR")


class DatabaseError(NeshError):
    """Erro de banco de dados (conexão, query, etc.)."""

    status_code = 503  # Service Unavailable

    def __init__(self, message: str):
        super().__init__(message, "DB_ERROR")


class DatabaseNotFoundError(DatabaseError):
    """Banco de dados não encontrado no caminho especificado."""

    status_code = 503

    def __init__(self, path: str):
        super().__init__(f"Banco de dados não encontrado: {path}")
        self.path = path


class ChapterNotFoundError(NeshError):
    """Capítulo não encontrado no banco de dados."""

    status_code = 404

    def __init__(self, chapter_num: str):
        super().__init__(f"Capítulo {chapter_num} não encontrado", "CHAPTER_NOT_FOUND")
        self.chapter_num = chapter_num


class InvalidQueryError(NeshError):
    """Query de busca inválida."""

    status_code = 400

    def __init__(self, query: str, reason: str = "Query inválida"):
        super().__init__(f"{reason}: '{query}'", "INVALID_QUERY")
        self.query = query


class ValidationError(NeshError):
    """Erro de validação de input (parâmetros inválidos ou faltantes)."""

    status_code = 400

    def __init__(self, message: str, field: str = None):
        super().__init__(message, "VALIDATION_ERROR")
        self.field = field


class ServiceError(NeshError):
    """Erro em operação de serviço (falha de processamento)."""

    status_code = 500

    def __init__(self, message: str, service: str = None):
        super().__init__(message, "SERVICE_ERROR")
        self.service = service


class NotFoundError(NeshError):
    """Recurso genérico não encontrado."""

    status_code = 404

    def __init__(self, resource: str, identifier: str = None):
        msg = (
            f"{resource} não encontrado"
            if not identifier
            else f"{resource} '{identifier}' não encontrado"
        )
        super().__init__(msg, "NOT_FOUND")
        self.resource = resource
        self.identifier = identifier
