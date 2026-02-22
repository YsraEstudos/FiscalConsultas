from backend.infrastructure.database import DatabaseAdapter
from backend.services.ai_service import AiService
from backend.services.nesh_service import NeshService
from backend.services.tipi_service import TipiService
from fastapi import Request


async def get_db(request: Request) -> DatabaseAdapter:
    """
    Dependency to get the DatabaseAdapter instance from app state.
    """
    return request.app.state.db


async def get_nesh_service(request: Request) -> NeshService:
    """
    Dependency to get the NeshService instance from app state.
    """
    return request.app.state.service


async def get_tipi_service(request: Request) -> TipiService:
    """
    Dependency to get the TipiService instance from app state.
    """
    return request.app.state.tipi_service


async def get_ai_service(request: Request) -> AiService:
    """
    Dependency to get the AiService instance from app state.
    """
    return request.app.state.ai_service
