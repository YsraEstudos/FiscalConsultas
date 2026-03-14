from __future__ import annotations

import hashlib
from typing import Any

from fastapi import Request


def cache_scope_key(request: Request) -> str:
    tenant_id = None
    try:
        from backend.server.middleware import get_current_tenant

        tenant_id = get_current_tenant()
    except ModuleNotFoundError:
        tenant_id = None

    if tenant_id:
        return f"tenant:{tenant_id}"

    header_tenant = (request.headers.get("X-Tenant-Id") or "").strip()
    if header_tenant:
        return f"tenant:{header_tenant}"

    if request.headers.get("Authorization"):
        return "auth-user"

    return "public"


def weak_etag(namespace: str, *parts: Any, size: int = 16) -> str:
    payload = ":".join([namespace, *[str(part) for part in parts]])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:size]
    return f'W/"{digest}"'
