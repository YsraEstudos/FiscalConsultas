"""
Renderizador HTML para o Nesh.
Facade compativel para o pipeline de Markdown/HTML e os helpers usados pelos testes.
"""

from html.parser import HTMLParser
from collections.abc import Mapping
import re

from ..config.constants import RegexPatterns
from ..config.logging_config import renderer_logger as logger
from ..data.glossary_manager import glossary_manager as _default_glossary_manager
from ..domain import SearchResult
from .renderer_patterns import _MultiTransformParser, _get_fallback_anchor_pattern, _get_position_pattern
from .renderer_structure import (
    _get_pending_anchors,
    _inject_fallback_anchors,
    _normalize_lines,
    _render_chapter,
    _render_full_response,
    _render_general_notes,
    _render_structured_sections,
    _structure_headings,
    _trim_chapter_content,
    inject_comment_marks,
)
from .renderer_text import (
    _apply_post_transforms,
    _clean_content,
    _convert_bold_markdown,
    _convert_text_to_html,
    _inject_exclusion_highlights,
    _inject_glossary_highlights,
    _inject_note_links,
    _inject_smart_links,
    _inject_unit_highlights,
)


glossary_manager = _default_glossary_manager
_DEFAULT_GLOSSARY_MANAGER = _default_glossary_manager


def _resolve_glossary_manager():
    from ..data.glossary_manager import glossary_manager as current_glossary_manager

    current_renderer_glossary = globals().get(
        "glossary_manager", _DEFAULT_GLOSSARY_MANAGER
    )
    if current_renderer_glossary is not _DEFAULT_GLOSSARY_MANAGER:
        return current_renderer_glossary
    return current_glossary_manager


class HtmlRenderer:
    """Render plain chapter text into the HTML structure used by the frontend."""

    RE_CLEAN_PAGE = re.compile(r"^\s*Page \d+\s*$", re.MULTILINE)
    RE_CLEAN_SPACES = re.compile(r"\n{3,}")
    RE_NOTE_REF = re.compile(
        r"(\b(?:ver\s+)?(?:a\s+)?Nota\s+(\d+)(?:\s+do\s+Cap[íi]tulo\s+(\d+))?)",
        re.IGNORECASE,
    )
    RE_NCM_LINK = re.compile(r"\b(\d{2}\.\d{2}|\d{4}\.\d{1,2})\b")
    RE_EXCLUSION = re.compile(
        r"\b(?:exceto|não\s+compreende|nao\s+compreende|exclu[ií]do|exclusive)\b",
        re.IGNORECASE,
    )
    RE_UNIT = re.compile(RegexPatterns.MEASUREMENT_UNITS)
    RE_NESH_INTERNAL_REF = re.compile(r"^\s*XV-\d{4}-\d+\s*$", re.MULTILINE)
    RE_STANDALONE_NCM = re.compile(r"^\s*\d{2}\.\d{2}(?:\.\d{2})?\s*$", re.MULTILINE)
    RE_STRAY_LIST_MARKER = re.compile(r"^\s*-\s*\*?\s*$", re.MULTILINE)
    RE_STRAY_STAR_MARKER = re.compile(r"^\s*\*\s*$", re.MULTILINE)
    _SUPERSCRIPT_MAP = {"2": "²", "3": "³"}
    _INLINE_WHITESPACE = {" ", "\t"}
    _BULLET_MARKERS = {"•", "·", "○", "o"}
    _PLUS_ARTIFACT = "(+)"
    _PLUS_ARTIFACT_REPLACEMENT = (
        ' <span class="nesh-subpos-indicator" '
        'title="Existe Nota Explicativa de subposição">†</span> '
    )
    RE_NCM_HEADING = re.compile(
        r"^\s*(?:\*\*|\*)?(\d{2}\.\d{2})(?:\*\*|\*)?\s*-\s*(.+?)(?:\*\*|\*)?\s*$",
        re.MULTILINE,
    )
    RE_NCM_SUBHEADING = re.compile(
        r"^\s*(?:\*\*|\*)?(\d{4}\.\d{1,2})(?:\*\*|\*)?\s*-\s*(.+?)(?:\*\*|\*)?\s*$",
        re.MULTILINE,
    )
    RE_LETTER_LIST = re.compile(r"^([a-z]\))\s+(.+)$", re.MULTILINE)
    RE_NUMBER_LIST = re.compile(r"^(\d+[\.\)])\s+(.+)$", re.MULTILINE)
    RE_ROMAN_LIST = re.compile(r"^([IVX]+[\.\)])\s+(.+)$", re.MULTILINE)
    RE_INDENTED_LINE = re.compile(r"^(\s{4,})(.+)$", re.MULTILINE)
    RE_BOLD_ONLY_LINE = re.compile(r"^\s*\*\*(.+?)\*\*\s*$")
    RE_BOLD_INLINE = re.compile(r"^\s*\*\*(.+?)\*\*\s+(.+)$")
    RE_BOLD_MARKDOWN = re.compile(r"\*\*(.+?)\*\*")
    RE_CHAPTER_HEADER = re.compile(
        r"^\s*CAP[ÍI]TULO\s+(\d{1,2})\s*$", re.IGNORECASE | re.MULTILINE
    )
    RE_SECTION_HEADER = re.compile(
        r"^\s*(?:\*\*)?\s*SEÇÃO\s+([IVXLCDM]+)\s*(?:\*\*)?\s*$",
        re.IGNORECASE | re.MULTILINE,
    )

    @staticmethod
    def clean_content(content: str) -> str:
        """
        Normalize and clean raw chapter text for HTML rendering.

        Example:
            ``HtmlRenderer.clean_content("Massa [2]")`` -> ``"Massa ²"``
        """
        return _clean_content(HtmlRenderer, content)

    @classmethod
    def _convert_text_to_html(cls, text: str) -> str:
        """Convert raw NESH text into structured HTML blocks."""
        return _convert_text_to_html(cls, text)

    @classmethod
    def inject_note_links(cls, text: str) -> str:
        """Wrap note references with clickable spans."""
        return _inject_note_links(cls, text)

    @classmethod
    def inject_smart_links(cls, text: str, current_chapter: str) -> str:
        """Wrap NCM codes with smart-link anchors."""
        del current_chapter
        return _inject_smart_links(cls, text)

    @classmethod
    def inject_exclusion_highlights(cls, text: str) -> str:
        """Highlight exclusion terms in rendered text."""
        return _inject_exclusion_highlights(cls, text)

    @classmethod
    def inject_unit_highlights(cls, text: str) -> str:
        """Highlight measurement units without touching existing smart links."""
        return _inject_unit_highlights(cls, text)

    @classmethod
    def inject_glossary_highlights(cls, text: str) -> str:
        """Highlight glossary terms using the shared glossary manager."""
        return _inject_glossary_highlights(text, _resolve_glossary_manager())

    @classmethod
    def convert_bold_markdown(cls, text: str) -> str:
        """Convert bold markdown while preserving existing HTML."""
        return _convert_bold_markdown(cls, text)

    @classmethod
    def apply_post_transforms(cls, text: str, current_chapter: str) -> str:
        """Apply all inline transforms in one pass."""
        del current_chapter
        return _apply_post_transforms(cls, text, _resolve_glossary_manager())

    @classmethod
    def _get_pending_anchors(
        cls, posicoes: list[object], existing_ids: set[str]
    ) -> list[tuple[str, str]]:
        """Return the position codes that still need fallback anchors."""
        del cls
        return _get_pending_anchors(posicoes, existing_ids)

    @classmethod
    def _inject_fallback_anchors(
        cls, content: str, posicoes: list[object], chapter_num: str
    ) -> str:
        """Inject fallback anchors for main positions when needed."""
        del cls
        return _inject_fallback_anchors(
            content,
            posicoes,
            chapter_num,
            logger=logger,
        )

    @classmethod
    def _render_structured_sections(
        cls, sections: dict[str, str | None], chapter_id: str
    ) -> tuple[str, bool]:
        """Render structured section blocks for a chapter."""
        return _render_structured_sections(
            cls,
            sections,
            chapter_id,
            glossary_manager_obj=_resolve_glossary_manager(),
        )

    @classmethod
    def _trim_chapter_content(cls, content: str, current_chapter: str) -> str:
        """Trim content that belongs to a different chapter or section."""
        return _trim_chapter_content(cls, content, current_chapter)

    @classmethod
    def _structure_headings(
        cls, content: str, state: dict[str, int | list[str]]
    ) -> str:
        """Promote chapter headings to semantic HTML anchors."""
        return _structure_headings(cls, content, state)

    @classmethod
    def _normalize_lines(cls, content: str) -> str:
        """Normalize PDF artefacts and inline titles before final rendering."""
        return _normalize_lines(cls, content)

    @classmethod
    def _render_general_notes(cls, notas: str, capitulo: str) -> str:
        """Render the general-notes block used by chapter pages."""
        return _render_general_notes(cls, notas, capitulo)

    @classmethod
    def render_chapter(cls, data: SearchResult) -> str:
        """Render a single chapter into HTML."""
        return _render_chapter(
            cls,
            data,
            glossary_manager_obj=_resolve_glossary_manager(),
            logger=logger,
        )

    @classmethod
    def render_full_response(cls, results_map: Mapping[str, SearchResult]) -> str:
        """Render multiple chapters in key order."""
        return _render_full_response(results_map, cls.render_chapter, logger=logger)
