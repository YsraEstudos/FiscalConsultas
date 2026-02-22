# Testing Strategy

## Goals
- Catch regressions early on API contracts and core search logic.
- Keep local feedback fast and deterministic.
- Make CI failures actionable (high signal, low flakiness).

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
1. Auth enforcement on `/api/ai/chat` (401 vs 200 contract).
2. AI chat rate-limit behavior (`429` + `Retry-After` header).
3. Webhook contract for `/api/webhooks/asaas` (token validation, payload validation, event routing).
4. Search route contract aliasing (`results` vs `resultados`) for legacy frontend compatibility.
5. TIPI route compatibility fields (`total_capitulos`, normalized text defaults).
6. Status payload normalization (`/api/status` database/TIPI schema contract).
7. In-memory sliding-window limiter correctness.
8. Webhook date/datetime parsing edge cases.
9. Cross-chapter note cache/dedup behavior on frontend.
10. Existing NCM/TIPI unit+integration regression tests.

## Out of Scope (Initial)
- Full E2E browser automation (Playwright): deferred to avoid extra CI flakiness now.
- Real external auth/billing provider integration (Clerk/Asaas): mocked contracts only.
- Performance assertions in default suite: kept as opt-in benchmarks.
- Legacy backend suite in `backend/tests` and diagnostic scripts in `tests/scripts`: excluded from official run path.

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
  - `pytest -q`
- Backend with coverage:
  - `pytest -q --cov=backend --cov-report=term-missing`
- Frontend (default stable):
  - `cd client && npm test`
- Frontend all tests (including perf):
  - `cd client && npm run test:all`
- Frontend coverage:
  - `cd client && npm run test:coverage`

## Secrets Scanning (PR-focused)
- Gitleaks (git history/repo scan):
  - `docker run --rm -v "${PWD}:/repo" ghcr.io/gitleaks/gitleaks:latest detect --source /repo --redact`
- 2MS (scan only tracked git content to avoid local `.env` / `.venv` noise):
  - `docker run --rm --entrypoint /bin/sh -v "${PWD}:/target" checkmarx/2ms:latest -lc "git config --global --add safe.directory /target && /app/2ms git /target --depth 200 --stdout-format json --report-path /target/2ms-report-git.json"`

## CI Policy
- Run backend unit+integration (no perf/snapshot) on push/PR.
- Run frontend stable tests on push/PR.
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
