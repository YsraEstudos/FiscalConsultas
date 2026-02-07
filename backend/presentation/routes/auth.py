from fastapi import APIRouter, Depends, HTTPException, Request
from backend.services.ai_service import AiService
from backend.config.settings import settings
from backend.server.dependencies import get_ai_service
from backend.server.middleware import decode_clerk_jwt, is_clerk_token_valid
from backend.server.rate_limit import ai_chat_rate_limiter
from backend.presentation.schemas.chat import ChatRequest

router = APIRouter()

def _extract_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return None


def _is_authenticated(token: str | None) -> bool:
    if not token:
        return False
    return is_clerk_token_valid(token)


def _extract_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        # Primeiro IP da cadeia
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _build_limiter_key(http_request: Request, token: str | None) -> str:
    if token:
        payload = decode_clerk_jwt(token) or {}
        user_id = payload.get("sub")
        if user_id:
            return f"ai:user:{user_id}"
    return f"ai:ip:{_extract_client_ip(http_request)}"


@router.get("/auth/me")
async def auth_me(http_request: Request):
    token = _extract_token(http_request)
    return {"authenticated": _is_authenticated(token)}

@router.post("/ai/chat")
async def chat_endpoint(
    request: ChatRequest,
    http_request: Request,
    ai_service: AiService = Depends(get_ai_service),
):
    """
    Endpoint de Chat com IA.
    Protegido por JWT do Clerk.
    """
    token = _extract_token(http_request)
    if not _is_authenticated(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    limiter_key = _build_limiter_key(http_request, token)
    allowed, retry_after = ai_chat_rate_limiter.consume(
        key=limiter_key,
        limit=settings.security.ai_chat_requests_per_minute,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for AI chat. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    response_text = await ai_service.get_chat_response(request.message)
    return {"success": True, "reply": response_text}
