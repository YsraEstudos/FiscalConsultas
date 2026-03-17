## 2024-05-15 - SQLAlchemy Count Queries
**Learning:** Using `select(func.count()).select_from(query.subquery())` generated an extra subquery which slows down execution significantly.
**Action:** For simple filtered queries, prefer `query.with_only_columns(func.count(), maintain_column_froms=True).order_by(None)` to avoid extra sorting while preserving the original `FROM` clause. For `DISTINCT`, `GROUP BY`, or more complex join semantics, count rows from a subquery or use `count(distinct(...))` so the count matches the original result set.

## 2026-03-13 - Optimize DOM Traversal Highlighting
**Learning:** String normalization (like NFD and regex replace) inside tight DOM traversal loops (e.g., TreeWalker) is a massive performance bottleneck.
**Action:** Use pre-compiled regex patterns before the loop to test values, eliminating the need to normalize every DOM node's text content.

## 2024-05-20 - Early String Deduplication
**Learning:** Performing `stemmer.stem()` (which does NFD normalization and multiple regex-like string replacements) on every word token individually is a bottleneck when processing text with many duplicate tokens.
**Action:** Use `dict.fromkeys(words)` for early deduplication *before* looping to run transformations in a list comprehension. This reduces time complexity for duplicate-heavy inputs and adds negligible overhead for small strings.
