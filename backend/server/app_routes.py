from __future__ import annotations

import os

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles

from backend.presentation.routes import (
    auth,
    comments,
    database_download,
    profile,
    search,
    services,
    system,
    tipi,
    webhooks,
)


def _configure_routes(app: FastAPI, project_root: str, logger) -> None:
    app.include_router(auth.router, prefix="/api", tags=["Auth"])
    app.include_router(search.router, prefix="/api", tags=["Search"])
    app.include_router(tipi.router, prefix="/api/tipi", tags=["TIPI"])
    app.include_router(services.router, prefix="/api/services", tags=["Services"])
    app.include_router(
        database_download.router, prefix="/api/database", tags=["Database"]
    )
    app.include_router(system.router, prefix="/api", tags=["System"])
    app.include_router(webhooks.router, prefix="/api/webhooks", tags=["Webhooks"])
    app.include_router(comments.router, prefix="/api", tags=["Comments"])
    app.include_router(profile.router, prefix="/api", tags=["Profile"])

    static_dir = os.path.join(project_root, "client", "dist")
    if os.path.exists(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
        return

    logger.warning("Frontend build not found at %s. Serving defaults.", static_dir)

    @app.get("/")
    async def _read_root():
        return {
            "message": (
                "Nesh API running. Frontend not found. "
                "Run 'npm run build' in client/ folder."
            )
        }

    @app.head("/", include_in_schema=False)
    async def _read_root_head():
        return Response(status_code=200)
