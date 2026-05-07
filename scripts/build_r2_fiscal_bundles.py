"""
Build R2-ready per-source fiscal bundles.

Each fiscal source is written to its own directory:
    database/r2/<source>/<source>.enc
    database/r2/<source>/<source>.meta.json
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from scripts.build_offline_db import DB_DIR, OfflineBundleOutput, build_source_bundle

DEFAULT_OUTPUT_ROOT = DB_DIR / "r2"


@dataclass(frozen=True)
class FiscalSource:
    id: str


@dataclass(frozen=True)
class BundlePaths:
    output_dir: Path
    encrypted: Path
    metadata: Path


FISCAL_SOURCES = [
    FiscalSource("nesh"),
    FiscalSource("tipi"),
    FiscalSource("nbs"),
    FiscalSource("unspsc"),
]


def resolve_bundle_paths(output_root: Path, source: str) -> BundlePaths:
    source_id = source.strip().lower()
    output_dir = output_root / source_id
    return BundlePaths(
        output_dir=output_dir,
        encrypted=output_dir / f"{source_id}.enc",
        metadata=output_dir / f"{source_id}.meta.json",
    )


def build_all(output_root: Path = DEFAULT_OUTPUT_ROOT) -> list[OfflineBundleOutput]:
    outputs: list[OfflineBundleOutput] = []
    for source in FISCAL_SOURCES:
        paths = resolve_bundle_paths(output_root, source.id)
        outputs.append(
            build_source_bundle(
                source.id,
                paths.encrypted,
                paths.metadata,
            )
        )
    return outputs


def main() -> int:
    outputs = build_all()
    for output in outputs:
        print(f"{output.source}: {output.encrypted_path} ({output.size_bytes} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
