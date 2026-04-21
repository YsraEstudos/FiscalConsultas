"""Low-level regex caches and HTML parser helpers for presentation rendering."""

from functools import lru_cache
from html.parser import HTMLParser
from typing import Callable, Protocol
import re


class _RendererRegexProtocol(Protocol):
    RE_CLEAN_PAGE: re.Pattern[str]
    RE_CLEAN_SPACES: re.Pattern[str]
    RE_NOTE_REF: re.Pattern[str]
    RE_NCM_LINK: re.Pattern[str]
    RE_EXCLUSION: re.Pattern[str]
    RE_UNIT: re.Pattern[str]
    RE_NESH_INTERNAL_REF: re.Pattern[str]
    RE_STANDALONE_NCM: re.Pattern[str]
    RE_STRAY_LIST_MARKER: re.Pattern[str]
    RE_STRAY_STAR_MARKER: re.Pattern[str]
    RE_NCM_HEADING: re.Pattern[str]
    RE_NCM_SUBHEADING: re.Pattern[str]
    RE_LETTER_LIST: re.Pattern[str]
    RE_NUMBER_LIST: re.Pattern[str]
    RE_ROMAN_LIST: re.Pattern[str]
    RE_INDENTED_LINE: re.Pattern[str]
    RE_BOLD_ONLY_LINE: re.Pattern[str]
    RE_BOLD_INLINE: re.Pattern[str]
    RE_BOLD_MARKDOWN: re.Pattern[str]
    RE_CHAPTER_HEADER: re.Pattern[str]
    RE_SECTION_HEADER: re.Pattern[str]
    _SUPERSCRIPT_MAP: dict[str, str]
    _INLINE_WHITESPACE: set[str]
    _BULLET_MARKERS: set[str]
    _PLUS_ARTIFACT: str
    _PLUS_ARTIFACT_REPLACEMENT: str


@lru_cache(maxsize=256)
def _get_position_pattern(pos_code: str) -> re.Pattern[str]:
    """Return the cached anchor regex for a single position code."""
    safe_code = re.escape(pos_code)
    return re.compile(
        rf"^\s*(?:\*\*|\*)?{safe_code}(?:\*\*|\*)?\s*(?:[-\u2013\u2014:])\s*",
        re.MULTILINE,
    )


@lru_cache(maxsize=256)
def _get_fallback_anchor_pattern(pos_codes: tuple[str, ...]) -> re.Pattern[str]:
    """Return the cached fallback-anchor regex for a stable tuple of codes."""
    escaped_codes = "|".join(re.escape(pos_code) for pos_code in pos_codes)
    return re.compile(
        rf"^\s*(?:\*\*|\*)?(?P<code>{escaped_codes})(?:\*\*|\*)?\s*(?:[-\u2013\u2014:])\s*",
        re.MULTILINE,
    )


def _has_class(attrs: list[tuple[str, str | None]] | None, cls_name: str) -> bool:
    if not attrs:
        return False
    for key, val in attrs:
        if key.lower() == "class" and val:
            classes = {c.strip() for c in val.split() if c.strip()}
            if cls_name in classes:
                return True
    return False


class _MultiTransformParser(HTMLParser):
    """Single-pass HTML parser that applies multiple text transforms."""

    def __init__(
        self,
        transforms: list[tuple[re.Pattern[str], Callable[[re.Match[str]], str]]],
        *,
        text_post_processor: Callable[[str], str] | None = None,
        skip_inside_tags: set[str] | None = None,
    ) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._transforms = transforms
        self._text_post_processor = text_post_processor
        self._skip_tags = {tag.lower() for tag in (skip_inside_tags or set())}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        raw_tag = self.get_starttag_text() or ""
        if self._skip_depth > 0:
            self._skip_depth += 1
        elif tag.lower() in self._skip_tags or _has_class(attrs, "smart-link"):
            self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag: str) -> None:
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.out.append(self.get_starttag_text() or "")

    def handle_data(self, data: str) -> None:
        if not data:
            return
        if self._skip_depth > 0:
            self.out.append(data)
            return

        result = data
        for pattern, replacer in self._transforms:
            result = pattern.sub(replacer, result)
        if self._text_post_processor is not None:
            result = self._text_post_processor(result)
        self.out.append(result)

    def handle_entityref(self, name: str) -> None:
        self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)


class _SmartLinkParser(HTMLParser):
    """Apply smart links only to text nodes outside existing anchors."""

    def __init__(
        self,
        pattern: re.Pattern[str],
        replacer_func: Callable[[re.Match[str]], str],
    ) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._pattern = pattern
        self._replacer = replacer_func

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        raw_tag = self.get_starttag_text() or ""
        if self._skip_depth > 0:
            self._skip_depth += 1
        elif tag.lower() == "a" or _has_class(attrs, "smart-link"):
            self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag: str) -> None:
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.out.append(self.get_starttag_text() or "")

    def handle_data(self, data: str) -> None:
        if not data:
            return
        if self._skip_depth > 0:
            self.out.append(data)
            return
        self.out.append(self._pattern.sub(self._replacer, data))

    def handle_entityref(self, name: str) -> None:
        self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)


class _UnitHighlighter(HTMLParser):
    """Apply unit highlights only to text nodes outside smart-link spans."""

    def __init__(
        self,
        pattern: re.Pattern[str],
        replacer_func: Callable[[re.Match[str]], str],
    ) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._pattern = pattern
        self._replacer = replacer_func

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        raw_tag = self.get_starttag_text() or ""
        if self._skip_depth > 0:
            self._skip_depth += 1
        elif _has_class(attrs, "smart-link"):
            self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag: str) -> None:
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.out.append(self.get_starttag_text() or "")

    def handle_data(self, data: str) -> None:
        if not data:
            return
        if self._skip_depth > 0:
            self.out.append(data)
            return
        self.out.append(self._pattern.sub(self._replacer, data))

    def handle_entityref(self, name: str) -> None:
        self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)
