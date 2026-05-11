import json
import shutil
import sqlite3
from pathlib import Path

from scripts import build_offline_db, build_r2_fiscal_bundles
from scripts.build_r2_fiscal_bundles import (
    DEFAULT_OUTPUT_ROOT,
    FISCAL_SOURCES,
    normalize_source_filter,
    resolve_bundle_paths,
)


def test_fiscal_sources_are_split_for_r2():
    assert [source.id for source in FISCAL_SOURCES] == ["nesh", "tipi", "nbs", "unspsc"]


def test_resolve_bundle_paths_uses_r2_shape(tmp_path: Path):
    paths = resolve_bundle_paths(tmp_path, "nesh")
    assert paths.output_dir == tmp_path / "nesh"
    assert paths.encrypted == tmp_path / "nesh" / "nesh.enc"
    assert paths.metadata == tmp_path / "nesh" / "nesh.meta.json"


def test_default_output_root_is_database_r2():
    assert DEFAULT_OUTPUT_ROOT == build_offline_db.DB_DIR / "r2"


def test_build_source_bundle_metadata_excludes_app_seed(
    tmp_path: Path,
    monkeypatch,
):
    source_db = tmp_path / "unspsc-source.db"
    _create_minimal_unspsc_source_db(source_db)
    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", source_db)
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)

    build_offline_db.build_source_bundle(
        "unspsc",
        tmp_path / "unspsc.enc",
        tmp_path / "unspsc.meta.json",
    )

    metadata = json.loads((tmp_path / "unspsc.meta.json").read_text(encoding="utf-8"))
    assert "app_seed" not in metadata


def test_legacy_main_metadata_excludes_app_seed(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(build_offline_db, "OUTPUT_DB", tmp_path / "fiscal_offline.db")
    monkeypatch.setattr(
        build_offline_db, "OUTPUT_ENCRYPTED", tmp_path / "fiscal_offline.enc"
    )
    monkeypatch.setattr(
        build_offline_db, "OUTPUT_META", tmp_path / "fiscal_offline.meta"
    )
    monkeypatch.setattr(build_offline_db, "_consolidate_databases", _create_metadata_db)
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)

    assert build_offline_db.main() == 0

    metadata = json.loads(
        (tmp_path / "fiscal_offline.meta").read_text(encoding="utf-8")
    )
    assert "app_seed" not in metadata


def test_build_source_bundle_removes_plaintext_when_encryption_fails(
    tmp_path: Path,
    monkeypatch,
):
    encrypted_path = tmp_path / "unspsc.enc"
    plaintext_path = tmp_path / "unspsc.db"
    source_db = tmp_path / "unspsc-source.db"

    _create_minimal_unspsc_source_db(source_db)
    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", source_db)
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _fail_encryption)

    try:
        build_offline_db.build_source_bundle(
            "unspsc",
            encrypted_path,
            tmp_path / "unspsc.meta.json",
        )
    except RuntimeError as exc:
        assert str(exc) == "encryption failed"
    else:
        raise AssertionError("Expected encryption failure")

    assert not plaintext_path.exists()


def test_build_source_bundle_requires_unspsc_source_db(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", tmp_path / "missing.db")
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)

    try:
        build_offline_db.build_source_bundle(
            "unspsc",
            tmp_path / "unspsc.enc",
            tmp_path / "unspsc.meta.json",
        )
    except RuntimeError as exc:
        assert str(exc) == "Missing required UNSPSC DB input: missing.db"
    else:
        raise AssertionError("Expected missing UNSPSC source DB to fail")


def test_unspsc_schema_uses_planned_columns(tmp_path: Path, monkeypatch):
    source_db = tmp_path / "unspsc-source.db"
    _create_minimal_unspsc_source_db(source_db)
    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", source_db)
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)

    build_offline_db.build_source_bundle(
        "unspsc",
        tmp_path / "unspsc.enc",
        tmp_path / "unspsc.meta.json",
    )

    conn = sqlite3.connect(tmp_path / "unspsc.enc")
    try:
        columns = [
            (row[1], row[2], bool(row[3]), bool(row[5]))
            for row in conn.execute("PRAGMA table_info(unspsc_items)")
        ]
    finally:
        conn.close()

    assert columns == [
        ("code", "TEXT", False, True),
        ("code_clean", "TEXT", True, False),
        ("title", "TEXT", True, False),
        ("description", "TEXT", False, False),
        ("segment", "TEXT", False, False),
        ("family", "TEXT", False, False),
        ("class", "TEXT", False, False),
        ("commodity", "TEXT", False, False),
    ]


def test_populated_unspsc_uses_safe_fallbacks_for_missing_optional_columns(
    tmp_path: Path,
    monkeypatch,
):
    source_db = tmp_path / "unspsc-source.db"
    conn = sqlite3.connect(source_db)
    try:
        conn.execute("""
            CREATE TABLE unspsc_items (
                code TEXT PRIMARY KEY,
                description TEXT
            )
        """)
        conn.execute(
            "INSERT INTO unspsc_items (code, description) VALUES (?, ?)",
            ("10101501", "Live bovine cattle"),
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", source_db)
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)

    build_offline_db.build_source_bundle(
        "unspsc",
        tmp_path / "unspsc.enc",
        tmp_path / "unspsc.meta.json",
    )

    conn = sqlite3.connect(tmp_path / "unspsc.enc")
    try:
        row = conn.execute("""
            SELECT code, code_clean, title, description,
                   segment, family, class, commodity
            FROM unspsc_items
        """).fetchone()
    finally:
        conn.close()

    assert row == (
        "10101501",
        "10101501",
        "Live bovine cattle",
        "Live bovine cattle",
        None,
        None,
        None,
        None,
    )


def test_missing_unspsc_source_does_not_write_bundle(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(build_offline_db, "UNSPSC_DB", tmp_path / "missing.db")
    monkeypatch.setattr(build_offline_db, "_encrypt_database", _copy_plaintext)
    encrypted_path = tmp_path / "unspsc.enc"

    try:
        build_offline_db.build_source_bundle(
            "unspsc",
            encrypted_path,
            tmp_path / "unspsc.meta.json",
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("Expected missing UNSPSC source DB to fail")

    assert not encrypted_path.exists()


def test_source_column_filter_rejects_unsafe_identifiers():
    assert build_offline_db.SQL_IDENTIFIER_RE.fullmatch("code_clean")
    assert not build_offline_db.SQL_IDENTIFIER_RE.fullmatch("code; DROP TABLE x")


def test_normalize_source_filter_accepts_single_or_multiple_sources():
    assert normalize_source_filter(None) is None
    assert normalize_source_filter("nbs") == {"nbs"}
    assert normalize_source_filter("nesh, tipi") == {"nesh", "tipi"}


def test_normalize_source_filter_rejects_unknown_sources():
    try:
        normalize_source_filter("nbs,unknown")
    except ValueError as exc:
        assert str(exc) == "Unknown fiscal source(s): unknown"
    else:
        raise AssertionError("Expected unknown source to fail")


def test_build_all_builds_each_source_with_resolved_paths(tmp_path: Path, monkeypatch):
    calls = []

    def fake_build_source_bundle(
        source: str, encrypted_path: Path, metadata_path: Path
    ):
        calls.append((source, encrypted_path, metadata_path))
        return build_offline_db.OfflineBundleOutput(
            source=source,
            encrypted_path=encrypted_path,
            metadata_path=metadata_path,
            version="v",
            built_at="now",
            size_bytes=1,
        )

    monkeypatch.setattr(
        build_r2_fiscal_bundles,
        "build_source_bundle",
        fake_build_source_bundle,
    )

    outputs = build_r2_fiscal_bundles.build_all(tmp_path)

    assert calls == [
        (
            source.id,
            tmp_path / source.id / f"{source.id}.enc",
            tmp_path / source.id / f"{source.id}.meta.json",
        )
        for source in FISCAL_SOURCES
    ]
    assert [output.source for output in outputs] == [
        source.id for source in FISCAL_SOURCES
    ]


def test_build_all_can_filter_sources(tmp_path: Path, monkeypatch):
    calls = []

    def fake_build_source_bundle(
        source: str, encrypted_path: Path, metadata_path: Path
    ):
        calls.append((source, encrypted_path, metadata_path))
        return build_offline_db.OfflineBundleOutput(
            source=source,
            encrypted_path=encrypted_path,
            metadata_path=metadata_path,
            version="v",
            built_at="now",
            size_bytes=1,
        )

    monkeypatch.setattr(
        build_r2_fiscal_bundles,
        "build_source_bundle",
        fake_build_source_bundle,
    )

    outputs = build_r2_fiscal_bundles.build_all(tmp_path, {"nbs"})

    assert [call[0] for call in calls] == ["nbs"]
    assert [output.source for output in outputs] == ["nbs"]


def test_build_monolithic_bundle_removes_partial_outputs_when_metadata_fails(
    tmp_path: Path,
    monkeypatch,
):
    encrypted_path = tmp_path / "fiscal_offline.enc"
    metadata_path = tmp_path / "fiscal_offline.meta.json"
    plaintext_path = tmp_path / "fiscal_offline.db"
    output_db = tmp_path / "build-output.db"

    def fake_consolidate_databases(output_path: Path) -> None:
        output_path.write_bytes(b"plain")
        output_db.write_bytes(b"temporary")

    def fake_encrypt_database(source_path: Path, output_path: Path) -> dict:
        assert source_path == plaintext_path
        output_path.write_bytes(b"encrypted")
        return {
            "sha256": "plain-sha",
            "encrypted_sha256": "encrypted-sha",
            "salt": "salt",
            "size_bytes": output_path.stat().st_size,
            "chunks": 1,
        }

    def fake_write_bundle_metadata(*args) -> tuple[str, str]:
        metadata_path.write_text("{", encoding="utf-8")
        raise RuntimeError("metadata failed")

    monkeypatch.setattr(
        build_r2_fiscal_bundles,
        "_consolidate_databases",
        fake_consolidate_databases,
    )
    monkeypatch.setattr(
        build_r2_fiscal_bundles,
        "_encrypt_database",
        fake_encrypt_database,
    )
    monkeypatch.setattr(
        build_r2_fiscal_bundles,
        "_write_bundle_metadata",
        fake_write_bundle_metadata,
    )
    monkeypatch.setattr(build_r2_fiscal_bundles, "OUTPUT_DB", output_db)

    try:
        build_r2_fiscal_bundles.build_monolithic_bundle(tmp_path)
    except RuntimeError as exc:
        assert str(exc) == "metadata failed"
    else:
        raise AssertionError("Expected metadata failure")

    assert not plaintext_path.exists()
    assert not output_db.exists()
    assert not encrypted_path.exists()
    assert not metadata_path.exists()


def test_copy_plaintext_rejects_output_outside_test_bundle_dir(tmp_path: Path):
    plaintext_path = tmp_path / "unspsc.db"
    plaintext_path.write_bytes(b"bundle")

    try:
        _copy_plaintext(plaintext_path, tmp_path.parent / "unspsc.enc")
    except ValueError as exc:
        assert str(exc) == "Test bundle paths must stay in the same directory"
    else:
        raise AssertionError("Expected path validation failure")


def _create_metadata_db(output_path: Path) -> None:
    conn = sqlite3.connect(output_path)
    try:
        conn.execute("""
            CREATE TABLE db_metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        conn.executemany(
            "INSERT INTO db_metadata (key, value) VALUES (?, ?)",
            [
                ("version", "test-version"),
                ("built_at", "2026-05-06T00:00:00Z"),
            ],
        )
        conn.commit()
    finally:
        conn.close()


def _create_minimal_unspsc_source_db(output_path: Path) -> None:
    conn = sqlite3.connect(output_path)
    try:
        conn.execute("""
            CREATE TABLE unspsc_items (
                code TEXT PRIMARY KEY,
                description TEXT
            )
        """)
        conn.execute(
            "INSERT INTO unspsc_items (code, description) VALUES (?, ?)",
            ("10101501", "Live bovine cattle"),
        )
        conn.commit()
    finally:
        conn.close()


def _copy_plaintext(plaintext_path: Path, encrypted_path: Path) -> dict:
    bundle_dir = plaintext_path.parent.resolve()
    safe_plaintext_path = _resolve_test_bundle_path(plaintext_path, bundle_dir)
    safe_encrypted_path = _resolve_test_bundle_path(encrypted_path, bundle_dir)

    shutil.copyfile(safe_plaintext_path, safe_encrypted_path)  # NOSONAR
    return {
        "sha256": "plain-sha",
        "encrypted_sha256": "encrypted-sha",
        "salt": "salt",
        "size_bytes": safe_encrypted_path.stat().st_size,
        "chunks": 1,
    }


def _resolve_test_bundle_path(path: Path, bundle_dir: Path) -> Path:
    resolved_path = path.resolve(strict=False)
    if not resolved_path.is_relative_to(bundle_dir):
        raise ValueError("Test bundle paths must stay in the same directory")
    return resolved_path


def _fail_encryption(plaintext_path: Path, encrypted_path: Path) -> dict:
    assert plaintext_path.exists()
    raise RuntimeError("encryption failed")
