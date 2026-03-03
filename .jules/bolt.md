## 2024-05-15 - SQLAlchemy Count Queries
**Learning:** Using `select(func.count()).select_from(query.subquery())` generated an extra subquery which slows down execution significantly.
**Action:** Always prefer `query.with_only_columns(func.count()).order_by(None)` instead of using `.subquery()` for counting in SQLAlchemy queries.
