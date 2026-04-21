from __future__ import annotations

from fastapi import Request, Response


_DOCS_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})


def _build_content_security_policy(server_env: str) -> str:
    connect_sources = ["'self'", "https:", "wss:"]
    if server_env == "development":
        connect_sources.extend(
            [
                "http://127.0.0.1:8000",
                "http://localhost:8000",
                "ws://127.0.0.1:*",
                "ws://localhost:*",
            ]
        )

    return "; ".join(
        (
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            (
                "script-src 'self' https://*.clerk.accounts.dev "
                "https://*.clerk.com https://challenges.cloudflare.com"
            ),
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https:",
            "font-src 'self' https://fonts.gstatic.com data:",
            f"connect-src {' '.join(connect_sources)}",
            "worker-src 'self' blob:",
            (
                "frame-src 'self' https://*.clerk.accounts.dev "
                "https://*.clerk.com https://challenges.cloudflare.com"
            ),
        )
    )


def _should_expose_api_docs(server_env: str, debug_mode: bool) -> bool:
    return server_env == "development" and debug_mode


def _request_uses_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        proto = forwarded_proto.split(",", 1)[0].strip().lower()
        if proto == "https":
            return True
    return request.url.scheme.lower() == "https"


def _apply_security_headers(
    request: Request, response: Response, server_env: str
) -> None:
    response.headers["Content-Security-Policy"] = _build_content_security_policy(
        server_env
    )
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if _request_uses_https(request):
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )


def _build_cors_configuration(
    server_env: str,
    cors_allowed_origins: list[str] | None,
    cors_allowed_origin_regex: str | None,
) -> tuple[list[str], str | None]:
    cors_origins = cors_allowed_origins or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://ysraestudos.github.io",
    ]

    cors_regex_parts: list[str] = []
    configured_cors_regex = (cors_allowed_origin_regex or "").strip()
    if configured_cors_regex:
        cors_regex_parts.append(f"(?:{configured_cors_regex})")

    if server_env == "development":
        cors_regex_parts.append(
            r"(?:^https?://(?:localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::5173)?$)"
        )

    cors_allow_origin_regex = "|".join(cors_regex_parts) or None
    return cors_origins, cors_allow_origin_regex
