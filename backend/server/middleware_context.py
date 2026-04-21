"""Request context helpers shared by server middleware and routes."""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from typing import Any, Coroutine, Optional

logger = logging.getLogger("nesh.middleware.context")

from backend.infrastructure.db_engine import tenant_context

_request_id_ctx: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
_jwt_failure_reason_ctx: ContextVar[Optional[str]] = ContextVar(
    "jwt_failure_reason", default=None
)

# Strong refs for background tasks so fire-and-forget work is not GC'd early.
_background_tasks: set[asyncio.Future[Any]] = set()


def get_current_tenant() -> Optional[str]:
    """Return the active tenant from the request-scoped context."""
    return tenant_context.get() or None


def get_current_request_id() -> Optional[str]:
    """Return the current request id from the request-scoped context."""
    return _request_id_ctx.get() or None


def get_last_jwt_failure_reason() -> Optional[str]:
    """Return the most recent JWT validation failure reason for the request."""
    return _jwt_failure_reason_ctx.get()


def _schedule_background_task(task_coro: Coroutine[Any, Any, Any]) -> None:
    """Schedule background work and keep a strong reference until completion."""
    task = asyncio.ensure_future(task_coro)
    if not isinstance(task, asyncio.Future):
        return

    _background_tasks.add(task)

    def _on_done(done_task: asyncio.Future[Any]) -> None:
        _background_tasks.discard(done_task)
        try:
            done_task.result()
        except asyncio.CancelledError:
            pass
        except Exception:
            # The caller already owns the user-facing request path.
            logger.debug("Background task failed silently", exc_info=True)

    task.add_done_callback(_on_done)


def _set_request_id(request_id: str) -> ContextVar.Token:
    return _request_id_ctx.set(request_id)


def _reset_request_id(token: ContextVar.Token) -> None:
    _request_id_ctx.reset(token)


def _record_jwt_failure_reason(reason: Optional[str]) -> None:
    _jwt_failure_reason_ctx.set(reason)

