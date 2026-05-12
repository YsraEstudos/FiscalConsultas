"""
Build R2-ready per-source fiscal bundles.

The default output is a single SQLite bundle containing every fiscal source:
    database/r2/fiscal_offline.enc
    database/r2/fiscal_offline.meta.json

Per-source bundles can also be generated for future source-scoped installs:
    database/r2/<source>/<source>.enc
    database/r2/<source>/<source>.meta.json
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.build_offline_db import (  # noqa: E402
    DB_DIR,
    OUTPUT_DB,
    OfflineBundleOutput,
    _consolidate_databases,
    _encrypt_database,
    _write_bundle_metadata,
    build_source_bundle,
)

DEFAULT_OUTPUT_ROOT = DB_DIR / "r2"
DEFAULT_BUNDLE_NAME = "fiscal_offline"


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
    split_sources: bool = False,
) -> list[OfflineBundleOutput]:
    if not split_sources:
        return [build_monolithic_bundle(output_root)]

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


def build_monolithic_bundle(
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    bundle_name: str = DEFAULT_BUNDLE_NAME,
) -> OfflineBundleOutput:
    encrypted_path = output_root / f"{bundle_name}.enc"
    metadata_path = output_root / f"{bundle_name}.meta.json"
    plaintext_path = output_root / f"{bundle_name}.db"

    encrypted_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    _consolidate_databases(plaintext_path)
    success = False
    try:
        crypto_info = _encrypt_database(plaintext_path, encrypted_path)
        version, built_at = _write_bundle_metadata(
            "fiscal",
            plaintext_path,
            metadata_path,
            crypto_info,
        )
        success = True
    finally:
        plaintext_path.unlink(missing_ok=True)
        OUTPUT_DB.unlink(missing_ok=True)
        if not success:
            encrypted_path.unlink(missing_ok=True)
            metadata_path.unlink(missing_ok=True)

    return OfflineBundleOutput(
        source="fiscal",
        encrypted_path=encrypted_path,
        metadata_path=metadata_path,
        version=version,
        built_at=built_at,
        size_bytes=int(crypto_info["size_bytes"]),
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build R2-ready fiscal bundles")
    parser.add_argument(
        "--source",
        help="Build only one source, or a comma-separated list of sources",
    )
    parser.add_argument(
        "--split-sources",
        action="store_true",
        help="Build source-scoped bundles instead of the consolidated fiscal bundle",
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

    if source_filter and not args.split_sources:
        print("--source requires --split-sources")
        return 2

    outputs = build_all(args.output_root, source_filter, args.split_sources)
    for output in outputs:
        print(f"{output.source}: {output.encrypted_path} ({output.size_bytes} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
