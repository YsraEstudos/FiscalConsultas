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


def _pytest_temp_root() -> Path:
    return Path(__file__).resolve().parents[1] / ".pytest_tmp"


def pytest_configure() -> None:
    """Force pytest temp directories into the workspace on Windows.

    The default user temp path can be blocked by OneDrive or policy settings in
    this environment, which causes `tmp_path`-based tests to fail before they
    even reach the code under test. Using a repo-local directory keeps the test
    suite deterministic and portable.
    """

    temp_root = _pytest_temp_root()
    temp_root.mkdir(exist_ok=True)

    temp_root_str = str(temp_root)
    os.environ["TMPDIR"] = temp_root_str  # NOSONAR - repo-local test temp dir
    os.environ["TEMP"] = temp_root_str  # NOSONAR - repo-local test temp dir
    os.environ["TMP"] = temp_root_str  # NOSONAR - repo-local test temp dir
    tempfile.tempdir = temp_root_str


def pytest_unconfigure(config) -> None:
    temp_root = _pytest_temp_root()
    try:
        shutil.rmtree(temp_root)
    except FileNotFoundError:
        return
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Failed to cleanup pytest temp directory %s: %s", temp_root, exc)
