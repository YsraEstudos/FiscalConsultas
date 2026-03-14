import logging
import os
from contextlib import asynccontextmanager
from typing import Any, cast

from backend.config import CONFIG, setup_logging
from backend.config.exceptions import NeshError
from backend.config.settings import settings
from backend.data.glossary_manager import init_glossary
from backend.infrastructure import DatabaseAdapter
from backend.infrastructure.redis_client import redis_cache

# Import New Routers
from backend.presentation.routes import (
    auth,
    comments,
    profile,
    search,
    services,
    system,
    tipi,
    webhooks,
)
from backend.server.error_handlers import (
    generic_exception_handler,
    nesh_exception_handler,
)
from backend.server.middleware import TenantMiddleware, is_loopback_host
from backend.services.ai_service import AiService
from backend.services.nbs_service import NbsService
from backend.services.tipi_service import TipiService
from backend.utils.frontend_check import verify_frontend_build
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

"""
Módulo do Servidor (API Handler).

Define a aplicação FastAPI, rotas da API e ciclo de vida do servidor.
Responsável por:
1. Inicializar recursos globais (DB, Services) no startup.
2. Definir endpoints REST para busca NCM e TIPI (via Routers).
3. Servir o frontend React compilado (arquivos estáticos).
4. Gerenciar tratamento de erros e respostas JSON.
"""

# Logger setup
setup_logging()
logger = logging.getLogger("server")

_DOCS_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})
_CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        (
            "script-src 'self' https://*.clerk.accounts.dev "
            "https://*.clerk.com https://challenges.cloudflare.com"
        ),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "font-src 'self' https://fonts.gstatic.com data:",
        (
            "connect-src 'self' https: wss: http://127.0.0.1:8000 "
            "http://localhost:8000 ws://127.0.0.1:* ws://localhost:*"
        ),
        "frame-src 'self' https:",
    )
)


def _resolve_project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _validate_dev_tenant_override_safety() -> None:
    if settings.server.env != "development" or not settings.features.debug_mode:
        return

    if is_loopback_host(settings.server.host):
        return

    raise RuntimeError(
        "Debug tenant overrides require a localhost-only host binding. "
        f"Received SERVER__HOST={settings.server.host!r}."
    )


def _should_expose_api_docs() -> bool:
    return settings.server.env == "development" and settings.features.debug_mode


def _request_uses_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        proto = forwarded_proto.split(",", 1)[0].strip().lower()
        if proto == "https":
            return True
    return request.url.scheme.lower() == "https"


def _apply_security_headers(request: Request, response) -> None:
    response.headers["Content-Security-Policy"] = _CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if _request_uses_https(request):
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )


async def _init_primary_database(app: FastAPI) -> None:
    logger.info("Initializing Database...")
    if settings.database.is_postgres:
        # Postgres path usa SQLAlchemy/Repository; o adapter legado não é necessário.
        app.state.db = None
        return

    app.state.db = DatabaseAdapter(CONFIG.db_path)
    # Cria pool cedo para falhar rápido em startup caso o arquivo/caminho esteja inválido.
    await app.state.db._ensure_pool()


async def _init_sqlmodel_engine(app: FastAPI) -> None:
    if settings.database.is_postgres:
        # Em Postgres, migrations são responsabilidade do Alembic.
        app.state.sqlmodel_enabled = True
        logger.info("SQLModel engine ready (Postgres migrations via Alembic)")
        return

    # SQLModel é opcional no modo legado; tratamos fallback para não bloquear startup em SQLite.
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
    except Exception as e:
        app.state.sqlmodel_enabled = False
        logger.warning("SQLModel init skipped (SQLite incompatibility): %s", e)


async def _init_nesh_service(app: FastAPI) -> None:
    logger.info("Initializing Services...")
    from backend.services.nesh_service import NeshService

    if settings.database.is_postgres:
        # Repository mode suporta RLS e isolamento por tenant no Postgres.
        app.state.service = await NeshService.create_with_repository()
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
    except Exception as e:
        logger.warning("Redis connect failed during startup: %s", e)
        return

    if not redis_cache.available:
        return

    try:
        warmed = await app.state.service.prewarm_cache()
        logger.info("Chapter cache prewarmed: %s capítulos", warmed)
    except Exception as e:
        # Prewarm é otimização: não deve derrubar startup.
        logger.warning("Cache prewarm failed: %s", e)


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
    except Exception as e:
        logger.warning("Could not check tipi_positions table: %s", e)
        return False


async def _init_tipi_service(app: FastAPI) -> None:
    if not settings.database.is_postgres:
        app.state.tipi_service = TipiService()
        logger.info("TipiService initialized in Legacy mode (SQLite)")
        return

    if await _postgres_tipi_has_data():
        app.state.tipi_service = await TipiService.create_with_repository()
        logger.info("TipiService initialized in Repository mode (Postgres)")
        return

    # Fallback temporário: enquanto a carga TIPI no Postgres não estiver completa.
    app.state.tipi_service = TipiService()
    logger.info(
        "TipiService initialized in SQLite mode "
        "(tipi.db - TIPI data not in Postgres yet)"
    )


def _init_nbs_service(app: FastAPI) -> None:
    app.state.nbs_service = NbsService()
    logger.info("NbsService initialized in SQLite mode (services.db)")


async def _shutdown_resources(app: FastAPI) -> None:
    logger.info("Shutting down...")

    if hasattr(app.state, "db") and app.state.db:
        try:
            await app.state.db.close()
        except Exception as e:
            logger.warning("Error closing DatabaseAdapter: %s", e)

    try:
        await redis_cache.close()
    except Exception as e:
        logger.warning("Error closing Redis cache: %s", e)

    if hasattr(app.state, "nbs_service") and app.state.nbs_service:
        try:
            await app.state.nbs_service.close()
        except Exception as e:
            logger.warning("Error closing NbsService: %s", e)

    if not getattr(app.state, "sqlmodel_enabled", False):
        return

    try:
        from backend.infrastructure.db_engine import close_db

        await close_db()
        logger.info("SQLModel engine closed")
    except Exception as e:
        logger.warning("Error closing SQLModel engine: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    project_root = _resolve_project_root()
    try:
        _validate_dev_tenant_override_safety()
        await _init_primary_database(app)
        await _init_sqlmodel_engine(app)
        await _init_nesh_service(app)
        await _init_cache_warmup(app)
        await _init_tipi_service(app)
        _init_nbs_service(app)
        app.state.ai_service = AiService()

        logger.info("Initializing Glossary...")
        init_glossary(project_root)

        # Check Frontend Build
        verify_frontend_build(project_root)

        yield
    finally:
        await _shutdown_resources(app)


app = FastAPI(title="Nesh API", version="4.2", lifespan=lifespan)

# --- Global Exception Handlers ---
app.add_exception_handler(NeshError, cast(Any, nesh_exception_handler))
app.add_exception_handler(Exception, cast(Any, generic_exception_handler))

# --- Middleware ---
# GZip (Architecture Improvement)
# compresslevel=1 →  ~5x faster than level 6 with only ~10% larger output.
# Critical: chapter responses are ~860KB; level 6 costs ~72ms, level 1 costs ~12ms.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)

# Multi-tenant context middleware
app.add_middleware(TenantMiddleware)

# CORS Setup
# Must be added after other middlewares so it wraps all responses,
# including auth/tenant errors returned before route handlers.
cors_origins = settings.server.cors_allowed_origins or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Dev convenience: allow local-network Vite hosts on :5173
# without opening broad CORS in production.
cors_allow_origin_regex = None
if settings.server.env == "development":
    cors_allow_origin_regex = (
        r"^https?://(?:localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::5173)?$"
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Admin-Token",
        "X-Tenant-Id",
        "Accept-Encoding",
        "Asaas-Access-Token",
        "X-Asaas-Access-Token",
    ],
)


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    path = request.url.path
    if path in _DOCS_PATHS and not _should_expose_api_docs():
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


# --- Routers ---
# Prefixing to keep existing contract
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(search.router, prefix="/api", tags=["Search"])
app.include_router(
    tipi.router, prefix="/api/tipi", tags=["TIPI"]
)  # Note: routes inside are /search, /chapters etc
app.include_router(services.router, prefix="/api/services", tags=["Services"])
app.include_router(system.router, prefix="/api", tags=["System"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["Webhooks"])
app.include_router(comments.router, prefix="/api", tags=["Comments"])
app.include_router(profile.router, prefix="/api", tags=["Profile"])


# --- Static Files / Frontend ---
# Serving Frontend (Production Build)
# Mounts the Vite build directory to serve the React App
project_root = _resolve_project_root()
static_dir = os.path.join(project_root, "client", "dist")

if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
else:
    logger.warning(f"Frontend build not found at {static_dir}. Serving defaults.")

    @app.get("/")
    async def read_root():
        return {
            "message": (
                "Nesh API running. Frontend not found. "
                "Run 'npm run build' in client/ folder."
            )
        }
