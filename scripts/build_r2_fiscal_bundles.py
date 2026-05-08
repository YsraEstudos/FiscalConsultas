"""
Build R2-ready per-source fiscal bundles.

Each fiscal source is written to its own directory:
    database/r2/<source>/<source>.enc
    database/r2/<source>/<source>.meta.json
"""

from __future__ import annotations

import argparse
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


def normalize_source_filter(source: str | None) -> set[str] | None:
    if source is None:
        return None

    source_ids = {item.strip().lower() for item in source.split(",") if item.strip()}
    known_sources = {item.id for item in FISCAL_SOURCES}
    unknown_sources = source_ids - known_sources
    if unknown_sources:
        unknown = ", ".join(sorted(unknown_sources))
        raise ValueError(f"Unknown fiscal source(s): {unknown}")

    return source_ids


def build_all(
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    source_filter: set[str] | None = None,
) -> list[OfflineBundleOutput]:
    outputs: list[OfflineBundleOutput] = []
    for source in FISCAL_SOURCES:
        if source_filter is not None and source.id not in source_filter:
            continue
        paths = resolve_bundle_paths(output_root, source.id)
        outputs.append(
            build_source_bundle(
                source.id,
                paths.encrypted,
                paths.metadata,
            )
        )
    return outputs


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build R2-ready fiscal bundles")
    parser.add_argument(
        "--source",
        help="Build only one source, or a comma-separated list of sources",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Root directory for source bundle output",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        source_filter = normalize_source_filter(args.source)
    except ValueError as exc:
        print(str(exc))
        return 2

    outputs = build_all(args.output_root, source_filter)
    for output in outputs:
        print(f"{output.source}: {output.encrypted_path} ({output.size_bytes} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
