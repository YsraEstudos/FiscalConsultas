from typing import Annotated

from backend.config.settings import settings
from backend.presentation.schemas.chat import ChatRequest
from backend.server.dependencies import get_ai_service
from backend.server.middleware import decode_clerk_jwt
from backend.server.rate_limit import ai_chat_rate_limiter
from backend.services.ai_service import AiService
from backend.utils.auth import extract_bearer_token, extract_client_ip
from fastapi import APIRouter, Depends, HTTPException, Request

router = APIRouter()


def _extract_client_ip(request: Request) -> str:
    return extract_client_ip(request)


def _normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _extract_email_from_payload(payload: dict | None) -> str | None:
    if not payload:
        return None

    direct_claims = (
        payload.get("email"),
        payload.get("email_address"),
        payload.get("primary_email_address"),
    )
    for candidate in direct_claims:
        normalized = _normalize_email(candidate if isinstance(candidate, str) else None)
        if normalized:
            return normalized

    email_addresses = payload.get("email_addresses")
    if isinstance(email_addresses, list):
        for candidate in email_addresses:
            if isinstance(candidate, str):
                normalized = _normalize_email(candidate)
                if normalized:
                    return normalized
            elif isinstance(candidate, dict):
                normalized = _normalize_email(
                    candidate.get("email_address") or candidate.get("email")
                )
                if normalized:
                    return normalized

    return None


def _is_email_allowed(email: str | None, allowed_emails: set[str]) -> bool:
    normalized = _normalize_email(email)
    if not normalized:
        return False
    return normalized in allowed_emails


def _build_auth_me_payload(payload: dict | None) -> dict:
    authenticated = payload is not None
    email = _extract_email_from_payload(payload)
    return {
        "authenticated": authenticated,
        "can_use_ai_chat": authenticated
        and _is_email_allowed(email, settings.security.ai_chat_allowed_email_set),
        "can_use_restricted_ui": authenticated
        and _is_email_allowed(email, settings.security.restricted_ui_allowed_email_set),
    }


async def _build_limiter_key(
    http_request: Request,
    token: str | None = None,
    jwt_payload: dict | None = None,
) -> str:
    payload = jwt_payload
    if payload is None and token:
        payload = (await decode_clerk_jwt(token)) or {}
    if payload:
        user_id = payload.get("sub")
        if user_id:
            return f"ai:user:{user_id}"
    return f"ai:ip:{extract_client_ip(http_request)}"


@router.get("/auth/me")
async def auth_me(http_request: Request):
    token = extract_bearer_token(http_request)
    payload = (await decode_clerk_jwt(token)) if token else None
    return _build_auth_me_payload(payload)


@router.post(
    "/ai/chat",
    responses={
        401: {"description": "Unauthorized (missing or invalid Clerk JWT)."},
        403: {"description": "Forbidden (authenticated user without AI chat access)."},
        413: {"description": "Message too long for configured limit."},
        422: {"description": "Validation error (empty message)."},
        429: {"description": "Rate limit exceeded for AI chat requests."},
    },
)
async def chat_endpoint(
    request: ChatRequest,
    http_request: Request,
    ai_service: Annotated[AiService, Depends(get_ai_service)],
):
    """
    Endpoint de Chat com IA.
    Protegido por JWT do Clerk.
    """
    message = (request.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message must not be empty")
    if len(message) > settings.security.ai_chat_max_message_chars:
        max_chars = settings.security.ai_chat_max_message_chars
        raise HTTPException(
            status_code=413,
            detail=f"message too long (max {max_chars} chars)",
        )

    token = extract_bearer_token(http_request)
    payload = (await decode_clerk_jwt(token)) if token else None
    if not payload:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not _is_email_allowed(
        _extract_email_from_payload(payload),
        settings.security.ai_chat_allowed_email_set,
    ):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: user does not have AI chat access",
        )

    limiter_key = await _build_limiter_key(
        http_request, token=token, jwt_payload=payload
    )
    allowed, retry_after = await ai_chat_rate_limiter.consume(
        key=limiter_key,
        limit=settings.security.ai_chat_requests_per_minute,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for AI chat. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    response_text = await ai_service.get_chat_response(message)
    return {"success": True, "reply": response_text}
