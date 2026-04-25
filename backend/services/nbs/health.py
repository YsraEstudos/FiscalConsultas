from __future__ import annotations

from backend.config.logging_config import service_logger as logger

from .bootstrap import acquire_nbs_repository
from .sqlite_common import (
    acquire_nbs_sqlite_connection,
    nbs_table_exists,
)
from .types import NbsServiceState


def build_nbs_health_payload(
    nbs_items: int,
    nebs_entries: int,
    metadata: dict[str, str],
) -> dict[str, object]:
    status = "online" if nbs_items > 0 and nebs_entries > 0 else "error"
    return {
        "status": status,
        "nbs_items": nbs_items,
        "nebs_entries": nebs_entries,
        "metadata": metadata,
    }


async def probe_nbs_repository_health(service: NbsServiceState) -> dict[str, object]:
    async with acquire_nbs_repository(service) as repo:
        if repo is None:
            raise RuntimeError("NBS repository unavailable")
        counts = await repo.snapshot_nbs_catalog_counts()
        metadata = await repo.snapshot_nbs_catalog_metadata()
    return build_nbs_health_payload(
        int(counts.get("nbs_items", 0)),
        int(counts.get("nebs_entries", 0)),
        metadata,
    )


async def count_nbs_sqlite_rows(conn, table: str, query: str) -> int:
    if not await nbs_table_exists(conn, table):
        return 0
    cursor = await conn.execute(query)
    row = await cursor.fetchone()
    return int(row[0] if row else 0)


async def read_nbs_sqlite_catalog_metadata(conn) -> dict[str, str]:
    if not await nbs_table_exists(conn, "catalog_metadata"):
        return {}
    cursor = await conn.execute("SELECT key, value FROM catalog_metadata")
    return {row["key"]: row["value"] for row in await cursor.fetchall()}


async def probe_nbs_sqlite_health(service: NbsServiceState) -> dict[str, object]:
    if not service.db_path.exists():
        return {
            "status": "error",
            "error": f"Banco NBS não encontrado: {service.db_path}",
        }

    conn = await acquire_nbs_sqlite_connection(service)
    try:
        nbs_count = await count_nbs_sqlite_rows(
            conn,
            "nbs_items",
            "SELECT COUNT(*) FROM nbs_items",
        )
        nebs_count = await count_nbs_sqlite_rows(
            conn,
            "nebs_entries",
            "SELECT COUNT(*) FROM nebs_entries WHERE parser_status = 'trusted'",
        )
        metadata = await read_nbs_sqlite_catalog_metadata(conn)
        return build_nbs_health_payload(nbs_count, nebs_count, metadata)
    except Exception as exc:
        logger.error("NBS SQLite healthcheck failed: %s", exc)
        return {"status": "error", "error": str(exc)}
    finally:
        from .sqlite_common import release_nbs_sqlite_connection

        await release_nbs_sqlite_connection(service, conn)


async def probe_nbs_catalog_health(service: NbsServiceState) -> dict[str, object]:
    if service._use_repository:
        try:
            return await probe_nbs_repository_health(service)
        except Exception as exc:
            logger.error("NBS repository healthcheck failed: %s", exc)
            return {"status": "error", "error": str(exc)}
    return await probe_nbs_sqlite_health(service)
