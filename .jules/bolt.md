## 2024-05-15 - SQLAlchemy Count Queries
**Learning:** Using `select(func.count()).select_from(query.subquery())` generated an extra subquery which slows down execution significantly.
**Action:** For simple filtered queries, prefer `query.with_only_columns(func.count(), maintain_column_froms=True).order_by(None)` to avoid extra sorting while preserving the original `FROM` clause. For `DISTINCT`, `GROUP BY`, or more complex join semantics, count rows from a subquery or use `count(distinct(...))` so the count matches the original result set.

## 2026-03-13 - Optimize DOM Traversal Highlighting
**Learning:** String normalization (like NFD and regex replace) inside tight DOM traversal loops (e.g., TreeWalker) is a massive performance bottleneck.
**Action:** Use pre-compiled regex patterns before the loop to test values, eliminating the need to normalize every DOM node's text content.

## $(date +%Y-%m-%d) - Database Healthcheck COUNT queries
**Learning:** Performing `SELECT COUNT(*)` on large tables (e.g. chapters, positions) on every healthcheck ping causes full table scans and high database load, which degrades overall API performance.
**Action:** Use a lightweight `SELECT 1` query to verify database connection viability. If table row counts are required for monitoring payloads, cache those specific statistics using a TTL (e.g., 60 seconds) to avoid redundant computation. Always initialize these caches inside the `__init__` constructor of the class executing the checks.
