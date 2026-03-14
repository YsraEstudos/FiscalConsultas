import pytest

from backend.config import settings as settings_mod

pytestmark = pytest.mark.unit


def test_app_settings_load_falls_back_to_defaults_on_invalid_json(
    tmp_path, monkeypatch, capsys
):
    config_dir = tmp_path / "backend" / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "settings.json").write_text("{invalid json", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings_mod, "PROJECT_ROOT", str(tmp_path))

    loaded = settings_mod.AppSettings.load()

    assert loaded.server.port == 8000
    assert loaded.database.engine == "sqlite"
    assert "Failed to load settings.json" in capsys.readouterr().out
