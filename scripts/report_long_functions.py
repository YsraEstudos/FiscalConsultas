from __future__ import annotations

import argparse
import ast
import json
import os
import tokenize
from dataclasses import dataclass, replace
from io import StringIO
from pathlib import Path
from typing import Iterable, Iterator, Sequence


IGNORED_DIRECTORY_NAMES = {
    ".agent",
    ".git",
    ".mypy_cache",
    ".nox",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vscode",
    ".worktrees",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "site-packages",
    "tox",
}

IGNORED_TOKEN_TYPES = {
    tokenize.COMMENT,
    tokenize.DEDENT,
    tokenize.ENCODING,
    tokenize.ENDMARKER,
    tokenize.INDENT,
    tokenize.NL,
    tokenize.NEWLINE,
}

DEFAULT_THRESHOLD = 20
DEFAULT_JSON_OUTPUT = Path("reports") / "long_functions.json"


@dataclass(frozen=True, slots=True)
class LongFunctionFinding:
    item_id: str
    relative_path: str
    function_name: str
    kind: str
    definition_start_line: int
    definition_end_line: int
    body_start_line: int
    body_end_line: int
    body_line_count: int


@dataclass(frozen=True, slots=True)
class ScanIssue:
    relative_path: str
    message: str


@dataclass(frozen=True, slots=True)
class ScanReport:
    root: Path
    threshold: int
    scanned_files: int
    findings: list[LongFunctionFinding]
    issues: list[ScanIssue]


def _statement_start_line(statement: ast.stmt) -> int:
    line_numbers = [getattr(statement, "lineno", None)]

    decorators = getattr(statement, "decorator_list", None) or []
    line_numbers.extend(
        getattr(decorator, "lineno", None) for decorator in decorators
    )

    valid_lines = [line for line in line_numbers if line is not None]
    return min(valid_lines) if valid_lines else 0


def _statement_end_line(statement: ast.stmt) -> int:
    line_numbers = [getattr(statement, "end_lineno", None), getattr(statement, "lineno", None)]

    decorators = getattr(statement, "decorator_list", None) or []
    line_numbers.extend(
        getattr(decorator, "end_lineno", None) or getattr(decorator, "lineno", None)
        for decorator in decorators
    )

    valid_lines = [line for line in line_numbers if line is not None]
    return max(valid_lines) if valid_lines else 0


def _body_span(body: Sequence[ast.stmt]) -> tuple[int, int]:
    start_lines = [_statement_start_line(statement) for statement in body]
    end_lines = [_statement_end_line(statement) for statement in body]
    return min(start_lines), max(end_lines)


def _count_meaningful_lines_in_span(source: str, start_line: int, end_line: int) -> int:
    if start_line <= 0 or end_line <= 0 or end_line < start_line:
        return 0

    meaningful_lines: set[int] = set()
    reader = StringIO(source).readline

    try:
        for token in tokenize.generate_tokens(reader):
            if token.type in IGNORED_TOKEN_TYPES:
                continue

            token_start_line = token.start[0]
            token_end_line = token.end[0]
            if token_end_line < start_line or token_start_line > end_line:
                continue

            line_start = max(start_line, token_start_line)
            line_end = min(end_line, token_end_line)
            meaningful_lines.update(range(line_start, line_end + 1))
    except tokenize.TokenError as exc:
        raise ValueError(f"failed to tokenize source: {exc}") from exc

    return len(meaningful_lines)


def count_function_body_lines(
    source: str, function_node: ast.FunctionDef | ast.AsyncFunctionDef
) -> int:
    body_start_line, body_end_line = _body_span(function_node.body)
    return _count_meaningful_lines_in_span(source, body_start_line, body_end_line)


def _relative_path(file_path: Path, root: Path) -> str:
    if root.is_file():
        return file_path.name

    try:
        return file_path.relative_to(root).as_posix()
    except ValueError:
        return file_path.as_posix()


def _iter_python_files(root: Path) -> Iterator[Path]:
    if root.is_file():
        if root.suffix.lower() == ".py":
            yield root
        return

    for current_dir, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            directory_name
            for directory_name in dirnames
            if directory_name not in IGNORED_DIRECTORY_NAMES
        ]

        current_path = Path(current_dir)
        for filename in filenames:
            if Path(filename).suffix.lower() != ".py":
                continue
            yield current_path / filename


def _collect_module_level_findings(
    source: str, file_path: Path, root: Path, threshold: int
) -> list[LongFunctionFinding]:
    tree = ast.parse(source, filename=str(file_path))
    relative_path = _relative_path(file_path, root)
    findings: list[LongFunctionFinding] = []

    for statement in tree.body:
        if not isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        body_line_count = count_function_body_lines(source, statement)
        if body_line_count <= threshold:
            continue

        body_start_line, body_end_line = _body_span(statement.body)
        definition_start_line = _statement_start_line(statement)
        definition_end_line = _statement_end_line(statement)
        kind = "async def" if isinstance(statement, ast.AsyncFunctionDef) else "def"

        findings.append(
            LongFunctionFinding(
                item_id="",
                relative_path=relative_path,
                function_name=statement.name,
                kind=kind,
                definition_start_line=definition_start_line,
                definition_end_line=definition_end_line,
                body_start_line=body_start_line,
                body_end_line=body_end_line,
                body_line_count=body_line_count,
            )
        )

    return findings


def _sort_findings(findings: Iterable[LongFunctionFinding]) -> list[LongFunctionFinding]:
    return sorted(
        findings,
        key=lambda finding: (
            -finding.body_line_count,
            finding.relative_path,
            finding.definition_start_line,
            finding.function_name,
        ),
    )


def scan_tree(root: Path | str, threshold: int = DEFAULT_THRESHOLD) -> ScanReport:
    root_path = Path(root).resolve()
    collected_findings: list[LongFunctionFinding] = []
    issues: list[ScanIssue] = []
    scanned_files = 0

    for file_path in _iter_python_files(root_path):
        scanned_files += 1

        try:
            with tokenize.open(file_path) as handle:
                source = handle.read()
        except OSError as exc:
            issues.append(
                ScanIssue(
                    relative_path=_relative_path(file_path, root_path),
                    message=f"read error: {exc}",
                )
            )
            continue

        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError as exc:
            issues.append(
                ScanIssue(
                    relative_path=_relative_path(file_path, root_path),
                    message=f"syntax error: {exc.msg} (line {exc.lineno}, column {exc.offset})",
                )
            )
            continue

        collected_findings.extend(
            _collect_module_level_findings(source, file_path, root_path, threshold)
        )

    findings = _sort_findings(collected_findings)
    numbered_findings = [replace(finding, item_id=f"ITEM_{index:04d}") for index, finding in enumerate(findings, start=1)]

    return ScanReport(
        root=root_path,
        threshold=threshold,
        scanned_files=scanned_files,
        findings=numbered_findings,
        issues=issues,
    )


def build_json_payload(report: ScanReport) -> dict[str, object]:
    summary: dict[str, object] = {
        "root": str(report.root),
        "threshold": report.threshold,
        "scanned_files": report.scanned_files,
        "matched_functions": len(report.findings),
        "issues": len(report.issues),
    }

    if report.issues:
        summary["scan_issues"] = [
            {
                "relative_path": issue.relative_path,
                "message": issue.message,
            }
            for issue in report.issues
        ]

    payload: dict[str, object] = {"summary": summary}

    for finding in report.findings:
        payload[finding.item_id] = {
            "relative_path": finding.relative_path,
            "function_name": finding.function_name,
            "kind": finding.kind,
            "definition_start_line": finding.definition_start_line,
            "definition_end_line": finding.definition_end_line,
            "body_start_line": finding.body_start_line,
            "body_end_line": finding.body_end_line,
            "body_line_count": finding.body_line_count,
        }

    return payload


def write_json_report(report: ScanReport, output_path: Path | str) -> Path:
    target_path = Path(output_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(
        json.dumps(build_json_payload(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return target_path


def format_terminal_report(report: ScanReport) -> str:
    lines = [
        f"Long functions above {report.threshold} body lines",
        f"Root: {report.root}",
        f"Scanned files: {report.scanned_files}",
        f"Matched functions: {len(report.findings)}",
        f"Issues: {len(report.issues)}",
        "",
    ]

    if not report.findings:
        lines.append("No module-level functions exceeded the threshold.")
    else:
        for finding in report.findings:
            lines.extend(
                [
                    f"{finding.item_id} {finding.relative_path}:{finding.definition_start_line} {finding.function_name} ({finding.kind})",
                    f"  body_lines={finding.body_line_count} body_span={finding.body_start_line}-{finding.body_end_line} definition_span={finding.definition_start_line}-{finding.definition_end_line}",
                ]
            )

    if report.issues:
        lines.append("")
        lines.append("Issues:")
        for issue in report.issues:
            lines.append(f"- {issue.relative_path}: {issue.message}")

    return "\n".join(lines)


def run_report(
    root: Path | str = Path(__file__).resolve().parents[1],
    *,
    threshold: int = DEFAULT_THRESHOLD,
    json_output_path: Path | str | None = DEFAULT_JSON_OUTPUT,
) -> ScanReport:
    report = scan_tree(root, threshold=threshold)
    print(format_terminal_report(report))

    if json_output_path is not None:
        output_path = write_json_report(report, json_output_path)
        print(f"JSON report written to: {output_path}")

    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report module-level Python functions whose bodies exceed a line threshold."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Root directory or Python file to scan.",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_THRESHOLD,
        help="Minimum body line count required to report a function.",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        default=DEFAULT_JSON_OUTPUT,
        help="Path to the JSON output file.",
    )
    parser.add_argument(
        "--no-json",
        action="store_true",
        help="Do not write a JSON report file.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    json_output_path: Path | None = None if args.no_json else args.json_out
    run_report(args.root, threshold=args.threshold, json_output_path=json_output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())