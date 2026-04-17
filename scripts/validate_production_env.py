from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.config.settings import settings
from backend.server.middleware import is_loopback_host, origin_looks_like_loopback


def _print_items(prefix: str, items: list[str]) -> None:
    for item in items:
        print(f"[{prefix}] {item}")


def main() -> int:
    warnings: list[str] = []
    errors: list[str] = []

    if settings.server.env != "production":
        warnings.append(
            f"SERVER__ENV={settings.server.env!r}. Este validador foi pensado para deploy publicado."
        )

    if settings.server.env == "production" and settings.features.debug_mode:
        errors.append("FEATURES__DEBUG_MODE deve ficar false em produção.")

    if settings.server.env == "production" and not settings.server.cors_allowed_origins:
        errors.append(
            "SERVER__CORS_ALLOWED_ORIGINS deve listar explicitamente os domínios oficiais do frontend."
        )

    if settings.server.env == "production" and any(
        origin_looks_like_loopback(origin)
        for origin in settings.server.cors_allowed_origins
    ):
        warnings.append(
            "SERVER__CORS_ALLOWED_ORIGINS ainda inclui localhost/loopback. Remova isso do ambiente publicado."
        )

    if settings.database.is_postgres and not settings.database.postgres_url:
        errors.append(
            "DATABASE__ENGINE=postgresql exige DATABASE__POSTGRES_URL preenchida."
        )

    if settings.server.env == "production" and not settings.database.is_postgres:
        warnings.append(
            "DATABASE__ENGINE não está em postgresql. Isso é aceitável só para ambiente temporário, não para produção final."
        )

    if settings.cache.enable_redis:
        if not settings.cache.redis_url.strip():
            errors.append("CACHE__ENABLE_REDIS=true exige CACHE__REDIS_URL preenchida.")
        elif is_loopback_host(urlparse(settings.cache.redis_url).hostname):
            warnings.append(
                "CACHE__REDIS_URL ainda aponta para localhost. Em produção, use Redis gerenciado."
            )

    if (
        settings.server.env == "production"
        and not settings.observability.metrics_enabled
    ):
        warnings.append(
            "OBSERVABILITY__METRICS_TOKEN ausente. O endpoint /api/metrics ficará desabilitado."
        )

    if (
        settings.server.env == "production"
        and not settings.observability.sentry_enabled
    ):
        warnings.append(
            "OBSERVABILITY__SENTRY_DSN ausente. Erros do backend não serão enviados para APM externo."
        )

    if settings.server.env == "production" and not settings.auth.clerk_domain:
        warnings.append(
            "AUTH__CLERK_DOMAIN ausente. Fluxos autenticados não serão validados."
        )
    if settings.server.env == "production" and not settings.auth.clerk_issuer:
        warnings.append(
            "AUTH__CLERK_ISSUER ausente. O backend perde validação explícita de issuer."
        )
    if (
        settings.server.env == "production"
        and not settings.auth.clerk_authorized_parties
        and not settings.auth.clerk_authorized_parties_regex
    ):
        warnings.append(
            "Nenhum AUTH__CLERK_AUTHORIZED_PARTIES(_REGEX) configurado. Revise azp antes do deploy."
        )

    _print_items("ERROR", errors)
    _print_items("WARN", warnings)

    if errors:
        print("[FAIL] Ambiente não está pronto para deploy publicado.")
        return 1

    print("[OK] Validação de ambiente concluída sem erros bloqueantes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
