from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI

from backend.config import CONFIG
from backend.config.settings import settings
from backend.data.glossary_manager import init_glossary
from backend.infrastructure import DatabaseAdapter
from backend.infrastructure.redis_client import redis_cache
from backend.server.middleware import is_loopback_host, origin_looks_like_loopback
from backend.server.observability import configure_observability
from backend.services.ai_service import AiService
from backend.services.nbs_service import NbsService
from backend.services.tipi_service import TipiService
from backend.utils.frontend_check import verify_frontend_build

logger = logging.getLogger("nesh.server")


def _resolve_project_root(current_file: str) -> str:
    return os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(current_file)))
    )


def _first_non_empty_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return None


def _collect_release_metadata(app: FastAPI) -> dict[str, str]:
    metadata: dict[str, str] = {
        "app_version": getattr(app, "version", "unknown"),
        "server_env": settings.server.env,
    }

    direct_env_map = {
        "render_service_id": "RENDER_SERVICE_ID",
        "render_service_name": "RENDER_SERVICE_NAME",
        "render_instance_id": "RENDER_INSTANCE_ID",
        "render_external_url": "RENDER_EXTERNAL_URL",
        "render_region": "RENDER_REGION",
    }
    for field, env_name in direct_env_map.items():
        value = os.getenv(env_name, "").strip()
        if value:
            metadata[field] = value

    git_commit = _first_non_empty_env(
        "RENDER_GIT_COMMIT",
        "SOURCE_VERSION",
        "GIT_COMMIT",
        "COMMIT_SHA",
    )
    if git_commit:
        metadata["git_commit"] = git_commit

    git_branch = _first_non_empty_env("RENDER_GIT_BRANCH", "GIT_BRANCH", "BRANCH")
    if git_branch:
        metadata["git_branch"] = git_branch

    deploy_id = _first_non_empty_env(
        "RENDER_DEPLOY_ID",
        "RENDER_BUILD_ID",
        "DEPLOY_ID",
    )
    if deploy_id:
        metadata["deploy_id"] = deploy_id

    return metadata


def _record_release_metadata(app: FastAPI) -> None:
    metadata = _collect_release_metadata(app)
    app.state.release_metadata = metadata
    logger.info(
        "Runtime release metadata: %s",
        json.dumps(metadata, ensure_ascii=False, sort_keys=True),
    )
    configure_observability(
        release=metadata.get("git_commit") or metadata.get("app_version"),
        server_name=metadata.get("render_service_name")
        or metadata.get("render_service_id"),
    )


def _log_runtime_security_warnings() -> None:
    if settings.server.env != "production":
        return

    warnings: list[str] = []
    if settings.features.debug_mode:
        warnings.append("SERVER__ENV=production com FEATURES__DEBUG_MODE=true.")

    if not settings.server.cors_allowed_origins:
        warnings.append(
            "SERVER__CORS_ALLOWED_ORIGINS vazio em produção; configure apenas domínios oficiais."
        )
    elif any(origin.strip() == "*" for origin in settings.server.cors_allowed_origins):
        warnings.append(
            'SERVER__CORS_ALLOWED_ORIGINS="*" é inseguro em produção; configure apenas origens explícitas.'
        )
    elif any(
        origin_looks_like_loopback(origin)
        for origin in settings.server.cors_allowed_origins
    ):
        warnings.append(
            "SERVER__CORS_ALLOWED_ORIGINS em produção ainda inclui origem localhost/loopback."
        )

    redis_hostname = urlparse(settings.cache.redis_url).hostname
    if settings.cache.enable_redis and is_loopback_host(redis_hostname):
        warnings.append(
            "CACHE__ENABLE_REDIS=true em produção com CACHE__REDIS_URL apontando para localhost."
        )

    if not settings.database.is_postgres:
        warnings.append(
            "DATABASE__ENGINE não está em postgresql no ambiente de produção."
        )

    for warning in warnings:
        logger.warning("Runtime security warning: %s", warning)


def _validate_dev_tenant_override_safety() -> None:
    if settings.server.env != "development" or not settings.features.debug_mode:
        return

    if is_loopback_host(settings.server.host):
        return

    raise RuntimeError(
        "Debug tenant overrides require a localhost-only host binding. "
        f"Received SERVER__HOST={settings.server.host!r}."
    )


async def _init_primary_database(app: FastAPI) -> None:
    logger.info("Initializing Database...")
    if settings.database.is_postgres:
        app.state.db = None
        return

    app.state.db = DatabaseAdapter(CONFIG.db_path)
    await app.state.db._ensure_pool()


async def _init_sqlmodel_engine(app: FastAPI) -> None:
    if settings.database.is_postgres:
        app.state.sqlmodel_enabled = True
        logger.info("SQLModel engine ready (Postgres migrations via Alembic)")
        return

    try:
        from backend.infrastructure.db_engine import init_db
    except ImportError:
        app.state.sqlmodel_enabled = False
        logger.debug("SQLModel not available, using legacy DatabaseAdapter")
        return

    try:
        await init_db()
        app.state.sqlmodel_enabled = True
        logger.info("SQLModel engine initialized (SQLite)")
    except Exception as exc:
        app.state.sqlmodel_enabled = False
        logger.warning("SQLModel init skipped (SQLite incompatibility): %s", exc)


async def _init_nesh_service(app: FastAPI) -> None:
    logger.info("Initializing Services...")
    from backend.services.nesh_service import NeshService

    if settings.database.is_postgres:
        app.state.service = (
            await NeshService.initializeNeshServiceWithRepositoryFactory()
        )
        logger.info("NeshService initialized in Repository mode (Postgres/RLS)")
        return

    if app.state.db is None:
        raise RuntimeError("DatabaseAdapter não inicializado para modo SQLite")
    app.state.service = NeshService(app.state.db)
    logger.info("NeshService initialized in Legacy mode (SQLite)")


async def _init_cache_warmup(app: FastAPI) -> None:
    if not settings.cache.enable_redis:
        return

    try:
        await redis_cache.connect()
    except Exception as exc:
        logger.warning("Redis connect failed during startup: %s", exc)
        return

    if not redis_cache.available:
        return

    try:
        warmed = await app.state.service.prewarmNeshChapterCache()
        logger.info("Chapter cache prewarmed: %s capítulos", warmed)
    except Exception as exc:
        logger.warning("Cache prewarm failed: %s", exc)


async def _postgres_tipi_has_data() -> bool:
    try:
        from backend.infrastructure.db_engine import get_session
        from sqlalchemy import text

        async with get_session() as session:
            result = await session.execute(
                text("SELECT EXISTS(SELECT 1 FROM tipi_positions)")
            )
            has_data = bool(result.scalar())
        logger.info("TIPI PostgreSQL data available: %s", has_data)
        return has_data
    except Exception as exc:
        logger.warning("Could not check tipi_positions table: %s", exc)
        return False


async def _init_tipi_service(app: FastAPI) -> None:
    if not settings.database.is_postgres:
        app.state.tipi_service = TipiService()
        logger.info("TipiService initialized in Legacy mode (SQLite)")
        return

    if await _postgres_tipi_has_data():
        app.state.tipi_service = (
            TipiService.initializeTipiServiceWithRepositoryFactory()
        )
        logger.info("TipiService initialized in Repository mode (Postgres)")
        return

    app.state.tipi_service = TipiService()
    logger.info(
        "TipiService initialized in SQLite mode "
        "(tipi.db - TIPI data not in Postgres yet)"
    )


async def _init_nbs_service(app: FastAPI) -> None:
    if settings.database.is_postgres:
        try:
            nbs_service = (
                await NbsService.initializeNbsServiceWithPostgresRepository()
            )
            catalog_health = await nbs_service.probeNbsCatalogHealth()
            if (
                catalog_health.get("status") == "online"
                and int(catalog_health.get("nbs_items", 0)) > 0
            ):
                app.state.nbs_service = nbs_service
                logger.info("NbsService initialized in Repository mode (Postgres)")
                return
            logger.warning(
                "NBS Postgres catalog healthcheck failed, falling back to SQLite "
                "mode: %s",
                catalog_health,
            )
        except Exception as exc:
            logger.warning(
                "NbsService repository init failed, falling back to SQLite mode: %s",
                exc,
            )
    app.state.nbs_service = NbsService()
    logger.info("NbsService initialized in SQLite mode (services.db)")


async def _close_app_state_resource(
    app: FastAPI, attr_name: str, method_name: str, label: str
) -> None:
    resource = getattr(app.state, attr_name, None)
    if resource is None:
        return

    close_method = getattr(resource, method_name, None)
    if not callable(close_method):
        return

    try:
        await close_method()
    except Exception as exc:
        logger.warning("Error closing %s: %s", label, exc)


async def _close_redis_cache() -> None:
    try:
        await redis_cache.close()
    except Exception as exc:
        logger.warning("Error closing Redis cache: %s", exc)


async def _close_sqlmodel_engine() -> None:
    try:
        from backend.infrastructure.db_engine import close_db

        await close_db()
        logger.info("SQLModel engine closed")
    except Exception as exc:
        logger.warning("Error closing SQLModel engine: %s", exc)


async def _shutdown_resources(app: FastAPI) -> None:
    logger.info("Shutting down...")
    await _close_app_state_resource(app, "db", "close", "DatabaseAdapter")
    await _close_redis_cache()
    await _close_app_state_resource(app, "tipi_service", "close", "TipiService")
    await _close_app_state_resource(
        app,
        "nbs_service",
        "shutdownNbsServiceResources",
        "NbsService",
    )
    await _close_sqlmodel_engine()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    project_root = _resolve_project_root(__file__)
    try:
        _record_release_metadata(app)
        _log_runtime_security_warnings()
        _validate_dev_tenant_override_safety()
        await _init_primary_database(app)
        await _init_sqlmodel_engine(app)
        await _init_nesh_service(app)
        await _init_cache_warmup(app)
        await _init_tipi_service(app)
        await _init_nbs_service(app)
        app.state.ai_service = AiService()

        logger.info("Initializing Glossary...")
        init_glossary(project_root)
        verify_frontend_build(project_root)

        yield
    finally:
        await _shutdown_resources(app)
