from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from ...config.logging_config import service_logger as logger
from .types import TipiRepositoryHealthPayload, TipiSqliteHealthPayload

if TYPE_CHECKING:
    from ..tipi_service import TipiService


async def probe_tipi_repository_catalog_health(
    service: "TipiService",
) -> TipiRepositoryHealthPayload:
    try:
        async with service._acquire_tipi_repository() as repo:
            if repo is None:
                raise RuntimeError("TIPI repository unavailable")

            chapters_result = await repo.session.execute(
                text("SELECT COUNT(DISTINCT chapter_num) FROM tipi_positions")
            )
            positions_result = await repo.session.execute(
                text("SELECT COUNT(*) FROM tipi_positions")
            )
            metadata_result = await repo.session.execute(
                text(
                    """
                    SELECT key, value
                    FROM catalog_metadata
                    WHERE key LIKE 'tipi_%'
                    ORDER BY key
                    """
                )
            )
            chapters = int(chapters_result.scalar() or 0)
            positions = int(positions_result.scalar() or 0)
            metadata_rows = list(metadata_result)

        metadata = {row.key: row.value for row in metadata_rows}
        return {
            "status": "online" if chapters > 0 and positions > 0 else "error",
            "chapters": chapters,
            "positions": positions,
            "metadata": metadata,
        }
    except asyncio.CancelledError:
        raise
    except (SQLAlchemyError, RuntimeError, OSError) as exc:
        logger.error("TIPI repository healthcheck failed: %s", exc)
        return {"status": "error", "error": str(exc)}


async def probe_tipi_sqlite_catalog_health(
    service: "TipiService",
) -> TipiSqliteHealthPayload:
    if not await asyncio.to_thread(service.db_path.exists):
        return {
            "ok": False,
            "error": f"Banco TIPI não encontrado: {service.db_path}",
        }

    try:
        conn = await service._acquire_tipi_connection()
        try:
            cursor = await conn.execute("SELECT COUNT(*) FROM tipi_chapters")
            chapters_row = await cursor.fetchone()
            chapters = chapters_row[0] if chapters_row else 0

            cursor = await conn.execute("SELECT COUNT(*) FROM tipi_positions")
            positions_row = await cursor.fetchone()
            positions = positions_row[0] if positions_row else 0

            return {"ok": True, "chapters": chapters, "positions": positions}
        finally:
            await service._release_tipi_connection(conn)
    except asyncio.CancelledError:
        raise
    except (SQLAlchemyError, RuntimeError, OSError) as exc:
        logger.error("TIPI Check Connection failed: %s", exc)
        return {"ok": False, "error": str(exc)}
