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


async def _is_authenticated(token: str | None) -> bool:
    if not token:
        return False
    return (await decode_clerk_jwt(token)) is not None


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
    return {"authenticated": await _is_authenticated(token)}


@router.post(
    "/ai/chat",
    responses={
        401: {"description": "Unauthorized (missing or invalid Clerk JWT)."},
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
