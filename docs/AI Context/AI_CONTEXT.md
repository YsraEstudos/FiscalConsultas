# Nesh / Fiscal - AI_CONTEXT

Atualizado em: 2026-03-13
Base desta revisao: README, `start_nesh_dev.bat`, `client/package.json`, `docs/TESTING.md` e workflows atuais de CI/MegaLinter.

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
- Shell SPA real: `client/index.html`
  - publica CSP, `referrer` policy e `Permissions-Policy` via meta tags.

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
- `POST /api/ai/chat` (Rate Limited 5req/min, Auth Required)
- `POST /api/webhooks/asaas` (Provisiona Tenants localmente)

Regras de compatibilidade importantes:

- respostas de codigo mantem `results` e `resultados`.
- TIPI usa `view_mode` estrito (`family`, `chapter`).
- `client/src/types/api.types.ts` e manual (sem codegen OpenAPI ativo).

## 6) Dados, Ingestao e Persistencia

### 6.1 PostgreSQL (Primary State)

- Motor primário atual para os dados (habilitado por `DATABASE__ENGINE=postgresql`).
- Configurado via `DATABASE__POSTGRES_URL` em prod/dev.
- Controle de Schema estrito gerenciado por Alembic migrations (`migrations/`).
- Engine RLS (Row-Level Security) ativo: `db_engine` injeta `app.current_tenant` da request via contextvar nas operações.

### 6.2 SQLite local (Modo Desacoplado Dev/Fallback)

- NESH: `database/nesh.db`
- TIPI: `database/tipi.db`
- Serviço `NeshService` possui fallback para SQLite em caso de modo Legacy de Ingestão (offline fallback mode), através do `DatabaseAdapter` original.
- Cuidado: Não é o target para transações reais de negócios como criação de Assinaturas e Usuários B2B.

### 6.3 Fontes de arquivos

- NESH: `data/Nesh.txt` ou `data/Nesh.zip` (setup principal), e variante `data/debug_nesh/Nesh.txt` (rebuild alternativo).
- TIPI: `data/tipi.xlsx`.
- Glossario: `backend/data/glossary_db.json`.

## 7) Seguranca e Tenancy

- **Hardcoded Secrets Restritos**: Nenhuma credencial inserida no código; todas são injetadas (leia `SECRETS_POLICY.md` para regras ativas).
- Middleware `TenantMiddleware` protege rotas `/api/*` (exceto `/api/auth/me`, `/api/webhooks`, `/api/status`).
- JWT Clerk (`RS256` + `JWKS`):
  - Autenticação migrou do session legada (desabilitada) para validação local assíncrona do JWKS (`AUTH__CLERK_DOMAIN`).
  - Cache local de tokens JWKS válidos (60s).
- Rate Limit & Anti-abuso:
  - Rotas pesadas como `ai/chat` impõem limite via `SlidingWindowRateLimiter` (`ai_chat_rate_limiter`). Cache via Redis na infraestrutura é alvo previsto.
- Multi-tenant:
  - `org_id` extraído do JWT para o `tenant_context`.
  - Provisioning Best-Effort (sincronização fantasma) de entidades DB locais após verificação de autenticidade JWT.
- Webhook Asaas para Pagamentos:
  - Gera triggers para criação automática/ativação de tenants (`Subscription`).
- Hardening ativo no frontend:
  - HTML backend-rendered/markdown legado passa por sanitização central em `client/src/utils/contentSecurity.ts`.
  - Links só aceitam protocolos seguros e links externos recebem `rel="noopener noreferrer"`.
  - Imagens inseguras são descartadas; imagens válidas recebem `loading="lazy"`, `decoding="async"` e `referrerpolicy="no-referrer"`.
  - `api.ts` usa `withCredentials: false`; o fluxo autenticado depende do header `Authorization`, não de cookies implícitos.
- Autorização/gating de UI no frontend:
  - `AuthContext` deriva `isAdmin` de `membership.role` do Clerk via `hasPrivilegedRole`.
  - roles reconhecidas: `admin`, `owner`, `superadmin`, inclusive formatos compostos como `org:admin`.
  - `VITE_RESTRICTED_UI_EMAILS` controla apenas superfícies opcionais de UI (chat IA, comentários, contribuições). Não é fronteira de autorização backend.

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
- Todo HTML renderizado por `ResultDisplay` e `MarkdownPane` deve passar pelo pipeline de sanitização/hardening antes de entrar no DOM.
- Fallbacks existem:
  - NESH fallback em `NeshRenderer.renderFullResponse`.
  - TIPI fallback em `renderTipiFallback`.
- Sidebar virtualizada (`react-virtuoso`) usa anchors e codigos normalizados.
- Notas cross-chapter usam cache dedicado (`CrossChapterNoteContext`).

## 10) Testes e CI (estado real)

Local:

- Backend default: `uv run pytest -q` (sem `perf` e `snapshot` por padrao).
- Frontend default: `cd client && npm run test`.
- Frontend type-check: `cd client && npm run type-check`.
- Full stack Windows: `.\start_nesh_dev.bat` (`--auth-debug` para diagnostico Clerk no frontend; `--rebuild` para recriar indices/bancos locais antes do boot).
- Validacao dedicada de auth env: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_auth_env.ps1`.
- Testes de performance existem, mas sao opt-in.
- Existe cobertura de contratos de rota, renderer, middleware e hooks.
- Snapshot observado em 2026-03-09:
  - frontend: `46` arquivos / `270` testes passando
  - novas suítes cobrindo `contentSecurity`, `authz`, `MarkdownPane`, `ModalManager`, `AuthContext`, `ResultDisplay`, `AppSearch`

CI observado em `.github/workflows/tests.yml`:

- Job backend:
  - Python `3.14`
  - `uv sync --group dev`
  - `uv run ruff format --check`
  - `uv run ruff check`
  - `uv run pyright migrations`
  - `uv run pylint migrations/env.py migrations/versions/001_initial.py migrations/versions/006_precomputed_columns_and_gin.py --disable=all --enable=E,F --disable=E0401,E1101`
  - `uv run pytest -q --cov=backend --cov-report=xml --cov-report=term-missing --cov-fail-under=70`
- Job frontend:
  - Node `24`
  - `npm ci`
  - `npm run lint`
  - `npm run type-check`
  - `npm run test:coverage`

CI adicional em `.github/workflows/megalinter.yml`:

- `pull_request` (`PR Smart`): `VALIDATE_ALL_CODEBASE=false` e linters/scanners selecionados para diff de PR.
- `workflow_dispatch` e `schedule` (`Full Audit`): `VALIDATE_ALL_CODEBASE=true` para varredura completa.
- `PYTHON_PYLINT` e `PYTHON_PYRIGHT` ficam fora do PR Smart e sao cobertos no workflow de testes do backend.

## 11) Drift Documental (status atual)

Status:

1. README, `TESTING.md` e este contexto foram sincronizados em 2026-03-09 com o hardening recente do frontend.
2. O ponto de atencao atual e manter a parte de UI restrita (`VITE_RESTRICTED_UI_EMAILS`) claramente documentada como gating de client, nao como auth backend.
3. Outro ponto de atencao e manter este documento sincronizado quando o escopo do `PR Smart` ou das suites frontend mudar.

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
uv sync --group dev
uv run Nesh.py
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
npm ci
npm run dev
```

### Dados SQLite

```powershell
uv run scripts/setup_tipi_database.py
$env:PYTHONUTF8="1"; uv run scripts/setup_database.py
$env:PYTHONUTF8="1"; uv run scripts/setup_fulltext.py
```

### Bootstrap Windows assistido

```powershell
.\start_nesh_dev.bat
```

Notas:

- o script faz `docker compose up -d`, valida `.env` e `client/.env.local`, espera `db`, `redis` e `pgadmin`, e bloqueia startup se o preflight de migracao PostgreSQL falhar.
- para diagnostico de auth do frontend, use `.\start_nesh_dev.bat --auth-debug`.
- para rebuild local antes do boot, use `.\start_nesh_dev.bat --rebuild`.
- se houver volume legado do PostgreSQL 15, verifique com `.\.venv\Scripts\python scripts\migrate_postgres_cluster.py --check-only` e migre com `.\.venv\Scripts\python scripts\migrate_postgres_cluster.py --run`.

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
