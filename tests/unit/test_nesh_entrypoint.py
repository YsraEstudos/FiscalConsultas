import os
import sys
from pathlib import Path

import Nesh
import pytest

pytestmark = pytest.mark.unit


def test_main_runs_uvicorn_with_app_instance_when_reload_disabled(monkeypatch):
    captured: dict[str, object] = {}

    def _fake_run(app_target, **kwargs):
        captured["app_target"] = app_target
        captured["kwargs"] = kwargs

    monkeypatch.delenv("NESH_RELOAD", raising=False)
    monkeypatch.setenv("SERVER__HOST", "0.0.0.0")  # nosec B104
    monkeypatch.setenv("SERVER__PORT", "10000")
    monkeypatch.setattr(Nesh.uvicorn, "run", _fake_run)

    Nesh.main()

    kwargs = captured["kwargs"]
    assert captured["app_target"] is not None
    assert not isinstance(captured["app_target"], str)
    assert kwargs["host"] == "0.0.0.0"  # nosec B104
    assert kwargs["port"] == 10000
    assert kwargs["reload"] is False


def test_main_runs_uvicorn_with_import_string_when_reload_enabled(monkeypatch):
    captured: dict[str, object] = {}

    def _fake_run(app_target, **kwargs):
        captured["app_target"] = app_target
        captured["kwargs"] = kwargs

    monkeypatch.setenv("NESH_RELOAD", "1")
    monkeypatch.setattr(Nesh.uvicorn, "run", _fake_run)

    Nesh.main()

    project_root = str(Path(Nesh.__file__).resolve().parent)
    backend_dir = os.path.join(project_root, "backend")
    kwargs = captured["kwargs"]
    assert captured["app_target"] == "backend.server.app:app"
    assert kwargs["reload"] is True
    assert kwargs["reload_dirs"] == [backend_dir]
    assert "client/node_modules/*" in kwargs["reload_excludes"]
    assert project_root in sys.path
