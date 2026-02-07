"""
Database Engine Factory e Session Management com SQLModel + Async.

Este módulo fornece:
- Engine singleton com suporte dual SQLite/PostgreSQL
- AsyncSession factory para injeção de dependência
- Context managers para uso em services e routes
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlmodel import SQLModel

from ..config.settings import settings


# ContextVar para rastrear o tenant_id na requisição atual
tenant_context: ContextVar[str] = ContextVar("tenant_context", default="")


def _create_engine():
    """
    Cria engine assíncrono baseado na configuração.
    
    SQLite: Usa aiosqlite com pool básico
    PostgreSQL: Usa asyncpg com pool otimizado
    """
    db_url = settings.database.async_url
    
    if settings.database.is_postgres:
        return create_async_engine(
            db_url,
            echo=settings.features.debug_mode,
            pool_pre_ping=False,  # Desabilitado: usa TCP keepalive ao invés de SELECT 1 por checkout
            pool_size=10,  # Aumentado de 5 para suportar mais concorrência
            max_overflow=20,  # Aumentado de 10
            pool_recycle=3600,  # Recicla conexões a cada 1h
            pool_timeout=30,  # Timeout de 30s para obter conexão do pool
        )
    else:
        # SQLite - pool limitado
        return create_async_engine(
            db_url,
            echo=settings.features.debug_mode,
            connect_args={"check_same_thread": False},
        )


# Engine singleton (lazy init via função para evitar problemas de import)
_engine = None


def get_engine():
    """Retorna engine singleton, criando se necessário."""
    global _engine
    if _engine is None:
        _engine = _create_engine()
    return _engine


# Session factory
def get_session_maker():
    """Retorna async session maker configurado."""
    return async_sessionmaker(
        get_engine(),
        class_=AsyncSession,
        expire_on_commit=False,  # Evita lazy loading issues após commit
    )


async def init_db():
    """
    Cria tabelas se não existirem (útil para dev/SQLite).
    Em produção PostgreSQL, usar Alembic migrations.
    """
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def close_db():
    """Fecha conexões do pool graciosamente."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager para sessão do banco.
    
    Uso:
        async with get_session() as session:
            result = await session.execute(...)
    """
    session_maker = get_session_maker()
    async with session_maker() as session:
        # Se estivermos em Postgres, injetamos o tenant_id na sessão para o RLS
        tid = tenant_context.get()
        if settings.database.is_postgres and tid:
            # check_function_bodies=off evita overhead de validação em cada set
            await session.execute(
                text("SELECT set_config('app.current_tenant', :tid, true)"),
                {"tid": tid}
            )
            
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI Depends para injeção de sessão.
    
    Uso em routes:
        @router.get("/items")
        async def get_items(session: AsyncSession = Depends(get_db)):
            ...
    """
    async with get_session() as session:
        yield session
