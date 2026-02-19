import pytest

from backend.utils import frontend_check


pytestmark = pytest.mark.unit


def test_verify_frontend_build_logs_error_when_build_missing(monkeypatch):
    errors = []
    monkeypatch.setattr(frontend_check.os.path, "exists", lambda _p: False)
    monkeypatch.setattr(frontend_check.logger, "error", lambda msg: errors.append(msg))

    frontend_check.verify_frontend_build("C:/proj")
    assert any("FRONTEND BUILD NOT FOUND" in msg for msg in errors)


def test_verify_frontend_build_warns_when_package_is_newer(monkeypatch):
    monkeypatch.setattr(frontend_check.os.path, "exists", lambda _p: True)
    monkeypatch.setattr(
        frontend_check.os.path,
        "getmtime",
        lambda p: 200.0 if p.endswith("package.json") else 100.0,
    )
    warnings = []
    monkeypatch.setattr(frontend_check.logger, "warning", lambda msg: warnings.append(msg))
    monkeypatch.setattr(frontend_check.logger, "info", lambda _msg: None)

    frontend_check.verify_frontend_build("C:/proj")
    assert any("OUTDATED" in msg for msg in warnings)


def test_verify_frontend_build_info_when_fresh(monkeypatch):
    monkeypatch.setattr(frontend_check.os.path, "exists", lambda _p: True)
    monkeypatch.setattr(
        frontend_check.os.path,
        "getmtime",
        lambda p: 50.0 if p.endswith("package.json") else 100.0,
    )
    infos = []
    monkeypatch.setattr(frontend_check.logger, "info", lambda msg: infos.append(msg))

    frontend_check.verify_frontend_build("C:/proj")
    assert any("package.json is older than build" in msg for msg in infos)


def test_verify_frontend_build_handles_exceptions(monkeypatch):
    monkeypatch.setattr(frontend_check.os.path, "exists", lambda _p: True)
    monkeypatch.setattr(
        frontend_check.os.path,
        "getmtime",
        lambda _p: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    warnings = []
    monkeypatch.setattr(frontend_check.logger, "warning", lambda msg: warnings.append(msg))

    frontend_check.verify_frontend_build("C:/proj")
    assert any("Failed to verify frontend build freshness" in msg for msg in warnings)

