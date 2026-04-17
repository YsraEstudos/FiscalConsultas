from __future__ import annotations

import importlib
import logging
import threading
from typing import Any

from backend.config.settings import settings

logger = logging.getLogger("nesh.server.observability")

_sentry_initialized = False
_sentry_lock = threading.Lock()


def _resolve_sentry_environment() -> str:
    explicit_environment = settings.observability.sentry_environment.strip()
    if explicit_environment:
        return explicit_environment
    return settings.server.env


def configure_observability(
    *,
    release: str | None = None,
    server_name: str | None = None,
) -> None:
    global _sentry_initialized

    if not settings.observability.sentry_enabled:
        return

    with _sentry_lock:
        if _sentry_initialized:
            return

    try:
        sentry_sdk = importlib.import_module("sentry_sdk")
    except (ImportError, ModuleNotFoundError):
        logger.warning(
            "Observability configured with Sentry DSN, but sentry_sdk is not installed."
        )
        return

    try:
        sentry_fastapi = importlib.import_module("sentry_sdk.integrations.fastapi")
    except (ImportError, ModuleNotFoundError):
        logger.warning(
            "sentry_sdk is installed, but sentry_sdk.integrations.fastapi is unavailable."
        )
        return

    fastapi_integration = getattr(sentry_fastapi, "FastApiIntegration", None)
    if fastapi_integration is None:
        logger.warning(
            "sentry_sdk.integrations.fastapi is unavailable; skipping Sentry initialization."
        )
        return

    init = getattr(sentry_sdk, "init", None)
    if not callable(init):
        logger.warning(
            "sentry_sdk.init is unavailable; skipping Sentry initialization."
        )
        return

    init_kwargs: dict[str, Any] = {
        "dsn": settings.observability.sentry_dsn,
        "environment": _resolve_sentry_environment(),
        "traces_sample_rate": settings.observability.sentry_traces_sample_rate,
        "integrations": [fastapi_integration()],
    }
    if release:
        init_kwargs["release"] = release
    if server_name:
        init_kwargs["server_name"] = server_name

    with _sentry_lock:
        if _sentry_initialized:
            return
        init(**init_kwargs)
        _sentry_initialized = True
    logger.info(
        "Sentry observability initialized for environment=%s",
        init_kwargs["environment"],
    )


def reset_observability_for_tests() -> None:
    global _sentry_initialized
    _sentry_initialized = False
