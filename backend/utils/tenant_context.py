from __future__ import annotations

from backend.infrastructure.db_engine import tenant_context


def get_current_tenant() -> str | None:
    return tenant_context.get() or None
