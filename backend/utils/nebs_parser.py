"""Helpers to parse the NEBS PDF into trusted entries plus audit artifacts."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

import fitz

from backend.utils.hash_util import calculate_file_sha256
from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
    normalize_nbs_text,
)

SECTION_RE = re.compile(r"^SEÇÃO\s+[IVXLCDM]+\b.*$", re.IGNORECASE)
ENTRY_RE = re.compile(r"^(?P<code>\d(?:\.\d+)+)\s+(?P<title>.+)$")
PAGE_HEADER_PREFIX_RE = re.compile(
    r"^Fl\.\s*\d+\s+do\s+Anexo\s+II\s+da\s+Portaria\s+Conjunta\b",
    re.IGNORECASE,
)
DIGIT_DASH_RE = re.compile(r"^\d+\s*-\s+")
TITLE_CONTINUATION_BLOCKLIST = (
    "esta ",
    "este ",
    "estas ",
    "estes ",
    "estão ",
    "estao ",
    "inclui",
    "incluem",
    "exclui",
    "excluem",
    "não ",
    "nao ",
    "compreende",
    "corresponde",
    "refer",
)
TITLE_CONTINUATION_PREFIX_RE = re.compile(
    r"^(?:e|ou|de|do|da|dos|das|ao|aos|à|às|com|para|por)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedNebsEntry:
    code: str
    code_clean: str
    title: str
    title_normalized: str
    body_text: str
    body_markdown: str | None
    body_normalized: str
    section_title: str | None
    page_start: int
    page_end: int
    parser_status: str
    parse_warnings: str | None
    source_hash: str
    updated_at: str


@dataclass(frozen=True)
class NebsAuditRecord:
    code: str | None
    parser_status: str
    reasons: tuple[str, ...]
    section_title: str | None
    title: str
    page_start: int
    page_end: int
    excerpt: str
    raw_text: str


@dataclass
class NebsParseOutcome:
    entries: list[ParsedNebsEntry] = field(default_factory=list)
    audit_records: list[NebsAuditRecord] = field(default_factory=list)
    counts: dict[str, int] = field(
        default_factory=lambda: {"trusted": 0, "suspect": 0, "rejected": 0}
    )


@dataclass
class _CandidateEntry:
    code: str
    title: str
    section_title: str | None
    page_start: int
    page_end: int
    body_lines: list[str] = field(default_factory=list)

    def add_line(self, line: str, page_number: int) -> None:
        self.body_lines.append(line)
        self.page_end = page_number


def _clean_page_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or _is_page_header(line):
            continue
        lines.append(line)
    return lines


def _is_page_header(line: str) -> bool:
    candidate = line.strip().strip("()").strip()
    return bool(candidate) and PAGE_HEADER_PREFIX_RE.match(candidate) is not None


def _should_join_line(previous: str, current: str) -> bool:
    if not previous:
        return False
    if current.startswith("- ") or DIGIT_DASH_RE.match(current):
        return False
    if SECTION_RE.match(current) or ENTRY_RE.match(current):
        return False
    if previous.startswith("- "):
        return True
    if previous.endswith(":"):
        return False
    if re.search(r"[.!?;:]$", previous):
        return False
    return True


def _should_extend_title(current_title: str, body_lines: list[str], line: str) -> bool:
    if body_lines:
        return False
    if not line or SECTION_RE.match(line) or ENTRY_RE.match(line):
        return False
    if line.startswith("- ") or DIGIT_DASH_RE.match(line):
        return False
    lowered = line.lower()
    if any(lowered.startswith(prefix) for prefix in TITLE_CONTINUATION_BLOCKLIST):
        return False
    if re.search(r"[.!?;:]$", line):
        return False
    if len(line) > 100:
        return False
    if current_title.endswith(":"):
        return False
    if current_title.rstrip().endswith((",", "-", "(")):
        return True
    if line[:1].islower():
        return True
    if TITLE_CONTINUATION_PREFIX_RE.match(line):
        return True
    return False


def _merge_body_lines(lines: Iterable[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        current = line.strip()
        if not current:
            continue
        if not merged:
            merged.append(current)
            continue
        if _should_join_line(merged[-1], current):
            merged[-1] = f"{merged[-1]} {current}".strip()
        else:
            merged.append(current)
    return merged


def _body_lines_to_text(lines: list[str]) -> str:
    return "\n".join(lines).strip()


def _body_lines_to_markdown(lines: list[str]) -> str | None:
    if not lines:
        return None

    blocks: list[str] = []
    bullet_buffer: list[str] = []

    def flush_bullets() -> None:
        nonlocal bullet_buffer
        if bullet_buffer:
            blocks.extend(bullet_buffer)
            bullet_buffer = []

    for line in lines:
        if line.startswith("- "):
            bullet_buffer.append(line)
            continue
        if DIGIT_DASH_RE.match(line):
            bullet_buffer.append(f"- {line}")
            continue
        flush_bullets()
        blocks.append(line)

    flush_bullets()
    return "\n\n".join(blocks).strip() or None


def _excerpt(text: str, limit: int = 220) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3].rstrip()}..."


def _token_overlap_ratio(left: str, right: str) -> float:
    left_tokens = {token for token in left.split() if len(token) > 2}
    right_tokens = {token for token in right.split() if len(token) > 2}
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = left_tokens & right_tokens
    return len(intersection) / max(len(left_tokens), len(right_tokens))


def _check_nbs_existence(
    resolved_nbs_item: tuple[str, str] | None, reasons: list[str]
) -> str | None:
    if resolved_nbs_item is not None:
        return None
    reasons.append("codigo_nao_encontrado_na_nbs")
    return "rejected"


def _check_duplicate(
    code: str, duplicate_codes: set[str], reasons: list[str]
) -> str | None:
    if code not in duplicate_codes:
        return None
    reasons.append("codigo_duplicado_no_pdf")
    return "suspect"


def _check_title_presence(
    title: str, expected_description: str | None, reasons: list[str]
) -> str | None:
    if title.strip():
        return None
    reasons.append("titulo_ausente")
    return "suspect" if expected_description else "rejected"


def _check_body_length(
    normalized_body: str,
    merged_lines: list[str],
    expected_description: str | None,
    reasons: list[str],
) -> str | None:
    if not normalized_body:
        reasons.append("corpo_vazio")
        return "suspect" if expected_description else "rejected"

    has_structured_body = any(line.startswith("- ") for line in merged_lines) or len(merged_lines) >= 2
    min_body_length = 30 if has_structured_body else 50
    if len(normalized_body) >= min_body_length:
        return None

    reasons.append("corpo_muito_curto")
    return "suspect"


def _check_title_vs_nbs(
    normalized_title: str, expected_description: str | None, reasons: list[str]
) -> str | None:
    if not expected_description:
        return None

    normalized_expected = normalize_nbs_text(expected_description)
    if (
        normalized_title
        and normalized_title != normalized_expected
        and _token_overlap_ratio(normalized_title, normalized_expected) < 0.6
    ):
        reasons.append("titulo_inconsistente_com_nbs")
        return "suspect"
    return None


def _validate_candidate(
    candidate: _CandidateEntry,
    resolved_nbs_item: tuple[str, str] | None,
    duplicate_codes: set[str],
    normalized_title: str,
    normalized_body: str,
    merged_lines: list[str],
) -> tuple[str, tuple[str, ...]]:
    reasons: list[str] = []
    status_rank = {"trusted": 0, "suspect": 1, "rejected": 2}
    parser_status = "trusted"

    def promote_status(next_status: str) -> None:
        nonlocal parser_status
        if status_rank[next_status] > status_rank[parser_status]:
            parser_status = next_status

    expected_description = resolved_nbs_item[1] if resolved_nbs_item else None
    checks = (
        _check_nbs_existence(resolved_nbs_item, reasons),
        _check_duplicate(candidate.code, duplicate_codes, reasons),
        _check_title_presence(candidate.title, expected_description, reasons),
        _check_body_length(normalized_body, merged_lines, expected_description, reasons),
        _check_title_vs_nbs(normalized_title, expected_description, reasons),
    )
    for status in checks:
        if status is not None:
            promote_status(status)

    return parser_status, tuple(reasons)


def _should_merge_duplicate_candidate(left: _CandidateEntry, right: _CandidateEntry) -> bool:
    if left.code != right.code:
        return False
    if left.section_title and right.section_title and left.section_title != right.section_title:
        return False
    titles_overlap = _token_overlap_ratio(
        normalize_nbs_text(left.title),
        normalize_nbs_text(right.title),
    )
    if titles_overlap < 0.6:
        return False
    if right.page_start > (left.page_end + 1):
        return False
    return True


def _merge_duplicate_candidate(left: _CandidateEntry, right: _CandidateEntry) -> _CandidateEntry:
    merged_title = left.title if len(left.title) >= len(right.title) else right.title
    merged_body_lines = [*left.body_lines]
    for line in right.body_lines:
        if line not in merged_body_lines:
            merged_body_lines.append(line)
    return _CandidateEntry(
        code=left.code,
        title=merged_title,
        section_title=left.section_title or right.section_title,
        page_start=min(left.page_start, right.page_start),
        page_end=max(left.page_end, right.page_end),
        body_lines=merged_body_lines,
    )


def _coalesce_duplicate_candidates(candidates: list[_CandidateEntry]) -> list[_CandidateEntry]:
    grouped: dict[str, list[_CandidateEntry]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.code, []).append(candidate)

    merged_candidates: list[_CandidateEntry] = []
    for group in grouped.values():
        if len(group) == 1:
            merged_candidates.extend(group)
            continue

        ordered = sorted(group, key=lambda item: (item.page_start, item.page_end))
        current = ordered[0]
        for candidate in ordered[1:]:
            if _should_merge_duplicate_candidate(current, candidate):
                current = _merge_duplicate_candidate(current, candidate)
            else:
                merged_candidates.append(current)
                current = candidate
        merged_candidates.append(current)

    return sorted(merged_candidates, key=lambda item: (item.page_start, item.page_end, item.code))


def _iter_candidate_entries(pdf_path: str | Path) -> list[_CandidateEntry]:
    document = fitz.open(Path(pdf_path))
    candidates: list[_CandidateEntry] = []
    current_section: str | None = None
    current_entry: _CandidateEntry | None = None

    try:
        for zero_based_page, page in enumerate(document):
            page_number = zero_based_page + 1
            for line in _clean_page_lines(page.get_text("text")):
                if SECTION_RE.match(line):
                    current_section = line
                    continue

                match = ENTRY_RE.match(line)
                if match:
                    current_entry = _CandidateEntry(
                        code=match.group("code"),
                        title=match.group("title").strip(),
                        section_title=current_section,
                        page_start=page_number,
                        page_end=page_number,
                    )
                    candidates.append(current_entry)
                    continue

                if current_entry is None:
                    continue

                if _should_extend_title(current_entry.title, current_entry.body_lines, line):
                    current_entry.title = f"{current_entry.title} {line}".strip()
                    current_entry.page_end = page_number
                    continue

                current_entry.add_line(line, page_number)
    finally:
        document.close()

    return _coalesce_duplicate_candidates(candidates)


def parse_nebs_pdf(
    pdf_path: str | Path,
    *,
    valid_nbs_items: dict[str, str],
) -> NebsParseOutcome:
    source_hash = calculate_file_sha256(pdf_path)
    updated_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    outcome = NebsParseOutcome()
    candidates = _iter_candidate_entries(pdf_path)
    duplicate_codes = {
        code for code in {candidate.code for candidate in candidates}
        if sum(1 for candidate in candidates if candidate.code == code) > 1
    }
    resolved_nbs_items: dict[str, tuple[str, str]] = {}
    for canonical_code, description in valid_nbs_items.items():
        for variant in build_nbs_code_variants(canonical_code):
            resolved_nbs_items.setdefault(variant, (canonical_code, description))

    for candidate in candidates:
        merged_lines = _merge_body_lines(candidate.body_lines)
        body_text = _body_lines_to_text(merged_lines)
        title = candidate.title.strip()
        normalized_title = normalize_nbs_text(title)
        normalized_body = normalize_nbs_text(body_text)
        resolved_nbs_item = resolved_nbs_items.get(candidate.code)
        canonical_code = resolved_nbs_item[0] if resolved_nbs_item else candidate.code
        parser_status, reasons = _validate_candidate(
            candidate,
            resolved_nbs_item,
            duplicate_codes,
            normalized_title,
            normalized_body,
            merged_lines,
        )

        if parser_status == "trusted":
            entry = ParsedNebsEntry(
                code=canonical_code,
                code_clean=clean_nbs_code(canonical_code),
                title=title,
                title_normalized=normalized_title,
                body_text=body_text,
                body_markdown=_body_lines_to_markdown(merged_lines),
                body_normalized=normalized_body,
                section_title=candidate.section_title,
                page_start=candidate.page_start,
                page_end=candidate.page_end,
                parser_status=parser_status,
                parse_warnings=None,
                source_hash=source_hash,
                updated_at=updated_at,
            )
            outcome.entries.append(entry)
            outcome.counts["trusted"] += 1
            continue

        audit_record = NebsAuditRecord(
            code=candidate.code,
            parser_status=parser_status,
            reasons=tuple(reasons) if reasons else ("bloco_ambiguous",),
            section_title=candidate.section_title,
            title=title,
            page_start=candidate.page_start,
            page_end=candidate.page_end,
            excerpt=_excerpt(body_text or title or candidate.code),
            raw_text=_body_lines_to_text(candidate.body_lines),
        )
        outcome.audit_records.append(audit_record)
        outcome.counts[parser_status] += 1

    return outcome


def write_nebs_audit_report(
    outcome: NebsParseOutcome,
    *,
    csv_path: str | Path,
    json_path: str | Path,
) -> None:
    csv_target = Path(csv_path)
    json_target = Path(json_path)
    csv_target.parent.mkdir(parents=True, exist_ok=True)
    json_target.parent.mkdir(parents=True, exist_ok=True)

    with csv_target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_ALL)
        writer.writerow(
            [
                "code",
                "parser_status",
                "reasons",
                "section_title",
                "title",
                "page_start",
                "page_end",
                "excerpt",
            ]
        )
        for record in outcome.audit_records:
            writer.writerow(
                [
                    record.code or "",
                    record.parser_status,
                    "|".join(record.reasons),
                    record.section_title or "",
                    record.title,
                    str(record.page_start),
                    str(record.page_end),
                    record.excerpt,
                ]
            )

    payload = [asdict(record) for record in outcome.audit_records]
    json_target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
