from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import IntEnum
from pathlib import Path
from typing import IO, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_VOLUME = "fiscal_postgres_data"
DEFAULT_TARGET_VOLUME = "fiscal_postgres18_data"
DEFAULT_SOURCE_IMAGE = "postgres:15"
DEFAULT_TARGET_IMAGE = "postgres:18"
DEFAULT_DB_NAME = "nesh_db"
DEFAULT_DB_USER = "postgres"
DOCKER_COMPOSE_PATH = PROJECT_ROOT / "docker-compose.yml"
ENV_PATH = PROJECT_ROOT / ".env"


class ExitCode(IntEnum):
    OK = 0
    MIGRATION_REQUIRED = 10
    COMPOSE_INCOMPATIBLE = 11
    PRECONDITION_MISSING = 20
    INSPECTION_FAILED = 21
    BACKUP_FAILED = 22
    DUMP_FAILED = 23
    RESTORE_FAILED = 24
    VALIDATION_FAILED = 25


@dataclass(frozen=True)
class ComposeCheck:
    compatible: bool
    has_expected_mount: bool
    has_legacy_mount: bool
    message: str


@dataclass(frozen=True)
class MigrationConfig:
    project_root: Path
    compose_path: Path
    env_path: Path
    source_volume: str
    target_volume: str
    source_image: str
    target_image: str
    db_name: str
    db_user: str
    db_password: str
    backup_volume: str | None
    dump_path: Path | None
    keep_dump: bool


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value.replace("$$", "$")

    return values


def _mask_secret(value: str | None) -> str:
    if not value:
        return "<empty>"
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def _format_command(command: Sequence[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def run_command(
    command: Sequence[str],
    *,
    check: bool = True,
    capture_output: bool = True,
    text: bool = True,
    stdin: IO[str] | None = None,
    stdout: IO[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(command),
        check=False,
        capture_output=capture_output and stdout is None,
        text=text,
        stdin=stdin,
        stdout=stdout,
    )
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(
            result.returncode,
            command,
            output=result.stdout,
            stderr=result.stderr,
        )
    return result


def build_config(args: argparse.Namespace) -> MigrationConfig:
    env_values = _load_env_file(ENV_PATH)
    db_name = args.db_name or env_values.get("POSTGRES_DB") or DEFAULT_DB_NAME
    db_user = args.db_user or env_values.get("POSTGRES_USER") or DEFAULT_DB_USER
    db_password = env_values.get("POSTGRES_PASSWORD", "")

    return MigrationConfig(
        project_root=PROJECT_ROOT,
        compose_path=DOCKER_COMPOSE_PATH,
        env_path=ENV_PATH,
        source_volume=args.source_volume,
        target_volume=args.target_volume,
        source_image=args.source_image,
        target_image=args.target_image,
        db_name=db_name,
        db_user=db_user,
        db_password=db_password,
        backup_volume=args.backup_volume,
        dump_path=Path(args.dump_path).resolve() if args.dump_path else None,
        keep_dump=bool(args.keep_dump),
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check or migrate local PostgreSQL Docker volumes from 15 to 18."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--source-volume", default=DEFAULT_SOURCE_VOLUME)
    parser.add_argument("--target-volume", default=DEFAULT_TARGET_VOLUME)
    parser.add_argument("--source-image", default=DEFAULT_SOURCE_IMAGE)
    parser.add_argument("--target-image", default=DEFAULT_TARGET_IMAGE)
    parser.add_argument("--db-name")
    parser.add_argument("--db-user")
    parser.add_argument("--backup-volume")
    parser.add_argument("--keep-dump", action="store_true")
    parser.add_argument("--dump-path")
    return parser.parse_args(argv)


def inspect_compose_mount(compose_path: Path) -> ComposeCheck:
    if not compose_path.exists():
        return ComposeCheck(
            compatible=False,
            has_expected_mount=False,
            has_legacy_mount=False,
            message=f"Compose file not found: {compose_path}",
        )

    lines = compose_path.read_text(encoding="utf-8").splitlines()
    in_db = False
    db_indent = 0
    in_volumes = False
    volumes_indent = 0
    has_expected_mount = False
    has_legacy_mount = False

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip(" "))
        if not in_db:
            if stripped == "db:":
                in_db = True
                db_indent = indent
            continue

        if indent <= db_indent and stripped.endswith(":") and not stripped.startswith("-"):
            break

        if not in_volumes:
            if stripped == "volumes:":
                in_volumes = True
                volumes_indent = indent
            continue

        if indent <= volumes_indent and not stripped.startswith("-"):
            in_volumes = False
            continue

        if not stripped.startswith("- "):
            continue

        mount = stripped[2:].strip().strip("'").strip('"')
        if ":/var/lib/postgresql/data" in mount:
            has_legacy_mount = True
        if mount.endswith(":/var/lib/postgresql") or ":/var/lib/postgresql:" in mount:
            has_expected_mount = True

    compatible = has_expected_mount and not has_legacy_mount
    if compatible:
        message = "Compose mount for Postgres 18 is compatible."
    elif has_legacy_mount:
        message = (
            "Compose still mounts the Postgres volume at /var/lib/postgresql/data."
        )
    else:
        message = "Compose does not expose the expected Postgres 18 mount."

    return ComposeCheck(
        compatible=compatible,
        has_expected_mount=has_expected_mount,
        has_legacy_mount=has_legacy_mount,
        message=message,
    )


def _docker_check() -> None:
    run_command(["docker", "version"])


def volume_exists(volume_name: str) -> bool:
    result = run_command(
        ["docker", "volume", "inspect", volume_name],
        check=False,
    )
    return result.returncode == 0


def _read_volume_version(volume_name: str, candidates: Sequence[str]) -> str | None:
    shell_candidates = " ".join(shlex.quote(candidate) for candidate in candidates)
    command = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{volume_name}:/inspect:ro",
        "alpine",
        "sh",
        "-lc",
        (
            "for p in "
            f"{shell_candidates}"
            '; do if [ -f "$p" ]; then cat "$p"; exit 0; fi; done; exit 1'
        ),
    ]
    result = run_command(command, check=False)
    if result.returncode != 0:
        return None
    version = (result.stdout or "").strip()
    return version or None


def read_source_pg_version(volume_name: str) -> str | None:
    return _read_volume_version(
        volume_name,
        ("/inspect/PG_VERSION", "/inspect/data/PG_VERSION"),
    )


def read_target_layout_version(volume_name: str) -> str | None:
    return _read_volume_version(volume_name, ("/inspect/18/docker/PG_VERSION",))


def list_volume_containers(volume_name: str, *, all_containers: bool) -> list[str]:
    command = ["docker", "ps"]
    if all_containers:
        command.append("-a")
    command.extend(["--filter", f"volume={volume_name}", "--format", "{{.Names}}"])
    result = run_command(command, check=False)
    if result.returncode != 0 or not result.stdout:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def remove_containers_using_volume(volume_name: str) -> None:
    containers = list_volume_containers(volume_name, all_containers=True)
    if not containers:
        return
    run_command(["docker", "rm", "-f", *containers], check=False)


def wait_for_postgres(container_name: str, db_user: str, db_name: str, timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        result = run_command(
            ["docker", "exec", container_name, "pg_isready", "-U", db_user, "-d", db_name],
            check=False,
        )
        if result.returncode == 0:
            return True
        time.sleep(2)
    return False


def build_source_container_cmd(config: MigrationConfig, container_name: str) -> list[str]:
    return [
        "docker",
        "run",
        "-d",
        "--rm",
        "--name",
        container_name,
        "-e",
        f"POSTGRES_PASSWORD={config.db_password}",
        "-e",
        f"POSTGRES_USER={config.db_user}",
        "-e",
        f"POSTGRES_DB={config.db_name}",
        "-v",
        f"{config.source_volume}:/var/lib/postgresql/data",
        config.source_image,
    ]


def build_target_container_cmd(config: MigrationConfig, container_name: str) -> list[str]:
    return [
        "docker",
        "run",
        "-d",
        "--rm",
        "--name",
        container_name,
        "-e",
        f"POSTGRES_PASSWORD={config.db_password}",
        "-e",
        f"POSTGRES_USER={config.db_user}",
        "-e",
        f"POSTGRES_DB={config.db_name}",
        "-v",
        f"{config.target_volume}:/var/lib/postgresql",
        config.target_image,
    ]


def build_volume_copy_cmd(source_volume: str, target_volume: str) -> list[str]:
    return [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{source_volume}:/from:ro",
        "-v",
        f"{target_volume}:/to",
        "alpine",
        "sh",
        "-lc",
        "cd /from && tar cf - . | tar xf - -C /to",
    ]


def _temp_container_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _query_scalar(container_name: str, db_user: str, db_name: str, sql: str) -> str:
    result = run_command(
        [
            "docker",
            "exec",
            container_name,
            "psql",
            "-U",
            db_user,
            "-d",
            db_name,
            "-v",
            "ON_ERROR_STOP=1",
            "-Atqc",
            sql,
        ]
    )
    return (result.stdout or "").strip()


def validate_target_data(config: MigrationConfig, container_name: str) -> tuple[bool, list[str]]:
    errors: list[str] = []

    checks = {
        "chapters": "SELECT COUNT(*) FROM chapters",
        "positions": "SELECT COUNT(*) FROM positions",
        "chapter_notes": "SELECT COUNT(*) FROM chapter_notes",
        "tipi_positions": "SELECT COUNT(*) FROM tipi_positions",
    }
    for table_name, sql in checks.items():
        raw_value = _query_scalar(container_name, config.db_user, config.db_name, sql)
        try:
            count = int(raw_value)
        except ValueError:
            errors.append(f"Invalid count for {table_name}: {raw_value!r}")
            continue
        if count <= 0:
            errors.append(f"Table {table_name} is empty")

    required_tables = ("users", "tenants", "subscriptions", "comments")
    for table_name in required_tables:
        exists = _query_scalar(
            container_name,
            config.db_user,
            config.db_name,
            f"SELECT to_regclass('public.{table_name}') IS NOT NULL",
        )
        if exists.lower() not in {"t", "true"}:
            errors.append(f"Table {table_name} is missing")

    has_tipi = _query_scalar(
        container_name,
        config.db_user,
        config.db_name,
        "SELECT EXISTS(SELECT 1 FROM tipi_positions)",
    )
    if has_tipi.lower() not in {"t", "true"}:
        errors.append("tipi_positions does not contain any rows")

    return (not errors, errors)


def validate_existing_target(config: MigrationConfig) -> tuple[bool, list[str]]:
    running_containers = list_volume_containers(config.target_volume, all_containers=False)
    if running_containers:
        for container_name in running_containers:
            try:
                return validate_target_data(config, container_name)
            except subprocess.CalledProcessError:
                continue

    temp_container = _temp_container_name("fiscal-pg18-validate")
    try:
        run_command(build_target_container_cmd(config, temp_container))
        if not wait_for_postgres(temp_container, config.db_user, config.db_name):
            return False, [f"Timed out waiting for {temp_container} to accept connections"]
        return validate_target_data(config, temp_container)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.output or "").strip()
        return False, [stderr or f"Failed to validate target volume with {_format_command(exc.cmd)}"]
    finally:
        run_command(["docker", "rm", "-f", temp_container], check=False)


def check_environment(config: MigrationConfig) -> ExitCode:
    try:
        _docker_check()
    except subprocess.CalledProcessError:
        print("Docker is not available or Docker Desktop is not running.")
        return ExitCode.PRECONDITION_MISSING

    compose_check = inspect_compose_mount(config.compose_path)
    if not compose_check.compatible:
        print(compose_check.message)
        return ExitCode.COMPOSE_INCOMPATIBLE

    if volume_exists(config.target_volume):
        target_version = read_target_layout_version(config.target_volume)
        if target_version == "18":
            valid, errors = validate_existing_target(config)
            if valid:
                print("Target Postgres 18 volume is already valid.")
                return ExitCode.OK
            print("Target Postgres 18 volume exists but validation failed:")
            for error in errors:
                print(f" - {error}")

    if not volume_exists(config.source_volume):
        print(
            "Legacy source volume not found and target volume is not valid: "
            f"{config.source_volume}"
        )
        return ExitCode.PRECONDITION_MISSING

    source_version = read_source_pg_version(config.source_volume)
    if source_version is None:
        print(f"Could not read PG_VERSION from source volume {config.source_volume}.")
        return ExitCode.INSPECTION_FAILED
    if source_version != "15":
        print(
            f"Unsupported source PG_VERSION for {config.source_volume}: {source_version}"
        )
        return ExitCode.INSPECTION_FAILED

    print(
        "Legacy PostgreSQL 15 volume detected. Run with --run to migrate it to Postgres 18."
    )
    return ExitCode.MIGRATION_REQUIRED


def _ensure_prerequisites_for_run(config: MigrationConfig) -> ExitCode | None:
    try:
        _docker_check()
    except subprocess.CalledProcessError:
        print("Docker is not available or Docker Desktop is not running.")
        return ExitCode.PRECONDITION_MISSING

    compose_check = inspect_compose_mount(config.compose_path)
    if not compose_check.compatible:
        print(compose_check.message)
        return ExitCode.COMPOSE_INCOMPATIBLE

    if not config.db_password:
        print("POSTGRES_PASSWORD is missing from .env; cannot run migration safely.")
        return ExitCode.PRECONDITION_MISSING

    if not volume_exists(config.source_volume):
        print(f"Source volume not found: {config.source_volume}")
        return ExitCode.PRECONDITION_MISSING

    source_version = read_source_pg_version(config.source_volume)
    if source_version is None:
        print(f"Could not inspect source volume {config.source_volume}.")
        return ExitCode.INSPECTION_FAILED
    if source_version != "15":
        print(
            f"Expected source volume {config.source_volume} to be PostgreSQL 15, got {source_version}."
        )
        return ExitCode.INSPECTION_FAILED

    return None


def _default_backup_volume() -> str:
    return f"fiscal_postgres15_backup_{_timestamp()}"


def _default_dump_path() -> Path:
    return Path(tempfile.gettempdir()) / f"fiscal_pg15_dump_{_timestamp()}.sql"


def create_backup_volume(source_volume: str, backup_volume: str) -> None:
    run_command(["docker", "volume", "create", backup_volume])
    run_command(build_volume_copy_cmd(source_volume, backup_volume))


def export_dump(config: MigrationConfig, dump_path: Path, container_name: str) -> None:
    run_command(build_source_container_cmd(config, container_name))
    if not wait_for_postgres(container_name, config.db_user, config.db_name):
        raise RuntimeError(f"Timed out waiting for source container {container_name}")
    with dump_path.open("w", encoding="utf-8", newline="\n") as handle:
        run_command(
            [
                "docker",
                "exec",
                container_name,
                "pg_dumpall",
                "-U",
                config.db_user,
            ],
            stdout=handle,
        )


def recreate_target_volume(target_volume: str) -> None:
    remove_containers_using_volume(target_volume)
    if volume_exists(target_volume):
        run_command(["docker", "volume", "rm", target_volume])
    run_command(["docker", "volume", "create", target_volume])


def restore_dump(config: MigrationConfig, dump_path: Path, container_name: str) -> None:
    run_command(build_target_container_cmd(config, container_name))
    if not wait_for_postgres(container_name, config.db_user, config.db_name):
        raise RuntimeError(f"Timed out waiting for target container {container_name}")
    with dump_path.open("r", encoding="utf-8") as handle:
        run_command(
            [
                "docker",
                "exec",
                "-i",
                container_name,
                "psql",
                "-U",
                config.db_user,
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            stdin=handle,
            capture_output=False,
        )
    run_command(
        [
            "docker",
            "exec",
            container_name,
            "psql",
            "-U",
            config.db_user,
            "-d",
            config.db_name,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "ANALYZE;",
        ]
    )


def run_migration(config: MigrationConfig) -> ExitCode:
    prerequisite_code = _ensure_prerequisites_for_run(config)
    if prerequisite_code is not None:
        return prerequisite_code

    backup_volume = config.backup_volume or _default_backup_volume()
    dump_path = config.dump_path or _default_dump_path()
    source_container = _temp_container_name("fiscal-pg15-dump")
    target_container = _temp_container_name("fiscal-pg18-restore")

    print(
        f"Preparing migration from {config.source_volume} ({config.source_image}) "
        f"to {config.target_volume} ({config.target_image})."
    )
    print(f"Using database user {config.db_user} and password {_mask_secret(config.db_password)}.")
    print(f"Backup volume: {backup_volume}")
    print(f"Dump path: {dump_path}")

    remove_containers_using_volume(config.source_volume)

    try:
        create_backup_volume(config.source_volume, backup_volume)
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"Failed to create backup volume {backup_volume}: {exc}")
        return ExitCode.BACKUP_FAILED

    try:
        export_dump(config, dump_path, source_container)
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"Failed to export logical dump to {dump_path}: {exc}")
        return ExitCode.DUMP_FAILED
    finally:
        run_command(["docker", "rm", "-f", source_container], check=False)

    try:
        recreate_target_volume(config.target_volume)
        restore_dump(config, dump_path, target_container)
        valid, errors = validate_target_data(config, target_container)
        if not valid:
            print("Validation failed after restore:")
            for error in errors:
                print(f" - {error}")
            return ExitCode.VALIDATION_FAILED

        print("PostgreSQL cluster migration completed successfully.")
        print(f"Source volume preserved: {config.source_volume}")
        print(f"Backup volume preserved: {backup_volume}")

        if not config.keep_dump and dump_path.exists():
            dump_path.unlink()
        elif dump_path.exists():
            print(f"Dump retained at: {dump_path}")

        return ExitCode.OK
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"Failed to restore dump into {config.target_volume}: {exc}")
        return ExitCode.RESTORE_FAILED
    finally:
        run_command(["docker", "rm", "-f", target_container], check=False)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    config = build_config(args)
    if args.check_only:
        return int(check_environment(config))
    return int(run_migration(config))


if __name__ == "__main__":
    sys.exit(main())
