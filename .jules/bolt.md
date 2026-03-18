## 2024-05-15 - SQLAlchemy Count Queries
**Learning:** Using `select(func.count()).select_from(query.subquery())` generated an extra subquery which slows down execution significantly.
**Action:** For simple filtered queries, prefer `query.with_only_columns(func.count(), maintain_column_froms=True).order_by(None)` to avoid extra sorting while preserving the original `FROM` clause. For `DISTINCT`, `GROUP BY`, or more complex join semantics, count rows from a subquery or use `count(distinct(...))` so the count matches the original result set.

## 2026-03-13 - Optimize DOM Traversal Highlighting
**Learning:** String normalization (like NFD and regex replace) inside tight DOM traversal loops (e.g., TreeWalker) is a massive performance bottleneck.
**Action:** Use pre-compiled regex patterns before the loop to test values, eliminating the need to normalize every DOM node's text content.

## 2024-05-18 - Global Memoization for Text Processing
**Learning:** When applying expensive string manipulation operations (like stemming or normalization) to individual words in a sequence where the same word might appear repeatedly, processing each occurrence independently wastes CPU cycles. While local memoization (e.g. `stem_cache = {}` inside a loop) works, it's limited to the scope of that single query/document. Many queries and documents share the exact same vocabulary.
**Action:** Apply a bounded `@functools.lru_cache(maxsize=10000)` directly to the expensive text processing method (e.g., `stem`). This shares the cache across multiple different documents and queries, yielding a much higher hit rate and better overall application performance than local looping caches, without leaking memory.
