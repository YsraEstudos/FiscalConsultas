# Nesh / Fiscal

Sistema de consulta fiscal offline-first com frontend React/Vite. As pesquisas em `NESH`, `TIPI`, `NBS` e `UNSPSC` rodam localmente no navegador depois que o usuário baixa as bases fiscais.

## O que é

- Busca por código e texto nas Notas Explicativas do Sistema Harmonizado (NESH).
- Busca na TIPI com visualização por família (`family`) ou capítulo (`chapter`).
- Busca em `NBS` e, na arquitetura planejada, `UNSPSC`, com bases baixáveis separadas.
- Frontend com navegação por abas, smart-links e recursos de produtividade (glossário, notas, chat IA).
- Instalação offline em um botão: o app shell é cacheado e as bases locais ficam disponíveis no navegador após a instalação.

## Direção de arquitetura

Este projeto passará a seguir uma arquitetura offline-first para as consultas fiscais.

As pesquisas em NESH, TIPI, NBS e UNSPSC não dependerão mais de backend online. As bases fiscais serão disponibilizadas como pacotes baixáveis e consultadas localmente no navegador do usuário, reduzindo custo de infraestrutura, eliminando limites de requisição e melhorando a velocidade das buscas.

O backend online deixará de ser responsável por pesquisas fiscais. Recursos como comentários, favoritos, perfil e preferências de usuário serão planejados para uma etapa futura, usando Cloudflare Workers + Cloudflare D1, com autenticação via Clerk.

### Divisão planejada

- Frontend estático: Cloudflare Pages.
- Bases fiscais baixáveis: Cloudflare R2.
- Busca fiscal: execução local no navegador.
- Login: Clerk.
- Dados de usuário futuros: Cloudflare Workers + Cloudflare D1.

### Bases fiscais no R2

As bases serão separadas por fonte, evitando um único banco monolítico:

```text
Cloudflare R2
├── nesh/
│   ├── nesh.meta.json
│   └── nesh.enc
├── tipi/
│   ├── tipi.meta.json
│   └── tipi.enc
├── nbs/
│   ├── nbs.meta.json
│   └── nbs.enc
└── unspsc/
    ├── unspsc.meta.json
    └── unspsc.enc
```

Cada base poderá ter seu próprio arquivo de dados e metadata de versão, permitindo download e atualização independentes.

### Recursos futuros

Os seguintes recursos ficam previstos para fases futuras:

- comentários de usuários;
- favoritos;
- perfil de usuário;
- preferências de usuário.

Esses recursos não fazem parte da migração inicial. A prioridade inicial é remover a dependência do backend online para busca fiscal.

### Segurança da arquitetura

O threat model da migração offline-first está em [`docs/security/OFFLINE_FIRST_THREAT_MODEL.md`](docs/security/OFFLINE_FIRST_THREAT_MODEL.md). A regra principal é que os bundles fiscais devem conter apenas dados públicos, com verificação de metadata/hash no navegador, e que dados de usuário futuros fiquem isolados em Clerk + Workers + D1.

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

Configuração recomendada para a migração offline-first:

- em `.env` ou no ambiente de build que gera os pacotes fiscais, configure a semente pública de empacotamento:

```env
OFFLINE_DB_APP_SEED=change_me_32_byte_hex
```

- em `client/.env.local`, defina a origem pública dos pacotes R2 e a mesma semente pública usada no build:

```env
VITE_FISCAL_R2_BASE_URL=https://seu-bucket-publico.r2.dev
VITE_OFFLINE_DB_PUBLIC_SEED=change_me_32_byte_hex
VITE_CLERK_PUBLISHABLE_KEY=pk_live_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
```

Durante a migração inicial, `VITE_API_URL` não deve ser necessário para pesquisa fiscal. O frontend pode ser publicado como site estático em Cloudflare Pages e baixar diretamente os pacotes públicos do R2.

Configuração legada de backend FastAPI:

O backend FastAPI, Render, Neon/Postgres e Redis/Upstash não devem mais ser usados para NESH, TIPI, NBS ou UNSPSC. Se ainda forem mantidos localmente, trate-os como compatibilidade temporária ou apoio a scripts administrativos, não como caminho de busca fiscal do produto.

Para comentários autenticados, favoritos, perfil e preferências, a direção futura é:

```env
Clerk -> Cloudflare Worker -> Cloudflare D1
```

Esses recursos ainda não fazem parte da migração inicial.

Sem `VITE_CLERK_PUBLISHABLE_KEY`, o frontend exibe apenas a tela de erro de configuração.

Checklist Clerk para a fase futura de conta:

- Criar template JWT `backend_api` com `aud = "fiscal-api"`.
- Validar o token no Cloudflare Worker usando JWKS do Clerk.
- Persistir somente dados de usuário no D1: comentários, favoritos, perfil e preferências.
- Não recolocar NESH, TIPI, NBS ou UNSPSC no Worker, no D1, no Neon ou em qualquer backend online de busca.

### 3) Preparar dados locais (SQLite)

```powershell
python scripts/setup_tipi_database.py
uv run scripts/rebuild_index.py
python scripts/setup_nbs_database.py
python scripts/setup_nebs_database.py
```

Observações:

- `rebuild_index.py` (Fase 5) é o script consolidado: cria `database/nesh.db`, extrai seções e reconstrói o índice FTS com Stemming.
- `setup_nbs_database.py` e `setup_nebs_database.py` alimentam `database/services.db`, usado por `NBS` e `NEBS`.
- A fonte canônica da NBS neste repositório é `data/nbs.csv`; sempre execute `setup_nbs_database.py` antes de `setup_nebs_database.py` após qualquer correção na NBS.
- A NEBS pública não representa o PDF integral: o site exibe somente notas explicativas confiáveis (`trusted`) vinculadas a códigos existentes na NBS carregada.
- Blocos NEBS suspeitos ou rejeitados permanecem fora da consulta pública e são registrados em `reports/nebs/` para auditoria e reavaliação posterior.
- Em Windows com encoding CP1252, scripts com emoji podem falhar; usar `PYTHONUTF8=1` (o `uv run` geralmente lida bem com isso, mas o script `.bat` já automatiza essa configuração).

### 4) Subir aplicação

Fluxo recomendado para teste local da migração offline-first: frontend estático com
bundles fiscais servidos por uma URL compatível com R2. A busca de NESH, TIPI,
NBS e UNSPSC deve acontecer no navegador, depois da instalação local das bases.

O backend FastAPI só deve ser iniciado quando você estiver validando rotas
legadas ou recursos não fiscais.

Comando único (Windows):

```powershell
.\testar_tudo_local.bat
```

Esse script é legado para desenvolvimento full-stack e:

- sobe o backend FastAPI na porta `8000`
- sobe o frontend Vite na porta `5173`
- cria `client/.env.development.local` apontando o frontend para a API local
- abre o navegador quando os dois serviços estão prontos

Ele não representa o caminho de produção da pesquisa fiscal offline-first.

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

O backend FastAPI não é mais necessário para pesquisa fiscal. Se ele for iniciado localmente para compatibilidade ou manutenção, o healthcheck de sistema permanece em `/api/status`, mas as rotas fiscais online devem estar aposentadas.

### 5) Gerar os pacotes fiscais para R2

Depois de preparar os bancos locais (`nesh.db`, `tipi.db`, `services.db` e, quando disponível, `unspsc.db`), gere os pacotes distribuíveis por fonte:

```powershell
python scripts/build_r2_fiscal_bundles.py
```

Arquivos gerados:

- `database/r2-fiscal-bundles/nesh/nesh.enc`
- `database/r2-fiscal-bundles/nesh/nesh.meta.json`
- `database/r2-fiscal-bundles/tipi/tipi.enc`
- `database/r2-fiscal-bundles/tipi/tipi.meta.json`
- `database/r2-fiscal-bundles/nbs/nbs.enc`
- `database/r2-fiscal-bundles/nbs/nbs.meta.json`
- `database/r2-fiscal-bundles/unspsc/unspsc.enc`
- `database/r2-fiscal-bundles/unspsc/unspsc.meta.json`

Esses arquivos devem ser publicados no Cloudflare R2 mantendo a mesma estrutura de pastas.

Contrato publico do banco offline:

- Os pacotes fiscais no R2 são considerados públicos. Eles podem ser baixados sem login pelo navegador.
- A criptografia do pacote offline protege integridade/formato de distribuicao, mas nao deve ser tratada como controle de acesso a dados sigilosos. Nao incluir informacao privada, segredos, dados de usuarios ou conteudo restrito dentro do bundle offline.
- NESH, TIPI, NBS e UNSPSC devem ser baixados, versionados e atualizados de forma independente.
- O conteudo NEBS associado a NBS faz parte do contrato do catalogo offline e online. A NEBS esta embutida nas notas explicativas da NBS e isso deve se manter assim: a descricao/entrada explicativa NEBS vinculada ao item NBS deve permanecer no banco, no bundle offline e no detalhe da NBS; nao remover `has_nebs`, `nebs_entries` nem o payload `detail.nebs` sem substituir o fluxo por equivalente compativel.

Comportamento esperado do fluxo:

- o frontend consulta os arquivos `*.meta.json` no R2
- baixa somente os pacotes `*.enc` necessários
- verifica hash/metadata de cada fonte
- grava cada base em OPFS
- inicializa o worker local
- aquece o cache do app shell via `client/public/coi-serviceworker.js`

Depois da instalação concluída, as buscas e detalhes de `NESH`, `TIPI`, `NBS` e `UNSPSC` passam a funcionar localmente no navegador, inclusive após recarregar a página sem rede, desde que o navegador suporte `SharedArrayBuffer` e OPFS.

O que continua online por natureza, como autenticação e dados de usuário futuros, entra em modo degradado quando não há rede, sem quebrar a navegação base.

### 6) Validar o modo offline no localhost

O modo offline tambem deve funcionar em `http://127.0.0.1:5173/` durante o desenvolvimento local.

Fluxo recomendado:

1. gere ou atualize os pacotes em `database/r2-fiscal-bundles/`
2. rode `.\testar_tudo_local.bat`
3. abra o frontend em `http://127.0.0.1:5173/`
4. clique em `Baixar` no instalador offline
5. espere o estado mudar para `Pronto`
6. desligue a rede, recarregue e valide as buscas locais

Importante:

- configure `VITE_FISCAL_R2_BASE_URL`; em desenvolvimento, o padrão é `/fiscal-bases`
- para testar sem R2 real, sirva a pasta de bundles no mesmo formato público esperado pelo frontend
- o script `testar_tudo_local.bat` ja cria `client/.env.development.local` apontando para a API local
- o backend local não deve ser necessário para NESH, TIPI, NBS ou UNSPSC

### 7) Diagnostico rapido do instalador offline

Se o botao de instalacao mostrar erro:

- `404` em `*.meta.json` ou `*.enc`: a estrutura no R2 ou no servidor estático local não corresponde ao contrato `fonte/fonte.meta.json` e `fonte/fonte.enc`
- `Offline database not available`: faltam pacotes fiscais baixáveis ou a variável `VITE_OFFLINE_DB_PUBLIC_SEED`
- navegador sem suporte: o instalador entra em `unsupported` quando faltar `SharedArrayBuffer`, `Worker`, `crypto.subtle` ou OPFS
- detalhe de `NBS` sem rede: confirme que a instalação da base NBS terminou em `ready`

## Deploy no Cloudflare

O caminho mais simples para este repositório é:

1. publicar o frontend em **Cloudflare Pages**
2. publicar as bases fiscais em **Cloudflare R2**
3. manter busca fiscal local no navegador
4. planejar dados de usuário futuros em **Cloudflare Workers + Cloudflare D1**

O backend FastAPI/Render não faz parte do caminho de pesquisa fiscal da arquitetura offline-first.

### Frontend no Pages

- `Framework preset`: `Vite`
- `Build command`: `npm run build`
- `Build output directory`: `dist`
- `Root directory`: `client`

Depois do deploy, ajuste `client/.env.local` ou as variáveis do projeto no Pages com:

```env
VITE_FISCAL_R2_BASE_URL=https://seu-bucket-publico.r2.dev
VITE_OFFLINE_DB_PUBLIC_SEED=change_me_32_byte_hex
VITE_CLERK_PUBLISHABLE_KEY=pk_live_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
```

Depois de trocar variáveis no Cloudflare Pages, faça um novo deploy e recarregue o site com `Ctrl + F5`.

Para previews do Cloudflare Pages, garanta que o bucket R2 público permita leitura a partir do domínio de preview ou use um domínio público estável para os pacotes fiscais.

### Bases no R2

Publique a saída de `scripts/build_r2_fiscal_bundles.py` no bucket R2:

```text
nesh/nesh.meta.json
nesh/nesh.enc
tipi/tipi.meta.json
tipi/tipi.enc
nbs/nbs.meta.json
nbs/nbs.enc
unspsc/unspsc.meta.json
unspsc/unspsc.enc
```

Não publique segredos, dados de usuários ou tokens dentro desses bundles.

### Rotas do React

O arquivo `client/public/_redirects` já garante fallback para SPA no Cloudflare Pages, então rotas internas como `/`, `/perfil` ou abas profundas não quebram ao atualizar a página.

## Deploy no GitHub Pages

Também é possível publicar o frontend estático no GitHub Pages em:

- `https://ysraestudos.github.io/FiscalConsultas/`

Requisitos e checklist:

1. Em `Settings > Pages`, deixe `Source = GitHub Actions`.
2. Cadastre `Settings > Secrets and variables > Actions > Variables > VITE_CLERK_PUBLISHABLE_KEY` com uma chave `pk_live_...` (ou `pk_test_...` para desenvolvimento). Sem isso, o workflow falhará.
3. Cadastre `VITE_FISCAL_R2_BASE_URL` e `VITE_OFFLINE_DB_PUBLIC_SEED` como variáveis do workflow.
4. Configure CORS no R2 para permitir `https://ysraestudos.github.io`.
5. Execute o workflow `Deploy GitHub Pages` na aba `Actions`.

Observações operacionais:

- O deploy usa o path-base `/FiscalConsultas/` por ser um **project site**.
- O workflow gera fallback SPA (`404.html`) para recarregamentos em rotas internas.
- O build do frontend baixa bases fiscais de `VITE_FISCAL_R2_BASE_URL`; ele não deve apontar para Render para pesquisa fiscal.

### Ajuste no R2

Se o frontend estiver no GitHub Pages, o R2 deve autorizar o host:

```http
Access-Control-Allow-Origin: https://ysraestudos.github.io
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Deploy no Render (legado)

Render, Neon/Postgres e Upstash/Redis eram a arquitetura anterior para backend online de consulta. Essa rota fica documentada apenas como histórico operacional e não deve ser usada para NESH, TIPI, NBS ou UNSPSC na arquitetura offline-first.

Para a migração atual, use:

- Cloudflare Pages para o frontend estático;
- Cloudflare R2 para os pacotes fiscais;
- busca local no navegador;
- Clerk, Cloudflare Workers e D1 apenas em fase futura para dados de usuário.

Se por compatibilidade temporária você ainda precisar manter `Render + Neon + Upstash`, o caminho legado era:

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
CACHE__REDIS_URL=rediss://default:<password>@<host>:6379
```

Se você ainda não provisionou Redis nesse ambiente, defina `CACHE__ENABLE_REDIS=false`
no Render. Sem esse override, o backend pode cair no fallback local
`redis://localhost:6379/0` e registrar warning no startup.
Se estiver usando Upstash, copie a Redis URL do painel e nao a REST URL/token.

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
GOOGLE_API_KEY=
LOGGING__LEVEL=INFO
LOGGING__REDACT_SENSITIVE_DATA=true
OBSERVABILITY__METRICS_TOKEN=troque-por-um-token-forte
OBSERVABILITY__SENTRY_DSN=
OBSERVABILITY__SENTRY_ENVIRONMENT=production
OBSERVABILITY__SENTRY_TRACES_SAMPLE_RATE=0.0
```

Se você usar previews do Cloudflare Pages, essas duas variáveis com regex evitam dor de cabeça com subdomínios temporários.
Se não quiser habilitar IA nesse ambiente, pode deixar `GOOGLE_API_KEY` ausente; o backend
sobe normalmente e apenas os recursos de chat IA ficam desativados.
Se o frontend estiver no GitHub Pages, inclua `https://ysraestudos.github.io` em
`AUTH__CLERK_AUTHORIZED_PARTIES` e `SERVER__CORS_ALLOWED_ORIGINS`.

### 4) Frontend legado

Se esse backend legado continuar existindo por compatibilidade, não use a URL dele para busca fiscal. O frontend publicado deve apontar para R2:

```env
VITE_FISCAL_R2_BASE_URL=https://seu-bucket-publico.r2.dev
VITE_OFFLINE_DB_PUBLIC_SEED=change_me_32_byte_hex
VITE_CLERK_PUBLISHABLE_KEY=pk_live_sua_chave
VITE_CLERK_TOKEN_TEMPLATE=backend_api
```

Se você ainda estiver usando a chave de desenvolvimento do Clerk no site publicado, o Clerk vai mostrar aviso no console. Para produção, troque pela chave live.

Se o frontend estiver no GitHub Pages, a URL final do project site deste repositorio e:

- `https://ysraestudos.github.io/FiscalConsultas/`

### Diagnóstico rápido no Render

- `Frontend build not found at /app/client/dist`: esperado quando o frontend está hospedado separadamente (por exemplo, no Cloudflare Pages ou GitHub Pages).
- `GOOGLE_API_KEY not found. AI features disabled.`: esperado quando IA não está habilitada nesse ambiente.
- `Redis connect failed ... localhost:6379`: indica `CACHE__ENABLE_REDIS=true` sem Redis externo configurado. Corrija `CACHE__REDIS_URL` ou desligue Redis explicitamente.
- `Redis connect failed: invalid username-password pair`: a app chegou ao Redis, mas a `CACHE__REDIS_URL` está no formato errado ou com credencial incorreta. Em Upstash, use a Redis URL TLS (`rediss://default:<password>@<host>:6379`), não a REST URL/token.
- `404` ou CORS em `*.meta.json`: revise o domínio público/CORS do R2 e a variável `VITE_FISCAL_R2_BASE_URL`.

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
- A UI opcional restrita agora consome capacidades vindas de `/api/auth/me`; a allowlist fica no backend, não mais no bundle público.

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

## Performance NCM (legado)

Os números abaixo são histórico do caminho antigo por API. A meta da arquitetura offline-first é medir a busca local no Worker/browser, não `/api/search`.

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
| `DATABASE__ENGINE` | Legado/futuro backend de conta; não usado pela busca fiscal offline-first |
| `DATABASE__POSTGRES_URL` | Legado/futuro backend de conta; não usado pela busca fiscal offline-first |
| `SERVER__ENV` | Comportamento de middleware/auth (`development` habilita fallbacks) |
| `SERVER__CORS_ALLOWED_ORIGINS` | Lista JSON de origens permitidas para CORS (produção deve conter apenas domínios oficiais) |
| `SERVER__CORS_ALLOWED_ORIGIN_REGEX` | Regex opcional para liberar previews controlados (ex.: subdomínios do Cloudflare Pages) |
| `CACHE__ENABLE_REDIS` | Legado/futuro backend de conta; não usado pela busca fiscal offline-first |
| `CACHE__REDIS_URL` | URL do Redis, se algum backend legado/futuro realmente usar cache |
| `AUTH__CLERK_DOMAIN` | Validação JWT via JWKS do Clerk |
| `AUTH__CLERK_ISSUER` | Valida `iss` explicitamente (`https://<seu-dominio-clerk>`) |
| `AUTH__CLERK_AUDIENCE` | Valida `aud` no backend (ex: `fiscal-api`) |
| `AUTH__CLERK_AUTHORIZED_PARTIES` | Valida `azp` (lista JSON; ex: `localhost` e `127.0.0.1`) |
| `AUTH__CLERK_AUTHORIZED_PARTIES_REGEX` | Regex opcional para aceitar `azp` de previews controlados |
| `AUTH__CLERK_CLOCK_SKEW_SECONDS` | Tolerância de clock para `exp/iat/nbf` (recomendado `120` em dev local) |
| `BILLING__ASAAS_WEBHOOK_TOKEN` | Validação de token no webhook `/api/webhooks/asaas` |
| `SECURITY__AI_CHAT_REQUESTS_PER_MINUTE` | Rate limit do endpoint `/api/ai/chat` |
| `SECURITY__AI_CHAT_ALLOWED_EMAILS` | Allowlist real do backend para habilitar `/api/ai/chat` |
| `SECURITY__RESTRICTED_UI_ALLOWED_EMAILS` | Allowlist opcional para UI restrita; se omitida, herda a do chat IA |
| `GOOGLE_API_KEY` | Habilita integração Gemini no serviço de IA |
| `VITE_CLERK_PUBLISHABLE_KEY` | Obrigatório para o frontend montar com Clerk |
| `VITE_CLERK_TOKEN_TEMPLATE` | Template usado no `getToken()` do Clerk (recomendado: `backend_api`) |
| `VITE_AUTH_DEBUG` | (Opcional) habilita logs de diagnóstico JWT no navegador |
| `VITE_FISCAL_R2_BASE_URL` | Base URL pública dos bundles fiscais no R2 |
| `VITE_OFFLINE_DB_PUBLIC_SEED` | Semente pública usada para abrir os bundles fiscais no navegador |

## Estrutura do projeto

```text
backend/         API FastAPI, serviços, repositórios e config
client/          React + Vite + TypeScript
scripts/         Setup de dados, migração e utilitários
database/        SQLite local + bundles R2 (nesh.db, tipi.db, services.db, r2-fiscal-bundles/)
migrations/      Alembic migrations (PostgreSQL)
tests/           Suite principal do backend
docs/            Documentação funcional/técnica
```

## Deploy/produção

Fluxo operacional atual (offline-first):

- Frontend: Cloudflare Pages ou outro host estático
- Bases fiscais: Cloudflare R2
- Busca fiscal: local no navegador
- Login: Clerk
- Dados de usuário futuros: Cloudflare Workers + D1

Suporte técnico confirmado no repositório:

- Build de frontend: `cd client && npm run build`
- Geração de bundles R2: `python scripts/build_r2_fiscal_bundles.py`

Checklist mínimo para produção:

1. Publicar `client` no Cloudflare Pages.
2. Publicar bundles por fonte no R2.
3. Configurar `VITE_FISCAL_R2_BASE_URL` e `VITE_OFFLINE_DB_PUBLIC_SEED`.
4. Configurar CORS mínimo no R2 para o domínio do frontend.
5. Configurar Clerk publishable key no frontend.
6. Validar download, hash e instalação local das bases.
7. Validar busca sem backend fiscal online.

Hardening operacional já aplicado no backend:

- `Content-Security-Policy` agora é dinâmica por ambiente: em produção ela não anuncia origens locais (`localhost`, `127.0.0.1`, `ws://` locais).
- O logger do backend agora evita duplicação de handlers e redige dados sensíveis comuns (`Authorization`, tokens, segredos, senhas, chaves).
- O startup em produção passa a registrar warnings explícitos quando encontra sinais de configuração fraca, como `debug_mode` ligado, `CORS` com loopback, Redis em `localhost` ou banco ainda em SQLite.
- O backend já expõe `GET /api/metrics` em formato Prometheus, mas só responde quando `OBSERVABILITY__METRICS_TOKEN` estiver configurado e enviado no header.
- A inicialização de Sentry é opcional e segura por fallback: se `OBSERVABILITY__SENTRY_DSN` existir sem `sentry-sdk`, o backend apenas registra warning e segue operando.

Exemplos de origem real do frontend:

- Cloudflare Pages: `https://fiscalconsultas.pages.dev`
- GitHub Pages (project site): `https://ysraestudos.github.io`

## Documentação para IA e manutenção

- Contexto técnico principal: [`docs/AI Context/AI_CONTEXT.md`](docs/AI%20Context/AI_CONTEXT.md)
- Segurança backend/auth: [`docs/AI Context/Backend/Seguranca.md`](docs/AI%20Context/Backend/Seguranca.md)
- Guia completo de abas (estado, fluxos e impactos): [`docs/AI Context/Frontend/Tabs.md`](docs/AI%20Context/Frontend/Tabs.md)
- Navegação e interações cruzadas: [`docs/AI Context/Frontend/NavigationInteractions.md`](docs/AI%20Context/Frontend/NavigationInteractions.md)
- Auto-scroll e sincronização: [`docs/AI Context/Frontend/Autoscroll.md`](docs/AI%20Context/Frontend/Autoscroll.md)
- Estratégia e estado da suíte: [`docs/TESTING.md`](docs/TESTING.md)
- Roadmap: [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md)
