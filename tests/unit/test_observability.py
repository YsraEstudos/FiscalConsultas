import types

import pytest

from backend.server import observability

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_observability_state(monkeypatch):
    observability.reset_observability_for_tests()
    monkeypatch.setattr(
        observability.settings.observability, "sentry_dsn", "", raising=False
    )
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_environment",
        "",
        raising=False,
    )
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_traces_sample_rate",
        0.0,
        raising=False,
    )
    monkeypatch.setattr(
        observability.settings.server, "env", "development", raising=False
    )
    yield
    observability.reset_observability_for_tests()


def test_configure_observability_skips_when_dsn_missing(monkeypatch):
    called = {"count": 0}

    def _unexpected_import(_name):  # NOSONAR
        called["count"] += 1
        raise AssertionError("sentry_sdk should not be imported without DSN")

    monkeypatch.setattr(observability.importlib, "import_module", _unexpected_import)

    observability.configure_observability()

    assert called["count"] == 0


def test_configure_observability_logs_warning_when_sdk_missing(monkeypatch):
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_dsn",
        "https://public@example.ingest.sentry.io/1",
        raising=False,
    )
    warnings: list[str] = []

    def _missing_import(_name):  # NOSONAR
        raise ModuleNotFoundError("missing sentry")

    def _capture_warning(message, *args, **kwargs):  # NOSONAR
        warnings.append(str(message))

    monkeypatch.setattr(observability.importlib, "import_module", _missing_import)
    monkeypatch.setattr(observability.logger, "warning", _capture_warning)

    observability.configure_observability()

    assert any("sentry_sdk is not installed" in message for message in warnings)


def test_configure_observability_initializes_sentry_once(monkeypatch):
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_dsn",
        "https://public@example.ingest.sentry.io/1",
        raising=False,
    )
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_environment",
        "public-beta",
        raising=False,
    )
    monkeypatch.setattr(
        observability.settings.observability,
        "sentry_traces_sample_rate",
        0.25,
        raising=False,
    )

    calls: list[dict] = []

    def _fake_init(**kwargs):  # NOSONAR
        calls.append(kwargs)

    class _FakeFastApiIntegration:
        def __call__(self):  # pragma: no cover - not used
            return self

    fake_sentry_sdk = types.SimpleNamespace(init=_fake_init)
    fake_fastapi_module = types.SimpleNamespace(
        FastApiIntegration=_FakeFastApiIntegration
    )

    def _fake_import(name):  # NOSONAR
        if name == "sentry_sdk":
            return fake_sentry_sdk
        if name == "sentry_sdk.integrations.fastapi":
            return fake_fastapi_module
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(observability.importlib, "import_module", _fake_import)

    observability.configure_observability(release="v1.2.3", server_name="render-api")
    observability.configure_observability(release="v1.2.3", server_name="render-api")

    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://public@example.ingest.sentry.io/1"
    assert calls[0]["environment"] == "public-beta"
    assert calls[0]["traces_sample_rate"] == 0.25
    assert calls[0]["release"] == "v1.2.3"
    assert calls[0]["server_name"] == "render-api"
    assert len(calls[0]["integrations"]) == 1
