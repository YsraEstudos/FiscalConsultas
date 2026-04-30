import json
import logging
import os
import secrets
from typing import List, Literal, Optional, Set

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import (
    BaseSettings,
    JsonConfigSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

# Root path resolving
PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)


class ServerSettings(BaseModel):
    port: int = 8000
    host: str = "127.0.0.1"
    env: str = "development"
    cors_allowed_origins: List[str] = Field(default_factory=list)
    cors_allowed_origin_regex: Optional[str] = None


class DatabaseSettings(BaseModel):
    """Database configuration with dual-mode SQLite/PostgreSQL support."""

    # SQLite paths (dev/legacy)
    filename: str = "database/nesh.db"
    tipi_filename: str = "database/tipi.db"
    services_filename: str = "database/services.db"

    # PostgreSQL (production)
    postgres_url: Optional[str] = None  # postgresql+asyncpg://user:pass@host/db

    # Engine mode: sqlite or postgresql
    engine: Literal["sqlite", "postgresql"] = "sqlite"

    @property
    def is_postgres(self) -> bool:
        """Returns True if using PostgreSQL engine."""
        return self.engine == "postgresql"

    @property
    def path(self) -> str:
        """Returns SQLite DB path (relative to root if not absolute)."""
        if os.path.isabs(self.filename):
            return self.filename
        return os.path.join(PROJECT_ROOT, self.filename)

    @property
    def tipi_path(self) -> str:
        """Returns TIPI SQLite DB path."""
        if os.path.isabs(self.tipi_filename):
            return self.tipi_filename
        return os.path.join(PROJECT_ROOT, self.tipi_filename)

    @property
    def services_path(self) -> str:
        """Returns services SQLite DB path."""
        if os.path.isabs(self.services_filename):
            return self.services_filename
        return os.path.join(PROJECT_ROOT, self.services_filename)

    @property
    def async_url(self) -> str:
        """Returns async-compatible database URL for SQLAlchemy."""
        if self.is_postgres:
            return self.postgres_url or ""
        return f"sqlite+aiosqlite:///{self.path}"


class SearchSettings(BaseModel):
    stopwords: List[str] = Field(default_factory=list)
    max_query_length: int = 100

    @property
    def stopwords_set(self) -> Set[str]:
        return set(self.stopwords)


class FeatureSettings(BaseModel):
    enable_fts: bool = True
    enable_ai: bool = False
    debug_mode: bool = False


class CacheSettings(BaseModel):
    enable_redis: bool = False
    redis_url: str = "redis://localhost:6379/0"
    max_payload_bytes: int = Field(default=32_768, ge=0)
    chapter_cache_ttl: int = 3600
    fts_cache_ttl: int = 600
    services_search_ttl: int = 600
    services_detail_ttl: int = 1800
    status_cache_ttl: int = 20


class AuthSettings(BaseModel):
    # Valores devem vir de env/JSON. Evita credenciais hardcoded.
    admin_password: str = ""
    admin_password_previous: str = ""
    admin_token: str = ""
    admin_token_previous: str = ""
    secret_key: str = ""
    clerk_domain: Optional[str] = None  # ex: your-app.clerk.accounts.dev
    clerk_issuer: Optional[str] = None  # ex: https://your-app.clerk.accounts.dev
    clerk_audience: Optional[str] = None  # opcional; exige match em "aud"
    clerk_authorized_parties: List[str] = Field(default_factory=list)  # valida "azp"
    clerk_authorized_parties_regex: Optional[str] = None  # regex opcional para previews
    # Tolerancia para exp/nbf/iat; use 5-30s em prod e mantenha hosts com NTP.
    clerk_clock_skew_seconds: int = 30


class BillingSettings(BaseModel):
    """Billing/Webhook settings."""

    asaas_api_key: Optional[str] = None
    asaas_webhook_token: Optional[str] = None
    asaas_max_payload_bytes: int = 1_048_576


class SecuritySettings(BaseModel):
    """Security and anti-abuse controls."""

    ai_chat_requests_per_minute: int = 5
    public_search_requests_per_minute: int = 60
    status_requests_per_minute: int = 30
    services_search_requests_per_minute: int = 30
    services_detail_requests_per_minute: int = 120
    ai_chat_max_message_chars: int = 4000
    ai_chat_allowed_emails: List[str] = Field(default_factory=list)
    restricted_ui_allowed_emails: Optional[List[str]] = None
    trusted_proxy_ips: List[str] = Field(default_factory=list)

    @field_validator(
        "ai_chat_allowed_emails",
        "restricted_ui_allowed_emails",
        mode="before",
    )
    @classmethod
    def _coerce_email_list(cls, value):
        if value is None:
            return None
        if value == "":
            return []
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return parsed
            return [part.strip() for part in stripped.split(",") if part.strip()]
        return value

    @staticmethod
    def _normalize_email_set(values: List[str] | None) -> Set[str]:
        if not values:
            return set()
        return {str(email).strip().lower() for email in values if str(email).strip()}

    @property
    def ai_chat_allowed_email_set(self) -> Set[str]:
        return self._normalize_email_set(self.ai_chat_allowed_emails)

    @property
    def restricted_ui_allowed_email_set(self) -> Set[str]:
        if self.restricted_ui_allowed_emails is not None:
            return self._normalize_email_set(self.restricted_ui_allowed_emails)
        return self.ai_chat_allowed_email_set


class LoggingSettings(BaseModel):
    level: str = "INFO"
    redact_sensitive_data: bool = True

    @property
    def normalized_level(self) -> str:
        return str(self.level or "INFO").strip().upper() or "INFO"

    @property
    def python_level(self) -> int:
        return getattr(logging, self.normalized_level, logging.INFO)


class ObservabilitySettings(BaseModel):
    metrics_token: str = ""
    sentry_dsn: str = ""
    sentry_environment: str = ""
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    @property
    def sentry_enabled(self) -> bool:
        return bool(self.sentry_dsn.strip())

    @property
    def metrics_enabled(self) -> bool:
        return bool(self.metrics_token.strip())


class AppSettings(BaseSettings):
    """
    Main Application Configuration.
    Reads from environment variables and/or settings.json
    """

    server: ServerSettings = Field(default_factory=ServerSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    search: SearchSettings = Field(default_factory=SearchSettings)
    features: FeatureSettings = Field(default_factory=FeatureSettings)
    cache: CacheSettings = Field(default_factory=CacheSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    billing: BillingSettings = Field(default_factory=BillingSettings)
    security: SecuritySettings = Field(default_factory=SecuritySettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)

    # Legacy compatibility property
    @property
    def db_path(self) -> str:
        return self.database.path

    @property
    def port(self) -> int:
        return self.server.port

    @property
    def stopwords(self) -> Set[str]:
        return self.search.stopwords_set

    model_config = SettingsConfigDict(
        env_file=".env",
        json_file=os.path.join(PROJECT_ROOT, "backend", "config", "settings.json"),
        env_nested_delimiter="__",
        case_sensitive=False,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            JsonConfigSettingsSource(settings_cls),
            file_secret_settings,
        )

    @classmethod
    def load(cls) -> "AppSettings":
        """
        Loads configuration prioritizing:
        1. Environment Variables
        2. settings.json
        3. Defaults
        """
        return cls()


# Singleton instance
settings = AppSettings.load()


def _get_model_fields(model: BaseModel) -> Set[str]:
    model_fields = getattr(model, "model_fields", None)
    if isinstance(model_fields, dict):
        return set(model_fields.keys())
    return set(getattr(model, "__fields__", {}).keys())


def reload_settings() -> "AppSettings":
    """
    Reloads settings from env/settings.json into the existing instance.
    Keeps references stable for modules that imported `settings`.
    """
    new_settings = AppSettings.load()
    for field_name in _get_model_fields(new_settings):
        setattr(settings, field_name, getattr(new_settings, field_name))
    return settings


def is_valid_admin_token(token: str | None) -> bool:
    if not token:
        return False
    current = settings.auth.admin_token
    previous = settings.auth.admin_token_previous
    if current and secrets.compare_digest(token, current):
        return True
    if previous and secrets.compare_digest(token, previous):
        return True
    return False


def is_valid_admin_password(password: str | None) -> bool:
    if not password:
        return False
    current = settings.auth.admin_password
    previous = settings.auth.admin_password_previous
    if current and secrets.compare_digest(password, current):
        return True
    if previous and secrets.compare_digest(password, previous):
        return True
    return False
