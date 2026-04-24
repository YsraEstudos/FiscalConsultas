from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncContextManager, AsyncIterator, Callable

from .types import NbsRepositoryProtocol, NbsServiceState


def build_nbs_repository_factory() -> Callable[
    [], AsyncContextManager[NbsRepositoryProtocol]
]:
    try:
        from backend.infrastructure.db_engine import get_session
        from backend.infrastructure.repositories.nbs_repository import NbsRepository
    except ImportError as exc:
        raise RuntimeError("Repository não disponível. Instale sqlmodel.") from exc

    @asynccontextmanager
    async def repo_factory() -> AsyncIterator[NbsRepositoryProtocol]:
        async with get_session() as session:
            yield NbsRepository(session)

    return repo_factory


@asynccontextmanager
async def acquire_nbs_repository(
    service: NbsServiceState,
) -> AsyncIterator[NbsRepositoryProtocol | None]:
    if service._repository is not None:
        yield service._repository
        return
    if service._repository_factory is not None:
        async with service._repository_factory() as repo:
            yield repo
        return
    yield None
