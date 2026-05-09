# Offline-First Fiscal Threat Model

## Scope

This threat model covers the fiscal search product after the offline-first migration. NESH, TIPI, NBS, and UNSPSC search run in the browser from static fiscal bundles. Cloud backend services are reserved for future user-account features only.

## Assets

- Fiscal bundle integrity and version metadata.
- Browser-local OPFS databases and installation state.
- Clerk session tokens and future user-account claims.
- Future D1 user data: comments, favorites, profile, and preferences.
- Cloudflare Pages deployment settings and R2 bucket/object configuration.
- Build-time bundle seed and release pipeline outputs.

## Trust Boundaries

- User browser to Cloudflare Pages static assets.
- User browser to Cloudflare R2 public bundle objects.
- Future user browser to Clerk for authentication.
- Future Cloudflare Worker to Clerk JWKS and D1.
- Build pipeline to generated fiscal bundles.

## Attacker-Controlled Inputs

- Search queries, NCM/NBS/UNSPSC codes, tab state, and local UI settings.
- Browser storage state, including stale or corrupted OPFS files.
- Network responses if an attacker can influence DNS, cache, proxy, or R2 object contents.
- Future authenticated user fields, comments, favorites, profile, and preferences.
- Future Clerk JWTs presented to Workers.

## Invariants

- Fiscal search must not depend on Render, FastAPI routes, Postgres, Neon, Redis, Upstash, or any online backend request path.
- Fiscal bundles must contain only public fiscal data, never secrets or user data.
- The browser must verify source metadata and expected hashes before trusting downloaded bundles.
- A failed or partial bundle install must not replace a known-good local source.
- Future Workers must store only user-account data in D1 and must not proxy fiscal search.
- Clerk tokens must be validated server-side in future Workers before any D1 read or write.

## Primary Failure Modes

- R2 object tampering or stale metadata causing malicious or incorrect local search results.
- Leaking secrets by treating bundle encryption as access control.
- Accidentally reintroducing online backend fallback for fiscal search, bringing back cost, rate-limit, and availability risks.
- Cross-source metadata mixups, such as installing a TIPI bundle as NESH.
- XSS through rendered fiscal content or future comments.
- Future D1 authorization bugs exposing comments, favorites, profiles, or preferences across tenants/users.

## Required Controls

- Keep R2 bundles public-data-only and immutable per version.
- Publish source-scoped `*.meta.json` files with hash, version, and source identifiers.
- Verify source id and content hash in the browser before activating an installed bundle.
- Sanitize rendered fiscal HTML and future user-generated content.
- Keep the backend fiscal route retirement covered by tests.
- Treat Clerk + Workers + D1 as a separate future account-data boundary.
