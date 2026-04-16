from pathlib import Path
import sqlite3


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_DIR = PROJECT_ROOT / "database"
NESH_DB = DATABASE_DIR / "nesh.db"
OFFLINE_DB = DATABASE_DIR / "fiscal_offline.enc"


def _size_mb(path: Path) -> float:
    return path.stat().st_size / 1024 / 1024


with sqlite3.connect(NESH_DB) as conn:
    cursor = conn.cursor()

    cursor.execute("SELECT SUM(length(content)) FROM chapters")
    total_content = cursor.fetchone()[0] or 0
    print(f"Chapters content: {total_content / 1024 / 1024:.1f} MB")

    cursor.execute(
        """
        SELECT
            COALESCE(SUM(length(notes_content)), 0)
            + COALESCE(SUM(length(titulo)), 0)
            + COALESCE(SUM(length(notas)), 0)
            + COALESCE(SUM(length(consideracoes)), 0)
            + COALESCE(SUM(length(definicoes)), 0)
            + COALESCE(SUM(length(parsed_notes_json)), 0)
        FROM chapter_notes
        """
    )
    total_notes = cursor.fetchone()[0] or 0
    print(f"Chapter notes: {total_notes / 1024 / 1024:.1f} MB")

    cursor.execute("SELECT COUNT(*) FROM positions")
    print(f"Positions count: {cursor.fetchone()[0]}")

grand_total = total_content + total_notes
print(f"\nnesh.db: {_size_mb(NESH_DB):.1f} MB")
print(f"fiscal_offline.enc: {_size_mb(OFFLINE_DB):.1f} MB")
print(f"\nNESH content to add: {grand_total / 1024 / 1024:.1f} MB")
print(
    f"Estimated new offline DB: {(_size_mb(OFFLINE_DB) * 1024 * 1024 + grand_total) / 1024 / 1024:.1f} MB"
)
