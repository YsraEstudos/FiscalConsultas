# Nesh / Fiscal

Sistema híbrido de consulta fiscal (NESH + TIPI) com backend FastAPI e frontend React/Vite.

## O que é

- Busca por código e texto nas Notas Explicativas do Sistema Harmonizado (NESH).
- Busca na TIPI com visualização por família (`family`) ou capítulo (`chapter`).
- Frontend com navegação por abas, smart-links e recursos de produtividade (glossário, notas, chat IA).

## Requisitos

- Python 3.13+ (alinhado com `pyproject.toml`)
- Node.js 22.12+ para o frontend (validado localmente com Node 22.17.0; CI usa Node 24)
- npm (validado localmente com npm 10.9.2)
- Opcional para modo PostgreSQL local: Docker + Docker Compose

## Quickstart

### 1) Instalar dependências

```powershell
uv sync --group dev

cd client
npm ci
cd ..
```

### 1.1) Ativar MegaLinter local no commit (pre-commit)

O projeto roda MegaLinter localmente via hook de commit (pre-commit).

```powershell
uv tool install pre-commit
pre-commit install
```

A partir disso, todo `git commit` executa o MegaLinter antes de criar o commit.
Além disso, o repositório também possui workflow de MegaLinter em Pull Request (`.github/workflows/megalinter.yml`).

### 1.2) MegaLinter local (execução manual)

Uso local e CI:
- Local: útil para feedback rápido antes do push, com saída em `megalinter-reports/`.
- PR/CI: o workflow de MegaLinter roda em PRs para `main` e publica resultado como check + logs/artifacts no GitHub Actions.
- PR Smart (`pull_request`): valida apenas diff do PR com linters/scanners selecionados para alto sinal.
- Full Audit (`workflow_dispatch` e `schedule`): valida codebase completa.
- Enforcement: se bloqueia merge depende das regras de branch protection/checks obrigatórios do repositório.

Executar apenas mudanças do branch (modo diff):

```powershell
docker run --rm -e DEFAULT_WORKSPACE=/tmp/lint -e VALIDATE_ALL_CODEBASE=false -v "${PWD}:/tmp/lint" oxsecurity/megalinter:v9
```

Executar base inteira (modo full):

```powershell
docker run --rm -e DEFAULT_WORKSPACE=/tmp/lint -e VALIDATE_ALL_CODEBASE=true -v "${PWD}:/tmp/lint" oxsecurity/megalinter:v9
```

Relatórios locais: `megalinter-reports/`
Relatórios de PR/CI: aba **Actions** (logs/artifacts) e comentário automático no PR quando habilitado pelo workflow.

Opcional sem `uv` (manual):

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -e .
pip install pytest pytest-cov pytest-benchmark httpx
```

### 2) Configurar ambiente

```powershell
Copy-Item .env.example .env
```

Configuração recomendada (cloud-first: API no Render + PostgreSQL no Neon):

Observação: quando o backend estiver no Render, configure esses valores no painel de Environment do provedor. O `.env` local é usado apenas quando você roda backend no seu computador.

- em `.env` (backend), ajuste pelo menos:

```env
SERVER__ENV=production
DATABASE__ENGINE=postgresql
DATABASE__POSTGRES_URL=postgresql+asyncpg://<user>:<password_urlencoded>@<host>/<db>?sslmode=require

AUTH__CLERK_DOMAIN=your-instance.clerk.accounts.dev
AUTH__CLERK_ISSUER=https://your-instance.clerk.accounts.dev
AUTH__CLERK_AUDIENCE=fiscal-api
AUTH__CLERK_AUTHORIZED_PARTIES=["http://localhost:5173","http://127.0.0.1:5173","https://seu-frontend.com"]
AUTH__CLERK_AUTHORIZED_PARTIES_REGEX=^https://(?:[a-z0-9-]+\.)?fiscalconsultas\.pages\.dev$
AUTH__CLERK_CLOCK_SKEW_SECONDS=120

# Trave CORS para os domínios oficiais do frontend
SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173","https://seu-frontend.com"]
# Opcional: libere previews do mesmo projeto Cloudflare Pages
SERVER__CORS_ALLOWED_ORIGIN_REGEX=^https://(?:[a-z0-9-]+\.)?fiscalconsultas\.pages\.dev$

# Redis opcional (Upstash)
CACHE__ENABLE_REDIS=true
CACHE__REDIS_URL=redis://default:<password>@<host>:6379/0
```

- em `client/.env.local`, defina:

```env
VITE_API_URL=https://seu-backend.onrender.com
VITE_CLERK_PUBLISHABLE_KEY=pk_test_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
VITE_RESTRICTED_UI_EMAILS=voce@empresa.com,admin@empresa.com
```

Configuração alternativa (local-first com SQLite):

- em `.env`, ajuste `DATABASE__ENGINE=sqlite`
- em `client/.env.local`, defina:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_sua_chave
VITE_RESTRICTED_UI_EMAILS=voce@empresa.com,admin@empresa.com
```

Sem `VITE_CLERK_PUBLISHABLE_KEY`, o frontend exibe apenas a tela de erro de configuração.

Para comentários autenticados com Clerk (`/api/comments/*`), configure também:

- Template no Clerk Dashboard: `backend_api` com `aud = "fiscal-api"`.
- em `.env`:

```env
AUTH__CLERK_DOMAIN=your-instance.clerk.accounts.dev
AUTH__CLERK_ISSUER=https://your-instance.clerk.accounts.dev
AUTH__CLERK_AUDIENCE=fiscal-api
AUTH__CLERK_AUTHORIZED_PARTIES=["http://localhost:5173","http://127.0.0.1:5173"]
AUTH__CLERK_CLOCK_SKEW_SECONDS=120
```

- em `client/.env.local`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
VITE_RESTRICTED_UI_EMAILS=voce@empresa.com,admin@empresa.com
```

Checklist rápido Clerk (dev local):

- `AUTH__CLERK_DOMAIN` e `AUTH__CLERK_ISSUER` devem apontar para o mesmo tenant Clerk.
- `AUTH__CLERK_AUDIENCE` deve ser exatamente o `aud` emitido no template JWT (`backend_api`).
- `VITE_CLERK_TOKEN_TEMPLATE` deve ter o mesmo nome do template configurado no Clerk.
- `AUTH__CLERK_AUTHORIZED_PARTIES` deve incluir `http://localhost:5173` e `http://127.0.0.1:5173`.
- `VITE_RESTRICTED_UI_EMAILS` é opcional e controla apenas superfícies de UI restritas no frontend (chat IA, comentários e aba de contribuições). Não substitui autorização backend.

### 3) Preparar dados locais (SQLite)

```powershell
python scripts/setup_tipi_database.py
uv run scripts/rebuild_index.py
```

Observações:

- `rebuild_index.py` (Fase 5) é o script consolidado: cria `database/nesh.db`, extrai seções e reconstrói o índice FTS com Stemming.
- Em Windows com encoding CP1252, scripts com emoji podem falhar; usar `PYTHONUTF8=1` (o `uv run` geralmente lida bem com isso, mas o script `.bat` já automatiza essa configuração).

### 4) Subir aplicação

Fluxo recomendado (cloud-first): frontend local consumindo API em produção.

Comando único (Windows):

```powershell
.\start_nesh_dev.bat
```

Para diagnóstico de autenticação Clerk no frontend:

```powershell
.\start_nesh_dev.bat --auth-debug
```

O script `start_nesh_dev.bat` atual é **frontend-only**:

- valida Node/npm e `client/.env.local`
- instala dependências frontend quando necessário
- inicia o Vite na porta `5173`
- abre `http://127.0.0.1:5173`

Ele **não** inicia backend, **não** executa `docker compose up -d` e **não** valida saúde de API.

Se você precisar rodar backend localmente (modo de desenvolvimento de API):

Terminal 1 (backend):

```powershell
uv run Nesh.py
```

Terminal 2 (frontend):

```powershell
cd client
npm run dev
```

Acesse `http://127.0.0.1:5173`.

Healthcheck backend:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status"
```

Resposta esperada: JSON com `status`, `database` e `tipi`.

## Deploy no Cloudflare

O caminho mais simples para este repositório é:

1. publicar o frontend em **Cloudflare Pages**
2. manter o backend FastAPI em um host compatível com Python, como Render, Fly.io ou Railway

Motivo: o Cloudflare Pages hospeda bem o `client` estático, mas não executa este backend FastAPI diretamente sem uma reestruturação maior.

### Frontend no Pages

- `Framework preset`: `Vite`
- `Build command`: `npm run build`
- `Build output directory`: `dist`
- `Root directory`: `client`

Depois do deploy, ajuste `client/.env.local` ou as variáveis do projeto no Pages com:

```env
VITE_API_URL=https://seu-backend.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
```

Se você quiser usar uma API própria em outro domínio, ela precisa permitir CORS para o domínio do Pages e aceitar o token do Clerk.

Para previews do Cloudflare Pages, o backend também precisa aceitar subdomínios como
`https://<preview>.fiscalconsultas.pages.dev`. Como essas URLs mudam a cada deploy,
o caminho mais estável é configurar um regex controlado no backend, além do domínio
principal em `SERVER__CORS_ALLOWED_ORIGINS` e `AUTH__CLERK_AUTHORIZED_PARTIES`.

### Rotas do React

O arquivo `client/public/_redirects` já garante fallback para SPA no Cloudflare Pages, então rotas internas como `/`, `/perfil` ou abas profundas não quebram ao atualizar a página.

## Deploy no GitHub Pages

Também é possível publicar o frontend estático no GitHub Pages em:

- `https://ysraestudos.github.io/FiscalConsultas/`

Checklist mínimo:

1. Em `Settings > Pages`, deixe `Source = GitHub Actions`.
2. Cadastre `Settings > Secrets and variables > Actions > Variables > VITE_CLERK_PUBLISHABLE_KEY` com uma chave `pk_live_...`.
3. Execute o workflow `Deploy GitHub Pages`.

Esse workflow usa o path-base `/FiscalConsultas/`, gera fallback SPA (`404.html`) e deve falhar se a variável `VITE_CLERK_PUBLISHABLE_KEY` não estiver definida.

## Deploy no Render

Se você quer deixar o projeto funcionando com `Render + Neon + Upstash`, o caminho mais simples é:

1. colocar o backend FastAPI no Render
2. colocar o banco Postgres no Neon
3. colocar o cache Redis no Upstash
4. manter o frontend estático em um host separado, como Cloudflare Pages ou GitHub Pages

### 1) Banco no Neon

No Neon, crie um banco e copie a URL de conexão do Postgres.

Use essa URL no Render em:

```env
DATABASE__ENGINE=postgresql
DATABASE__POSTGRES_URL=postgresql+asyncpg://<user>:<password>@<host>/<db>?sslmode=require
```

### 2) Cache no Upstash

No Upstash, crie um Redis e copie a URL de conexão.

Use essa URL no Render em:

```env
CACHE__ENABLE_REDIS=true
CACHE__REDIS_URL=<upstash-redis-url>
```

### 3) Backend no Render

No Render, crie um `Web Service` apontando para este repositório.

Configuração recomendada:

- `Runtime`: `Docker`
- `Health Check Path`: `/api/status`
- `Auto Deploy`: ligado, se você quiser deploy automático

O backend já tem um `Dockerfile`, então o Render não precisa de build customizado.

No painel de variáveis de ambiente do Render, use:

```env
SERVER__ENV=production
SERVER__HOST=0.0.0.0
AUTH__CLERK_DOMAIN=your-instance.clerk.accounts.dev
AUTH__CLERK_ISSUER=https://your-instance.clerk.accounts.dev
AUTH__CLERK_AUDIENCE=fiscal-api
AUTH__CLERK_AUTHORIZED_PARTIES=["http://localhost:5173","http://127.0.0.1:5173","https://fiscalconsultas.pages.dev"]
AUTH__CLERK_AUTHORIZED_PARTIES_REGEX=^https://(?:[a-z0-9-]+\.)?fiscalconsultas\.pages\.dev$
AUTH__CLERK_CLOCK_SKEW_SECONDS=120
SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173","https://fiscalconsultas.pages.dev"]
SERVER__CORS_ALLOWED_ORIGIN_REGEX=^https://(?:[a-z0-9-]+\.)?fiscalconsultas\.pages\.dev$
```

Se você usar previews do Cloudflare Pages, essas duas variáveis com regex evitam dor de cabeça com subdomínios temporários.
Se o frontend estiver no GitHub Pages, inclua `https://ysraestudos.github.io` em
`AUTH__CLERK_AUTHORIZED_PARTIES` e `SERVER__CORS_ALLOWED_ORIGINS`.

### 4) Frontend

Se o frontend continuar no Cloudflare Pages, a URL da API no Pages deve apontar para o Render:

```env
VITE_API_URL=https://fiscal-api-5eok.onrender.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
```

Se você ainda estiver usando a chave de desenvolvimento do Clerk no site publicado, o Clerk vai mostrar aviso no console. Para produção, troque pela chave live.

## Workflow de desenvolvimento

### Comandos principais

| Ação | Comando |
| :--- | :--- |
| Backend tests (suite principal) | `uv run pytest -q` |
| Backend perf | `uv run pytest -m perf -q` |
| Backend snapshot | `uv run pytest -m snapshot -q` |
| Frontend lint | `cd client && npm run lint` |
| Frontend tests | `cd client && npm run test` |
| Frontend tests (todos, inclui perf) | `cd client && npm run test:all` |
| Frontend cobertura | `cd client && npm run test:coverage` |
| Backend cobertura | `uv run pytest -q --cov=backend --cov-report=term-missing` |
| Frontend build | `cd client && npm run build` |

Observação para snapshots:

- Antes de rodar `uv run pytest -m snapshot -q`, garanta que `snapshots/baseline_v1.json` existe.
- Para gerar/atualizar a baseline local determinística, use `uv run python scripts/generate_snapshot.py`.

Status observado em **2026-02-07**:

- `pytest -q`: OK (suite padrão exclui `perf` e `snapshot`)
- Fluxo oficial backend: rodar `pytest` a partir da raiz do repositório.
- `cd client && npm run lint`: OK
- `cd client && npm run test`: OK (suite estável, sem perf)
- `cd client && npm run build`: OK

Status observado em **2026-02-19** (fechamento da Fase 0 de cobertura):

- Backend:
  - `.\.venv\Scripts\python -m pytest -q --cov=backend --cov-report=term`: **429 passed, 12 deselected**
  - Cobertura backend total: **91%**
- Frontend:
  - `cd client && npm test -- --run`: **167 passed**
  - `cd client && npm run test:coverage`:
    - Statements: **89.66%**
    - Branches: **76.83%**
    - Functions: **89.92%**
    - Lines: **92.47%**

Ganhos relevantes na Fase 0:

- `client/src/components/ResultDisplay.tsx`: **91.07% statements**
- `client/src/components/SettingsModal.tsx`: **100% statements**
- `client/src/hooks/useTabs.ts`: **100% statements**
- `client/src/types/api.types.ts`: **100% statements**

Status observado em **2026-02-19** (fechamento da Fase 1 de cobertura frontend):

- Frontend:
  - `cd client && npm test -- --run`: **191 passed**
  - `cd client && npm run test:coverage`:
    - Statements: **92.12%**
    - Branches: **80.66%**
    - Functions: **91.21%**
    - Lines: **94.93%**
- Módulos foco da Fase 1 (branches):
  - `client/src/components/TabsBar.tsx`: **92.85% branches** (**100% statements**)
  - `client/src/hooks/useSearch.ts`: **89.13% branches** (**100% statements**)
  - `client/src/utils/id_utils.ts`: **97.05% branches** (**100% statements**)
  - `client/src/context/AuthContext.tsx`: **100% branches** (**100% statements**)

Status observado em **2026-02-19** (fechamento da Fase 2 de cobertura frontend):

- Frontend:
  - `cd client && npm test -- --run`: **211 passed**
  - `cd client && npm run test:coverage`:
    - Statements: **93.95%**
    - Branches: **82.83%**
    - Functions: **94.30%**
    - Lines: **96.26%**
- Módulos foco da Fase 2 (branches):
  - `client/src/components/SearchBar.tsx`: **90.90% branches** (**100% statements**)
  - `client/src/context/SettingsContext.tsx`: **100% branches** (**100% statements**)
  - `client/src/components/StatsModal.tsx`: **100% branches** (**100% statements**)
  - `client/src/components/TextSearchResults.tsx`: **96.87% branches** (**100% statements**)
- Módulos novos estabilizados para evitar regressão global:
  - `client/src/components/HighlightPopover.tsx`: **94.11% branches** (**96.15% statements**)
  - `client/src/hooks/useTextSelection.ts`: **100% branches** (**100% statements**)

Status observado em **2026-03-09** (hardening de frontend + atualização da suíte):

- Frontend:
  - `cd client && npm run test`: **270 passed** (`46` arquivos de teste)
  - `cd client && npm run type-check`: **OK**
- Novas suítes/expansões relevantes:
  - `client/src/utils/contentSecurity.test.ts`
  - `client/src/utils/authz.test.ts`
  - `client/tests/unit/MarkdownPane.test.tsx`
  - reforços em `AuthContext`, `ModalManager`, `ResultDisplay`, `Header`, `App.behavior` e `AppSearch`

## Hardening de frontend (2026-03-09)

Mudanças de segurança documentadas no estado atual:

- HTML vindo do backend ou de markdown legado passa por sanitização central em `client/src/utils/contentSecurity.ts` antes de entrar no DOM.
- A sanitização preserva atributos necessários para smart-links/notas (`data-ncm`, `data-note`, `data-chapter`), mas remove tags perigosas (`script`, `iframe`, `form`, `svg`, `math`, mídia embutida etc.) e atributos inseguros (`style`, `srcset`).
- Links recebem hardening adicional:
  - protocolos permitidos: `http`, `https`, `mailto`, `tel`
  - links externos ou `_blank` recebem `rel="noopener noreferrer"`
- Imagens recebem hardening adicional:
  - só aceitam `http`, `https`, `blob` e `data:image/...` permitido
  - imagens inseguras são descartadas
  - imagens válidas recebem `loading="lazy"`, `decoding="async"` e `referrerpolicy="no-referrer"`
- O shell SPA em `client/index.html` publica `Content-Security-Policy`, `referrer` policy e `Permissions-Policy` via meta tags.
- O client axios opera com `withCredentials: false`; a autenticação do Clerk segue apenas pelo header `Authorization`.
- `isAdmin` no frontend não usa mais fallback por email hardcoded; agora deriva de `membership.role` do Clerk e aceita `admin`, `owner` e `superadmin` (inclusive em formatos como `org:admin`).
- `VITE_RESTRICTED_UI_EMAILS` controla apenas exposição de UI opcional no client. Qualquer autorização sensível continua devendo existir no backend.

Guia curto de estratégia, marcadores e escopo de testes: `docs/TESTING.md`.
Observação: suites legadas/diagnóstico fora do contrato oficial ficam excluídas do fluxo padrão.

## Modo PostgreSQL (suportado)

Subir serviços:

```powershell
docker compose up -d
```

Em `.env`:

```env
DATABASE__ENGINE=postgresql
POSTGRES_USER=postgres
POSTGRES_PASSWORD=sua_senha
POSTGRES_DB=nesh_db
PGADMIN_DEFAULT_EMAIL=admin@seudominio.com
PGADMIN_DEFAULT_PASSWORD=uma_senha_forte
DATABASE__POSTGRES_URL=postgresql+asyncpg://postgres:sua_senha_urlencoded@localhost:5432/nesh_db
```

Observação importante:

- se `POSTGRES_PASSWORD` tiver caractere `$`, escape como `$$` no `.env` para o Docker Compose não interpretar como interpolação de variável.
- portas padrão: PostgreSQL `5432`, Redis `6379`, pgAdmin `8080`.
- se existir um PostgreSQL local do Windows usando a porta `5432`, pare/desabilite o serviço local para evitar colisão com o container Docker.
  - PowerShell (Administrador):

```powershell
Stop-Service -Name "postgresql-x64-18" -Force
Set-Service -Name "postgresql-x64-18" -StartupType Disabled
```

Migrar schema:

```powershell
alembic upgrade head
```

Migrar dados SQLite para PostgreSQL:

```powershell
python scripts/migrate_to_postgres.py
```

### Migracao do PostgreSQL 15 para 18 (Windows/Docker local)

Se o ambiente local tinha um volume antigo `fiscal_postgres_data` em PostgreSQL 15,
o container `postgres:18` pode entrar em restart loop se o cluster nao for migrado
ou se o volume for montado no caminho legado `/var/lib/postgresql/data`.

Configuracao esperada no compose para PostgreSQL 18:

```yaml
volumes:
  - postgres18_data:/var/lib/postgresql
```

Verificar se o ambiente precisa de migracao:

```powershell
.\.venv\Scripts\python scripts\migrate_postgres_cluster.py --check-only
```

Executar a migracao logica do cluster PostgreSQL 15 para 18:

```powershell
.\.venv\Scripts\python scripts\migrate_postgres_cluster.py --run
```

O utilitario faz:

- deteccao do volume legado `fiscal_postgres_data`
- clone defensivo do volume antigo
- dump logico completo com `pg_dumpall`
- recriacao limpa do volume `fiscal_postgres18_data`
- restore no PostgreSQL 18
- validacao de tabelas e contagens minimas (`chapters`, `positions`, `chapter_notes`, `tipi_positions`, `users`, `tenants`, `subscriptions`, `comments`)

Validacao pos-migracao:

```powershell
docker compose up -d
docker compose ps
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status"
```

Política de rollback local:

- o volume fonte `fiscal_postgres_data` nao e apagado automaticamente
- o clone `fiscal_postgres15_backup_<timestamp>` tambem e preservado
- se a migracao falhar, corrija o problema e repita o `--run`
- se precisar de recuperacao parcial, recrie o cluster PostgreSQL 18 e rode `alembic upgrade head` seguido de `python scripts/migrate_to_postgres.py`

## Performance NCM (estado atual)

Baseline local mais recente para `/api/search?ncm=8481.30.00` (10 de fevereiro de 2026):

- `first_load` (rota backend, processo já iniciado): ~`602ms` média
- `warm_hit` (cache payload): ~`2.8ms` média

Mudanças principais já aplicadas:

- renderer backend otimizado (pipeline unificado de transformações)
- resposta NESH em `markdown` agora com HTML puro (fallback markdown legado só no frontend)
- short-circuit de cache na rota `/api/search` com header `X-Payload-Cache: MISS|HIT`

## Configuração (env vars usadas)

| Variável | Uso |
| :--- | :--- |
| `DATABASE__ENGINE` | Seleciona engine (`sqlite` ou `postgresql`) |
| `DATABASE__POSTGRES_URL` | URL asyncpg usada quando engine = `postgresql` |
| `SERVER__ENV` | Comportamento de middleware/auth (`development` habilita fallbacks) |
| `SERVER__CORS_ALLOWED_ORIGINS` | Lista JSON de origens permitidas para CORS (produção deve conter apenas domínios oficiais) |
| `SERVER__CORS_ALLOWED_ORIGIN_REGEX` | Regex opcional para liberar previews controlados (ex.: subdomínios do Cloudflare Pages) |
| `CACHE__ENABLE_REDIS` | Liga/desliga Redis para cache/rate-limit distribuído |
| `CACHE__REDIS_URL` | URL do Redis (ex: Upstash) |
| `AUTH__CLERK_DOMAIN` | Validação JWT via JWKS do Clerk |
| `AUTH__CLERK_ISSUER` | Valida `iss` explicitamente (`https://<seu-dominio-clerk>`) |
| `AUTH__CLERK_AUDIENCE` | Valida `aud` no backend (ex: `fiscal-api`) |
| `AUTH__CLERK_AUTHORIZED_PARTIES` | Valida `azp` (lista JSON; ex: `localhost` e `127.0.0.1`) |
| `AUTH__CLERK_AUTHORIZED_PARTIES_REGEX` | Regex opcional para aceitar `azp` de previews controlados |
| `AUTH__CLERK_CLOCK_SKEW_SECONDS` | Tolerância de clock para `exp/iat/nbf` (recomendado `120` em dev local) |
| `BILLING__ASAAS_WEBHOOK_TOKEN` | Validação de token no webhook `/api/webhooks/asaas` |
| `SECURITY__AI_CHAT_REQUESTS_PER_MINUTE` | Rate limit do endpoint `/api/ai/chat` |
| `GOOGLE_API_KEY` | Habilita integração Gemini no serviço de IA |
| `VITE_CLERK_PUBLISHABLE_KEY` | Obrigatório para o frontend montar com Clerk |
| `VITE_CLERK_TOKEN_TEMPLATE` | Template usado no `getToken()` do Clerk (recomendado: `backend_api`) |
| `VITE_RESTRICTED_UI_EMAILS` | Lista CSV opcional para liberar UI restrita no frontend (chat IA, comentários, contribuições); não é controle de auth backend |
| `VITE_AUTH_DEBUG` | (Opcional) habilita logs de diagnóstico JWT no navegador |
| `VITE_API_URL` / `VITE_API_FILTER_URL` | Base URL de API no frontend (normalizada em runtime) |

## Estrutura do projeto

```text
backend/         API FastAPI, serviços, repositórios e config
client/          React + Vite + TypeScript
scripts/         Setup de dados, migração e utilitários
database/        SQLite local (nesh.db, tipi.db)
migrations/      Alembic migrations (PostgreSQL)
tests/           Suite principal do backend
docs/            Documentação funcional/técnica
```

## Deploy/produção

Fluxo operacional atual (cloud-first):

- Banco de dados: PostgreSQL gerenciado (Neon)
- API: FastAPI em provedor cloud (Render)
- Frontend: local em desenvolvimento (`npm run dev`) ou hospedado separadamente

Suporte técnico confirmado no repositório:

- Build de frontend: `cd client && npm run build`
- Backend serve `client/dist` automaticamente quando a pasta existe.

Checklist mínimo para produção:

1. Configurar `DATABASE__POSTGRES_URL` com SSL (`sslmode=require`).
2. Configurar Clerk (`AUTH__CLERK_*`) com `AUTHORIZED_PARTIES` incluindo o domínio real do frontend.
3. Configurar `SERVER__CORS_ALLOWED_ORIGINS` com domínios oficiais (sem curingas em produção).
4. Configurar Redis (opcional, recomendado): `CACHE__ENABLE_REDIS=true` e `CACHE__REDIS_URL`.
5. Validar `GET /api/status` após deploy.

## Documentação para IA e manutenção

- Contexto técnico principal: [`docs/AI Context/AI_CONTEXT.md`](docs/AI%20Context/AI_CONTEXT.md)
- Segurança backend/auth: [`docs/AI Context/Backend/Seguranca.md`](docs/AI%20Context/Backend/Seguranca.md)
- Guia completo de abas (estado, fluxos e impactos): [`docs/AI Context/Frontend/Tabs.md`](docs/AI%20Context/Frontend/Tabs.md)
- Navegação e interações cruzadas: [`docs/AI Context/Frontend/NavigationInteractions.md`](docs/AI%20Context/Frontend/NavigationInteractions.md)
- Auto-scroll e sincronização: [`docs/AI Context/Frontend/Autoscroll.md`](docs/AI%20Context/Frontend/Autoscroll.md)
- Estratégia e estado da suíte: [`docs/TESTING.md`](docs/TESTING.md)
- Roadmap: [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md)
