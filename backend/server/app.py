from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import logging

from backend.config import CONFIG, setup_logging
from backend.config.settings import settings
from backend.config.exceptions import NeshError
from backend.infrastructure import DatabaseAdapter
from backend.services import NeshService
from backend.services.ai_service import AiService
from backend.services.tipi_service import TipiService
from backend.server.error_handlers import nesh_exception_handler, generic_exception_handler
from backend.infrastructure.redis_client import redis_cache

from backend.data.glossary_manager import init_glossary
from backend.utils.frontend_check import verify_frontend_build

# Import New Routers
from backend.presentation.routes import auth, search, system, tipi, webhooks
from backend.server.middleware import TenantMiddleware

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    logger.info("Initializing Database...")
    if settings.database.is_postgres:
        app.state.db = None
    else:
        app.state.db = DatabaseAdapter(CONFIG.db_path)
        # Ensure pool is created (optional, but good for check)
        await app.state.db._ensure_pool()
    
    # SQLModel engine init
    try:
        from backend.infrastructure.db_engine import init_db
        if settings.database.is_postgres:
            # Em Postgres, o schema deve ser gerenciado apenas por Alembic
            app.state.sqlmodel_enabled = True
            logger.info("SQLModel engine ready (Postgres migrations via Alembic)")
        else:
            try:
                await init_db()
                app.state.sqlmodel_enabled = True
                logger.info("SQLModel engine initialized (SQLite)")
            except Exception as e:
                # Alguns ambientes SQLite não suportam tipos específicos (ex: TSVECTOR).
                # Nesses casos, seguimos com o adaptador legado sem interromper startup.
                app.state.sqlmodel_enabled = False
                logger.warning("SQLModel init skipped (SQLite incompatibility): %s", e)
    except ImportError:
        app.state.sqlmodel_enabled = False
        logger.debug("SQLModel not available, using legacy DatabaseAdapter")
    
    logger.info("Initializing Services...")
    from backend.services.nesh_service import NeshService
    from backend.services.tipi_service import TipiService
    from backend.services.ai_service import AiService
    
    if settings.database.is_postgres:
        # Criamos o serviço no modo Repository para suporte a RLS
        app.state.service = await NeshService.create_with_repository()
        logger.info("NeshService initialized in Repository mode (Postgres/RLS)")
    else:
        app.state.service = NeshService(app.state.db)
        logger.info("NeshService initialized in Legacy mode (SQLite)")

    if settings.cache.enable_redis:
        await redis_cache.connect()
        if redis_cache.available:
            try:
                warmed = await app.state.service.prewarm_cache()
                logger.info("Chapter cache prewarmed: %s capítulos", warmed)
            except Exception as e:
                logger.warning("Cache prewarm failed: %s", e)

    if settings.database.is_postgres:
        # Verificar se tipi_positions tem dados no PostgreSQL
        # Se não tiver, usar fallback para SQLite (tipi.db) que é mais rápido
        tipi_has_data = False
        try:
            from backend.infrastructure.db_engine import get_session
            from sqlalchemy import text
            async with get_session() as session:
                result = await session.execute(text("SELECT COUNT(*) FROM tipi_positions"))
                count = result.scalar()
                tipi_has_data = count > 0
                logger.info(f"TIPI PostgreSQL: {count} positions found")
        except Exception as e:
            logger.warning(f"Could not check tipi_positions table: {e}")

        if tipi_has_data:
            app.state.tipi_service = await TipiService.create_with_repository()
            logger.info("TipiService initialized in Repository mode (Postgres)")
        else:
            app.state.tipi_service = TipiService()
            logger.info("TipiService initialized in SQLite mode (tipi.db - TIPI data not in Postgres yet)")
    else:
        app.state.tipi_service = TipiService()
        logger.info("TipiService initialized in Legacy mode (SQLite)")
    app.state.ai_service = AiService()
    
    logger.info("Initializing Glossary...")
    init_glossary(project_root)

    # Check Frontend Build
    verify_frontend_build(project_root)
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    if hasattr(app.state, "db") and app.state.db:
        await app.state.db.close()

    await redis_cache.close()
    
    # Close SQLModel engine if initialized
    if getattr(app.state, "sqlmodel_enabled", False):
        try:
            from backend.infrastructure.db_engine import close_db
            await close_db()
            logger.info("SQLModel engine closed")
        except Exception as e:
            logger.warning(f"Error closing SQLModel engine: {e}")

app = FastAPI(
    title="Nesh API",
    version="4.2",
    lifespan=lifespan
)

# --- Global Exception Handlers ---
app.add_exception_handler(NeshError, nesh_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

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

# Dev convenience: allow local-network Vite hosts on :5173 without opening broad CORS in production.
cors_allow_origin_regex = None
if settings.server.env == "development":
    cors_allow_origin_regex = r"^https?://(?:localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::5173)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response

# --- Routers ---
# Prefixing to keep existing contract
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(search.router, prefix="/api", tags=["Search"])
app.include_router(tipi.router, prefix="/api/tipi", tags=["TIPI"]) # Note: routes inside are /search, /chapters etc
app.include_router(system.router, prefix="/api", tags=["System"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["Webhooks"])


# --- Static Files / Frontend ---
# Serving Frontend (Production Build)
# Mounts the Vite build directory to serve the React App
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
static_dir = os.path.join(project_root, "client", "dist")

if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
else:
    logger.warning(f"Frontend build not found at {static_dir}. Serving defaults.")
    @app.get("/")
    async def read_root():
        return {"message": "Nesh API running. Frontend not found. Run 'npm run build' in client/ folder."}
