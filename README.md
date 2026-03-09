# Nesh / Fiscal

Sistema híbrido de consulta fiscal (NESH + TIPI) com backend FastAPI e frontend React/Vite.

## O que é

- Busca por código e texto nas Notas Explicativas do Sistema Harmonizado (NESH).
- Busca na TIPI com visualização por família (`family`) ou capítulo (`chapter`).
- Frontend com navegação por abas, smart-links e recursos de produtividade (glossário, notas, chat IA).

## Requisitos

- Python 3.13+ (alinhado com `pyproject.toml`)
- Node.js 18+ (validado localmente com Node 22.17.0)
- npm (validado localmente com npm 10.9.2)
- Opcional para modo PostgreSQL: Docker + Docker Compose

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

Configuração mínima para desenvolvimento local com SQLite:

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
$env:PYTHONUTF8="1"; python scripts/setup_database.py
$env:PYTHONUTF8="1"; python scripts/setup_fulltext.py
```

Observações:

- `setup_database.py` cria `database/nesh.db` (capítulos/posições), mas **não** cria FTS.
- `setup_fulltext.py` cria `search_index` (FTS) em `database/nesh.db`.
- Em Windows com encoding CP1252, scripts com emoji podem falhar; `PYTHONUTF8=1` evita o erro.

### 4) Subir aplicação

Terminal 1 (backend):

```powershell
python Nesh.py
```

Terminal 2 (frontend):

```powershell
cd client
npm run dev
```

Acesse `http://127.0.0.1:5173`.

Alternativa com script único (Windows):

```powershell
.\start_nesh_dev.bat
```

Para diagnóstico de autenticação Clerk no frontend:

```powershell
.\start_nesh_dev.bat --auth-debug
```

O script faz preflight, executa `docker compose up -d` automaticamente, espera os serviços (`db`, `redis`, `pgadmin`) e bloqueia startup se faltarem variáveis obrigatórias de auth em `.env` (`AUTH__CLERK_DOMAIN`, `AUTH__CLERK_ISSUER`, `AUTH__CLERK_AUDIENCE`, `AUTH__CLERK_AUTHORIZED_PARTIES`, `AUTH__CLERK_CLOCK_SKEW_SECONDS`) ou em `client/.env.local` (`VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_TOKEN_TEMPLATE`). Em caso de falha, exibe checklist com ações manuais.

Healthcheck backend:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status"
```

Resposta esperada: JSON com `status`, `database` e `tipi`.

## Workflow de desenvolvimento

### Comandos principais

| Ação | Comando |
| :--- | :--- |
| Backend tests (suite principal) | `.\.venv\Scripts\python -m pytest -q` |
| Frontend lint | `cd client && npm run lint` |
| Frontend tests | `cd client && npm run test` |
| Frontend tests (todos, inclui perf) | `cd client && npm run test:all` |
| Frontend cobertura | `cd client && npm run test:coverage` |
| Backend cobertura | `.\.venv\Scripts\python -m pytest -q --cov=backend --cov-report=term-missing` |
| Frontend build | `cd client && npm run build` |

Status observado em **2026-02-07**:

- `pytest -q`: OK (suite padrão exclui `perf` e `snapshot`)
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
| `AUTH__CLERK_DOMAIN` | Validação JWT via JWKS do Clerk |
| `AUTH__CLERK_ISSUER` | Valida `iss` explicitamente (`https://<seu-dominio-clerk>`) |
| `AUTH__CLERK_AUDIENCE` | Valida `aud` no backend (ex: `fiscal-api`) |
| `AUTH__CLERK_AUTHORIZED_PARTIES` | Valida `azp` (lista JSON; ex: `localhost` e `127.0.0.1`) |
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

Suporte confirmado no repositório:

- Build de frontend: `cd client && npm run build`
- Backend serve `client/dist` automaticamente quando a pasta existe.

Não há script dedicado de deploy/orquestração além de `docker-compose.yml` para banco local de desenvolvimento.

## Documentação para IA e manutenção

- Contexto técnico principal: [`docs/AI Context/AI_CONTEXT.md`](docs/AI%20Context/AI_CONTEXT.md)
- Segurança backend/auth: [`docs/AI Context/Backend/Seguranca.md`](docs/AI%20Context/Backend/Seguranca.md)
- Guia completo de abas (estado, fluxos e impactos): [`docs/AI Context/Frontend/Tabs.md`](docs/AI%20Context/Frontend/Tabs.md)
- Navegação e interações cruzadas: [`docs/AI Context/Frontend/NavigationInteractions.md`](docs/AI%20Context/Frontend/NavigationInteractions.md)
- Auto-scroll e sincronização: [`docs/AI Context/Frontend/Autoscroll.md`](docs/AI%20Context/Frontend/Autoscroll.md)
- Estratégia e estado da suíte: [`docs/TESTING.md`](docs/TESTING.md)
- Roadmap: [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md)
