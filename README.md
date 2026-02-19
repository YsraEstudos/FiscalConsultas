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
```

Sem `VITE_CLERK_PUBLISHABLE_KEY`, o frontend exibe apenas a tela de erro de configuração.

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

Migrar schema:

```powershell
alembic upgrade head
```

Migrar dados SQLite para PostgreSQL:

```powershell
python scripts/migrate_to_postgres.py
```

## Performance NCM (estado atual)

Baseline local mais recente para `/api/search?ncm=8481.30.00` (10 de fevereiro de 2026):

- `first_load` (rota backend, processo já iniciado): ~`602ms` média
- `warm_hit` (cache payload): ~`2.8ms` média

Mudanças principais já aplicadas:

- renderer backend otimizado (pipeline unificado de transformações)
- resposta NESH em `markdown` agora com HTML puro (fallback markdown legado só no frontend)
- short-circuit de cache na rota `/api/search` com header `X-Payload-Cache: MISS|HIT`
- melhoria de responsividade em multi-busca no frontend (execução sequencial e render diferido em abas inativas)

## Configuração (env vars usadas)

| Variável | Uso |
| :--- | :--- |
| `DATABASE__ENGINE` | Seleciona engine (`sqlite` ou `postgresql`) |
| `DATABASE__POSTGRES_URL` | URL asyncpg usada quando engine = `postgresql` |
| `SERVER__ENV` | Comportamento de middleware/auth (`development` habilita fallbacks) |
| `AUTH__CLERK_DOMAIN` | Validação JWT via JWKS do Clerk |
| `BILLING__ASAAS_WEBHOOK_TOKEN` | Validação de token no webhook `/api/webhooks/asaas` |
| `SECURITY__AI_CHAT_REQUESTS_PER_MINUTE` | Rate limit do endpoint `/api/ai/chat` |
| `GOOGLE_API_KEY` | Habilita integração Gemini no serviço de IA |
| `VITE_CLERK_PUBLISHABLE_KEY` | Obrigatório para o frontend montar com Clerk |
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
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
