# Arquitetura de Backend (estado real 2026-02-17)

Este documento descreve a arquitetura **como ela existe hoje no codigo**, incluindo caminhos legados e novos.

## 1) Visao Geral

O backend e FastAPI com orientacao modular, mas em estado de transicao:

- caminho legado SQLite (`DatabaseAdapter`)
- caminho SQLAlchemy/SQLModel repository (`db_engine` + repositories)

Em varios pontos os dois coexistem no mesmo servico.

## 2) Componentes Estruturais

| Camada | Modulos | Responsabilidade atual |
|---|---|---|
| Entry/Lifecycle | `Nesh.py`, `backend/server/app.py` | Boot, middlewares, DI por `app.state`, startup/shutdown |
| Routes | `backend/presentation/routes/*` | contrato HTTP, validacao de entrada, cache de payload, headers |
| Services | `backend/services/nesh_service.py`, `backend/services/tipi_service.py`, `backend/services/ai_service.py` | logica de negocio, normalizacao, ranking, cache L1 |
| Infra | `backend/infrastructure/database.py`, `backend/infrastructure/db_engine.py`, `backend/infrastructure/repositories/*`, `backend/infrastructure/redis_client.py` | acesso a dados, session, tenant context, cache L2 |
| Domain | `backend/domain/models.py`, `backend/domain/sqlmodels.py` | contratos legados TypedDict + ORM/response SQLModel |

## 3) Startup / Shutdown

Fonte: `backend/server/app.py`.

No startup:

1. Seleciona modo de banco (`settings.database.is_postgres`).
2. Se SQLite:
   - cria `DatabaseAdapter` em `app.state.db`.
3. Inicializa SQLModel engine (quando aplicavel).
4. Inicializa services:
   - NESH: repository mode em Postgres, legado em SQLite.
   - TIPI: repository mode apenas se `tipi_positions` no Postgres tiver dados; caso contrario fallback para SQLite `tipi.db`.
5. Conecta Redis se habilitado e faz prewarm de capitulo no NESH.
6. Carrega glossario.
7. Executa `verify_frontend_build` para validar `client/dist` quando aplicavel.

No shutdown:

- fecha pool do adapter SQLite (se usado)
- fecha Redis
- fecha SQLModel engine

## 4) Fluxos de Busca

### 4.1 NESH por codigo

Entrada: `GET /api/search?ncm=...`

- Rota aplica validacao simples, headers (`ETag`, `Vary`) e cache de payload (raw + gzip).
- Para query de codigo, tenta short-circuit em payload cache antes de chamar service.
- `NeshService.search_by_code`:
  - split de query multi-codigo
  - resolve capitulo/posicao-alvo
  - carrega capitulo via cache + repo/adapter
  - enriquece `anchor_id` quando ausente
- Rota pre-renderiza HTML (`HtmlRenderer.render_full_response`) e remove `conteudo` bruto.

### 4.2 NESH por texto

`NeshService.search_full_text` aplica ranking por tiers:

1. frase exata
2. AND
3. OR

No caminho legado SQLite pode aplicar bonus NEAR.

### 4.3 TIPI por codigo

Entrada: `GET /api/tipi/search?ncm=...&view_mode=family|chapter`

- `TipiService.search_by_code` suporta:
  - `chapter`: capitulo completo
  - `family`: prefixo + ancestrais
- Mantem `results` e alias `resultados`.

### 4.4 TIPI por texto

`TipiService.search_text` retorna lista textual e a rota garante defaults de contrato (`normalized`, `warning`, `match_type`).

## 5) Acesso a Dados: Modo Hibrido

### 5.1 Legado SQLite

- `DatabaseAdapter` com pool `aiosqlite`.
- introspecao dinamica de schema FTS e colunas (cache com assinatura do DB).
- queries SQL manuais para chapters/positions/FTS.

### 5.2 SQLModel/Repository

- `db_engine.get_session()` com `AsyncSession`.
- repositories (`ChapterRepository`, `TipiRepository`, etc.) com SQLAlchemy.
- em Postgres, injeta `app.current_tenant` por `set_config` para RLS.
- observacao: `TipiService.check_connection()` ainda verifica existencia de `tipi.db`, mesmo quando o service opera em modo repository.

## 6) Cache: 4 Camadas

1. **Service L1 in-memory**
   - NESH: chapter cache + fts cache
   - TIPI: chapter positions cache + code result cache
2. **Redis L2 opcional**
   - chapters e fts do NESH
3. **Payload cache de rota**
   - `/api/search` e `/api/tipi/search`
   - guarda bytes raw + gzip
4. **Frontend cache (`api.ts`)**
   - memoria + localStorage + dedup in-flight

## 7) Multi-Tenant e Segurança no fluxo HTTP

Fonte: `backend/server/middleware.py`, `backend/utils/auth.py`.

- `TenantMiddleware` intercepta `/api/*`.
- Rotas publicas sao whitelist por path.
- Extrai JWT Bearer, valida via Clerk JWKS em producao.
- Define `tenant_context` para o restante da request.
- Provisioning de tenant/user e best-effort via `asyncio.create_task`.

## 8) Erros e Contrato de Falha

Fonte: `backend/server/error_handlers.py`.

- `NeshError` -> JSON padrao com `success=false`, `error.code`, `error.message`, `error.details`.
- erro generico -> `INTERNAL_ERROR` com status 500.

## 9) Renderizacao e Contrato com Frontend

- NESH: render principal no backend (`HtmlRenderer`) injetado em `markdown`.
- TIPI: hoje o fluxo principal de tela usa render fallback no frontend quando `markdown` nao vem.
- contrato de IDs de anchor depende de `generate_anchor_id` (backend) e `generateAnchorId` (frontend).

## 10) Hotspots Arquiteturais (prioridade)

P0:

1. Dominio duplicado (`TypedDict` x SQLModel response).
2. Parser/regex fragmentado em runtime + scripts.
3. Servicos com bifurcacao legado/repository no mesmo modulo.

P1:

4. Duplicacao de payload-cache entre rotas search/tipi.
5. Renderer NESH muito concentrado (limpeza + estrutura + links + highlights + fallback IDs).
6. Endpoint `/api/debug/anchors` chama `service.process_request()` e tenta ler `markdown`, mas render principal e feito na rota `/api/search`.

P2:

7. Consolidar fonte de verdade de representacao visual (backend-first para todos os caminhos).

## 11) Decisoes de Mudanca Segura

1. Preservar contratos externos (`results` + `resultados`) ate migracao frontend.
2. Extrair parser semantico para modulo unico antes de remover caminhos legados.
3. Separar composicao de servico (factory) da logica de busca para reduzir `if _use_repository`.
4. So endurecer schema (`extra=forbid`) apos cobertura de contrato.

## 12) Endpoints de Operacao

- `GET /api/status`: status agregado DB + TIPI.
- `GET /api/cache-metrics`: metricas L1/L2/payload (admin).
- `GET /api/debug/anchors`: diagnostico de anchors (admin + debug_mode).
- `POST /api/admin/reload-secrets`: recarrega settings.
