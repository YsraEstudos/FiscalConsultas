"""Admin Dashboard routes — search telemetry + device monitoring.

Endpoints:
- POST /admin/search-event  — log a search event (open to all, auth optional)
- GET  /admin/dashboard      — admin-only overview of devices & searches
- GET  /admin/device/{fp}/history — admin-only drill-down for a device
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, delete, func, select

from backend.domain.sqlmodels import SearchEvent
from backend.infrastructure.db_engine import get_session
from backend.server.middleware import decode_clerk_jwt
from backend.utils.auth import extract_bearer_token, is_admin_payload

router = APIRouter()
logger = logging.getLogger("routes.admin_dashboard")

ACTIVE_THRESHOLD_MINUTES = 30
RETENTION_DAYS = 90
VALID_SEARCH_TYPES = {"nesh", "tipi", "nbs", "text"}


# ─── Request / Response schemas ────────────────────────────────────


class SearchEventRequest(BaseModel):
    search_type: str = Field(..., max_length=20)
    search_query: Optional[str] = Field(None, max_length=300)
    device_fingerprint: str = Field(..., max_length=128)
    device_label: Optional[str] = Field(None, max_length=255)


class DeviceSummary(BaseModel):
    fingerprint: str
    label: Optional[str]
    user_email: Optional[str]
    user_id: Optional[str]
    last_active: datetime
    is_active: bool
    searches_today: int
    total_searches: int


class DashboardResponse(BaseModel):
    total_active_devices: int
    total_searches_today: int
    searches_by_type: dict[str, int]
    devices: list[DeviceSummary]


class DailyStats(BaseModel):
    date: str
    nesh: int = 0
    tipi: int = 0
    nbs: int = 0
    text: int = 0
    total: int = 0


class RecentSearch(BaseModel):
    query: Optional[str]
    type: str
    at: datetime


class DeviceHistoryResponse(BaseModel):
    device: DeviceSummary
    daily_stats: list[DailyStats]
    recent_searches: list[RecentSearch]


# ─── Helpers ────────────────────────────────────────────────────────


async def _is_admin_request(request: Request) -> bool:
    token = extract_bearer_token(request)
    if not token:
        return False
    payload = await decode_clerk_jwt(token)
    return is_admin_payload(payload)


async def _extract_user_info(
    request: Request,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Extract user_id, email, session_id, tenant_id from JWT if present."""
    token = extract_bearer_token(request)
    if not token:
        return None, None, None, None
    payload = await decode_clerk_jwt(token)
    if not payload:
        return None, None, None, None
    user_id = payload.get("sub")
    email = (
        payload.get("email")
        or payload.get("email_address")
        or payload.get("primary_email_address")
    )
    session_id = payload.get("sid")
    org_id = payload.get("org_id")
    return user_id, email, session_id, org_id


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _active_cutoff() -> datetime:
    return _now_utc() - timedelta(minutes=ACTIVE_THRESHOLD_MINUTES)


def _today_start() -> datetime:
    now = _now_utc()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


# ─── POST /admin/search-event ──────────────────────────────────────


@router.post("/admin/search-event", status_code=204)
async def log_search_event(body: SearchEventRequest, request: Request):
    """
    Log a search event. Open to all users (including anonymous).
    Fire-and-forget from the client perspective.
    """
    search_type = body.search_type.strip().lower()
    if search_type not in VALID_SEARCH_TYPES:
        raise HTTPException(status_code=422, detail="Invalid search_type")

    fingerprint = body.device_fingerprint.strip()
    if not fingerprint:
        raise HTTPException(status_code=422, detail="device_fingerprint required")

    user_id, email, session_id, org_id = await _extract_user_info(request)

    async with get_session() as session:
        event = SearchEvent(
            user_id=user_id,
            user_email=email,
            session_id=session_id,
            device_fingerprint=fingerprint,
            device_label=(body.device_label or "").strip()[:255] or None,
            search_type=search_type,
            search_query=(body.search_query or "").strip()[:300] or None,
            tenant_id=org_id,
        )
        session.add(event)

    # Opportunistic cleanup: 1-in-100 chance to purge old events
    import secrets

    if secrets.randbelow(100) == 0:
        try:
            async with get_session() as session:
                cutoff = _now_utc() - timedelta(days=RETENTION_DAYS)
                await session.execute(
                    delete(SearchEvent).where(SearchEvent.created_at < cutoff)
                )
        except Exception as exc:
            logger.warning("Failed to purge old search events: %s", exc)

    return None


# ─── GET /admin/dashboard ──────────────────────────────────────────


@router.get("/admin/dashboard")
async def get_admin_dashboard(request: Request) -> DashboardResponse:
    """Admin-only dashboard with device/search overview."""
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    today_start = _today_start()
    cutoff = _active_cutoff()

    async with get_session() as session:
        # Searches by type today
        type_counts_result = await session.execute(
            select(
                SearchEvent.search_type,
                func.count(SearchEvent.id),
            )
            .where(SearchEvent.created_at >= today_start)
            .group_by(SearchEvent.search_type)
        )
        searches_by_type: dict[str, int] = {}
        total_today = 0
        for row in type_counts_result:
            searches_by_type[row[0]] = row[1]
            total_today += row[1]

        # Device summaries
        devices_result = await session.execute(
            select(
                SearchEvent.device_fingerprint,
                func.max(SearchEvent.device_label).label("label"),
                func.max(SearchEvent.user_email).label("email"),
                func.max(SearchEvent.user_id).label("uid"),
                func.max(SearchEvent.created_at).label("last_active"),
                func.count(SearchEvent.id).label("total"),
                func.sum(
                    case(
                        (SearchEvent.created_at >= today_start, 1),
                        else_=0,
                    )
                ).label("today"),
            )
            .group_by(SearchEvent.device_fingerprint)
            .order_by(func.max(SearchEvent.created_at).desc())
            .limit(200)
        )

        devices: list[DeviceSummary] = []
        active_count = 0
        for row in devices_result:
            is_active = row.last_active >= cutoff if row.last_active else False
            if is_active:
                active_count += 1
            devices.append(
                DeviceSummary(
                    fingerprint=row.device_fingerprint,
                    label=row.label,
                    user_email=row.email,
                    user_id=row.uid,
                    last_active=row.last_active,
                    is_active=is_active,
                    searches_today=row.today or 0,
                    total_searches=row.total or 0,
                )
            )

    return DashboardResponse(
        total_active_devices=active_count,
        total_searches_today=total_today,
        searches_by_type=searches_by_type,
        devices=devices,
    )


# ─── GET /admin/device/{fingerprint}/history ───────────────────────


@router.get("/admin/device/{fingerprint}/history")
async def get_device_history(
    fingerprint: str, request: Request
) -> DeviceHistoryResponse:
    """Admin-only drill-down for a specific device."""
    if not await _is_admin_request(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    today_start = _today_start()
    cutoff = _active_cutoff()

    async with get_session() as session:
        # Device summary
        device_row = await session.execute(
            select(
                func.max(SearchEvent.device_label).label("label"),
                func.max(SearchEvent.user_email).label("email"),
                func.max(SearchEvent.user_id).label("uid"),
                func.max(SearchEvent.created_at).label("last_active"),
                func.count(SearchEvent.id).label("total"),
                func.sum(
                    case(
                        (SearchEvent.created_at >= today_start, 1),
                        else_=0,
                    )
                ).label("today"),
            ).where(SearchEvent.device_fingerprint == fingerprint)
        )
        row = device_row.one_or_none()
        if not row or not row.last_active:
            raise HTTPException(status_code=404, detail="Device not found")

        device = DeviceSummary(
            fingerprint=fingerprint,
            label=row.label,
            user_email=row.email,
            user_id=row.uid,
            last_active=row.last_active,
            is_active=row.last_active >= cutoff,
            searches_today=row.today or 0,
            total_searches=row.total or 0,
        )

        # Daily stats (last 14 days)
        fourteen_days_ago = _now_utc() - timedelta(days=14)
        daily_result = await session.execute(
            select(
                func.date(SearchEvent.created_at).label("d"),
                SearchEvent.search_type,
                func.count(SearchEvent.id).label("cnt"),
            )
            .where(
                and_(
                    SearchEvent.device_fingerprint == fingerprint,
                    SearchEvent.created_at >= fourteen_days_ago,
                )
            )
            .group_by(func.date(SearchEvent.created_at), SearchEvent.search_type)
            .order_by(func.date(SearchEvent.created_at).desc())
        )

        daily_map: dict[str, dict[str, int]] = {}
        for dr in daily_result:
            date_str = str(dr.d)
            if date_str not in daily_map:
                daily_map[date_str] = {}
            daily_map[date_str][dr.search_type] = dr.cnt

        daily_stats = []
        for date_str, type_counts in sorted(daily_map.items(), reverse=True):
            total = sum(type_counts.values())
            daily_stats.append(
                DailyStats(
                    date=date_str,
                    nesh=type_counts.get("nesh", 0),
                    tipi=type_counts.get("tipi", 0),
                    nbs=type_counts.get("nbs", 0),
                    text=type_counts.get("text", 0),
                    total=total,
                )
            )

        # Recent searches (last 50)
        recent_result = await session.execute(
            select(
                SearchEvent.search_query,
                SearchEvent.search_type,
                SearchEvent.created_at,
            )
            .where(SearchEvent.device_fingerprint == fingerprint)
            .order_by(SearchEvent.created_at.desc())
            .limit(50)
        )

        recent = [
            RecentSearch(query=r.search_query, type=r.search_type, at=r.created_at)
            for r in recent_result
        ]

    return DeviceHistoryResponse(
        device=device,
        daily_stats=daily_stats,
        recent_searches=recent,
    )
