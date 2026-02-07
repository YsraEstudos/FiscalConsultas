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

## CI Policy
- Run backend unit+integration (no perf/snapshot) on push/PR.
- Run frontend stable tests on push/PR.
- Publish coverage artifacts for backend and frontend.

## Coverage Targets
- Initial baseline target:
  - Backend critical modules touched by routes/services/helpers: >= 70%.
  - Frontend critical hooks/components/services under test: >= 60%.
- Focus on meaningful contract coverage over raw percentage.
