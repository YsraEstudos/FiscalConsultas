from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import logging

from backend.config import CONFIG, setup_logging
from backend.config.constants import SearchConfig, ViewMode
from backend.config.exceptions import NeshError, ValidationError
from backend.infrastructure import DatabaseAdapter
from backend.services import NeshService
from backend.services.ai_service import AiService
from backend.services.tipi_service import TipiService
from backend.server.error_handlers import nesh_exception_handler, generic_exception_handler

from backend.data.glossary_manager import init_glossary, glossary_manager
from backend.presentation import HtmlRenderer
from backend.presentation.tipi_renderer import TipiRenderer

"""
Módulo do Servidor (API Handler).

Define a aplicação FastAPI, rotas da API e ciclo de vida do servidor.
Responsável por:
1. Inicializar recursos globais (DB, Services) no startup.
2. Definir endpoints REST para busca NCM e TIPI.
3. Servir o frontend React compilado (arquivos estáticos).
4. Gerenciar tratamento de erros e respostas JSON.
"""

# Logger setup
setup_logging()
logger = logging.getLogger("server")

# Global state for services
class AppState:
    db: DatabaseAdapter = None
    service: NeshService = None
    tipi_service: TipiService = None
    ai_service: AiService = None

state = AppState()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    logger.info("Initializing Database...")
    state.db = DatabaseAdapter(CONFIG.db_path)
    # Ensure pool is created (optional, but good for check)
    await state.db._ensure_pool()
    
    logger.info("Initializing Services...")
    state.service = NeshService(state.db)
    state.tipi_service = TipiService()
    state.ai_service = AiService()
    
    logger.info("Initializing Glossary...")
    init_glossary(project_root)
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    if state.db:
        await state.db.close()

app = FastAPI(
    title="Nesh API",
    version="4.2",
    lifespan=lifespan
)

# --- Global Exception Handlers ---
app.add_exception_handler(NeshError, nesh_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

from pydantic import BaseModel
from backend.config.constants import ServerConfig

# --- Models ---
class LoginRequest(BaseModel):
    password: str

@app.post("/api/login")
async def login(request: LoginRequest):
    """
    Simples endpoint de login de admin.
    
    Verifica se a senha corresponde à configurada no servidor.
    Retorna access_token simples (flag) se sucesso.
    """
    if request.password == ServerConfig.ADMIN_PASSWORD:
        return {"success": True, "token": "admin_token_valid", "message": "Login realizado com sucesso"}
    else:
        raise HTTPException(status_code=401, detail="Senha incorreta")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for dev, tighten for prod
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

# --- Routes ---

class ChatRequest(BaseModel):
    message: str
    token: str

@app.post("/api/ai/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Endpoint de Chat com IA.
    Protegido por token simples.
    """
    if request.token != "admin_token_valid":
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    response_text = await state.ai_service.get_chat_response(request.message)
    return {"success": True, "reply": response_text}

@app.get("/api/search")
async def search(ncm: str = Query(..., description="Código NCM ou termo textual para busca")):
    """
    Busca Principal (NCM/NESH).
    
    Realiza busca híbrida:
    - Se a query for numérica (ex: "8517"): Busca hierárquica por código.
    - Se for texto (ex: "sem fio"): Busca Full-Text Search (FTS) com ranking.
    
    Returns:
        JSON com resultados da busca, metadados e estrutura para renderização.
        
    Raises:
        ValidationError: Se a query estiver vazia ou for muito longa.
    """
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")
    
    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm"
        )
    
    logger.info(f"Busca: '{ncm}'")
    
    # Service Layer (ASYNC) - Exceções propagam para o handler global
    response_data = await state.service.process_request(ncm)
    
    # Presentation Layer (Legacy Compatibility - keeping markdown for now)
    if response_data.get('type') == 'code':
        response_data['markdown'] = HtmlRenderer.render_full_response(response_data['results'])
        response_data['resultados'] = response_data['results']
        
    return response_data

@app.get("/api/chapters")
async def get_chapters():
    """
    Lista todos os capítulos do sistema Harmonizado (NESH).
    
    Returns:
        JSON contendo lista de capítulos disponíveis no banco de dados.
    """
    chapters = await state.db.get_all_chapters_list()
    return {"success": True, "capitulos": chapters}

@app.get("/api/tipi/search")
async def tipi_search(
    ncm: str = Query(..., description="Código NCM ou termo para busca na TIPI"),
    view_mode: ViewMode = Query(ViewMode.FAMILY, description="Modo de visualização: 'chapter' (completo) ou 'family' (apenas família NCM)")
):
    """
    Busca na Tabela TIPI (IPI).
    
    Endpoint dedicado para consulta de alíquotas de IPI.
    Suporta busca por código NCM (com destaque de alíquota) e busca textual.
    
    Parâmetros:
        - ncm: Código NCM ou termo de busca
        - view_mode: 'family' (padrão) retorna apenas sub-itens do NCM buscado;
                     'chapter' retorna o capítulo completo com auto-scroll para o NCM.
                     
    Raises:
        ValidationError: Se a query estiver vazia ou for muito longa.
    """
    if not ncm:
        raise ValidationError("Parâmetro 'ncm' é obrigatório", field="ncm")

    if len(ncm) > SearchConfig.MAX_QUERY_LENGTH:
        raise ValidationError(
            f"Query muito longa (máximo {SearchConfig.MAX_QUERY_LENGTH} caracteres)",
            field="ncm"
        )
    
    logger.info(f"TIPI Busca: '{ncm}' (mode={view_mode})")
    
    # Detectar tipo de busca - Exceções propagam para o handler global
    if state.tipi_service.is_code_query(ncm):
        result = await state.tipi_service.search_by_code(ncm, view_mode=view_mode.value)

        # Compatibilidade
        result['resultados'] = result.get('resultados') or result.get('results') or {}
        result['results'] = result.get('results') or result['resultados']
        result['total_capitulos'] = result.get('total_capitulos') or len(result['resultados'])

        # Renderizar HTML (For compatibility)
        result['markdown'] = TipiRenderer.render_full_response(result['resultados'])
    else:
        result = await state.tipi_service.search_text(ncm)
        result.setdefault('normalized', result.get('query', ''))
        result.setdefault('warning', None)
        result.setdefault('match_type', 'text')
    
    return result

@app.get("/api/tipi/chapters")
async def get_tipi_chapters():
    """
    Lista todos os capítulos da tabela TIPI.
    
    Útil para navegação hierárquica no frontend.
    """
    # Exceções propagam para o handler global
    chapters = await state.tipi_service.get_all_chapters()
    return {"success": True, "capitulos": chapters}

@app.get("/api/glossary")
async def get_glossary(term: str = Query(..., description="Termo para consultar no glossário")):
    """
    Consulta definições no Glossário Aduaneiro.
    
    Retorna a definição de um termo técnico se encontrado.
    """
    definition = glossary_manager.get_definition(term)
    if definition:
        return {"found": True, "term": term, "data": definition}
    else:
        return {"found": False, "term": term}

@app.get("/api/status")
async def get_status():
    """
    Healthcheck e Status do Sistema.
    
    Verifica conectividade com:
    - Banco de dados Principal (nesh.db)
    - Banco de dados TIPI (tipi.db)
    
    Retorna versão da API e estado atual dos serviços.
    """
    import time
    
    start = time.perf_counter()
    db_stats = await state.db.check_connection() if state.db else None
    db_latency_ms = round((time.perf_counter() - start) * 1000, 2)

    # TIPI status - captura erros localmente para agregação
    tipi_stats = None
    tipi_ok = False
    try:
        tipi_stats = await state.tipi_service.check_connection()
        tipi_ok = bool(tipi_stats and tipi_stats.get("ok"))
    except Exception as tipi_err:
        tipi_stats = {"status": "error", "error": str(tipi_err)}

    if db_stats:
        db_stats["status"] = "online"
        db_stats["latency_ms"] = db_latency_ms

    status = {
        "status": "online",
        "version": "4.2",
        "backend": "FastAPI",
        "database": db_stats if db_stats else {"status": "error"},
        "tipi": {"status": "online" if tipi_ok else "error", **(tipi_stats or {})}
    }
    return status

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
