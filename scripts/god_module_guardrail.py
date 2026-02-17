#!/usr/bin/env python3
"""
God Module Guardrail

Analisa um repositorio e identifica modulos com sinais de "god module",
com foco principal em Rust (adaptando para outros tipos quando necessario).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Literal, TypeAlias


LanguageName: TypeAlias = Literal["rust", "javascript", "python"]
JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]

RUST_EXTENSIONS: set[str] = {".rs"}
JS_EXTENSIONS: set[str] = {".js", ".jsx", ".ts", ".tsx"}
PYTHON_EXTENSIONS: set[str] = {".py"}

IGNORED_DIRS: set[str] = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "target",
    "dist",
    "build",
}

RESPONSIBILITY_PATTERNS_RAW: dict[str, list[str]] = {
    "web": [
        r"\baxum::",
        r"\bwarp::",
        r"\bhyper::",
        r"\btower::",
        r"\bfastapi\b",
        r"\bflask\b",
        r"\bexpress\b",
        r"\brouter\b",
    ],
    "database": [
        r"\bsqlx::",
        r"\bdiesel::",
        r"\brusqlite\b",
        r"\bsqlalchemy\b",
        r"\balembic\b",
        r"\bpostgres\b",
        r"\bsqlite\b",
        r"\bmigration\b",
    ],
    "indexing_search": [
        r"\btantivy::",
        r"\belasticsearch\b",
        r"\bfts5\b",
        r"\bsearch_index\b",
        r"\binverted index\b",
    ],
    "auth_security": [
        r"\boauth\b",
        r"\bjwt\b",
        r"\bbcrypt\b",
        r"\bargon2\b",
        r"\brbac\b",
        r"\bpermission\b",
    ],
    "llm_ai": [
        r"\bllm\b",
        r"\bprompt\b",
        r"\bopenai\b",
        r"\bgemini\b",
        r"\banthropic\b",
        r"\bembedding\b",
        r"\bchat completion\b",
    ],
    "io_fs": [
        r"\bstd::fs::",
        r"\btokio::fs::",
        r"\bpathlib\b",
        r"\baiofiles\b",
        r"\bfile::open\b",
        r"\bfile::create\b",
        r"\bopenoptions\b",
        r"\bbufreader\b",
        r"\bbufwriter\b",
    ],
    "async_concurrency": [
        r"\btokio::",
        r"\bfutures::",
        r"\basyncio\b",
        r"\bspawn\(",
        r"\bgather\(",
        r"\bjoin_all\b",
    ],
    "serialization": [
        r"\bserde(?:_json)?\b",
        r"\borjson\b",
        r"\bpydantic\b",
        r"\byaml\b",
        r"\btoml\b",
        r"\bmsgpack\b",
    ],
    "vcs_git": [
        r"\bgit2\b",
        r"\bgitpython\b",
        r"\bgithub\b",
        r"\bgitlab\b",
        r"\bcommit\b",
        r"\bbranch\b",
    ],
    "observability": [
        r"\btracing\b",
        r"\bopentelemetry\b",
        r"\bprometheus\b",
        r"\bsentry\b",
        r"\bmetrics\b",
        r"\bstructured logging\b",
    ],
}
RESPONSIBILITY_RULES: dict[str, list[re.Pattern[str]]] = {
    category: [re.compile(pattern, re.IGNORECASE) for pattern in patterns]
    for category, patterns in RESPONSIBILITY_PATTERNS_RAW.items()
}


RUST_FN_PATTERN = re.compile(
    r"^\s*(?:pub(?:\([^)]+\))?\s+)?"
    r"(?:default\s+)?"
    r"(?:const\s+)?"
    r"(?:async\s+)?"
    r"(?:unsafe\s+)?"
    r'(?:extern\s+(?:"[^"]*"\s+)?)?'
    r"fn\s+([A-Za-z_]\w*)\s*[<(]",
)
RUST_DECISION_PATTERN = re.compile(r"\bif\b|\bmatch\b|\bfor\b|\bwhile\b|\bloop\b|&&|\|\|")
RUST_EARLY_RETURN_PATTERN = re.compile(r"\?")
PYTHON_FN_PATTERN = re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(")
PYTHON_DECISION_PATTERN = re.compile(r"\bif\b|\belif\b|\bfor\b|\bwhile\b|\bexcept\b|\bmatch\b|\band\b|\bor\b")
JS_FN_DECL_PATTERN = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
JS_ARROW_FN_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
USE_PATTERN = re.compile(r"^\s*use\s+")
MOD_PATTERN = re.compile(r"^\s*mod\s+")
STRUCT_PATTERN = re.compile(r"^\s*(?:pub(?:\([^)]+\))?\s+)?struct\s+")
ENUM_PATTERN = re.compile(r"^\s*(?:pub(?:\([^)]+\))?\s+)?enum\s+")
TRAIT_PATTERN = re.compile(r"^\s*(?:pub(?:\([^)]+\))?\s+)?(?:unsafe\s+)?trait\s+")
IMPL_PATTERN = re.compile(r"^\s*impl\b")
PYTHON_IMPORT_PATTERN = re.compile(r"^\s*(?:from\s+\S+\s+import|import\s+)")
JS_IMPORT_PATTERN = re.compile(r"^\s*import\s+|\brequire\(")
RUST_CHAR_LITERAL_PATTERN = re.compile(
    r"""'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|n|r|t|\\|0|'|")|[^\\'])'"""
)
RUST_RAW_STRING_START = re.compile(r'(?:br|rb|r)(#*)"')
JS_ELSE_IF_PATTERN = re.compile(r"\belse\s+if\b")
JS_IF_PATTERN = re.compile(r"\bif\b")
JS_DECISION_PATTERN = re.compile(r"\bfor\b|\bwhile\b|\bswitch\b|\bcatch\b|&&|\|\|")


@dataclass
class FunctionMetric:
    name: str
    start_line: int
    end_line: int
    loc: int
    complexity: int


@dataclass
class FileMetric:
    path: Path
    language: str
    total_lines: int
    code_lines: int
    blank_lines: int
    comment_lines: int
    imports: int
    modules: int
    structs: int
    enums: int
    traits: int
    impls: int
    functions: list[FunctionMetric]
    responsibilities: list[str]
    score: float
    reasons: list[str]


@dataclass
class RustStripState:
    block_comment_depth: int = 0
    raw_string_closer: str | None = None


ImportMethod: TypeAlias = Literal["match", "search"]


@dataclass(frozen=True)
class LanguageConfig:
    line_language: LanguageName
    extract_functions: Callable[[list[str]], list[FunctionMetric]]
    import_pattern: re.Pattern[str]
    import_method: ImportMethod
    count_rust_items: bool


def iter_source_files(root: Path, allowed_extensions: set[str]) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if should_ignore_path(path):
            continue
        if path.suffix.lower() in allowed_extensions:
            yield path


def should_ignore_path(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.parts)


def detect_language_mode(root: Path, requested: str) -> tuple[LanguageName, set[str]]:
    if requested != "auto":
        if requested == "rust":
            return "rust", RUST_EXTENSIONS
        if requested == "javascript":
            return "javascript", JS_EXTENSIONS
        if requested == "python":
            return "python", PYTHON_EXTENSIONS
        raise ValueError(f"linguagem invalida: {requested}")

    counts: dict[LanguageName, int] = {"rust": 0, "javascript": 0, "python": 0}
    ext_map: dict[str, LanguageName] = {
        **{ext: "rust" for ext in RUST_EXTENSIONS},
        **{ext: "javascript" for ext in JS_EXTENSIONS},
        **{ext: "python" for ext in PYTHON_EXTENSIONS},
    }
    extensions_by_lang: dict[LanguageName, set[str]] = {
        "rust": RUST_EXTENSIONS,
        "javascript": JS_EXTENSIONS,
        "python": PYTHON_EXTENSIONS,
    }

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if should_ignore_path(path):
            continue
        language = ext_map.get(path.suffix.lower())
        if language:
            counts[language] += 1

    mode: LanguageName = max(counts, key=lambda key: counts[key])
    return mode, extensions_by_lang[mode]


def count_line_kinds(lines: list[str], language: str = "rust") -> tuple[int, int, int]:
    blank = 0
    comment = 0
    code = 0
    rust_state = RustStripState()
    js_block_comment_depth = 0
    js_in_template = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            blank += 1
            continue

        if language == "rust":
            clean, rust_state = strip_rust_line_for_logic(line, rust_state)
            has_code = bool(clean.strip())
            if has_code:
                code += 1
            else:
                comment += 1
            continue

        if language == "python":
            if stripped.startswith("#"):
                comment += 1
            else:
                code += 1
            continue

        if language == "javascript":
            clean, js_block_comment_depth, js_in_template = strip_c_like_line_for_logic(
                line, js_block_comment_depth, js_in_template
            )
            if clean.strip():
                code += 1
            else:
                comment += 1
            continue

        code += 1

    return code, blank, comment


def count_responsibilities(text: str) -> list[str]:
    found: list[str] = []
    for category, patterns in RESPONSIBILITY_RULES.items():
        if any(pattern.search(text) for pattern in patterns):
            found.append(category)
    return found


def find_matching_brace(lines: list[str], start_idx: int) -> int:
    opened = 0
    started = False
    rust_state = RustStripState()
    for idx in range(start_idx, len(lines)):
        line, rust_state = strip_rust_line_for_logic(lines[idx], rust_state)
        opened += line.count("{")
        if line.count("{") > 0:
            started = True
        opened -= line.count("}")
        if started and opened <= 0:
            return idx
    return len(lines) - 1


def find_matching_brace_js(lines: list[str], start_idx: int) -> int:
    opened = 0
    started = False
    block_comment_depth = 0
    in_template = False
    for idx in range(start_idx, len(lines)):
        line, block_comment_depth, in_template = strip_c_like_line_for_logic(
            lines[idx], block_comment_depth, in_template
        )
        opened += line.count("{")
        if line.count("{") > 0:
            started = True
        opened -= line.count("}")
        if started and opened <= 0:
            return idx
    return len(lines) - 1


def strip_rust_line_for_logic(line: str, state: RustStripState) -> tuple[str, RustStripState]:
    result: list[str] = []
    i = 0
    block_comment_depth = state.block_comment_depth
    raw_string_closer = state.raw_string_closer

    while i < len(line):
        if raw_string_closer is not None:
            pos = line.find(raw_string_closer, i)
            if pos != -1:
                i = pos + len(raw_string_closer)
                raw_string_closer = None
            else:
                i = len(line)
            continue

        if block_comment_depth > 0:
            if line.startswith("/*", i):
                block_comment_depth += 1
                i += 2
                continue
            if line.startswith("*/", i):
                block_comment_depth -= 1
                i += 2
                continue
            i += 1
            continue

        if line.startswith("//", i):
            break
        if line.startswith("/*", i):
            block_comment_depth += 1
            i += 2
            continue

        raw_match = RUST_RAW_STRING_START.match(line, i)
        if raw_match is not None:
            hashes = raw_match.group(1)
            closer = '"' + hashes
            i = raw_match.end()
            pos = line.find(closer, i)
            if pos != -1:
                i = pos + len(closer)
            else:
                raw_string_closer = closer
                i = len(line)
            result.append('""')
            continue

        ch = line[i]
        if line.startswith('b"', i):
            result.append("b")
            i += 1
            continue
        if ch == '"':
            result.append('""')
            i += 1
            escaped = False
            while i < len(line):
                c = line[i]
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch == "'":
            maybe_char = RUST_CHAR_LITERAL_PATTERN.match(line, i)
            if maybe_char is not None:
                result.append("' '")
                i += maybe_char.end() - maybe_char.start()
                continue

        result.append(ch)
        i += 1

    new_state = RustStripState(
        block_comment_depth=block_comment_depth,
        raw_string_closer=raw_string_closer,
    )
    return "".join(result), new_state


def strip_c_like_line_for_logic(
    line: str, block_comment_depth: int, in_template: bool = False
) -> tuple[str, int, bool]:
    result: list[str] = []
    i = 0
    while i < len(line):
        if in_template:
            if line[i] == "\\" and i + 1 < len(line):
                i += 2
                continue
            if line[i] == "`":
                in_template = False
                i += 1
                continue
            i += 1
            continue

        if block_comment_depth > 0:
            if line.startswith("/*", i):
                block_comment_depth += 1
                i += 2
                continue
            if line.startswith("*/", i):
                block_comment_depth -= 1
                i += 2
                continue
            i += 1
            continue

        if line.startswith("//", i):
            break
        if line.startswith("/*", i):
            block_comment_depth += 1
            i += 2
            continue

        ch = line[i]
        if ch in ('"', "'"):
            quote = ch
            result.append(quote + quote)
            i += 1
            escaped = False
            while i < len(line):
                c = line[i]
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == quote:
                    i += 1
                    break
                i += 1
            continue
        if ch == "`":
            result.append("``")
            in_template = True
            i += 1
            continue

        result.append(ch)
        i += 1

    return "".join(result), block_comment_depth, in_template


def sanitize_rust_lines(lines: list[str]) -> str:
    clean_lines: list[str] = []
    rust_state = RustStripState()
    for line in lines:
        clean, rust_state = strip_rust_line_for_logic(line, rust_state)
        clean_lines.append(clean)
    return "\n".join(clean_lines)


def sanitize_c_like_lines(lines: list[str]) -> str:
    clean_lines: list[str] = []
    block_comment_depth = 0
    in_template = False
    for line in lines:
        clean, block_comment_depth, in_template = strip_c_like_line_for_logic(
            line, block_comment_depth, in_template
        )
        clean_lines.append(clean)
    return "\n".join(clean_lines)


def sanitize_python_lines(lines: list[str]) -> str:
    clean_lines: list[str] = []
    in_triple: str | None = None

    for line in lines:
        clean_line, in_triple = strip_python_line_for_logic(line, in_triple)
        clean_lines.append(clean_line)

    return "\n".join(clean_lines)


def strip_python_line_for_logic(line: str, in_triple: str | None) -> tuple[str, str | None]:
    result: list[str] = []
    i = 0

    while i < len(line):
        if in_triple is not None:
            if line.startswith(in_triple, i):
                result.append(in_triple)
                i += 3
                in_triple = None
            else:
                i += 1
            continue

        if line.startswith('"""', i) or line.startswith("'''", i):
            in_triple = line[i : i + 3]
            result.append(in_triple)
            i += 3
            continue

        ch = line[i]
        if ch in ('"', "'"):
            quote = ch
            result.append(quote + quote)
            i += 1
            escaped = False
            while i < len(line):
                c = line[i]
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == quote:
                    i += 1
                    break
                i += 1
            continue

        if ch == "#":
            break

        result.append(ch)
        i += 1

    return "".join(result), in_triple


def compute_rust_complexity(snippet_lines: list[str]) -> int:
    clean = sanitize_rust_lines(snippet_lines)
    base = 1 + len(RUST_DECISION_PATTERN.findall(clean))
    early_returns = len(RUST_EARLY_RETURN_PATTERN.findall(clean))
    return base + (early_returns // 3)


def compute_python_complexity(snippet_lines: list[str]) -> int:
    clean = sanitize_python_lines(snippet_lines)
    return 1 + len(PYTHON_DECISION_PATTERN.findall(clean))


def compute_js_complexity(snippet_lines: list[str]) -> int:
    clean = sanitize_c_like_lines(snippet_lines)
    else_if_count = len(JS_ELSE_IF_PATTERN.findall(clean))
    clean_without_else_if = JS_ELSE_IF_PATTERN.sub(" ", clean)
    if_count = len(JS_IF_PATTERN.findall(clean_without_else_if))
    decision_count = len(JS_DECISION_PATTERN.findall(clean))
    return 1 + else_if_count + if_count + decision_count


def extract_rust_functions(lines: list[str]) -> list[FunctionMetric]:
    functions: list[FunctionMetric] = []
    i = 0
    while i < len(lines):
        match = RUST_FN_PATTERN.match(lines[i])
        if not match:
            i += 1
            continue

        name = match.group(1)
        brace_line = i
        found_body = "{" in lines[i]
        while not found_body and brace_line + 1 < len(lines):
            brace_line += 1
            current = lines[brace_line]
            if ";" in current and "{" not in current:
                break
            if "{" in current:
                found_body = True
                break
        if not found_body:
            i += 1
            continue

        end = find_matching_brace(lines, brace_line)
        snippet_lines = lines[i : end + 1]
        complexity = compute_rust_complexity(snippet_lines)
        functions.append(
            FunctionMetric(
                name=name,
                start_line=i + 1,
                end_line=end + 1,
                loc=end - i + 1,
                complexity=complexity,
            )
        )
        i = end + 1
    return functions


def extract_python_functions(lines: list[str]) -> list[FunctionMetric]:
    functions: list[FunctionMetric] = []
    i = 0
    in_triple: str | None = None
    while i < len(lines):
        clean_line, in_triple = strip_python_line_for_logic(lines[i], in_triple)
        match = PYTHON_FN_PATTERN.match(clean_line)
        if not match:
            i += 1
            continue

        name = match.group(1)
        base_indent = len(lines[i]) - len(lines[i].lstrip(" \t"))
        end = i
        j = i + 1
        j_triple = in_triple
        while j < len(lines):
            clean_j, j_triple = strip_python_line_for_logic(lines[j], j_triple)
            stripped = clean_j.strip()
            if not stripped:
                j += 1
                continue
            indent = len(lines[j]) - len(lines[j].lstrip(" \t"))
            if indent <= base_indent and not stripped.startswith("#"):
                break
            end = j
            j += 1

        snippet_lines = lines[i : end + 1]
        complexity = compute_python_complexity(snippet_lines)
        functions.append(
            FunctionMetric(
                name=name,
                start_line=i + 1,
                end_line=end + 1,
                loc=end - i + 1,
                complexity=complexity,
            )
        )
        i = max(end + 1, i + 1)
    return functions


def extract_js_functions(lines: list[str]) -> list[FunctionMetric]:
    functions: list[FunctionMetric] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        match_decl = JS_FN_DECL_PATTERN.match(line)
        match_arrow = JS_ARROW_FN_PATTERN.match(line)
        if not match_decl and not match_arrow:
            i += 1
            continue

        if match_decl is not None:
            name = match_decl.group(1)
        elif match_arrow is not None:
            name = match_arrow.group(1)
        else:
            i += 1
            continue
        brace_line = i
        found_body = "{" in line
        while not found_body and brace_line + 1 < len(lines):
            brace_line += 1
            current = lines[brace_line]
            if ";" in current and "{" not in current:
                break
            if "{" in current:
                found_body = True
                break

        if not found_body:
            i += 1
            continue

        end = find_matching_brace_js(lines, brace_line)
        snippet_lines = lines[i : end + 1]
        complexity = compute_js_complexity(snippet_lines)
        functions.append(
            FunctionMetric(
                name=name,
                start_line=i + 1,
                end_line=end + 1,
                loc=end - i + 1,
                complexity=complexity,
            )
        )
        i = end + 1
    return functions


def score_file(total_lines: int, functions: list[FunctionMetric], responsibilities: list[str]) -> tuple[float, list[str]]:
    reasons: list[str] = []
    long_funcs = [f for f in functions if f.loc >= 80]
    complex_funcs = [f for f in functions if f.complexity >= 20]
    max_complexity = max((f.complexity for f in functions), default=0)
    func_count = len(functions)

    size_score = min(1.0, total_lines / 450.0) * 30.0
    complexity_score = min(1.0, max_complexity / 30.0) * 20.0
    long_func_score = min(1.0, len(long_funcs) / 4.0) * 15.0
    responsibility_score = min(1.0, len(responsibilities) / 6.0) * 15.0
    function_count_score = min(1.0, func_count / 30.0) * 20.0
    score = size_score + complexity_score + long_func_score + responsibility_score + function_count_score

    if total_lines >= 450:
        reasons.append(f"arquivo grande ({total_lines} linhas)")
    if complex_funcs:
        reasons.append(f"funcao(oes) muito complexa(s) ({len(complex_funcs)})")
    if long_funcs:
        reasons.append(f"funcao(oes) longa(s) ({len(long_funcs)})")
    if len(responsibilities) >= 4:
        reasons.append(f"muitas responsabilidades ({len(responsibilities)})")
    if func_count >= 25:
        reasons.append(f"muitas funcoes ({func_count})")

    return round(score, 2), reasons


LANGUAGE_CONFIG: dict[LanguageName, LanguageConfig] = {
    "rust": LanguageConfig(
        line_language="rust",
        extract_functions=extract_rust_functions,
        import_pattern=USE_PATTERN,
        import_method="match",
        count_rust_items=True,
    ),
    "python": LanguageConfig(
        line_language="python",
        extract_functions=extract_python_functions,
        import_pattern=PYTHON_IMPORT_PATTERN,
        import_method="match",
        count_rust_items=False,
    ),
    "javascript": LanguageConfig(
        line_language="javascript",
        extract_functions=extract_js_functions,
        import_pattern=JS_IMPORT_PATTERN,
        import_method="search",
        count_rust_items=False,
    ),
}


def analyze_file(path: Path, root: Path, language: LanguageName) -> FileMetric | None:
    cfg = LANGUAGE_CONFIG[language]
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"WARN: skipping {path}: {exc}", file=sys.stderr)
        return None

    lines = text.splitlines()
    code_lines, blank_lines, comment_lines = count_line_kinds(lines, language=cfg.line_language)
    functions = cfg.extract_functions(lines)
    responsibilities = count_responsibilities(text)
    score, reasons = score_file(len(lines), functions, responsibilities)

    if cfg.import_method == "search":
        imports = sum(1 for line in lines if cfg.import_pattern.search(line))
    else:
        imports = sum(1 for line in lines if cfg.import_pattern.match(line))

    count_rust_items = cfg.count_rust_items
    return FileMetric(
        path=path.relative_to(root),
        language=language,
        total_lines=len(lines),
        code_lines=code_lines,
        blank_lines=blank_lines,
        comment_lines=comment_lines,
        imports=imports,
        modules=sum(1 for line in lines if MOD_PATTERN.match(line)) if count_rust_items else 0,
        structs=sum(1 for line in lines if STRUCT_PATTERN.match(line)) if count_rust_items else 0,
        enums=sum(1 for line in lines if ENUM_PATTERN.match(line)) if count_rust_items else 0,
        traits=sum(1 for line in lines if TRAIT_PATTERN.match(line)) if count_rust_items else 0,
        impls=sum(1 for line in lines if IMPL_PATTERN.match(line)) if count_rust_items else 0,
        functions=functions,
        responsibilities=responsibilities,
        score=score,
        reasons=reasons,
    )


def rank_refactoring_suggestions(metric: FileMetric) -> list[str]:
    suggestions: list[str] = []
    if metric.total_lines >= 450:
        suggestions.append("Separar o arquivo por dominio (ex.: web, db, indexing, auth).")
    if any(f.loc >= 80 for f in metric.functions):
        suggestions.append("Extrair funcoes longas em funcoes menores com contratos claros.")
    if any(f.complexity >= 20 for f in metric.functions):
        suggestions.append("Reduzir ramificacoes: mover regras para helpers e tabelas de decisao.")
    if len(metric.responsibilities) >= 4:
        suggestions.append("Mover responsabilidades cruzadas para modulos dedicados.")
    if metric.imports >= 25:
        suggestions.append("Revisar dependencias do modulo e reduzir acoplamento.")
    if not suggestions:
        suggestions.append("Sem acao urgente; manter monitoramento por score.")
    return suggestions


def function_metric_to_json(function: FunctionMetric) -> dict[str, JsonValue]:
    payload: dict[str, JsonValue] = {
        "name": function.name,
        "start_line": function.start_line,
        "end_line": function.end_line,
        "loc": function.loc,
        "complexity": function.complexity,
    }
    return payload


def file_metric_to_json(metric: FileMetric) -> dict[str, JsonValue]:
    functions_payload: list[JsonValue] = [function_metric_to_json(func) for func in metric.functions]
    payload: dict[str, JsonValue] = {
        "path": str(metric.path),
        "score": metric.score,
        "total_lines": metric.total_lines,
        "code_lines": metric.code_lines,
        "blank_lines": metric.blank_lines,
        "comment_lines": metric.comment_lines,
        "imports": metric.imports,
        "modules": metric.modules,
        "structs": metric.structs,
        "enums": metric.enums,
        "traits": metric.traits,
        "impls": metric.impls,
        "responsibilities": metric.responsibilities,
        "reasons": metric.reasons,
        "suggestions": rank_refactoring_suggestions(metric),
        "functions": functions_payload,
    }
    return payload


def to_markdown(root: Path, language: str, files: list[FileMetric], threshold: float) -> str:
    flagged = [m for m in files if m.score >= threshold]
    top = sorted(files, key=lambda m: m.score, reverse=True)[:10]

    lines: list[str] = []
    lines.append("# God Module Guardrail Report")
    lines.append("")
    lines.append(f"- Root: `{root}`")
    lines.append(f"- Language mode: `{language}`")
    lines.append(f"- Files scanned: **{len(files)}**")
    lines.append(f"- Threshold: **{threshold:.1f}**")
    lines.append(f"- Flagged modules: **{len(flagged)}**")
    lines.append("")

    lines.append("## Top Risk Modules")
    lines.append("")
    if not top:
        lines.append("Nenhum arquivo fonte encontrado para o modo selecionado.")
    else:
        lines.append("| Module | Score | Lines | Functions | Max Complexity | Responsibilities |")
        lines.append("|---|---:|---:|---:|---:|---:|")
        for metric in top:
            max_complexity = max((f.complexity for f in metric.functions), default=0)
            lines.append(
                f"| `{metric.path}` | {metric.score:.2f} | {metric.total_lines} | {len(metric.functions)} | {max_complexity} | {len(metric.responsibilities)} |"
            )
    lines.append("")

    lines.append("## Flagged Modules")
    lines.append("")
    if not flagged:
        lines.append("Nenhum modulo ultrapassou o threshold.")
    else:
        for metric in sorted(flagged, key=lambda m: m.score, reverse=True):
            lines.append(f"### `{metric.path}` (score {metric.score:.2f})")
            lines.append("")
            reason_text = ", ".join(metric.reasons) if metric.reasons else "sinal fraco, mas acima do threshold"
            lines.append(f"- Sinais: {reason_text}")
            lines.append(f"- Linhas totais: {metric.total_lines}")
            lines.append(f"- Funcoes: {len(metric.functions)}")
            lines.append(f"- Imports: {metric.imports}")
            lines.append(f"- Responsabilidades: {', '.join(metric.responsibilities) if metric.responsibilities else 'nenhuma detectada'}")

            top_funcs = sorted(metric.functions, key=lambda f: (f.complexity, f.loc), reverse=True)[:5]
            if top_funcs:
                lines.append("- Funcoes mais criticas:")
                for fn in top_funcs:
                    lines.append(
                        f"  - `{fn.name}` lines {fn.start_line}-{fn.end_line}, loc={fn.loc}, complexity={fn.complexity}"
                    )

            lines.append("- Refatoracao segura sugerida:")
            for suggestion in rank_refactoring_suggestions(metric):
                lines.append(f"  - {suggestion}")
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def to_json_dict(root: Path, language: str, files: list[FileMetric], threshold: float) -> dict[str, JsonValue]:
    flagged = [m for m in files if m.score >= threshold]
    files_payload: list[JsonValue] = [file_metric_to_json(m) for m in sorted(files, key=lambda x: x.score, reverse=True)]

    payload: dict[str, JsonValue] = {
        "root": str(root),
        "language_mode": language,
        "files_scanned": len(files),
        "threshold": threshold,
        "flagged_modules": len(flagged),
        "files": files_payload,
    }
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detecta possiveis god modules em repositorios.")
    parser.add_argument("--root", default=".", help="Caminho do repositorio.")
    parser.add_argument(
        "--language",
        default="auto",
        choices=["auto", "rust", "javascript", "python"],
        help="Linguagem alvo para analise.",
    )
    parser.add_argument("--threshold", type=float, default=60.0, help="Threshold de score para flag.")
    parser.add_argument("--out", default="", help="Arquivo de saida markdown.")
    parser.add_argument("--json-out", default="", help="Arquivo de saida JSON.")
    parser.add_argument("--print-top", type=int, default=10, help="Quantidade de itens no resumo de console.")
    parser.add_argument("--version", action="version", version="%(prog)s 0.3.0")
    parser.add_argument(
        "--fail-on-flagged",
        action="store_true",
        help="Retorna codigo 1 quando houver modulos acima do threshold (util para CI).",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        parser.error(f"root nao existe: {root}")

    language, extensions = detect_language_mode(root, args.language)
    files = list(iter_source_files(root, extensions))
    raw_metrics = [analyze_file(path, root, language) for path in files]
    metrics = [m for m in raw_metrics if m is not None]

    report_md = to_markdown(root, language, metrics, args.threshold)
    json_payload = to_json_dict(root, language, metrics, args.threshold)

    top_count = max(args.print_top, 0)
    top = sorted(metrics, key=lambda m: m.score, reverse=True)[:top_count]
    print("Step 1: Scan Repository Tree")
    print(f"Root: {root}")
    print(f"Language mode: {language}")
    print(f"Source files found: {len(metrics)}")
    print("")
    print("Step 2: Full Source Scan")
    if not metrics:
        print("No source files were found for selected mode.")
    elif top_count == 0:
        print("Top output disabled (--print-top 0).")
    else:
        for idx, metric in enumerate(top, start=1):
            max_complexity = max((f.complexity for f in metric.functions), default=0)
            print(
                f"{idx:>2}. {metric.path} | score={metric.score:.2f} | lines={metric.total_lines} | "
                f"functions={len(metric.functions)} | max_complexity={max_complexity} | responsibilities={len(metric.responsibilities)}"
            )

    flagged = [m for m in metrics if m.score >= args.threshold]
    print("")
    print("Step 3: Guardrail Decision")
    print(f"Flagged modules: {len(flagged)} (threshold={args.threshold:.1f})")
    print("Status: FAIL" if flagged else "Status: PASS")

    if args.out:
        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report_md, encoding="utf-8")
        print(f"Markdown report written to: {out_path}")
    if args.json_out:
        out_path = Path(args.json_out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(json_payload, indent=2), encoding="utf-8")
        print(f"JSON report written to: {out_path}")

    if not args.out:
        print("")
        print("---- Markdown Preview ----")
        print(report_md)

    if args.fail_on_flagged and flagged:
        print("")
        print(f"FAIL: {len(flagged)} module(s) above threshold.")
        return 1
    if args.fail_on_flagged:
        print("")
        print("PASS: no modules above threshold.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
