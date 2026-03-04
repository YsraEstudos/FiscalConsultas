## 2023-10-24 - SQLAlchemy query count optimization
**Learning:** In SQLAlchemy, using `select(func.count()).select_from(base_query.subquery())` can cause the database to generate inefficient derived tables or subqueries, hurting performance.
**Action:** Optimize count queries by utilizing `query.with_only_columns(func.count()).order_by(None)` instead to evaluate counts efficiently without generating unnecessary subqueries.
