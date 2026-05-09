# Agent guidelines

## Critical Rules

- Put non-negotiable safety, data, and production constraints first.
- If a rule is labeled `CAVEAT`, `IMPORTANT`, `DO NOT CHANGE`, or equivalent in project docs, rule files, or nearby code comments, it overrides general best practices.
- Keep always-loaded instructions concise; move long procedures and domain details into linked or scoped documents.

## Agent Behavior & Workflow

- Self-correction: treat the first iteration as a draft. run the relevant tests or checks to verify the solution. If not, manually review the generated code for obvious edge cases before finishing.
- Surgical changes: output only the necessary changes. Do not rewrite entire files just to change a few lines.

## Context Routing & Precedence

- Progressive disclosure: before making architectural decisions, inspect the neighboring code to understand local conventions. If project documentation exists, read it too. If docs conflict with the code, treat the code as the source of truth and flag the inconsistency.
- Context routing: use this file as an entry point, not as the only source of truth. If working on a specific domain, first locate and read that domain’s documentation and nearest analogous implementation before proposing changes.
- Living context: after any meaningful change, update the relevant context files so a future session can understand the current state without rediscovery.

## Code style

**Performance baseline**
- Default to `O(1)` lookups. Use Sets for uniqueness checks and Maps/Dicts for key-value grouping.
- Never use nested loops (`O(n^2)`) for data transformation if a flat approach with a hash map is possible.

**Functions**
- 4–20 lines per function. Split anything longer by responsibility.
- One function, one job. If you need "and" to describe it, split it.
- Early returns over nested ifs. Max 2 levels of indentation inside a function body.

**Files**
- Under 500 lines. Split by responsibility, not by size alone.
- One module, one responsibility (SRP). No god files.
- Predictable paths: follow the framework convention (`controller/model/view`,
  `src/lib/test`, etc.).

**Naming**
- Names must be specific and unique. Avoid `data`, `handler`, `Manager`, `utils`, `helpers`.
- A good name returns fewer than 5 `grep` hits across the codebase.
- Boolean names start with `is`, `has`, or `can` (`isLoading`, `hasPermission`).

**Types**
- Explicit types everywhere. No `any`, no untyped `Dict`, no untyped function signatures.
- Prefer domain types over primitives: `UserId` over `string`, `Price` over `number`.

**Duplication & indirection**
- No copy-pasted logic. Extract shared behaviour into a named function or module.
- Three identical call sites is the threshold — extract on the third occurrence, not the first.

**Error messages**
- Always include the offending value and the expected shape.
  - Bad: `raise ValueError("Invalid input")`
  - Good: `raise ValueError(f"Expected ISO-8601 date, got {value!r}")`

## Comments

- Keep every comment you write. Do not strip comments during refactors — they carry
  intent and provenance.
- Write **why**, not what. Skip `// increment counter` above `i++`.
- Docstrings on every public function: state the intent and include one usage example.
- When a line exists because of a specific bug or upstream constraint, reference
  the issue number or commit SHA inline.
  ```python
  # Workaround for upstream bug: github.com/org/lib/issues/42 (fixed in v2.1, pending upgrade)
  ```

## Tests

- All tests run with a single command. Document that command at the top of the README.
- Every new function gets a test. Every bug fix gets a regression test.
- Mock external I/O (API, DB, filesystem) with named fake classes, not inline stubs.
  ```python
  class FakePaymentGateway:      # not: mock.patch("stripe.charge")
      def charge(self, amount): ...
  ```
- Tests must be F.I.R.S.T:
  - **Fast** — no real network or disk I/O.
  - **Independent** — no shared mutable state between tests.
  - **Repeatable** — same result on any machine, any run order.
  - **Self-validating** — pass or fail, no human interpretation required.
  - **Timely** — written alongside the code, not after the PR is merged.
- Name tests so the failure message is a complete sentence:
  `test_order_total_includes_tax_when_region_is_eu`

## Error handling

- Handle errors at the boundary where you have enough context to act.
- Do not swallow exceptions silently. Log or re-raise with added context.
- Distinguish recoverable errors (retry/fallback) from programming errors (panic/crash).
- Never use exceptions for control flow in the happy path.

## Dependencies

- Inject dependencies through the constructor or function parameters. No globals,
  no module-level singletons.
- Wrap every third-party library behind a thin interface owned by this project.
  Internals depend on that interface, not on the library directly. Swapping the
  vendor requires changing only the adapter.
- Pin dependency versions in lock files. Review diffs on upgrades.

## Structure

- Follow the framework's established layout (Rails, Django, Next.js, etc.).
- Small, focused modules over large, catch-all files.

## Formatting

Run the language-default formatter before every commit. Do not discuss style
beyond what the formatter enforces.

| Language   | Formatter         |
|------------|-------------------|
| Rust       | `cargo fmt`       |
| Go         | `gofmt`           |
| JavaScript | `prettier`        |
| Python     | `black`           |
| Ruby       | `rubocop -A`      |

If there is no formatter, agree on one and add it to CI.

## Logging

- **Structured JSON** for all internal/observability logs. Include a `level`,
  `timestamp`, and a `context` object with relevant IDs on every line.
- **Plain text** only for user-facing CLI output.
- Log at the right level: `DEBUG` for tracing, `INFO` for lifecycle events,
  `WARN` for recoverable issues, `ERROR` for failures that need attention.
- Never log secrets, tokens, PII, or raw request bodies.

## Security

- Validate and sanitise all input at the entry point (API boundary, CLI args, env vars).
- Never interpolate user input into queries, shell commands, or HTML. Use
  parameterised queries and escaping utilities.
- Secrets come from environment variables or a secrets manager. Never hard-code
  them, never commit them.
- Apply least-privilege: request only the permissions a module actually needs.

## Local Search Offline Install

- The offline search database is expected to auto-install on first supported visit.
- User removal sets `offline-db:auto-install-opt-out`; manual install clears it.
- Cross-tab installation is coordinated by `client/src/context/offlineDatabaseInstallCoordinator.ts`, which prefers Web Locks and falls back to a renewable localStorage lease.
- Do not rely on `beforeunload`/`unload` to release install state; abandoned owners must expire and be taken over.
- Fiscal search is offline-first: NESH, TIPI, NBS, and UNSPSC must be downloaded from static R2 bundles and queried locally in the browser.
- Do not add Render, FastAPI route, Postgres, Redis, Upstash, Neon, or any online backend dependency back into fiscal search.
- Cloud backend work is reserved for future user-account features only: comments, favorites, profile, and preferences via Clerk, Cloudflare Workers, and Cloudflare D1.
- R2 bundle layout is source-scoped: `nesh/nesh.meta.json`, `nesh/nesh.enc`, `tipi/tipi.meta.json`, `tipi/tipi.enc`, `nbs/nbs.meta.json`, `nbs/nbs.enc`, `unspsc/unspsc.meta.json`, and `unspsc/unspsc.enc`.

## Git hygiene

- One logical change per commit. Commits must build and pass tests in isolation.
- Commit message format: `<type>(<scope>): <short imperative summary>`
  Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- PR descriptions state **why** the change is needed, not just what changed.
- Do not merge with failing CI.
