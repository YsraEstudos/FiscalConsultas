## 2024-05-15 - SQLAlchemy Count Queries
**Learning:** Using `select(func.count()).select_from(query.subquery())` generated an extra subquery which slows down execution significantly.
**Action:** For simple filtered queries, prefer `query.with_only_columns(func.count(), maintain_column_froms=True).order_by(None)` to avoid extra sorting while preserving the original `FROM` clause. For `DISTINCT`, `GROUP BY`, or more complex join semantics, count rows from a subquery or use `count(distinct(...))` so the count matches the original result set.

## 2026-03-13 - Optimize DOM Traversal Highlighting
**Learning:** String normalization (like NFD and regex replace) inside tight DOM traversal loops (e.g., TreeWalker) is a massive performance bottleneck.
**Action:** Use pre-compiled regex patterns before the loop to test values, eliminating the need to normalize every DOM node's text content.

## 2025-03-26 - Single-Pass DOM Regex Modification Performance
**Learning:** Re-scanning and substituting a massive HTML string for each individual comment ID using an O(N * M) loop caused substantial performance degradation (taking multiple seconds).
**Action:** Replaced with a single-pass regex compilation `re.compile(r'<[a-zA-Z][^>]*\bid=["\']?([^"\'\s>]+)["\']?[^>]*>')` and an O(1) set lookup `keys_set = set(commented_anchor_keys)` within the replacer function, achieving a ~200-300x speedup for bulk comment highlighting in large DOM structures. Pre-compiling internal substitution regexes further avoided redundant overhead.
