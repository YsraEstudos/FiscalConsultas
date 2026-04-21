"""Keep root-level pytest fixtures intentionally lightweight.

Integration and performance fixtures live in their respective subdirectories so
unit tests stay isolated and do not mutate shared application settings.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def pytest_configure() -> None:
    """Force pytest temp directories into the workspace on Windows.

    The default user temp path can be blocked by OneDrive or policy settings in
    this environment, which causes `tmp_path`-based tests to fail before they
    even reach the code under test. Using a repo-local directory keeps the test
    suite deterministic and portable.
    """

    temp_root = Path(__file__).resolve().parents[1] / ".pytest_tmp"
    temp_root.mkdir(exist_ok=True)

    temp_root_str = str(temp_root)
    os.environ["TMPDIR"] = temp_root_str
    os.environ["TEMP"] = temp_root_str
    os.environ["TMP"] = temp_root_str
    tempfile.tempdir = temp_root_str
