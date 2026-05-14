from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from backend.config import CONFIG, setup_logging
from backend.config.exceptions import NeshError
from backend.config.settings import settings
from backend.data.glossary_manager import init_glossary
from backend.infrastructure import DatabaseAdapter
from backend.infrastructure.redis_client import redis_cache
from backend.server.app_lifecycle import (
    _collect_release_metadata as _collect_release_metadata_impl,
)
from backend.server.app_lifecycle import (
    _first_non_empty_env as _first_non_empty_env_impl,
)
from backend.server.app_lifecycle import (
    _init_cache_warmup as _init_cache_warmup_impl,
)
from backend.server.app_lifecycle import (
    _init_nbs_service as _init_nbs_service_impl,
)
from backend.server.app_lifecycle import (
    _init_nesh_service as _init_nesh_service_impl,
)
from backend.server.app_lifecycle import (
    _init_primary_database as _init_primary_database_impl,
)
from backend.server.app_lifecycle import (
    _run_alembic_migrations as _run_alembic_migrations_impl,
)
from backend.server.app_lifecycle import (
    _init_sqlmodel_engine as _init_sqlmodel_engine_impl,
)
from backend.server.app_lifecycle import (
    _init_tipi_service as _init_tipi_service_impl,
)
from backend.server.app_lifecycle import (
    _log_runtime_security_warnings as _log_runtime_security_warnings_impl,
)
from backend.server.app_lifecycle import (
    _postgres_tipi_has_data as _postgres_tipi_has_data_impl,
)
from backend.server.app_lifecycle import (
    _record_release_metadata as _record_release_metadata_impl,
)
from backend.server.app_lifecycle import (
    _resolve_project_root as _resolve_project_root_impl,
)
from backend.server.app_lifecycle import (
    _shutdown_resources as _shutdown_resources_impl,
)
from backend.server.app_lifecycle import (
    _validate_dev_tenant_override_safety as _validate_dev_tenant_override_safety_impl,
)
from backend.server.app_routes import _configure_routes
from backend.server.app_security import (
    _apply_security_headers as _apply_security_headers_impl,
)
from backend.server.app_security import (
    _build_content_security_policy as _build_content_security_policy_impl,
)
from backend.server.app_security import (
    _build_cors_configuration as _build_cors_configuration_impl,
)
from backend.server.app_security import (
    _request_uses_https as _request_uses_https_impl,
)
from backend.server.app_security import (
    _should_expose_api_docs as _should_expose_api_docs_impl,
)
from backend.server.error_handlers import (
    generic_exception_handler,
    nesh_exception_handler,
)
from backend.server.middleware import (
    TenantMiddleware,
    is_loopback_host,
    origin_looks_like_loopback,
)
from backend.services.ai_service import AiService
from backend.services.nbs_service import NbsService
from backend.services.tipi_service import TipiService
from backend.server.observability import configure_observability
from backend.utils.frontend_check import verify_frontend_build

setup_logging()
logger = logging.getLogger("server")


def _sync_lifecycle_dependencies() -> None:
    """Keeps the lifecycle module aligned with monkeypatched app-level symbols."""
    import backend.server.app_lifecycle as app_lifecycle

    app_lifecycle.CONFIG = CONFIG
    app_lifecycle.settings = settings
    app_lifecycle.DatabaseAdapter = DatabaseAdapter
    app_lifecycle.redis_cache = redis_cache
    app_lifecycle.init_glossary = init_glossary
    app_lifecycle.verify_frontend_build = verify_frontend_build
    app_lifecycle.AiService = AiService
    app_lifecycle.NbsService = NbsService
    app_lifecycle.TipiService = TipiService
    app_lifecycle.configure_observability = configure_observability
    app_lifecycle.is_loopback_host = is_loopback_host
    app_lifecycle.origin_looks_like_loopback = origin_looks_like_loopback
    app_lifecycle.logger = logger


def _sync_lifecycle_call[**P, R](callback: Callable[P, R]) -> Callable[P, R]:
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        _sync_lifecycle_dependencies()
        return callback(*args, **kwargs)

    return wrapped


def _sync_lifecycle_async_call[**P, R](
    callback: Callable[P, Awaitable[R]],
) -> Callable[P, Awaitable[R]]:
    async def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        _sync_lifecycle_dependencies()
        return await callback(*args, **kwargs)

    return wrapped


def _resolve_project_root() -> str:
    return _sync_lifecycle_call(_resolve_project_root_impl)(__file__)


def _first_non_empty_env(*names: str) -> str | None:
    return _first_non_empty_env_impl(*names)


_collect_release_metadata = _sync_lifecycle_call(_collect_release_metadata_impl)
_record_release_metadata = _sync_lifecycle_call(_record_release_metadata_impl)


def _build_content_security_policy() -> str:
    return _build_content_security_policy_impl(settings.server.env)


def _should_expose_api_docs() -> bool:
    return _should_expose_api_docs_impl(
        settings.server.env,
        settings.features.debug_mode,
    )


def _request_uses_https(request: Request) -> bool:
    return _request_uses_https_impl(request)


def _apply_security_headers(request: Request, response: Response) -> None:
    _apply_security_headers_impl(request, response, settings.server.env)


def _build_cors_configuration() -> tuple[list[str], str | None]:
    return _build_cors_configuration_impl(
        settings.server.env,
        settings.server.cors_allowed_origins,
        settings.server.cors_allowed_origin_regex,
    )


_run_alembic_migrations = _sync_lifecycle_async_call(_run_alembic_migrations_impl)
_init_primary_database = _sync_lifecycle_async_call(_init_primary_database_impl)
_init_sqlmodel_engine = _sync_lifecycle_async_call(_init_sqlmodel_engine_impl)
_init_nesh_service = _sync_lifecycle_async_call(_init_nesh_service_impl)
_init_cache_warmup = _sync_lifecycle_async_call(_init_cache_warmup_impl)
_postgres_tipi_has_data = _sync_lifecycle_async_call(_postgres_tipi_has_data_impl)
_init_tipi_service = _sync_lifecycle_async_call(_init_tipi_service_impl)
_init_nbs_service = _sync_lifecycle_async_call(_init_nbs_service_impl)
_shutdown_resources = _sync_lifecycle_async_call(_shutdown_resources_impl)
_log_runtime_security_warnings = _sync_lifecycle_call(
    _log_runtime_security_warnings_impl
)
_validate_dev_tenant_override_safety = _sync_lifecycle_call(
    _validate_dev_tenant_override_safety_impl
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializa e encerra recursos da aplicação de forma controlada."""
    project_root = _resolve_project_root()
    try:
        _record_release_metadata(app)
        _log_runtime_security_warnings()
        _validate_dev_tenant_override_safety()
        await _run_alembic_migrations(project_root)
        await _init_sqlmodel_engine(app)
        app.state.ai_service = AiService()

        logger.info("Initializing Glossary...")
        init_glossary(project_root)
        verify_frontend_build(project_root)
        yield
    finally:
        await _shutdown_resources(app)


app = FastAPI(title="Nesh API", version="4.2", lifespan=lifespan)

app.add_exception_handler(NeshError, cast(Any, nesh_exception_handler))
app.add_exception_handler(Exception, cast(Any, generic_exception_handler))

app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)
app.add_middleware(TenantMiddleware)

_cors_allowed_origins, _cors_allow_origin_regex = _build_cors_configuration()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allowed_origins,
    allow_origin_regex=_cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "X-Admin-Token",
        "X-Tenant-Id",
        "Accept-Encoding",
        "Asaas-Access-Token",
        "X-Asaas-Access-Token",
    ],
    expose_headers=["X-Request-Id"],
)


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    """Aplica headers de segurança e evita cache em páginas HTML e docs."""
    path = request.url.path
    if path in {"/docs", "/redoc", "/openapi.json"} and not _should_expose_api_docs():
        response = JSONResponse(status_code=404, content={"detail": "Not Found"})
        _apply_security_headers(request, response)
        return response

    response = await call_next(request)
    _apply_security_headers(request, response)
    if path == "/" or path.endswith(".html"):
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
    return response


_configure_routes(app, _resolve_project_root(), logger)
