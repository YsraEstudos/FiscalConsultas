# Nesh / Fiscal - AI_CONTEXT

Atualizado em: 2026-02-07 (auditado contra o código atual do repositório)
Revisão desta atualização: alinhada ao README e à validação local de comandos (build/lint/test) em 2026-02-07.

## 1) Propósito do projeto

Nesh/Fiscal é um sistema de consulta fiscal com backend FastAPI e frontend React/Vite. Ele combina busca por código e texto nas Notas Explicativas do Sistema Harmonizado (NESH), consulta de alíquotas TIPI e recursos de interface (abas, smart-links, glossário e chat IA) para acelerar análise de classificação fiscal.

## 2) Estrutura do repositório (mapa rápido)

```text
backend/
  config/                settings, constantes e logging
  server/                app FastAPI, middleware, handlers
  presentation/routes/   endpoints HTTP
  services/              lógica de negócio (NESH, TIPI, IA)
  infrastructure/        adapters SQLite + engine SQLModel
  domain/                modelos (TypedDict e SQLModel)
  data/                  glossary_db.json

client/
  src/                   app React + hooks + contexts + serviços
  tests/                 testes de frontend (unit/integration/perf)
  package.json           scripts npm

scripts/
  setup_database.py      cria banco SQLite NESH (sem FTS)
  setup_fulltext.py      cria índice FTS SQLite (search_index)
  setup_tipi_database.py cria banco SQLite TIPI
  migrate_to_postgres.py migra dados SQLite -> PostgreSQL
  setup_postgres_rls.sql políticas RLS
  rotate_secrets.py      rotação de secrets no .env

migrations/
  versions/001-004       migrations Alembic para PostgreSQL

database/
  nesh.db                SQLite NESH
  tipi.db                SQLite TIPI

tests/                   suíte principal backend (pytest.ini aponta para aqui)
backend/tests/           suíte backend adicional (exige PYTHONPATH)
```

## 3) Source of truth de execução

- Entrypoint principal backend: `Nesh.py`
  - chama `uvicorn.run("backend.server.app:app", host="127.0.0.1", port=8000, reload=True)`
- App FastAPI real: `backend/server/app.py`
  - inclui routers com prefixos `/api`, `/api/tipi`, `/api/webhooks`
  - monta `client/dist` na raiz `/` quando build existe
- Frontend dev server: `client/package.json` script `dev` (`vite --port 5173 --strictPort --host`)

## 4) Como rodar localmente (comandos exatos)

### 4.1 Backend + Frontend (SQLite local)

1. Instalar dependências:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cd client
npm install
cd ..
```

2. Configurar env:

```powershell
Copy-Item .env.example .env
```

Ajustar `.env` para SQLite:

```env
DATABASE__ENGINE=sqlite
```

Criar `client/.env.local`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_sua_chave
```

3. Popular dados:

```powershell
python scripts/setup_tipi_database.py
$env:PYTHONUTF8="1"; python scripts/setup_database.py
$env:PYTHONUTF8="1"; python scripts/setup_fulltext.py
```

4. Subir app:

```powershell
python Nesh.py
```

Em outro terminal:

```powershell
cd client
npm run dev
```

5. Validar status:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status"
```

### 4.2 Modo PostgreSQL

1. Banco local (docker):

```powershell
docker compose up -d
```

2. `.env`:

```env
DATABASE__ENGINE=postgresql
DATABASE__POSTGRES_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/nesh_db
```

3. Criar schema:

```powershell
alembic upgrade head
```

4. Migrar dados do SQLite:

```powershell
python scripts/migrate_to_postgres.py
```

## 5) Testes, lint e build

Comandos válidos:

```powershell
pytest -q
$env:PYTHONPATH='.'; pytest -q backend/tests
cd client; npm run lint
cd client; npm run test
cd client; npm run build
```

Resultado observado em 2026-02-07:

- `pytest -q`: 2 falhas (`tests/integration/test_api_regression.py` para buscas textuais)
- `pytest -q backend/tests` sem `PYTHONPATH`: erro de import `ModuleNotFoundError: No module named 'backend'`
- `pytest -q backend/tests` com `PYTHONPATH='.'`: executa, com 2 falhas de asserção
- `npm run lint`: OK
- `npm run test`: falhas em testes que não montam providers obrigatórios (`ClerkProvider`, `SettingsProvider`, `CrossChapterNoteProvider`)
- `npm run build`: OK

## 6) Endpoints e contratos HTTP

Prefixos:

- `/api/*` (auth/search/system)
- `/api/tipi/*`
- `/api/webhooks/*`

Rotas mapeadas no código:

- `GET /api/search?ncm=...`
- `GET /api/chapters`
- `GET /api/nesh/chapter/{chapter}/notes`
- `GET /api/glossary?term=...`
- `GET /api/tipi/search?ncm=...&view_mode=family|chapter`
- `GET /api/tipi/chapters`
- `GET /api/status`
- `GET /api/debug/anchors` (somente com `features.debug_mode=true` e JWT válido)
- `GET /api/auth/me`
- `POST /api/ai/chat`
- `POST /api/admin/reload-secrets`
- `POST /api/webhooks/asaas`

Contratos importantes para o frontend:

- respostas de busca por código mantêm `results` e alias legado `resultados`
- TIPI usa `view_mode` com valores estritos `family` e `chapter`
- chat IA exige Bearer token Clerk válido e respeita `SECURITY__AI_CHAT_REQUESTS_PER_MINUTE`

## 7) Fontes de dados e inicialização

- NESH (SQLite): `database/nesh.db`
  - tabelas principais: `chapters`, `positions`, `chapter_notes`, `search_index` (FTS)
- TIPI (SQLite): `database/tipi.db`
  - tabelas: `tipi_chapters`, `tipi_positions`, `tipi_fts`
- Glossário: `backend/data/glossary_db.json`
- PostgreSQL (opcional): schema criado por Alembic (`migrations/versions/*.py`)

## 8) Variáveis de ambiente efetivamente usadas

- `DATABASE__ENGINE`
- `DATABASE__POSTGRES_URL`
- `SERVER__ENV`
- `AUTH__CLERK_DOMAIN`
- `BILLING__ASAAS_WEBHOOK_TOKEN`
- `SECURITY__AI_CHAT_REQUESTS_PER_MINUTE`
- `GOOGLE_API_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_URL`
- `VITE_API_FILTER_URL`

Observação:

- `BILLING__ASAAS_API_KEY` existe em `settings`, mas não é consumida diretamente nas rotas atuais.

## 9) Workflows comuns para manutenção

### 9.1 Adicionar endpoint

1. Criar handler em `backend/presentation/routes/<arquivo>.py`
2. Incluir router em `backend/server/app.py`
3. Se necessário, adicionar método em `backend/services/*`
4. Atualizar cliente em `client/src/services/api.ts` e tipos em `client/src/types/api.types.ts`

### 9.2 Alterar modelo SQLModel / banco PostgreSQL

1. Editar `backend/domain/sqlmodels.py`
2. Criar migration Alembic em `migrations/versions/`
3. Executar `alembic upgrade head`
4. Validar endpoint `/api/status`

### 9.3 Atualizar dados NESH/TIPI (SQLite)

- NESH:

```powershell
$env:PYTHONUTF8="1"; python scripts/setup_database.py
$env:PYTHONUTF8="1"; python scripts/setup_fulltext.py
```

- TIPI:

```powershell
python scripts/setup_tipi_database.py
```

### 9.4 Rotacionar secrets de admin

```powershell
python scripts/rotate_secrets.py
```

Depois, sem restart:

- `POST /api/admin/reload-secrets` com JWT Clerk válido

## 10) Regras para edição por IA (Do/Don't)

Do:

- manter compatibilidade de payload (`results` + `resultados`)
- preservar prefixos de rota (`/api`, `/api/tipi`, `/api/webhooks`)
- atualizar docs junto com mudanças em execução/build/teste
- preferir alterações localizadas em `services`/`routes` sem quebrar contratos do frontend

Don't:

- não remover aliases de resposta usados pelo frontend
- não mudar `view_mode` da TIPI sem atualizar backend, frontend e testes
- não editar manualmente `database/*.db` em vez de usar scripts
- não assumir que `backend/tests` roda com `pytest` puro (exige `PYTHONPATH='.'`)

## 11) Gotchas conhecidos

- `client/src/main.tsx` exige `VITE_CLERK_PUBLISHABLE_KEY`; sem isso a UI principal não monta.
- `npm run dev` usa `--strictPort`; se 5173 estiver ocupada, o comando falha.
- scripts Python com emojis podem quebrar em Windows CP1252 (`UnicodeEncodeError`); usar `PYTHONUTF8=1`.
- `setup_database.py` pode falhar ao remover `database/nesh.db` se o arquivo estiver em uso.
- em modo PostgreSQL, se dados não forem migrados, buscas textuais podem retornar zero resultados.

## 12) Troubleshooting rápido

### Erro: `Port 5173 is already in use`

- libere a porta 5173 ou encerre o processo Vite em execução.

### Erro: `UnicodeEncodeError` em scripts de setup

```powershell
$env:PYTHONUTF8="1"
```

Execute o script novamente no mesmo terminal.

### Erro: `ModuleNotFoundError: No module named 'backend'` ao rodar `backend/tests`

```powershell
$env:PYTHONPATH='.'; pytest -q backend/tests
```

### `/api/status` com `database.chapters = 0` em modo PostgreSQL

- rode `alembic upgrade head`
- rode `python scripts/migrate_to_postgres.py`

### `POST /api/ai/chat` retorna 401

- validar Bearer token Clerk
- conferir `AUTH__CLERK_DOMAIN`
- em produção, sem domínio Clerk configurado, o token não é validado

## 13) Itens Unknown

- Processo oficial de deploy em produção (além de `npm run build` + execução do backend): **Unknown**
- Pipeline CI/CD versionado em `.github/workflows`: **Unknown** (diretório não existe neste snapshot)
