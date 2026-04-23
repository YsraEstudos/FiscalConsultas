"""Text cleaning and inline transforms used by the presentation renderer."""

import logging
import re
from collections.abc import Callable
from html.parser import HTMLParser
from typing import Protocol

from .renderer_patterns import (
    _MultiTransformParser,
    _SmartLinkParser,
    _UnitHighlighter,
    _RendererRegexProtocol,
)

logger = logging.getLogger("nesh.renderer.text")


class _GlossaryManagerProtocol(Protocol):
    def get_regex_pattern(self) -> re.Pattern[str] | None: ...


def _log_parser_fallback(parser_name: str, text: str) -> None:
    logger.warning(
        "%s failed during text rendering; using fallback transform (length=%s)",
        parser_name,
        len(text),
        exc_info=True,
    )


def _replace_plus_artifact(renderer: _RendererRegexProtocol, text: str) -> str:
    output: list[str] = []
    index = 0
    marker_size = len(renderer._PLUS_ARTIFACT)
    size = len(text)

    while index < size:
        marker_index = text.find(renderer._PLUS_ARTIFACT, index)
        if marker_index == -1:
            output.append(text[index:])
            break

        output.append(text[index:marker_index])
        if output and output[-1] and output[-1][-1] in renderer._INLINE_WHITESPACE:
            output[-1] = output[-1][:-1]

        after_index = marker_index + marker_size
        while after_index < size and text[after_index] in renderer._INLINE_WHITESPACE:
            after_index += 1

        output.append(renderer._PLUS_ARTIFACT_REPLACEMENT)
        index = after_index

    return "".join(output)


def _consume_inline_whitespace(
    renderer: _RendererRegexProtocol, text: str, index: int
) -> int:
    size = len(text)
    while index < size and text[index] in renderer._INLINE_WHITESPACE:
        index += 1
    return index


def _parse_superscript_token(
    renderer: _RendererRegexProtocol, text: str, index: int
) -> tuple[str, int] | None:
    if text[index] != "[":
        return None

    digit_index = _consume_inline_whitespace(renderer, text, index + 1)
    if digit_index >= len(text):
        return None

    digit = text[digit_index]
    replacement = renderer._SUPERSCRIPT_MAP.get(digit)
    if replacement is None:
        return None

    close_index = _consume_inline_whitespace(renderer, text, digit_index + 1)
    if close_index >= len(text) or text[close_index] != "]":
        return None

    return replacement, close_index + 1


def _replace_bracket_superscripts(renderer: _RendererRegexProtocol, text: str) -> str:
    output: list[str] = []
    index = 0
    size = len(text)

    while index < size:
        parsed_token = _parse_superscript_token(renderer, text, index)
        if parsed_token is None:
            output.append(text[index])
            index += 1
            continue

        replacement, next_index = parsed_token
        if output and output[-1] in renderer._INLINE_WHITESPACE:
            output.pop()
        output.append(replacement)
        index = next_index

    return "".join(output)


def _extract_bullet_content(renderer: _RendererRegexProtocol, line: str) -> str | None:
    stripped = line.strip()
    if not stripped:
        return None

    marker = stripped[0]
    if marker not in renderer._BULLET_MARKERS:
        return None

    tail = stripped[1:]
    if not tail:
        return ""
    if not tail[0].isspace():
        return None

    return tail.strip()


def _match_list_item(
    renderer: _RendererRegexProtocol, line: str
) -> tuple[str, str] | None:
    if match := renderer.RE_LETTER_LIST.match(line):
        return "a", match.group(2)
    if match := renderer.RE_NUMBER_LIST.match(line):
        return "1", match.group(2)
    if match := renderer.RE_ROMAN_LIST.match(line):
        return "I", match.group(2)
    return None


def _process_list_block(
    renderer: _RendererRegexProtocol, lines: list[str], html_parts: list[str]
) -> None:
    is_list = False
    list_type: str | None = None
    list_items: list[str] = []
    normal_lines: list[str] = []

    def _flush_normal_lines() -> None:
        if normal_lines:
            content = "<br>\n".join(normal_lines)
            html_parts.append(f'<p class="nesh-paragraph">{content}</p>')
            normal_lines.clear()

    def _flush_current_list() -> None:
        nonlocal is_list
        if is_list and list_items:
            type_attr = f' type="{list_type}"' if list_type != "1" else ""
            html_parts.append(
                f'<ol{type_attr} class="nesh-list">{"".join(list_items)}</ol>'
            )
            list_items.clear()
        is_list = False

    for line in lines:
        line = line.strip()
        if not line:
            continue

        list_match = _match_list_item(renderer, line)
        if list_match:
            _flush_normal_lines()
            is_list = True
            list_type = list_match[0]
            list_items.append(f"<li>{list_match[1]}</li>")
            continue

        _flush_current_list()
        normal_lines.append(line)

    _flush_current_list()
    _flush_normal_lines()


def _apply_smart_links_outside_tags(renderer: _RendererRegexProtocol, text: str) -> str:
    def smart_replacer(match: re.Match[str]) -> str:
        ncm = match.group(1)
        clean_ncm = ncm.replace(".", "")
        return f'<a href="#" class="smart-link" data-ncm="{clean_ncm}">{ncm}</a>'

    output: list[str] = []
    index = 0
    in_anchor_depth = 0
    size = len(text)

    while index < size:
        tag_start = text.find("<", index)
        if tag_start == -1:
            if in_anchor_depth > 0:
                output.append(text[index:])
            else:
                output.append(renderer.RE_NCM_LINK.sub(smart_replacer, text[index:]))
            break

        if tag_start > index:
            segment = text[index:tag_start]
            if in_anchor_depth > 0:
                output.append(segment)
            else:
                output.append(renderer.RE_NCM_LINK.sub(smart_replacer, segment))

        tag_end = text.find(">", tag_start + 1)
        if tag_end == -1:
            tail = text[tag_start:]
            if in_anchor_depth > 0:
                output.append(tail)
            else:
                output.append(renderer.RE_NCM_LINK.sub(smart_replacer, tail))
            break

        tag = text[tag_start : tag_end + 1]
        output.append(tag)

        tag_body = tag[1:-1].strip()
        if tag_body:
            is_closing_tag = tag_body.startswith("/")
            if is_closing_tag:
                tag_body = tag_body[1:].lstrip()
            tag_name = tag_body.split(None, 1)[0].rstrip("/").lower()
            if tag_name == "a":
                if is_closing_tag:
                    in_anchor_depth = max(0, in_anchor_depth - 1)
                elif not tag.rstrip().endswith("/>"):
                    in_anchor_depth += 1

        index = tag_end + 1

    return "".join(output)


def _clean_content(renderer: _RendererRegexProtocol, content: str) -> str:
    content = renderer.RE_CLEAN_PAGE.sub("", content)
    content = _replace_bracket_superscripts(renderer, content)
    content = _replace_plus_artifact(renderer, content)
    content = renderer.RE_NESH_INTERNAL_REF.sub("", content)
    content = renderer.RE_STANDALONE_NCM.sub("", content)
    content = renderer.RE_STRAY_LIST_MARKER.sub("", content)
    content = renderer.RE_STRAY_STAR_MARKER.sub("", content)
    content = renderer.RE_CLEAN_SPACES.sub("\n\n", content)
    return "\n".join([line.strip() for line in content.split("\n")])


def _convert_text_to_html(renderer: _RendererRegexProtocol, text: str) -> str:
    if not text:
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\n+", text)
    html_parts: list[str] = []

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        heading_match = renderer.RE_NCM_HEADING.match(block)
        if heading_match:
            ncm_code = heading_match.group(1)
            title = heading_match.group(2)
            html_parts.append(
                f'<h3 class="nesh-heading" data-ncm="{ncm_code.replace(".", "")}">'
                f'<span class="nesh-ncm">{ncm_code}</span> - {title}</h3>'
            )
            continue

        lines = block.split("\n")
        has_list_marker = any(
            _match_list_item(renderer, line.strip()) is not None
            for line in lines
            if line.strip()
        )

        if has_list_marker:
            _process_list_block(renderer, lines, html_parts)
            continue

        paragraph_content = "<br>\n".join(lines)
        html_parts.append(f'<p class="nesh-paragraph">{paragraph_content}</p>')

    return "\n\n".join(html_parts)


def _inject_note_links(renderer: _RendererRegexProtocol, text: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        full_match = match.group(0)
        note_num = match.group(2)
        chapter_num = match.group(3)
        if chapter_num:
            return (
                f'<span class="note-ref" data-note="{note_num}" '
                f'data-chapter="{chapter_num}">{full_match}</span>'
            )
        return f'<span class="note-ref" data-note="{note_num}">{full_match}</span>'

    return renderer.RE_NOTE_REF.sub(replacer, text)


def _inject_smart_links(renderer: _RendererRegexProtocol, text: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        ncm = match.group(1)
        clean_ncm = ncm.replace(".", "")
        return f'<a href="#" class="smart-link" data-ncm="{clean_ncm}">{ncm}</a>'

    if "<" not in text and ">" not in text:
        return renderer.RE_NCM_LINK.sub(replacer, text)

    parser = _SmartLinkParser(renderer.RE_NCM_LINK, replacer)
    try:
        parser.feed(text)
        parser.close()
        return parser.get_html()
    except Exception:
        _log_parser_fallback("SmartLinkParser", text)
        return _apply_smart_links_outside_tags(renderer, text)


def _inject_exclusion_highlights(renderer: _RendererRegexProtocol, text: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        term = match.group(0)
        return f'<span class="highlight-exclusion">{term}</span>'

    return renderer.RE_EXCLUSION.sub(replacer, text)


def _inject_unit_highlights(renderer: _RendererRegexProtocol, text: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        raw = match.group(0)
        stripped = raw.lstrip()
        if stripped != raw:
            leading = raw[: len(raw) - len(stripped)]
            return f'{leading}<span class="highlight-unit">{stripped}</span>'
        return f'<span class="highlight-unit">{raw}</span>'

    if "<" not in text and ">" not in text:
        return renderer.RE_UNIT.sub(replacer, text)

    parser = _UnitHighlighter(renderer.RE_UNIT, replacer)
    try:
        parser.feed(text)
        parser.close()
        return parser.get_html()
    except Exception:
        _log_parser_fallback("UnitHighlighter", text)
        return renderer.RE_UNIT.sub(replacer, text)


def _inject_glossary_highlights(
    text: str, glossary_manager_obj: _GlossaryManagerProtocol | None
) -> str:
    regex = glossary_manager_obj.get_regex_pattern() if glossary_manager_obj else None
    if not regex:
        return text

    def replacer(match: re.Match[str]) -> str:
        term = match.group(0)
        return f'<span class="glossary-term" data-term="{term}">{term}</span>'

    return regex.sub(replacer, text)


def _convert_bold_markdown(renderer: _RendererRegexProtocol, text: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        inner = match.group(1)
        return f"<strong>{inner}</strong>"

    class _BoldParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.out: list[str] = []

        def handle_starttag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            self.out.append(self.get_starttag_text() or "")

        def handle_endtag(self, tag: str) -> None:
            self.out.append(f"</{tag}>")

        def handle_startendtag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            self.out.append(self.get_starttag_text() or "")

        def handle_data(self, data: str) -> None:
            if not data:
                return
            self.out.append(renderer.RE_BOLD_MARKDOWN.sub(replacer, data))

        def handle_entityref(self, name: str) -> None:
            self.out.append(f"&{name};")

        def handle_charref(self, name: str) -> None:
            self.out.append(f"&#{name};")

        def get_html(self) -> str:
            return "".join(self.out)

    if "<" not in text and ">" not in text:
        return renderer.RE_BOLD_MARKDOWN.sub(replacer, text)

    parser = _BoldParser()
    try:
        parser.feed(text)
        parser.close()
        return parser.get_html()
    except Exception:
        _log_parser_fallback("BoldParser", text)
        return renderer.RE_BOLD_MARKDOWN.sub(replacer, text)


def _apply_post_transforms(
    renderer: _RendererRegexProtocol,
    text: str,
    glossary_manager_obj: _GlossaryManagerProtocol | None,
) -> str:
    def bold_replacer(match: re.Match[str]) -> str:
        return f"<strong>{match.group(1)}</strong>"

    def exclusion_replacer(match: re.Match[str]) -> str:
        return f'<span class="highlight-exclusion">{match.group(0)}</span>'

    def unit_replacer(match: re.Match[str]) -> str:
        raw = match.group(0)
        stripped = raw.lstrip()
        if stripped != raw:
            leading = raw[: len(raw) - len(stripped)]
            return f'{leading}<span class="highlight-unit">{stripped}</span>'
        return f'<span class="highlight-unit">{raw}</span>'

    transforms: list[tuple[re.Pattern[str], Callable[[re.Match[str]], str]]] = [
        (renderer.RE_BOLD_MARKDOWN, bold_replacer),
        (renderer.RE_EXCLUSION, exclusion_replacer),
        (renderer.RE_UNIT, unit_replacer),
    ]

    glossary_regex = (
        glossary_manager_obj.get_regex_pattern() if glossary_manager_obj else None
    )
    if glossary_regex:

        def glossary_replacer(match: re.Match[str]) -> str:
            term = match.group(0)
            return f'<span class="glossary-term" data-term="{term}">{term}</span>'

        transforms.append((glossary_regex, glossary_replacer))

    def _run_inline(raw_text: str) -> str:
        result = raw_text
        for pattern, replacer in transforms:
            result = pattern.sub(replacer, result)
        return _apply_smart_links_outside_tags(renderer, result)

    if "<" not in text and ">" not in text:
        return _run_inline(text)

    parser = _MultiTransformParser(
        transforms,
        text_post_processor=lambda raw_text: _apply_smart_links_outside_tags(
            renderer, raw_text
        ),
        skip_inside_tags={"a"},
    )
    try:
        parser.feed(text)
        parser.close()
        return parser.get_html()
    except Exception:
        _log_parser_fallback("MultiTransformParser", text)
        return _run_inline(text)
