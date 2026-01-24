"""
Exception Handlers globais para o FastAPI.

Centraliza o tratamento de todas as exceções NeshError e erros genéricos,
garantindo respostas JSON padronizadas e evitando vazamento de stack traces.
"""

import logging
from fastapi import Request
from fastapi.responses import JSONResponse

from backend.config.exceptions import NeshError

logger = logging.getLogger("server")


async def nesh_exception_handler(request: Request, exc: NeshError) -> JSONResponse:
    """
    Handler global para todas as exceções NeshError e subclasses.
    
    Converte exceções tipadas em respostas JSON padronizadas com:
    - success: false
    - error.code: Código programático (ex: "VALIDATION_ERROR")
    - error.message: Mensagem legível para o usuário
    - error.details: Informações adicionais (opcional)
    
    Args:
        request: Request FastAPI
        exc: Exceção NeshError (ou subclasse)
        
    Returns:
        JSONResponse com status_code apropriado
    """
    status_code = getattr(exc, 'status_code', 500)
    
    # Log com nível apropriado baseado no status_code
    if status_code >= 500:
        logger.error(f"[{exc.code}] {exc.message} - Path: {request.url.path}")
    else:
        logger.warning(f"[{exc.code}] {exc.message} - Path: {request.url.path}")
    
    # Coletar detalhes extras se existirem
    details = {}
    for attr in ('field', 'query', 'resource', 'identifier', 'path', 'service', 'chapter_num'):
        if hasattr(exc, attr) and getattr(exc, attr) is not None:
            details[attr] = getattr(exc, attr)
    
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": details if details else None
            }
        }
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Handler de fallback para exceções não tratadas.
    
    Captura qualquer Exception não prevista e retorna uma resposta genérica
    sem vazar detalhes internos (stack traces, paths, etc.).
    
    Args:
        request: Request FastAPI
        exc: Qualquer exceção Python
        
    Returns:
        JSONResponse com status 500 e mensagem genérica
    """
    # Log completo para debugging (com traceback)
    logger.exception(f"Unhandled exception on {request.url.path}: {exc}")
    
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Erro interno do servidor. Tente novamente.",
                "details": None
            }
        }
    )
