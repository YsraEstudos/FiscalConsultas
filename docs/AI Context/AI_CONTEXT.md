# Nesh / Fiscal - AI_CONTEXT

Atualizado em: 2026-02-17
Base desta revisao: leitura direta de backend/frontend/scripts/docs no estado atual do repositório.

## 1) Proposito

Nesh/Fiscal e uma aplicacao de consulta fiscal com dois domínios principais:

- NESH: busca por codigo e por texto em capitulos/notas/posicoes.
- TIPI: busca por codigo e texto com foco em arvore de NCM e aliquotas.

A UX e orientada por navegacao rapida (abas, smart-links, menu contextual, autoscroll, sidebar virtualizada).

## 2) Verdade de Execucao (Source of Truth)

- Backend entrypoint real: `Nesh.py`
  - sobe `backend.server.app:app` com Uvicorn.
- App FastAPI real: `backend/server/app.py`
  - routers: `/api`, `/api/tipi`, `/api/webhooks`
  - middlewares: GZip, TenantMiddleware, CORS, no-cache para HTML
  - lifespan: inicializa `NeshService`, `TipiService`, `AiService`, `Redis`, glossario.
- Frontend entrypoint real: `client/src/main.tsx`
  - exige `VITE_CLERK_PUBLISHABLE_KEY`.
- `main.py` na raiz e placeholder (imprime "Hello from fiscal!") e nao representa runtime da aplicacao.

## 3) Mapa Arquitetural Atual

```text
backend/
  config/                settings, constantes, excecoes, logging, schema SQL
  server/                app FastAPI, middleware tenant/JWT, rate-limit, handlers
  presentation/routes/   contratos HTTP (search, tipi, auth, system, webhooks)
  services/              logica de negocio (NESH, TIPI, IA)
  infrastructure/        DatabaseAdapter SQLite, db_engine SQLAlchemy/SQLModel, Redis, repositories
  domain/                TypedDict legados + SQLModel ORM/response models
  data/                  glossary_manager + glossary_db.json

client/src/
  components/            ResultDisplay, Sidebar, TextSearchResults, modais
  hooks/                 useSearch, useRobustScroll, useTabs, useHistory
  context/               Auth, Settings, Glossary, CrossChapterNote
  services/api.ts        axios + auth interceptor + cache local/in-memory
  types/api.types.ts     contratos TS manuais

scripts/
  setup_database.py      monta SQLite NESH (chapters/positions/chapter_notes)
  setup_fulltext.py      cria/atualiza FTS SQLite
  setup_tipi_database.py monta SQLite TIPI (xlsx)
  rebuild_index.py       rebuild alternativo de nesh.db (usa fonte debug)
  ingest_markdown.py     ingestao alternativa/legada
  migrate_to_postgres.py migracao SQLite -> PostgreSQL
```

## 4) Fluxos Criticos de Negocio

### 4.1 NESH - Busca por codigo (`GET /api/search?ncm=...`)

1. Rota valida tamanho da query e monta headers de cache.
2. Se query parecer codigo (`ncm_utils.is_code_query`), tenta payload cache de rota.
3. `NeshService.process_request` encaminha para `search_by_code`.
4. Service monta `results` por capitulo (com `posicoes`, `notas_parseadas`, `secoes`).
5. Rota pre-renderiza HTML via `HtmlRenderer.render_full_response(results)` no campo `markdown`.
6. Rota remove `conteudo` bruto do payload e preserva compatibilidade `results` + `resultados`.
7. Corpo serializado e comprimido e cacheado em memoria da rota (raw + gzip).

### 4.2 NESH - Busca textual

1. Service normaliza query (com stemming via `NeshTextProcessor`).
2. Executa estrategia por tiers:
   - Tier 1: frase exata
   - Tier 2: AND
   - Tier 3: OR
3. Se caminho legado SQLite: aplica bonus NEAR.
4. Retorna `type="text"` com `match_type`, `warning`, `results` scoreados.

### 4.3 TIPI - Busca por codigo/texto (`GET /api/tipi/search`)

- Codigo: `TipiService.search_by_code` com `view_mode=family|chapter`.
- Texto: `TipiService.search_text` (FTS).
- Compatibilidade de contrato: rota garante `results` e alias `resultados`.
- Payload cache da rota TIPI segue padrao semelhante ao NESH.

## 5) Contratos HTTP Relevantes

Rotas principais:

- `GET /api/search`
- `GET /api/chapters`
- `GET /api/nesh/chapter/{chapter}/notes`
- `GET /api/glossary`
- `GET /api/tipi/search`
- `GET /api/tipi/chapters`
- `GET /api/status`
- `GET /api/cache-metrics` (admin)
- `GET /api/debug/anchors` (debug_mode + admin)
- `GET /api/auth/me`
- `POST /api/ai/chat`
- `POST /api/admin/reload-secrets` (admin)
- `POST /api/webhooks/asaas`

Regras de compatibilidade importantes:

- respostas de codigo mantem `results` e `resultados`.
- TIPI usa `view_mode` estrito (`family`, `chapter`).
- `client/src/types/api.types.ts` e manual (sem codegen OpenAPI ativo).

## 6) Dados, Ingestao e Persistencia

### 6.1 SQLite local

- NESH: `database/nesh.db`
  - tabelas chave: `chapters`, `positions`, `chapter_notes`, `search_index`.
- TIPI: `database/tipi.db`
  - tabelas chave: `tipi_chapters`, `tipi_positions`, `tipi_fts`.

### 6.2 PostgreSQL

- Habilitado por `DATABASE__ENGINE=postgresql`.
- Schema evoluido por Alembic (`migrations/versions/*.py`).
- `db_engine` injeta `app.current_tenant` em sessao para RLS.
- `NeshService` pode rodar em modo repository; TIPI alterna entre repository e SQLite fallback conforme disponibilidade de dados em `tipi_positions`.

### 6.3 Fontes de arquivos

- NESH: `data/Nesh.txt` ou `data/Nesh.zip` (setup principal), e variante `data/debug_nesh/Nesh.txt` (rebuild alternativo).
- TIPI: `data/tipi.xlsx`.
- Glossario: `backend/data/glossary_db.json`.

## 7) Seguranca e Tenancy

- Middleware `TenantMiddleware` protege rotas `/api/*` (exceto rotas publicas definidas).
- JWT Clerk:
  - producao: validacao via JWKS (`AUTH__CLERK_DOMAIN`).
  - desenvolvimento: decode sem assinatura so com `debug_mode=true`.
- Multi-tenant:
  - org_id extraido do JWT e colocado em `tenant_context`.
  - provisioning best-effort de `Tenant`/`User` local via task assincrona.
- Admin checks:
  - `X-Admin-Token` atual/previous ou roles JWT (`admin|owner|superadmin`).
- IA:
  - `/api/ai/chat` exige JWT e rate limit por usuario/IP.
- Webhook Asaas:
  - token opcional, limite de payload e validacao de evento.

## 8) Cache e Performance (estado atual)

Camadas de cache:

1. L1 service cache (in-memory) em `NeshService` e `TipiService`.
2. L2 Redis opcional (`backend/infrastructure/redis_client.py`) para chapter/FTS.
3. Payload cache de rota (`/api/search`, `/api/tipi/search`) com corpo pre-serializado e gzip precomputado.
4. Cache frontend em `client/src/services/api.ts` (memoria + localStorage + dedup in-flight).

Notas:

- compressao usa `compresslevel=1` na pratica (middleware + caches de rota).
- `PerformanceConfig.GZIP_COMPRESSION_LEVEL=6` em constantes nao e a fonte ativa.

## 9) Frontend: Contratos Operacionais

- `ResultDisplay` e o orquestrador de render/autoscroll/persistencia de scroll.
- NESH preferencialmente chega pre-renderizado no campo `markdown` (HTML do backend).
- Fallbacks existem:
  - NESH fallback em `NeshRenderer.renderFullResponse`.
  - TIPI fallback em `renderTipiFallback`.
- Sidebar virtualizada (`react-virtuoso`) usa anchors e codigos normalizados.
- Notas cross-chapter usam cache dedicado (`CrossChapterNoteContext`).

## 10) Testes e CI (estado real)

Local:

- Backend default: `pytest -q` (sem `perf` por padrao).
- Frontend default: `cd client && npm run test`.
- Testes de performance existem, mas sao opt-in.
- Existe cobertura de contratos de rota, renderer, middleware e hooks.

CI observado em `.github/workflows/tests.yml`:

- Job backend:
  - Python `3.13`
  - `uv sync --group dev`
  - Ruff apenas em arquivos `.py` alterados no diff do push/PR
  - `uv run pytest -q --cov=backend --cov-report=xml --cov-report=term-missing`
- Job frontend:
  - Node `22`
  - `npm ci`
  - `npm run lint`
  - `npm run type-check`
  - `npm test`
  - `npm run test:coverage`

## 11) Drift Documental (importante)

Inconsistencias atuais entre docs e codigo:

1. `README.md` declara Python `3.10+`, mas `pyproject.toml` exige `>=3.13`.
2. `README.md` sugere `requirements.txt`/`requirements-dev.txt`, arquivos inexistentes no snapshot.
3. `README.md` aponta roadmap em `docs/ROADMAP.md`, mas o caminho ativo atual e `docs/roadmap/ROADMAP.md`.

## 12) Divida Tecnica Estrutural (resumo)

1. Dominio duplicado (`TypedDict` + response models SQLModel) em paralelo.
2. Parser/regex fragmentado entre runtime e scripts de ingestao.
3. Servicos hibridos com bifurcacao legado vs repository no mesmo modulo.
4. Split-brain de renderizacao (backend + fallback frontend).
5. Uso elevado de `any` em pontos centrais de frontend.
6. `sys.path.append/insert` em scripts e imports de fallback.
7. Contrato de callback de autoscroll desalinhado entre `App.tsx` e `ResultDisplay.tsx`.
8. Endpoint `/api/debug/anchors` tenta ler `markdown` direto do service, mas renderer principal roda na rota `/api/search`.

## 13) Setup / Comandos Recomendados

### Backend

Opcao A (pyproject/uv):

```powershell
uv sync
uv run python Nesh.py
```

Opcao B (venv + install local):

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -e .
python Nesh.py
```

Observacoes:

- `requirements.txt` e `requirements-dev.txt` nao existem neste snapshot.
- `pyproject.toml` define `requires-python = ">=3.13"`.

### Frontend

```powershell
cd client
npm install
npm run dev
```

### Dados SQLite

```powershell
python scripts/setup_tipi_database.py
$env:PYTHONUTF8="1"; python scripts/setup_database.py
$env:PYTHONUTF8="1"; python scripts/setup_fulltext.py
```

## 14) Regras para Mudancas por IA

Do:

- Preservar contratos legados (`results` + `resultados`) enquanto frontend depender.
- Manter compatibilidade de IDs de anchor (`generate_anchor_id`/`generateAnchorId`).
- Atualizar docs em conjunto com mudancas de fluxo/contrato.

Don't:

- Nao remover fallbacks sem plano de migracao e testes.
- Nao mudar formato de `view_mode` da TIPI sem alinhar frontend + testes.
- Nao assumir que um unico renderer e usado em todos os caminhos hoje.

## 15) Prioridades de Refatoracao (explicacao simples)

1. Corrigir callback de autoscroll.
Motivo simples: e como etiquetar a caixa certa antes de guardar o brinquedo.
2. Escolher uma fonte principal de render por fluxo (NESH/TIPI).
Motivo simples: duas receitas diferentes para o mesmo bolo confundem a cozinha.
3. Unificar parser de NESH.
Motivo simples: varias regras diferentes para o mesmo jogo geram briga.
4. Consolidar modelos de dominio.
Motivo simples: dois mapas diferentes para o mesmo lugar fazem voce se perder.
5. Reduzir `any` e dividir componentes grandes.
Motivo simples: caixas com nome ajudam a achar as coisas rapido.

## 16) Unknown / Nao Consolidado

- Padrao oficial unico de deploy (alem de `docker-compose` local + build frontend): nao consolidado em documento unico.
- Estrategia final de desativacao do alias `resultados` no contrato publico: ainda nao definida.
