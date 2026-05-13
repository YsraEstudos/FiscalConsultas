"""Keep root-level pytest fixtures intentionally lightweight.

Integration and performance fixtures live in their respective subdirectories so
unit tests stay isolated and do not mutate shared application settings.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path

LOGGER = logging.getLogger(__name__)
_ACTIVE_PYTEST_TEMP_ROOT: Path | None = None


def _pytest_temp_root() -> Path:
    configured_root = os.environ.get("PYTEST_TMP_ROOT")
    if configured_root:
        return Path(configured_root)

    for env_name in ("TMPDIR", "TEMP", "TMP"):
        env_value = os.environ.get(env_name)
        if env_value:
            env_root = Path(env_value)
            if _can_use_temp_base(env_root):
                return env_root / "fiscal-site-pytest"

    if os.name == "nt":
        tmp_root = Path("C:/tmp")
        if _can_use_temp_base(tmp_root):
            return tmp_root / "fiscal-site-pytest"

    return Path(__file__).resolve().parents[1] / ".pytest_tmp"


def _can_use_temp_base(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".pytest-temp-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError:
        return False
    return True


def pytest_configure() -> None:
    """Force pytest temp directories into a short writable path on Windows.

    The default user temp path and repo-local temp folders can be blocked by
    OneDrive, sandbox, or policy settings in this environment. Prefer an
    explicit `PYTEST_TMP_ROOT`, then the caller's temp env vars, then C:/tmp,
    and only fall back to a repo-local directory when nothing else is writable.
    """

    global _ACTIVE_PYTEST_TEMP_ROOT

    temp_root = _pytest_temp_root()
    temp_root.mkdir(parents=True, exist_ok=True)
    _ACTIVE_PYTEST_TEMP_ROOT = temp_root

    temp_root_str = str(temp_root)
    os.environ["TMPDIR"] = temp_root_str  # NOSONAR - repo-local test temp dir
    os.environ["TEMP"] = temp_root_str  # NOSONAR - repo-local test temp dir
    os.environ["TMP"] = temp_root_str  # NOSONAR - repo-local test temp dir
    tempfile.tempdir = temp_root_str


def pytest_unconfigure(config) -> None:
    temp_root = _ACTIVE_PYTEST_TEMP_ROOT
    if temp_root is None:
        return
    try:
        shutil.rmtree(temp_root)
    except FileNotFoundError:
        return
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Failed to cleanup pytest temp directory %s: %s", temp_root, exc)
