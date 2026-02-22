# PR #20 - Code Quality Debt Report (2026-02-22)

## Context
- PR: `#20` (`feature/refactor-renderer-sonar` -> `main`)
- Snapshot sources:
  - GitHub Actions run: `22267207340` (MegaLinter)
  - Local folder: `megalinter-reports/`
  - Tests workflow run: `22267207357` (`frontend` failed)

## Scope of this report
- Documents current debt and prioritization.
- Does **not** attempt to fix all MegaLinter findings in this pass.
- Coverage gate failure is documented as future work, per current team direction.

## Finding Categories

### 1) Tooling / Noise
- Secret scanners can flag repository internals or non-runtime artifacts (example: findings in `.git/config` from `kingfisher`).
- Static checks may include local templates or non-production assets.
- Some findings are high-volume and low-signal for merge readiness when run against historical code.

### 2) Security (real / potentially real)
- Dependency vulnerabilities reported:
  - `axios` in `client/package-lock.json` (`1.13.2`, fixed in `1.13.5`)
  - `cryptography` in `uv.lock` (`46.0.4`, fixed in `46.0.5`)
- JWT decoding paths require explicit rationale and safeguards when using unverified payloads in debug/observability scenarios.

### 3) Style / Formatting
- Typical linter classes from MegaLinter run:
  - line length
  - trailing whitespace
  - generic suppression comments (`NOSONAR`) needing narrower scope

### 4) Typing / Static Analysis
- Type-check findings were reported by MegaLinter stack (`mypy`, `pyright`, `pylint`), including missing imports and strictness mismatches.
- Not all are immediate runtime blockers; triage is required before broad remediation.

## Priority Plan

### P0 - Security confirmed
- Upgrade vulnerable dependencies:
  - `axios` to a patched version in `client/package-lock.json`
  - `cryptography` to a patched version in `uv.lock`
- Keep debug-only JWT paths explicitly guarded and documented.

### P1 - Potential runtime bugs
- Event target safety in delegated DOM handlers.
- Dialog semantics/accessibility correctness for modal behavior.
- Parsing consistency across scripts that process the same source format.

### P2 - Style and conventions
- Lint cleanups (`NOSONAR` granularity, comments, formatting).
- Broader static-analysis convergence across historical files.

## Frontend Coverage Failure (documented; not fixed in this pass)
- Failed check: `Tests / frontend`
- Failing command in CI: `npm run test:coverage`
- Current gate: global thresholds at `80%` in `client/vite.config.js`
- CI evidence from run `22267207357`:
  - lines: `24.95%`
  - statements: `23.13%`
  - functions: `20.17%`
  - branches: `15.72%`
- Root cause in this run: only a minimal subset of tests executed compared to required global threshold.

## Recommended Future Strategy
- Scanner baseline for historical findings (focus new/changed code in PR gates).
- Scope filters by path/type for security scanners where appropriate.
- Two-tier quality policy:
  - strict on changed code
  - backlog on legacy debt
- Coverage plan options for frontend:
  - expand stable suite in CI
  - phased thresholds by module maturity
  - per-folder thresholds instead of one global gate

## MegaLinter Policy
- MegaLinter remains local-only workflow support.
- It is not the official required CI gate for merge in this strategy.
