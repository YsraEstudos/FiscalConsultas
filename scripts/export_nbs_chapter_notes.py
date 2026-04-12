from __future__ import annotations

import argparse
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

from pypdf import PdfReader


FOOTER_RE = re.compile(r"\(Fl\.\s*\d+[^\n]*\)\s*")
CHAPTER_RE = re.compile(r"^Capítulo\s+(\d+)\s*-\s*(.+?)\s*$")
NUMBERED_NOTE_RE = re.compile(r"^(\d+)\)\s*(.*)$")
LETTERED_NOTE_RE = re.compile(r"^([a-z])\)\s*(.*)$")


def normalize_lines(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    lines: list[str] = []

    for page in reader.pages[5:]:
        text = (page.extract_text() or "").replace("\x00", "")
        text = FOOTER_RE.sub("\n", text)

        for raw_line in text.splitlines():
            clean_line = re.sub(r"\s+", " ", raw_line).strip()
            if clean_line:
                lines.append(clean_line)

    return lines


def parse_note_items(raw_lines: list[str]) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    current_item: dict[str, object] | None = None
    current_subitem: dict[str, str] | None = None

    for line in raw_lines:
        numbered_match = NUMBERED_NOTE_RE.match(line)
        if numbered_match:
            if current_item is not None:
                items.append(current_item)

            note_text = numbered_match.group(2).strip()
            if note_text in {"", "."} and current_item is not None:
                if current_subitem is not None:
                    current_subitem["text"] = f"{current_subitem['text']} {line.strip()}".strip()
                else:
                    current_item["text"] = f"{current_item['text']} {line.strip()}".strip()
                continue

            current_item = {"label": numbered_match.group(1), "text": note_text, "subitems": []}
            current_subitem = None
            continue

        lettered_match = LETTERED_NOTE_RE.match(line)
        if lettered_match and current_item is not None:
            current_subitem = {
                "label": lettered_match.group(1),
                "text": lettered_match.group(2).strip(),
            }
            subitems = current_item["subitems"]
            if isinstance(subitems, list):
                subitems.append(current_subitem)
            continue

        if current_item is None:
            continue

        if current_subitem is not None:
            current_subitem["text"] = f"{current_subitem['text']} {line.strip()}".strip()
        else:
            current_item["text"] = f"{current_item['text']} {line.strip()}".strip()

    if current_item is not None:
        items.append(current_item)

    return items


def dedupe_notes(note_items: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[str] = set()
    deduped_items: list[dict[str, object]] = []

    for item in note_items:
        fingerprint = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if fingerprint in seen:
            continue

        seen.add(fingerprint)
        deduped_items.append(item)

    return deduped_items


def extract_chapter_notes(lines: list[str]) -> OrderedDict[str, dict[str, object]]:
    chapters: OrderedDict[str, dict[str, object]] = OrderedDict()
    current_chapter: str | None = None
    collecting_title = False
    collecting_notes = False

    for line in lines:
        chapter_match = CHAPTER_RE.match(line)
        if chapter_match:
            chapter_number = f"{int(chapter_match.group(1)):02d}"
            current_chapter = chapter_number
            chapters[chapter_number] = {
                "chapter": chapter_number,
                "title_parts": [chapter_match.group(2).strip()] if chapter_match.group(2).strip() else [],
                "raw_notes": [],
            }
            collecting_title = True
            collecting_notes = False
            continue

        if current_chapter is None:
            continue

        if collecting_title:
            if line.startswith("Notas"):
                collecting_title = False
                collecting_notes = True
                continue

            if line.startswith("NBS 2.0 DESCRIÇÃO"):
                collecting_title = False
                collecting_notes = False
                continue

            chapters[current_chapter]["title_parts"].append(line)
            continue

        if collecting_notes:
            if line.startswith("NBS 2.0 DESCRIÇÃO"):
                collecting_notes = False
                continue

            if CHAPTER_RE.match(line):
                collecting_notes = False
                continue

            chapters[current_chapter]["raw_notes"].append(line)

    exported: OrderedDict[str, dict[str, object]] = OrderedDict()

    for chapter_number, data in chapters.items():
        title_parts = data.get("title_parts", [])
        raw_notes = data.get("raw_notes", [])
        exported[chapter_number] = {
            "chapter": chapter_number,
            "title": " ".join(title_parts).strip(),
            "hasOfficialNotes": len(raw_notes) > 0,
            "notes": dedupe_notes(parse_note_items(raw_notes)),
        }

    return exported


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrai as notas oficiais por capítulo da NBS a partir do PDF.",
    )
    parser.add_argument("pdf", type=Path, help="Caminho do PDF oficial da NBS")
    parser.add_argument("output", type=Path, help="Arquivo JSON de saída")
    args = parser.parse_args()

    normalized_lines = normalize_lines(args.pdf)
    chapter_notes = extract_chapter_notes(normalized_lines)
    expected_chapters = {f"{number:02d}" for number in range(1, 27)}
    exported_chapters = set(chapter_notes.keys())
    missing_chapters = sorted(expected_chapters - exported_chapters)

    if missing_chapters:
        print(
            f"Missing chapters in extracted notes: {', '.join(missing_chapters)}",
            file=sys.stderr,
        )
        raise SystemExit(1)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(chapter_notes, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Exported {len(chapter_notes)} chapters to {args.output}")


if __name__ == "__main__":
    main()
