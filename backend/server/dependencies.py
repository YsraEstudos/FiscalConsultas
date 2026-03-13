from fastapi import Request

from backend.infrastructure.database import DatabaseAdapter
from backend.services.ai_service import AiService
from backend.services.nbs_service import NbsService
from backend.services.nesh_service import NeshService
from backend.services.tipi_service import TipiService


def get_db(request: Request) -> DatabaseAdapter:
    """
    Dependency to get the DatabaseAdapter instance from app state.
    """
    return request.app.state.db


def get_nesh_service(request: Request) -> NeshService:
    """
    Dependency to get the NeshService instance from app state.
    """
    return request.app.state.service


def get_tipi_service(request: Request) -> TipiService:
    """
    Dependency to get the TipiService instance from app state.
    """
    return request.app.state.tipi_service


def get_nbs_service(request: Request) -> NbsService:
    """
    Dependency to get the NbsService instance from app state.
    """
    return request.app.state.nbs_service


def get_ai_service(request: Request) -> AiService:
    """
    Dependency to get the AiService instance from app state.
    """
    return request.app.state.ai_service
