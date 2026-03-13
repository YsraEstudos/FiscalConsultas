"""Shared hashing helpers used across catalog import utilities."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path


def calculate_file_sha256(path: str | Path) -> str:
    digest = sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()
