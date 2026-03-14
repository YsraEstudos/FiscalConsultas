"""Helpers to ingest and normalize the NBS CSV catalog."""

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ParsedNbsItem:
    code: str
    code_clean: str
    description: str
    description_normalized: str
    parent_code: str | None
    level: int
    source_order: int
    sort_path: str
    has_nebs: int = 0


def normalize_nbs_text(text: str) -> str:
    """Lowercase, remove accents and collapse whitespace for search."""
    normalized = unicodedata.normalize("NFKD", text or "")
    without_accents = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", without_accents).strip().lower()


def clean_nbs_code(code: str) -> str:
    """Return an NBS code with punctuation removed."""
    return re.sub(r"\D", "", code or "")


def build_nbs_code_variants(code: str) -> tuple[str, ...]:
    """Return canonical and alias forms used across NBS/NEBS sources."""
    segments = [
        segment.strip() for segment in str(code or "").split(".") if segment.strip()
    ]
    if not segments:
        return ()

    variants: list[str] = []

    def add(candidate: str) -> None:
        if candidate and candidate not in variants:
            variants.append(candidate)

    normalized = ".".join(segments)
    add(normalized)

    # NEBS frequently omits the trailing .00 used by the canonical NBS leaf codes.
    if len(segments) >= 4 and segments[-1] == "00":
        add(".".join(segments[:-1]))

    if len(segments) == 3 and len(segments[1]) == 4 and len(segments[2]) == 2:
        add(".".join([*segments, "00"]))

    return tuple(variants)


def build_sort_path(code: str) -> str:
    """Create a lexicographically sortable path for dotted NBS codes."""
    parts = [segment.zfill(8) for segment in str(code).split(".") if segment]
    return ".".join(parts)


def iter_nbs_rows(csv_path: str | Path) -> Iterable[tuple[str, str]]:
    """Yield `(code, description)` rows from the NBS CSV."""
    path = Path(csv_path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        for row_number, row in enumerate(reader, start=1):
            if not row:
                continue

            code = row[0].strip() if row else ""
            description = ";".join(part.strip() for part in row[1:]).strip()

            if row_number == 1 and code.upper().startswith("NBS 2.0"):
                continue

            if not code or not description:
                continue

            yield code, description


def _find_parent_code(code: str, seen_codes: list[str]) -> str | None:
    for candidate in reversed(seen_codes):
        if code.startswith(candidate):
            return candidate
    return None


def build_nbs_items(rows: Iterable[tuple[str, str]]) -> list[ParsedNbsItem]:
    """Build hierarchical NBS items preserving CSV order."""
    items_by_code: dict[str, ParsedNbsItem] = {}
    ordered_codes: list[str] = []
    parsed_items: list[ParsedNbsItem] = []

    for source_order, (code, description) in enumerate(rows, start=1):
        if code in items_by_code:
            raise ValueError(f"Código NBS duplicado encontrado: {code}")

        parent_code = _find_parent_code(code, ordered_codes)
        level = 0 if parent_code is None else items_by_code[parent_code].level + 1

        item = ParsedNbsItem(
            code=code,
            code_clean=clean_nbs_code(code),
            description=description.strip(),
            description_normalized=normalize_nbs_text(description),
            parent_code=parent_code,
            level=level,
            source_order=source_order,
            sort_path=build_sort_path(code),
        )
        items_by_code[code] = item
        ordered_codes.append(code)
        parsed_items.append(item)

    return parsed_items
