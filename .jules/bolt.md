
## 2026-03-05 - SQLAlchemy pagination counts with subqueries
**Learning:** Using `select(func.count()).select_from(base_query.subquery())` is a common but sub-optimal way to compute counts for pagination. It generates a derived table and forces the DB to materialize the inner query just to compute a total count, and retains unneeded `ORDER BY` clauses if present.
**Action:** Always count total elements for pagination by converting the base query directly: `base_query.with_only_columns(func.count()).order_by(None)`. The `.order_by(None)` is crucial to prevent the DB from sorting elements just to count them.
