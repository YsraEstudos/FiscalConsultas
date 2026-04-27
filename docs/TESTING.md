# Testing Strategy

## Goals
- Catch regressions early on API contracts and core search logic.
- Keep local feedback fast and deterministic.
- Make CI failures actionable (high signal, low flakiness).
- Protect the offline install flow, app-shell cache, and local search contract for `NESH`, `TIPI`, `NBS`, and `NEBS`.

## Test Pyramid
- Unit (`tests/unit`, `client/tests/unit`):
  - Pure logic and helper behavior.
  - No real network calls.
  - Fast and isolated.
- Integration (`tests/integration`, `client/tests/integration`):
  - FastAPI route contracts with dependency overrides/mocks.
  - UI integration around search flows and state transitions.
- Performance/diagnostics (`tests/performance`, `client/tests/performance`):
  - Not part of default `test` command.
  - Run on demand for profiling/regression baselines.

## Top 10 Risk Areas (Execution Order)
1. Instalacao offline (`/api/database/version`, `/api/database/token`, `/api/database/download`) e validacao de metadata.
2. App shell offline via `coi-serviceworker.js` e reabertura sem rede.
3. Busca local e publica e detalhe para `NESH`, `TIPI`, `NBS` e `NEBS`.
4. Contrato das rotas publicas de `NBS`/`NEBS` (`200` anonimo, `429` ainda aplicado, sem modal de login).
5. Sanitização de HTML/backend-rendered content no frontend (`contentSecurity.ts`, `MarkdownPane`, `ResultDisplay`).
6. Gating de moderação/admin por role do Clerk (`AuthContext`, `authz.ts`, `ModalManager`).
7. Capacidades de UI restrita vindas de `/api/auth/me`, sem expor allowlists no bundle público.
8. Auth enforcement on `/api/ai/chat` (`401` vs `403` vs `200` contract).
9. AI chat rate-limit behavior (`429` + `Retry-After` header).
10. Webhook contract for `/api/webhooks/asaas` (token validation, payload validation, event routing).

## Fase 1B Report (2026-04-17): Gap Analysis por Risco

### Critério de classificação
- `Coberto`: há suíte determinística protegendo o comportamento crítico (unit e/ou integration), com boa sinalização de regressão.
- `Parcial`: há cobertura relevante, mas falta validação em camada crítica do risco (geralmente E2E browser ou contrato ponta a ponta).
- `Não coberto`: não há cobertura suficiente para o risco principal.

### Matriz risco x cobertura atual

| # | Área de risco | Unit | Integration | E2E Playwright | Status | Prioridade |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Instalação offline (`/api/database/version`, `/token`, `/download`) | Forte | Limitada | Ausente | Parcial | P0 |
| 2 | App shell offline + reabertura sem rede | Limitada | Ausente | Ausente | Não coberto | P0 |
| 3 | Busca/detalhe local (`NESH`, `TIPI`, `NBS`, `NEBS`) | Forte | Forte | Parcial | Parcial | P0 |
| 4 | Contrato das rotas públicas de `NBS`/`NEBS` | Forte | Forte | Parcial | Parcial | P0 |
| 5 | Sanitização de HTML renderizado | Forte | Limitada | Ausente | Coberto | P1 |
| 6 | Gating de moderação/admin por role | Forte | Limitada | Ausente | Parcial | P1 |
| 7 | Capacidades de UI restrita vindas de `/api/auth/me` | Forte | Forte | Sim (`auth-capabilities.spec.ts`) | Coberto | P0 |
| 8 | Auth enforcement `/api/ai/chat` (`401/403/200`) | Limitada | Forte | Ausente | Coberto | P1 |
| 9 | Rate limit de AI chat (`429` + `Retry-After`) | Limitada | Forte | Ausente | Coberto | P1 |
| 10 | Contrato de webhook `/api/webhooks/asaas` | Limitada | Forte | N/A | Coberto | P1 |

### Evidências usadas na classificação (amostra)
- Offline contract backend: `tests/unit/test_database_download_route.py`
- Auth e AI chat contracts: `tests/integration/test_auth_api_contract.py`
- Webhooks contract: `tests/integration/test_webhooks_api_contract.py`
- Search/services contracts: `tests/integration/test_search_route_contracts.py`, `tests/integration/test_services_route_contract.py`
- Sanitização frontend: `client/tests/unit/ResultDisplay.test.tsx`, `client/tests/unit/MarkdownPane.test.tsx`, `client/src/utils/contentSecurity.test.ts`
- Playwright atual: `client/tests/playwright/site-smoke.spec.ts`, `client/tests/playwright/services-tabs.spec.ts`, `client/tests/playwright/services-tabs.resilience.spec.ts`, `client/tests/playwright/nesh-ordering.spec.ts`, `client/tests/playwright/tipi-ordering.spec.ts`, `client/tests/playwright/auth-capabilities.spec.ts`

### Lacunas priorizadas para execução (P0/P1/P2)
- **P0**
  - Cobrir em Playwright o fluxo de instalação offline (version/token/download) e reabertura sem rede (app shell/service worker).
  - Expandir E2E de busca/detalhe local para além de serviços (NESH/TIPI em fluxo completo de usuário).
- **P1**
  - Adicionar E2E para fluxos de erro de autenticação/limite (`401`, `403`, `429`) com feedback visível ao usuário.
  - Validar em browser os gates de moderação/admin com cenários signed-in/signed-out e role mismatch.
- **P2**
  - Endurecer testes de regressão existentes removendo pontos fracos que podem mascarar falhas (asserts ausentes e waits fixos).
  - Revisar suíte de snapshot para impedir falso positivo em divergências semânticas.

### Gate de saída da Fase 1B
- Matriz de risco atualizada e versionada neste documento.
- Priorização `P0/P1/P2` definida para orientar execução da Fase 2.
- Backlog técnico de testes organizado por risco, e não apenas por módulo.

## Fase 0C Report (2026-04-17): Matriz de Interações para Cobertura Total de Fluxo

### Escopo da Fase 0C
- Consolidar um checklist único de interações críticas de clique, abas e scroll para `NESH`, `TIPI`, `NBS` e `NEBS`.
- Marcar a cobertura atual por camada (Playwright vs unit/integration).
- Definir lacunas obrigatórias para fechamento de cobertura E2E de fluxo completo.

### Definition of Done (Fase 0C)
- Cada interação crítica da matriz está classificada como `Coberto E2E`, `Parcial` ou `Não coberto E2E`.
- Cada item `Parcial` ou `Não coberto E2E` aponta para uma fase de execução com dono claro.
- Existe ao menos uma evidencia de teste por item marcado como `Coberto E2E`.
- O gate de saída desta fase está versionado e auditável neste documento.

### Matriz única de interações (estado atual)

| Domínio | Interação crítica | Playwright atual | Unit/Integration atual | Status Fase 0C | Próxima fase |
| --- | --- | --- | --- | --- | --- |
| NESH | Busca por código + ordenação de itens do capítulo | Sim (`nesh-ordering.spec.ts`) | Sim | Coberto E2E | Manter |
| NESH | Clique em item de navegação com salto para âncora correta | Sim (`nesh-ordering.spec.ts`) | Sim | Coberto E2E | Manter |
| NESH | Auto-scroll pós-busca em browser real | Sim (`nesh-ordering.spec.ts`) | Sim | Coberto E2E | Manter |
| TIPI | Busca por código + ordenação de itens | Sim (`tipi-ordering.spec.ts`) | Sim | Coberto E2E | Manter |
| TIPI | Clique/navegação por itens com confirmação de alvo visível | Sim (`tipi-ordering.spec.ts`) | Parcial | Coberto E2E | Manter |
| TIPI | Auto-scroll e persistência de posição em browser real | Sim (`tabs-scroll-persistence.spec.ts`) | Sim | Coberto E2E | Manter |
| NBS | Abertura de catálogo, busca e detalhamento inicial | Sim (`services-tabs.spec.ts`, `site-smoke.spec.ts`) | Sim | Coberto E2E | Manter |
| NBS | Navegação por hierarquia (ancestrais/filhos) via clique | Sim (`services-tabs.spec.ts`) | Sim | Coberto E2E | Manter |
| NBS | Abertura de notas de capítulo e retorno ao workspace | Sim (`services-tabs.spec.ts`) | Parcial | Coberto E2E | Manter |
| NBS | Smart links em nota (click, ctrl/cmd, middle-click) para NEBS | Sim (`services-tabs.spec.ts`) | Sim | Coberto E2E | Manter |
| NBS/NEBS | Troca NBS -> NEBS -> NBS no mesmo contexto | Sim (`services-tabs.spec.ts`) | Sim | Coberto E2E | Manter |
| NEBS | Breadcrumbs para NBS relacionado | Sim (`services-tabs.spec.ts`) | Parcial | Coberto E2E | Manter |
| NEBS | Ação "Abrir item NBS relacionado" respeitando preferência de nova aba | Sim (`services-tabs.spec.ts`) | Sim | Coberto E2E | Manter |
| Abas | Criar/trocar/fechar/reordenar (drag/teclado) em browser real | Sim (`tabs-workflow.spec.ts`) | Sim (forte) | Coberto E2E | Manter |
| Abas + Scroll | Persistência de scroll entre abas/documentos em browser real | Sim (`tabs-scroll-persistence.spec.ts`) | Sim (forte) | Coberto E2E | Manter |
| Offline app shell | Instalação offline + reabertura sem rede | Sim (`offline-install-reopen.spec.ts`, `offline-reopen.sw.live.spec.ts`) | Sim | Coberto E2E | Manter |

### Atualização Fase 2 (2026-04-18)
- Cenários E2E adicionados em `client/tests/playwright/services-tabs.spec.ts`:
  - Hierarquia NBS por clique em ancestral e em filho.
  - Abertura/fechamento das explicações de capítulo no workspace NBS.
  - Smart-link em nota NBS com navegação para NEBS (mesma aba, ctrl/cmd e middle-click).
  - Breadcrumb NEBS -> NBS e ação "Abrir item NBS relacionado" com preferência de nova aba.
- Validação executada:
  - `cd client && npx playwright test tests/playwright/services-tabs.spec.ts --project=mocked-chromium`
  - Resultado: 10 passed.

### Atualização Fase 3 (2026-04-18)
- Cenários E2E adicionados em `client/tests/playwright/tabs-workflow.spec.ts`:
  - Criar abas com documentos distintos (`NESH`, `TIPI`, `NBS`) e alternar aba ativa por clique.
  - Fechar abas por botão e por middle-click, preservando a última aba aberta.
  - Reordenar abas com drag-and-drop.
  - Alternar aba ativa por teclado (`Enter` e `Space`).
- Validação executada:
  - `cd client && npx playwright test tests/playwright/tabs-workflow.spec.ts --project=mocked-chromium`
  - Resultado: 4 passed.

### Atualização Fase 4 (2026-04-18)
- Cenários E2E adicionados em `client/tests/playwright/tabs-scroll-persistence.spec.ts`:
  - Restauração de scroll salvo ao alternar entre abas com documentos diferentes (`NESH` e `TIPI`).
  - Preservação independente de scroll por aba após alternâncias rápidas.
- Validação executada:
  - `cd client && npx playwright test tests/playwright/tabs-scroll-persistence.spec.ts --project=mocked-chromium`
  - Resultado: 2 passed.
  - `cd client && npx playwright test tests/playwright/tabs-workflow.spec.ts tests/playwright/services-tabs.spec.ts tests/playwright/services-tabs.resilience.spec.ts tests/playwright/tabs-scroll-persistence.spec.ts --project=mocked-chromium`
  - Resultado: 23 passed.

### Atualização Fase 1 (2026-04-18)
- Cenários E2E adicionados:
  - `client/tests/playwright/nesh-ordering.spec.ts`: valida auto-scroll pós-busca no fluxo real de browser (sem clique manual em sidebar).
  - `client/tests/playwright/auth-capabilities.spec.ts`: valida gates de UI por capacidades vindas de `/api/auth/me` (`can_use_restricted_ui` e `can_use_ai_chat`).
- Validação executada:
  - `cd client && npx playwright test tests/playwright/nesh-ordering.spec.ts tests/playwright/auth-capabilities.spec.ts --project=mocked-chromium`
  - Resultado: 5 passed.

### Evidências principais usadas na classificação Fase 0C
- Playwright: `client/tests/playwright/site-smoke.spec.ts`
- Playwright: `client/tests/playwright/nesh-ordering.spec.ts`
- Playwright: `client/tests/playwright/tipi-ordering.spec.ts`
- Playwright: `client/tests/playwright/services-tabs.spec.ts`
- Playwright: `client/tests/playwright/services-tabs.resilience.spec.ts`
- Playwright: `client/tests/playwright/tabs-workflow.spec.ts`
- Playwright: `client/tests/playwright/tabs-scroll-persistence.spec.ts`
- Playwright: `client/tests/playwright/auth-capabilities.spec.ts`
- Playwright: `client/tests/playwright/offline-install-reopen.spec.ts`
- Playwright: `client/tests/playwright/offline-reopen.sw.live.spec.ts`
- Unit: `client/tests/unit/useTabs.test.tsx`, `client/tests/unit/TabsBar.test.tsx`, `client/tests/unit/TabsBar.behavior.test.tsx`
- Integration: `client/tests/integration/TabScrollPersistence.test.tsx`, `client/tests/integration/NcmScroll.test.tsx`, `client/tests/integration/SameChapterNavigation.test.tsx`

### Gate de saída da Fase 0C
- Checklist de interações de fluxo total versionado neste documento.
- Lacunas obrigatórias mapeadas para Fases 1-4 sem ambiguidades.
- Cada item marcado como `Coberto E2E` referencia explicitamente um spec Playwright existente.
- CI de PR preserva o baseline P0 atual com offline/service/scroll + NESH auto-scroll + auth capabilities.

## Out of Scope (Initial)
- Real external auth/billing provider integration (Clerk/Asaas): mocked contracts only.
- Performance assertions in default suite: kept as opt-in benchmarks.
- Legacy diagnostic scripts should live outside collected pytest paths.
- Full browser-matrix coverage is still opt-in; targeted offline browser flows are part of release validation.

## Conventions
- Naming: `test_<feature>_<expected_behavior>.py` and `<Feature>.test.tsx`.
- Markers:
  - `unit`
  - `integration`
  - `perf`
  - `snapshot`
- Default pytest excludes `perf` and `snapshot`.
- Fixtures:
  - Keep fixtures small and readable in `tests/fixtures/`.
  - Prefer deterministic static payloads (example: `asaas_payment_confirmed.json`).

## How To Run
- Backend (default stable):
  - `uv run pytest -q`
  - or `.\.venv\Scripts\python -m pytest -q`
- Backend with coverage:
  - `uv run pytest -q --cov=backend --cov-report=term-missing`
  - or `.\.venv\Scripts\python -m pytest -q --cov=backend --cov-report=term-missing`
- Backend performance:
  - `uv run pytest -m perf -q`
- Backend snapshots:
  - `uv run pytest -m snapshot -q`
  - Pré-requisito: `snapshots/baseline_v1.json` deve existir antes da execução.
  - Para gerar/atualizar a baseline local de forma determinística:
    - `uv run python scripts/generate_snapshot.py`
- Frontend (default stable):
  - `cd client && npm test`
- Frontend all tests (including perf):
  - `cd client && npm run test:all`
- Frontend coverage:
  - `cd client && npm run test:coverage`
- Offline-focused suites:
  - `.\.venv\Scripts\python -m pytest tests/unit/test_database_download_route.py -q`
  - `cd client && npx vitest run tests/unit/useSearch.test.tsx tests/unit/useSearch.behavior.test.tsx tests/e2e/services-tabs.flow.test.tsx`

## Secrets Scanning (PR-focused)
- Gitleaks (git history/repo scan):
  - `docker run --rm -v "${PWD}:/repo" ghcr.io/gitleaks/gitleaks:latest detect --source /repo --redact`
- 2MS (scan only tracked git content to avoid local `.env` / `.venv` noise):
- `docker run --rm --entrypoint /bin/sh -v "${PWD}:/target" checkmarx/2ms:latest -c "git config --global --add safe.directory /target && /app/2ms git /target --depth 200 --stdout-format json --report-path /target/2ms-report-git.json"`

## CI Policy
- Run backend unit+integration (no perf/snapshot) on push/PR.
- Run frontend stable tests on push/PR.
- Keep the offline contract covered in CI whenever the install flow, worker, service worker, or services search changes.
- Publish coverage artifacts for backend and frontend.
- Enforce minimum coverage gates:
  - Backend: `--cov-fail-under=70` in CI.
  - Frontend: Vitest `coverage.thresholds` (lines/statements 60, functions 58, branches 50).

## Coverage Targets
- Initial baseline target:
  - Backend critical modules touched by routes/services/helpers: >= 70%.
  - Frontend critical hooks/components/services under test: >= 60%.
- Focus on meaningful contract coverage over raw percentage.

## Fase 0 Report (2026-02-19)
- Baseline interno no início da fase:
  - Backend: ~90.8%
  - Frontend: ~73.09% statements
- Resultado consolidado ao final:
  - Backend: **91%** (`429 passed`, `12 deselected`)
  - Frontend: **89.66% statements**, **76.83% branches**, **89.92% functions**, **92.47% lines** (`167 passed`)

### Principais entregas da fase
- Expansão de testes de comportamento de `App` e `Header`.
- Novas suítes para:
  - `ResultDisplay` (fluxos avançados, fallback NESH/TIPI, auto-scroll, chunked render e tratamento de erro)
  - `SettingsModal` (ESC, backdrop, opções de navegação/TIPI e visibilidade admin)
  - `useTabs`, `NotePanel` e type guards de `api.types`.
- Cobertura elevada de módulos críticos:
  - `src/components/ResultDisplay.tsx`: **91.07% statements**
  - `src/components/SettingsModal.tsx`: **100% statements**
  - `src/hooks/useTabs.ts`: **100% statements**
  - `src/types/api.types.ts`: **100% statements**

## Fase 1 Report (2026-02-19)
- Objetivo da fase:
  - Aumentar cobertura de branches em `TabsBar`, `useSearch`, `id_utils` e `AuthContext`.
- Resultado consolidado:
  - Frontend: **92.12% statements**, **80.66% branches**, **91.21% functions**, **94.93% lines** (`191 passed`).

### Entregas principais
- Novas suítes:
  - `tests/unit/TabsBar.test.tsx`
  - `tests/unit/AuthContext.test.tsx`
  - `tests/unit/useSearch.branches.test.tsx`
- Expansão de suíte existente:
  - `tests/unit/id_utils.test.ts`

### Cobertura dos alvos da Fase 1
- `src/components/TabsBar.tsx`: **100% statements**, **92.85% branches**, **100% functions**, **100% lines**
- `src/hooks/useSearch.ts`: **100% statements**, **89.13% branches**, **100% functions**, **100% lines**
- `src/utils/id_utils.ts`: **100% statements**, **97.05% branches**, **100% functions**, **100% lines**
- `src/context/AuthContext.tsx`: **100% statements**, **100% branches**, **100% functions**, **100% lines**

## Fase 2 Report (2026-02-19)
- Objetivo da fase:
  - Aumentar cobertura de branches em `SearchBar`, `SettingsContext`, `StatsModal` e `TextSearchResults`.
- Resultado consolidado:
  - Frontend: **93.95% statements**, **82.83% branches**, **94.30% functions**, **96.26% lines** (`211 passed`).

### Entregas principais
- Expansão de suíte existente:
  - `tests/unit/SearchBar.test.tsx`
  - `tests/unit/StatsTutorialModal.test.tsx`
  - `tests/unit/TextSearchResults.test.tsx`
- Novas suítes:
  - `tests/unit/SettingsContext.test.tsx`
  - `tests/unit/HighlightPopover.test.tsx`
  - `tests/unit/useTextSelection.test.tsx`

### Cobertura dos alvos da Fase 2
- `src/components/SearchBar.tsx`: **100% statements**, **90.90% branches**, **100% functions**, **100% lines**
- `src/context/SettingsContext.tsx`: **100% statements**, **100% branches**, **100% functions**, **100% lines**
- `src/components/StatsModal.tsx`: **100% statements**, **100% branches**, **100% functions**, **100% lines**
- `src/components/TextSearchResults.tsx`: **100% statements**, **96.87% branches**, **100% functions**, **100% lines**

### Cobertura adicional estabilizada
- `src/components/HighlightPopover.tsx`: **96.15% statements**, **94.11% branches**, **100% functions**, **100% lines**
- `src/hooks/useTextSelection.ts`: **100% statements**, **100% branches**, **100% functions**, **100% lines**

### Próximo foco recomendado (Fase 3)
- Aumentar cobertura de branches em:
  - `src/components/SettingsModal.tsx`
  - `src/components/CrossNavContextMenu.tsx`
  - `src/components/Sidebar.tsx`
  - `src/hooks/useRobustScroll.ts`

## Snapshot Atual (2026-03-09)
- Frontend default suite:
  - `cd client && npm run test` -> **270 passed** em **46 arquivos**
- Frontend type safety:
  - `cd client && npm run type-check` -> **OK**

### Cobertura funcional adicionada nesta rodada
- Novas suítes:
  - `client/src/utils/contentSecurity.test.ts`
  - `client/src/utils/authz.test.ts`
  - `client/tests/unit/MarkdownPane.test.tsx`
- Suítes expandidas:
  - `client/tests/unit/AuthContext.test.tsx`
  - `client/tests/unit/ModalManager.test.tsx`
  - `client/tests/unit/ResultDisplay.test.tsx`
  - `client/tests/unit/Header.test.tsx`
  - `client/tests/unit/App.behavior.test.tsx`
  - `client/tests/integration/AppSearch.test.tsx`
  - `client/tests/unit/UserProfilePage.test.tsx`

### O que esta rodada protege
- HTML malicioso e protocolos inseguros não chegam ao DOM renderizado.
- Links externos são endurecidos com `noopener noreferrer`.
- Imagens inseguras são descartadas e imagens válidas ganham políticas seguras.
- A UI de moderação só renderiza para roles privilegiadas do Clerk.
- O fluxo de busca principal ficou estável sob carga da suíte completa.

## Notas do Ambiente de Teste
- O fluxo de desativação de conta em `UserProfilePage` aciona `location.reload()` após sucesso.
- Em JSDOM isso ainda pode emitir o aviso `Not implemented: navigation to another Document`.
- Esse aviso é conhecido, não quebra a suíte e não muda o resultado dos testes.
