from types import SimpleNamespace

import pytest

from backend.config.exceptions import ServiceError
from backend.services import ai_service as ai_mod


pytestmark = pytest.mark.unit


class _OkModel:
    async def generate_content_async(self, message: str):
        return SimpleNamespace(text=f"ok:{message}")


class _ErrorModel:
    async def generate_content_async(self, _message: str):
        raise RuntimeError("genai failure")


def test_init_without_api_key_disables_model(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(ai_mod.logger, "warning", lambda _msg: None)

    service = ai_mod.AiService()
    assert service.model is None


def test_init_with_api_key_sets_model(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "k-test")
    monkeypatch.setattr(ai_mod.genai, "configure", lambda **_kwargs: None)
    monkeypatch.setattr(ai_mod.genai, "GenerativeModel", lambda _name: _OkModel())
    monkeypatch.setattr(ai_mod.logger, "info", lambda _msg: None)

    service = ai_mod.AiService()
    assert service.model is not None


def test_init_with_api_key_handles_provider_error(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "k-test")
    monkeypatch.setattr(ai_mod.genai, "configure", lambda **_kwargs: None)
    monkeypatch.setattr(ai_mod.genai, "GenerativeModel", lambda _name: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(ai_mod.logger, "error", lambda _msg: None)

    service = ai_mod.AiService()
    assert service.model is None


@pytest.mark.asyncio
async def test_get_chat_response_requires_configured_model(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(ai_mod.logger, "warning", lambda _msg: None)
    service = ai_mod.AiService()

    with pytest.raises(ServiceError) as exc:
        await service.get_chat_response("oi")
    assert exc.value.code == "SERVICE_ERROR"
    assert exc.value.service == "AI"


@pytest.mark.asyncio
async def test_get_chat_response_success(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(ai_mod.logger, "warning", lambda _msg: None)
    service = ai_mod.AiService()
    service.model = _OkModel()

    text = await service.get_chat_response("hello")
    assert text == "ok:hello"


@pytest.mark.asyncio
async def test_get_chat_response_wraps_provider_exception(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(ai_mod.logger, "warning", lambda _msg: None)
    monkeypatch.setattr(ai_mod.logger, "error", lambda _msg: None)
    service = ai_mod.AiService()
    service.model = _ErrorModel()

    with pytest.raises(ServiceError) as exc:
        await service.get_chat_response("hello")
    assert exc.value.service == "AI"

