
## 2026-03-05 - SQLAlchemy pagination counts with subqueries
**Learning:** Using `select(func.count()).select_from(base_query.subquery())` is a common but sub-optimal way to compute counts for pagination. It generates a derived table and forces the DB to materialize the inner query just to compute a total count, and retains unneeded `ORDER BY` clauses if present.
**Action:** For simple pagination queries with filters only, prefer `base_query.with_only_columns(func.count(), maintain_column_froms=True).order_by(None)` to avoid unnecessary sorting while preserving the original `FROM` clause. For queries with `DISTINCT`, `GROUP BY`, or more complex join semantics, count rows from a subquery or use `count(distinct(...))` so the count matches the original result set semantics.
