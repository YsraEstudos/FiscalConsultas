import asyncio
import logging
import time

from fastapi import Request

from backend.config.settings import settings
from backend.infrastructure.redis_client import redis_cache

logger = logging.getLogger("nesh.routes.system_status")

_STATUS_CACHE: dict[str, object | None] = {"value": None, "expires_at": 0.0}
_STATUS_CACHE_REFRESH_TASK: asyncio.Task | None = None
_STATUS_CACHE_LOCK: asyncio.Lock | None = None


def _build_status_error_payload(catalog_name: str, exc: Exception) -> dict[str, str]:
    logger.warning("%s status collection failed: %s", catalog_name, exc, exc_info=True)
    return {"status": "error", "error": str(exc)}


def get_status_cache_lock() -> asyncio.Lock:
    global _STATUS_CACHE_LOCK
    if _STATUS_CACHE_LOCK is None:
        _STATUS_CACHE_LOCK = asyncio.Lock()
    return _STATUS_CACHE_LOCK


def status_cache_ttl_seconds() -> int:
    return max(int(getattr(settings.cache, "status_cache_ttl", 0) or 0), 0)


def read_l1_status_snapshot(now: float | None = None) -> dict | None:
    snapshot = _STATUS_CACHE.get("value")
    if not isinstance(snapshot, dict):
        return None
    if now is None:
        now = time.monotonic()
    expires_at = float(_STATUS_CACHE.get("expires_at") or 0.0)
    return snapshot if expires_at > now else None


def read_stale_l1_status_snapshot() -> dict | None:
    snapshot = _STATUS_CACHE.get("value")
    return snapshot if isinstance(snapshot, dict) else None


def reset_status_cache_for_tests() -> None:
    global _STATUS_CACHE_LOCK, _STATUS_CACHE_REFRESH_TASK
    _STATUS_CACHE["value"] = None
    _STATUS_CACHE["expires_at"] = 0.0
    _STATUS_CACHE_REFRESH_TASK = None
    _STATUS_CACHE_LOCK = None


def coerce_int(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def extract_prefixed_metadata(raw_stats: dict | None, prefix: str) -> dict[str, str]:
    metadata = (raw_stats or {}).get("metadata")
    if not isinstance(metadata, dict):
        return {}
    prefix_token = f"{prefix}_"
    return {
        key.removeprefix(prefix_token): str(value)
        for key, value in metadata.items()
        if key.startswith(prefix_token)
    }


def normalize_db_status(raw_stats: dict | None, latency_ms: float) -> dict:
    if not raw_stats:
        return {
            "status": "error",
            "chapters": 0,
            "positions": 0,
            "latency_ms": latency_ms,
            "error": "Database unavailable",
        }

    chapters = coerce_int(raw_stats.get("chapters"))
    positions = coerce_int(raw_stats.get("positions"))
    has_error = raw_stats.get("status") == "error"
    payload = {
        "status": "online"
        if not has_error and chapters > 0 and positions > 0
        else "error",
        "chapters": chapters,
        "positions": positions,
        "latency_ms": latency_ms,
    }
    metadata = extract_prefixed_metadata(raw_stats, "nesh")
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


def normalize_tipi_status(raw_stats: dict | None) -> dict:
    raw_stats = raw_stats or {}
    chapters = coerce_int(raw_stats.get("chapters"))
    positions = coerce_int(raw_stats.get("positions"))
    is_online = bool(
        (raw_stats.get("ok") is True or raw_stats.get("status") == "online")
        and chapters > 0
        and positions > 0
    )
    payload = {
        "status": "online" if is_online else "error",
        "chapters": chapters,
        "positions": positions,
    }
    metadata = extract_prefixed_metadata(raw_stats, "tipi")
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


def normalize_count_catalog_status(
    raw_stats: dict | None,
    *,
    count_field: str,
    metadata_prefix: str,
    public_count_field: str,
) -> dict:
    raw_stats = raw_stats or {}
    total = coerce_int(raw_stats.get(count_field))
    payload = {
        "status": (
            "online" if raw_stats.get("status") != "error" and total > 0 else "error"
        ),
        public_count_field: total,
    }
    metadata = extract_prefixed_metadata(raw_stats, metadata_prefix)
    if metadata:
        payload["metadata"] = metadata
    if raw_stats.get("error"):
        payload["error"] = str(raw_stats.get("error"))
    return payload


async def collect_db_status(request: Request) -> tuple[dict, float]:
    db = getattr(request.app.state, "db", None)
    start = time.perf_counter()

    if db:
        db_stats = await db.check_connection()
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        return db_stats, latency_ms

    try:
        from sqlalchemy import text

        from backend.infrastructure.db_engine import get_session

        async with get_session() as session:
            chapters_count = await session.execute(
                text("SELECT COUNT(*) FROM chapters")
            )
            positions_count = await session.execute(
                text("SELECT COUNT(*) FROM positions")
            )
            metadata: dict[str, str] = {}
            if settings.database.is_postgres:
                try:
                    metadata_result = await session.execute(
                        text(
                            """
                            SELECT key, value
                            FROM catalog_metadata
                            WHERE key LIKE 'nesh_%'
                            ORDER BY key
                            """
                        )
                    )
                    metadata = {row.key: row.value for row in metadata_result}
                except Exception:
                    logger.debug(
                        "Failed to fetch catalog_metadata for nesh", exc_info=True
                    )
                    metadata = {}
        db_stats = {
            "status": "online",
            "chapters": int(chapters_count.scalar() or 0),
            "positions": int(positions_count.scalar() or 0),
            "metadata": metadata,
        }
    except Exception as exc:
        db_stats = _build_status_error_payload("database", exc)

    latency_ms = round((time.perf_counter() - start) * 1000, 2)
    return db_stats, latency_ms


async def collect_tipi_status(request: Request) -> dict:
    tipi_service = getattr(request.app.state, "tipi_service", None)
    if tipi_service is None:
        return {"status": "error", "error": "TIPI service unavailable"}
    try:
        return await tipi_service.probeTipiCatalogHealth()
    except Exception as exc:
        return _build_status_error_payload("tipi", exc)


async def collect_nbs_catalog_health(request: Request) -> dict:
    nbs_service = getattr(request.app.state, "nbs_service", None)
    if nbs_service is None:
        return {"status": "error", "error": "NBS service unavailable"}
    try:
        return await nbs_service.probeNbsCatalogHealth()
    except Exception as exc:
        return _build_status_error_payload("nbs", exc)


async def collect_status_payloads_uncached(
    request: Request,
) -> tuple[dict, dict, dict, dict, str]:
    db_stats, db_latency_ms = await collect_db_status(request)
    tipi_stats = await collect_tipi_status(request)
    nbs_stats = await collect_nbs_catalog_health(request)

    normalized_db = normalize_db_status(db_stats, db_latency_ms)
    normalized_tipi = normalize_tipi_status(tipi_stats)
    normalized_nbs = normalize_count_catalog_status(
        nbs_stats,
        count_field="nbs_items",
        metadata_prefix="nbs",
        public_count_field="items",
    )
    normalized_nebs = normalize_count_catalog_status(
        nbs_stats,
        count_field="nebs_entries",
        metadata_prefix="nebs",
        public_count_field="entries",
    )
    overall_status = (
        "online"
        if normalized_db.get("status") == "online"
        and normalized_tipi.get("status") == "online"
        and normalized_nbs.get("status") == "online"
        and normalized_nebs.get("status") == "online"
        else "error"
    )
    return (
        normalized_db,
        normalized_tipi,
        normalized_nbs,
        normalized_nebs,
        overall_status,
    )


def build_status_snapshot(
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict,
    normalized_nebs: dict,
    overall_status: str,
) -> dict:
    return {
        "normalized_db": normalized_db,
        "normalized_tipi": normalized_tipi,
        "normalized_nbs": normalized_nbs,
        "normalized_nebs": normalized_nebs,
        "overall_status": overall_status,
    }


def unpack_status_snapshot(snapshot: dict) -> tuple[dict, dict, dict, dict, str]:
    return (
        dict(snapshot.get("normalized_db") or {}),
        dict(snapshot.get("normalized_tipi") or {}),
        dict(snapshot.get("normalized_nbs") or {}),
        dict(snapshot.get("normalized_nebs") or {}),
        str(snapshot.get("overall_status") or "error"),
    )


def store_status_snapshot(snapshot: dict, *, expires_at: float) -> dict:
    _STATUS_CACHE["value"] = snapshot
    _STATUS_CACHE["expires_at"] = expires_at
    return snapshot


async def refresh_status_snapshot(request: Request, ttl_seconds: int) -> dict:
    snapshot = build_status_snapshot(*await collect_status_payloads_uncached(request))
    store_status_snapshot(snapshot, expires_at=time.monotonic() + ttl_seconds)
    if redis_cache.available:
        try:
            await redis_cache.set_status_snapshot("public", snapshot)
        except Exception:
            logger.warning(
                "Failed to persist status snapshot to Redis; keeping in-process cache",
                exc_info=True,
            )
    return snapshot


async def read_redis_status_snapshot(*, now: float, ttl_seconds: int) -> dict | None:
    if not redis_cache.available:
        return None
    redis_cached = await redis_cache.get_status_snapshot("public")
    if not isinstance(redis_cached, dict):
        return None
    return store_status_snapshot(redis_cached, expires_at=now + ttl_seconds)


async def await_status_refresh_snapshot(request: Request, ttl_seconds: int) -> dict:
    global _STATUS_CACHE_REFRESH_TASK

    task: asyncio.Task | None = None
    lock = get_status_cache_lock()
    async with lock:
        cached = read_l1_status_snapshot()
        if cached is not None:
            return cached
        task = _STATUS_CACHE_REFRESH_TASK
        if task is None:
            task = asyncio.create_task(refresh_status_snapshot(request, ttl_seconds))
            _STATUS_CACHE_REFRESH_TASK = task

    try:
        return await task
    finally:
        async with lock:
            if _STATUS_CACHE_REFRESH_TASK is task:
                _STATUS_CACHE_REFRESH_TASK = None


async def recover_status_snapshot(ttl_seconds: int) -> dict | None:
    stale = read_stale_l1_status_snapshot()
    if stale is not None:
        return stale
    return await read_redis_status_snapshot(
        now=time.monotonic(),
        ttl_seconds=ttl_seconds,
    )


async def get_status_snapshot(request: Request) -> dict:
    ttl_seconds = status_cache_ttl_seconds()
    if ttl_seconds <= 0:
        return build_status_snapshot(*await collect_status_payloads_uncached(request))

    now = time.monotonic()
    cached = read_l1_status_snapshot(now)
    if cached is not None:
        return cached

    redis_cached = await read_redis_status_snapshot(now=now, ttl_seconds=ttl_seconds)
    if redis_cached is not None:
        return redis_cached

    try:
        return await await_status_refresh_snapshot(request, ttl_seconds)
    except Exception:
        logger.warning("Status refresh failed, attempting recovery", exc_info=True)
        fallback = await recover_status_snapshot(ttl_seconds)
        if fallback is not None:
            return fallback
        raise


async def collect_status_payloads(
    request: Request,
) -> tuple[dict, dict, dict, dict, str]:
    return unpack_status_snapshot(await get_status_snapshot(request))


def build_public_status_payload(
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict | str | None = None,
    normalized_nebs: dict | None = None,
    overall_status: str | None = None,
) -> dict:
    legacy_mode = False
    if isinstance(normalized_nbs, str) and overall_status is None:
        overall_status = normalized_nbs
        normalized_nbs = None
        normalized_nebs = None
        legacy_mode = True

    overall_status = overall_status or "error"
    catalogs = {
        "nesh": {"status": normalized_db.get("status", "error")},
        "tipi": {"status": normalized_tipi.get("status", "error")},
    }
    if normalized_nbs is not None:
        catalogs["nbs"] = {"status": normalized_nbs.get("status", "error")}
    if normalized_nebs is not None:
        catalogs["nebs"] = {"status": normalized_nebs.get("status", "error")}

    payload = {
        "status": overall_status,
        "database": {"status": normalized_db.get("status", "error")},
        "tipi": {"status": normalized_tipi.get("status", "error")},
    }
    if not legacy_mode:
        payload["catalogs"] = catalogs
    if normalized_nbs is not None:
        payload["nbs"] = {"status": normalized_nbs.get("status", "error")}
    if normalized_nebs is not None:
        payload["nebs"] = {"status": normalized_nebs.get("status", "error")}
    return payload


def build_detailed_status_payload(
    request: Request,
    normalized_db: dict,
    normalized_tipi: dict,
    normalized_nbs: dict,
    normalized_nebs: dict,
    overall_status: str,
) -> dict:
    catalogs = {
        "nesh": normalized_db,
        "tipi": normalized_tipi,
        "nbs": normalized_nbs,
        "nebs": normalized_nebs,
    }
    return {
        "status": overall_status,
        "version": getattr(request.app, "version", None),
        "backend": "FastAPI",
        "database": normalized_db,
        "tipi": normalized_tipi,
        "nbs": {
            "status": normalized_nbs.get("status", "error"),
            "items": int(normalized_nbs.get("items") or 0),
            **(
                {"metadata": normalized_nbs["metadata"]}
                if isinstance(normalized_nbs.get("metadata"), dict)
                else {}
            ),
            **(
                {"error": normalized_nbs["error"]}
                if normalized_nbs.get("error")
                else {}
            ),
        },
        "nebs": {
            "status": normalized_nebs.get("status", "error"),
            "entries": int(normalized_nebs.get("entries") or 0),
            **(
                {"metadata": normalized_nebs["metadata"]}
                if isinstance(normalized_nebs.get("metadata"), dict)
                else {}
            ),
            **(
                {"error": normalized_nebs["error"]}
                if normalized_nebs.get("error")
                else {}
            ),
        },
        "catalogs": catalogs,
    }
