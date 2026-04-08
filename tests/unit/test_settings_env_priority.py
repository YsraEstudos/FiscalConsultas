import pytest

from backend.config.settings import AppSettings

pytestmark = pytest.mark.unit


def test_load_prioritizes_environment_over_settings_json(monkeypatch):
    monkeypatch.setenv(
        "SERVER__CORS_ALLOWED_ORIGINS",
        '["https://fiscalconsultas.pages.dev"]',
    )
    monkeypatch.setenv(
        "CACHE__REDIS_URL",
        "redis://decent-escargot-70513.upstash.io:6379/0",
    )

    settings = AppSettings.load()

    assert settings.server.cors_allowed_origins == ["https://fiscalconsultas.pages.dev"]
    assert settings.cache.redis_url == "redis://decent-escargot-70513.upstash.io:6379/0"


def test_load_falls_back_to_settings_json_when_env_missing(monkeypatch):
    monkeypatch.delenv("SERVER__CORS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("CACHE__REDIS_URL", raising=False)

    settings = AppSettings.load()

    assert settings.server.cors_allowed_origins == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    assert settings.cache.redis_url == "redis://localhost:6379/0"
