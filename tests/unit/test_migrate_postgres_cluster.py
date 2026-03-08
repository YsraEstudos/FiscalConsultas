import argparse
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from scripts import migrate_postgres_cluster as mod

pytestmark = pytest.mark.unit


def _raise(exc: Exception) -> None:
    raise exc


def _config(tmp_path: Path) -> mod.MigrationConfig:
    secret = "".join(["se", "cret"])
    return mod.MigrationConfig(
        project_root=tmp_path,
        compose_path=tmp_path / "docker-compose.yml",
        env_path=tmp_path / ".env",
        source_volume="fiscal_postgres_data",
        target_volume="fiscal_postgres18_data",
        source_image="postgres:15",
        target_image="postgres:18",
        db_name="nesh_db",
        db_user="postgres",
        db_password=secret,
        backup_volume="fiscal_postgres15_backup_test",
        dump_path=tmp_path / "dump.sql",
        keep_dump=False,
    )


def _completed(
    stdout: str = "", returncode: int = 0
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(["docker"], returncode, stdout, "")


def test_inspect_compose_mount_detects_postgres18_layout(tmp_path):
    compose = tmp_path / "docker-compose.yml"
    compose.write_text(
        "services:\n"
        "  db:\n"
        "    image: postgres:18\n"
        "    volumes:\n"
        "      - postgres18_data:/var/lib/postgresql\n",
        encoding="utf-8",
    )

    check = mod.inspect_compose_mount(compose)

    assert check.compatible is True
    assert check.has_expected_mount is True
    assert check.has_legacy_mount is False


def test_inspect_compose_mount_detects_legacy_layout(tmp_path):
    compose = tmp_path / "docker-compose.yml"
    compose.write_text(
        "services:\n"
        "  db:\n"
        "    image: postgres:18\n"
        "    volumes:\n"
        "      - postgres18_data:/var/lib/postgresql/data\n",
        encoding="utf-8",
    )

    check = mod.inspect_compose_mount(compose)

    assert check.compatible is False
    assert check.has_legacy_mount is True


def test_build_config_unescapes_docker_escaped_password(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_key = "POSTGRES_" + "PASSWORD"
    secret = "".join(["ab", "$$", "cd", "$$", "12"])
    env_path.write_text(
        "".join(
            [
                "POSTGRES_USER=postgres\n",
                f"{env_key}={secret}\n",
                "POSTGRES_DB=nesh_db\n",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "ENV_PATH", env_path)

    args = argparse.Namespace(
        source_volume="src",
        target_volume="dst",
        source_image="postgres:15",
        target_image="postgres:18",
        db_name=None,
        db_user=None,
        backup_volume=None,
        keep_dump=False,
        dump_path=None,
    )

    config = mod.build_config(args)

    assert config.db_user == "postgres"
    assert config.db_password == "ab$cd$12"


def test_build_target_container_cmd_uses_postgres18_mount(tmp_path):
    config = _config(tmp_path)

    command = mod.build_target_container_cmd(config, "pg18-target")

    assert f"{config.target_volume}:/var/lib/postgresql" in command
    assert f"{config.target_volume}:/var/lib/postgresql/data" not in command


def test_build_volume_copy_cmd_uses_tar_pipeline():
    command = mod.build_volume_copy_cmd("from_vol", "to_vol")

    assert command[:4] == ["docker", "run", "--rm", "-v"]
    assert "from_vol:/from:ro" in command
    assert "to_vol:/to" in command
    assert command[-1] == "cd /from && tar cf - . | tar xf - -C /to"


def test_check_environment_returns_compose_incompatible_before_volume_checks(
    tmp_path, monkeypatch
):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(False, False, True, "bad mount"),
    )

    exit_code = mod.check_environment(config)

    assert exit_code == mod.ExitCode.COMPOSE_INCOMPATIBLE


def test_check_environment_returns_ok_for_valid_target(tmp_path, monkeypatch):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(True, True, False, "ok"),
    )
    monkeypatch.setattr(
        mod,
        "volume_exists",
        lambda volume: volume == config.target_volume,
    )
    monkeypatch.setattr(mod, "read_target_layout_version", lambda _volume: "18")
    monkeypatch.setattr(mod, "validate_existing_target", lambda _cfg: (True, []))

    exit_code = mod.check_environment(config)

    assert exit_code == mod.ExitCode.OK


def test_check_environment_returns_migration_required_for_legacy_source(
    tmp_path, monkeypatch
):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(True, True, False, "ok"),
    )
    monkeypatch.setattr(
        mod,
        "volume_exists",
        lambda volume: volume == config.source_volume,
    )
    monkeypatch.setattr(mod, "read_source_pg_version", lambda _volume: "15")

    exit_code = mod.check_environment(config)

    assert exit_code == mod.ExitCode.MIGRATION_REQUIRED


def test_check_environment_returns_precondition_missing_without_source_or_target(
    tmp_path, monkeypatch
):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(True, True, False, "ok"),
    )
    monkeypatch.setattr(mod, "volume_exists", lambda _volume: False)

    exit_code = mod.check_environment(config)

    assert exit_code == mod.ExitCode.PRECONDITION_MISSING


def test_ensure_prerequisites_for_run_rejects_matching_source_and_target_volumes(
    tmp_path, monkeypatch, capsys
):
    config = replace(_config(tmp_path), target_volume="fiscal_postgres_data")
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(True, True, False, "ok"),
    )

    exit_code = mod._ensure_prerequisites_for_run(config, "fiscal_postgres15_backup")

    assert exit_code == mod.ExitCode.PRECONDITION_MISSING
    assert "source_volume and target_volume" in capsys.readouterr().out


def test_ensure_prerequisites_for_run_rejects_matching_backup_and_target_volumes(
    tmp_path, monkeypatch, capsys
):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_docker_check", lambda: None)
    monkeypatch.setattr(
        mod,
        "inspect_compose_mount",
        lambda _path: mod.ComposeCheck(True, True, False, "ok"),
    )

    exit_code = mod._ensure_prerequisites_for_run(config, config.target_volume)

    assert exit_code == mod.ExitCode.PRECONDITION_MISSING
    assert "backup_volume and target_volume" in capsys.readouterr().out


def test_run_migration_returns_dump_failed(tmp_path, monkeypatch):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_ensure_prerequisites_for_run", lambda *_args: None)
    monkeypatch.setattr(mod, "remove_containers_using_volume", lambda _volume: None)
    monkeypatch.setattr(mod, "create_backup_volume", lambda _src, _dst: None)
    monkeypatch.setattr(
        mod,
        "export_dump",
        lambda *_args: _raise(RuntimeError("dump failed")),
    )
    monkeypatch.setattr(mod, "run_command", lambda *args, **kwargs: _completed())

    exit_code = mod.run_migration(config)

    assert exit_code == mod.ExitCode.DUMP_FAILED


def test_run_migration_returns_dump_failed_for_oserror(tmp_path, monkeypatch):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_ensure_prerequisites_for_run", lambda *_args: None)
    monkeypatch.setattr(mod, "remove_containers_using_volume", lambda _volume: None)
    monkeypatch.setattr(mod, "create_backup_volume", lambda _src, _dst: None)
    monkeypatch.setattr(
        mod,
        "export_dump",
        lambda *_args: _raise(OSError("disk full")),
    )
    monkeypatch.setattr(mod, "run_command", lambda *args, **kwargs: _completed())

    exit_code = mod.run_migration(config)

    assert exit_code == mod.ExitCode.DUMP_FAILED


def test_run_migration_returns_validation_failed(tmp_path, monkeypatch):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_ensure_prerequisites_for_run", lambda *_args: None)
    monkeypatch.setattr(mod, "remove_containers_using_volume", lambda _volume: None)
    monkeypatch.setattr(mod, "create_backup_volume", lambda _src, _dst: None)
    monkeypatch.setattr(mod, "export_dump", lambda *_args: None)
    monkeypatch.setattr(mod, "recreate_target_volume", lambda _volume: None)
    monkeypatch.setattr(mod, "restore_dump", lambda *_args: None)
    monkeypatch.setattr(
        mod,
        "validate_target_data",
        lambda *_args: (False, ["tipi_positions does not contain any rows"]),
    )
    monkeypatch.setattr(mod, "run_command", lambda *args, **kwargs: _completed())

    exit_code = mod.run_migration(config)

    assert exit_code == mod.ExitCode.VALIDATION_FAILED


def test_run_migration_returns_restore_failed_for_oserror(tmp_path, monkeypatch):
    config = _config(tmp_path)
    monkeypatch.setattr(mod, "_ensure_prerequisites_for_run", lambda *_args: None)
    monkeypatch.setattr(mod, "remove_containers_using_volume", lambda _volume: None)
    monkeypatch.setattr(mod, "create_backup_volume", lambda _src, _dst: None)
    monkeypatch.setattr(mod, "export_dump", lambda *_args: None)
    monkeypatch.setattr(mod, "recreate_target_volume", lambda _volume: None)
    monkeypatch.setattr(
        mod,
        "restore_dump",
        lambda *_args: _raise(OSError("cannot open dump")),
    )
    monkeypatch.setattr(mod, "run_command", lambda *args, **kwargs: _completed())

    exit_code = mod.run_migration(config)

    assert exit_code == mod.ExitCode.RESTORE_FAILED
