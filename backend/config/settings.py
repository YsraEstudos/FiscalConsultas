import json
import os
import secrets
from typing import List, Literal, Optional, Set

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Root path resolving
PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)


class ServerSettings(BaseModel):
    port: int = 8000
    host: str = "127.0.0.1"
    env: str = "development"
    cors_allowed_origins: List[str] = Field(default_factory=list)


class DatabaseSettings(BaseModel):
    """Database configuration with dual-mode SQLite/PostgreSQL support."""

    # SQLite paths (dev/legacy)
    filename: str = "database/nesh.db"
    tipi_filename: str = "database/tipi.db"

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
    chapter_cache_ttl: int = 3600
    fts_cache_ttl: int = 600


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
    clerk_clock_skew_seconds: int = 120  # tolerancia para exp/nbf/iat


class BillingSettings(BaseModel):
    """Billing/Webhook settings."""

    asaas_api_key: Optional[str] = None
    asaas_webhook_token: Optional[str] = None
    asaas_max_payload_bytes: int = 1_048_576


class SecuritySettings(BaseModel):
    """Security and anti-abuse controls."""

    ai_chat_requests_per_minute: int = 5
    ai_chat_max_message_chars: int = 4000
    trusted_proxy_ips: List[str] = Field(default_factory=list)


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
        env_nested_delimiter="__",
        case_sensitive=False,
        extra="ignore",
    )

    @classmethod
    def load(cls) -> "AppSettings":
        """
        Loads configuration prioritizing:
        1. Environment Variables
        2. settings.json
        3. Defaults
        """
        # Try loading from JSON first to populate defaults, then override with Env
        config_path = os.path.join(PROJECT_ROOT, "backend", "config", "settings.json")
        json_data = {}

        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    json_data = json.load(f)
            except Exception as e:
                print(f"⚠️ Failed to load settings.json: {e}")

        # Pydantic handles merging: passed kwargs > env vars > defaults
        # We pass json_data as kwargs
        return cls(**json_data)


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
