"""
Security incident reporting endpoint.

Receives client-side security events (DevTools detection, tampering, etc.)
and logs them for monitoring and alerting.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.utils.auth import extract_client_ip
from backend.server.rate_limit import RedisBackedRateLimiter

logger = logging.getLogger("routes.security")

router = APIRouter()

# Track incidents to escalate sustained probing attempts
_INCIDENT_WINDOW = 3600  # 1 hour
_incident_tracker = RedisBackedRateLimiter(
    window_seconds=_INCIDENT_WINDOW,
    redis_prefix="sec-incident"
)
_INCIDENT_THRESHOLD = 3


class SecurityIncidentReport(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    ts: int | None = None


@router.post("/security/incident")
async def report_security_incident(
    request: Request,
    report: SecurityIncidentReport,
):
    """
    Receive a client-side security incident report.

    Logs the event with the client IP for audit purposes.
    Escalates to CRITICAL if sustained probing is detected.
    This endpoint is intentionally lightweight and always returns 200
    to avoid leaking information to potential attackers.
    """
    client_ip = extract_client_ip(request)
    user_agent = (request.headers.get("user-agent") or "")[:200]
    
    # Active monitoring: track frequency of incidents per IP
    key = f"{client_ip}:{report.type}"
    allowed, _ = await _incident_tracker.consume(key=key, limit=_INCIDENT_THRESHOLD)

    if not allowed:
        # Escalate: sustained probing detected
        logger.critical(
            "SECURITY_ESCALATION ip=%s type=%s ts=%s ua=%s threshold_exceeded=true "
            "msg='Multiple security incidents detected from this IP within the monitoring window.'",
            client_ip,
            report.type,
            report.ts,
            user_agent,
        )
    else:
        # Standard warning
        logger.warning(
            "SECURITY_INCIDENT ip=%s type=%s ts=%s ua=%s",
            client_ip,
            report.type,
            report.ts,
            user_agent,
        )
        
    return {"acknowledged": True}
