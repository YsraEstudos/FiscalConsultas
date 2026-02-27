"""
Renderizador HTML para o Nesh.
Transforma dados brutos em conteúdo formatado para o frontend.
"""

import re
from functools import lru_cache
from html.parser import HTMLParser
from typing import Callable, Dict

from ..config.constants import RegexPatterns
from ..config.logging_config import renderer_logger as logger
from ..data.glossary_manager import glossary_manager
from ..domain import SearchResult
from ..utils.id_utils import generate_anchor_id


# Performance: LRU cache for position anchor regex patterns
# Avoids recompiling the same pattern multiple times per render
@lru_cache(maxsize=256)
def _get_position_pattern(pos_code: str) -> re.Pattern:
    """
    Get cached compiled regex pattern for position code anchor injection.
    Matches:
    - Start of line
    - The code (escaped)
    - Optional spaces
    - Separator (dash, en-dash, em-dash, colon, or just space)
    """
    safe_code = re.escape(pos_code)
    # Allow: normal dash (-), en-dash (–), em-dash (—), colon (:)
    # FIX: Allow leading whitespace (^\s*) and optional markdown bold (** or *)
    return re.compile(
        rf"^\s*(?:\*\*|\*)?{safe_code}(?:\*\*|\*)?\s*(?:[-\u2013\u2014:])\s*",
        re.MULTILINE,
    )


class _MultiTransformParser(HTMLParser):
    """Single-pass HTML parser that applies multiple text transforms."""

    def __init__(
        self,
        transforms: list[tuple[re.Pattern, Callable[[re.Match], str]]],
        *,
        text_post_processor: Callable[[str], str] | None = None,
        skip_inside_tags: set[str] | None = None,
    ):
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._transforms = transforms
        self._text_post_processor = text_post_processor
        self._skip_tags = {tag.lower() for tag in (skip_inside_tags or set())}

    @staticmethod
    def _has_class(attrs, cls_name: str) -> bool:
        for key, val in attrs or []:
            if key.lower() == "class" and val:
                classes = {c.strip() for c in val.split() if c.strip()}
                if cls_name in classes:
                    return True
        return False

    def handle_starttag(self, tag, attrs):
        raw_tag = self.get_starttag_text() or ""
        if self._skip_depth > 0:
            self._skip_depth += 1
        elif tag.lower() in self._skip_tags or self._has_class(attrs, "smart-link"):
            self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag):
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(self, tag, attrs):
        self.out.append(self.get_starttag_text() or "")

    def handle_data(self, data):
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

    def handle_entityref(self, name):
        self.out.append(f"&{name};")

    def handle_charref(self, name):
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)


class _SmartLinkParser(HTMLParser):
    """Aplica smart links apenas em texto, ignorando conteúdo dentro de links existentes."""

    def __init__(self, replacer_func: Callable[[re.Match], str]):
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._replacer = replacer_func

    @staticmethod
    def _is_smart_link(attrs) -> bool:
        if not attrs:
            return False
        for k, v in attrs:
            if k.lower() == "class" and v:
                classes = {c.strip() for c in v.split() if c.strip()}
                if "smart-link" in classes:
                    return True
        return False

    def handle_starttag(self, tag, attrs):
        raw_tag = self.get_starttag_text() or ""
        if self._skip_depth > 0:
            self._skip_depth += 1
        else:
            if tag.lower() == "a" or self._is_smart_link(attrs):
                self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag):
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(self, tag, attrs):
        raw_tag = self.get_starttag_text() or ""
        self.out.append(raw_tag)

    def handle_data(self, data):
        if not data:
            return
        if self._skip_depth > 0:
            self.out.append(data)
            return
        self.out.append(HtmlRenderer.RE_NCM_LINK.sub(self._replacer, data))

    def handle_entityref(self, name):
        self.out.append(f"&{name};")

    def handle_charref(self, name):
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)


class _UnitHighlighter(HTMLParser):
    """Aplica highlight apenas em texto, ignorando conteúdo dentro de `.smart-link`."""

    def __init__(self, replacer_func: Callable[[re.Match], str]):
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._skip_depth = 0
        self._replacer = replacer_func

    @staticmethod
    def _is_smart_link(attrs) -> bool:
        if not attrs:
            return False
        for k, v in attrs:
            if k.lower() == "class" and v:
                classes = {c.strip() for c in v.split() if c.strip()}
                if "smart-link" in classes:
                    return True
        return False

    def handle_starttag(self, tag, attrs):
        raw_tag = self.get_starttag_text() or ""
        # Se já estamos dentro de smart-link, apenas aumente profundidade
        if self._skip_depth > 0:
            self._skip_depth += 1
        else:
            if self._is_smart_link(attrs):
                self._skip_depth = 1
        self.out.append(raw_tag)

    def handle_endtag(self, tag):
        self.out.append(f"</{tag}>")
        if self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_startendtag(self, tag, attrs):
        raw_tag = self.get_starttag_text() or ""
        self.out.append(raw_tag)

    def handle_data(self, data):
        if not data:
            return
        if self._skip_depth > 0:
            self.out.append(data)
            return
        self.out.append(HtmlRenderer.RE_UNIT.sub(self._replacer, data))

    def handle_entityref(self, name):
        self.out.append(f"&{name};")

    def handle_charref(self, name):
        self.out.append(f"&#{name};")

    def get_html(self) -> str:
        return "".join(self.out)


class HtmlRenderer:
    """
    Responsável por transformar DataObjects em HTML rico.

    Responsabilidades:
    - Limpar conteúdo (remover páginas, espaços extras)
    - Injetar links clicáveis para notas
    - Injetar smart links para NCMs
    - Gerar anchors para navegação
    - Renderizar capítulos em HTML
    """

    # Regex compilados para performance
    RE_CLEAN_PAGE = re.compile(RegexPatterns.CLEAN_PAGE)
    RE_CLEAN_SPACES = re.compile(RegexPatterns.CLEAN_SPACES)
    RE_NOTE_REF = re.compile(RegexPatterns.NOTE_REFERENCE)
    RE_NCM_LINK = re.compile(RegexPatterns.NCM_LINK)
    RE_EXCLUSION = re.compile(RegexPatterns.EXCLUSION_TERMS)
    RE_UNIT = re.compile(RegexPatterns.MEASUREMENT_UNITS)
    # Filtrar referências internas do NESH (formato XV-7324-1, XV-8471-2, etc.)
    RE_NESH_INTERNAL_REF = re.compile(r"^\s*XV-\d{4}-\d+\s*$", re.MULTILINE)
    # Filtrar linhas com apenas código NCM isolado (ex: "73.24" sozinho sem descrição)
    # Padrão: linha com apenas código no formato XX.XX ou XX.XX.XX (sem texto após)
    RE_STANDALONE_NCM = re.compile(r"^\s*\d{2}\.\d{2}(?:\.\d{2})?\s*$", re.MULTILINE)
    # Alguns capítulos trazem artefatos de lista no texto fonte (ex: "- *" sozinho).
    RE_STRAY_LIST_MARKER = re.compile(r"^\s*-\s*\*?\s*$", re.MULTILINE)
    RE_STRAY_STAR_MARKER = re.compile(r"^\s*\*\s*$", re.MULTILINE)
    # Superscript bracket notation from PDF extraction: [2] → ², [3] → ³
    # Restrito a whitespace inline (espaço/tab) para não consumir quebras de linha.
    # Ex.: "cm [3]" → "cm³", preservando estrutura de parágrafos/listas.
    RE_SUPERSCRIPT_BRACKET = re.compile(r"[ \t]?\[[ \t]*([23])[ \t]*\]")
    _SUPERSCRIPT_MAP = {"2": "²", "3": "³"}
    # NESH convention: (+) indicates subposition explanatory note exists
    RE_PLUS_ARTIFACT = re.compile(r"\s*\(\+\)\s*")

    @staticmethod
    def clean_content(content: str) -> str:
        """
        Normalize and clean raw chapter text for HTML rendering.

        Performs several cleanup transformations: converts PDF-style bracketed superscripts (e.g., "[2]" → "²"), replaces the subposition artifact marker "(+)" with a semantic indicator, removes internal NESH references and stray list markers, normalizes blank lines and spaces, and trims each line.

        Parameters:
            content (str): Raw chapter text to be cleaned.

        Returns:
            str: Cleaned text with consistent formatting, suitable for subsequent HTML rendering.
        """
        content = HtmlRenderer.RE_CLEAN_PAGE.sub("", content)
        # Converte notação de colchetes do PDF para Unicode: [3] → ³, [2] → ²
        content = HtmlRenderer.RE_SUPERSCRIPT_BRACKET.sub(
            lambda m: HtmlRenderer._SUPERSCRIPT_MAP[m.group(1)], content
        )
        # Converte artefato NESH (+) em indicador semântico com tooltip
        content = HtmlRenderer.RE_PLUS_ARTIFACT.sub(
            ' <span class="nesh-subpos-indicator" title="Existe Nota Explicativa de subposição">†</span> ',
            content,
        )
        # Remove referências internas do documento NESH (ex: XV-7324-1)
        content = HtmlRenderer.RE_NESH_INTERNAL_REF.sub("", content)
        # Remove linhas com apenas código NCM isolado (duplicatas do código com descrição)
        content = HtmlRenderer.RE_STANDALONE_NCM.sub("", content)
        # Remove marcadores soltos que viram listas vazias no renderer (ex: "- *", "*")
        content = HtmlRenderer.RE_STRAY_LIST_MARKER.sub("", content)
        content = HtmlRenderer.RE_STRAY_STAR_MARKER.sub("", content)
        content = HtmlRenderer.RE_CLEAN_SPACES.sub("\n\n", content)
        return "\n".join([line.strip() for line in content.split("\n")])

    # Regex patterns for text-to-HTML conversion
    # Pattern: **XX.XX - Description** (bold markers optional but preferred)
    # Captures: Code (2 digits.2 digits ONLY - main positions, NOT subpositions like 8417.10)
    # FIX: Restrict to exactly 2 digits before dot to avoid matching subpositions
    RE_NCM_HEADING = re.compile(
        r"^\s*(?:\*\*|\*)?(\d{2}\.\d{2})(?:\*\*|\*)?\s*-\s*(.+?)(?:\*\*|\*)?\s*$",
        re.MULTILINE,
    )
    # Short subpositions like 8419.8 or 8419.80
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
    RE_BULLET_ONLY = re.compile(r"^\s*[•·○]\s*$")
    RE_BULLET_ITEM = re.compile(r"^\s*[•·○]\s+(.+)$")
    RE_BOLD_MARKDOWN = re.compile(r"\*\*(.+?)\*\*")
    RE_CHAPTER_HEADER = re.compile(
        r"^\s*CAP[ÍI]TULO\s+(\d{1,2})\s*$", re.IGNORECASE | re.MULTILINE
    )
    RE_SECTION_HEADER = re.compile(
        r"^\s*(?:\*\*)?\s*SEÇÃO\s+([IVXLCDM]+)\s*(?:\*\*)?\s*$",
        re.IGNORECASE | re.MULTILINE,
    )

    @classmethod
    def _match_list_item(cls, line: str) -> tuple[str, str] | None:
        """Helper to match a line against list patterns and return (list_type, item_content)."""
        if match := cls.RE_LETTER_LIST.match(line):
            return "a", match.group(2)
        if match := cls.RE_NUMBER_LIST.match(line):
            return "1", match.group(2)
        if match := cls.RE_ROMAN_LIST.match(line):
            return "I", match.group(2)
        return None

    @classmethod
    def _process_list_block(cls, lines: list[str], html_parts: list[str]) -> None:
        is_list = False
        list_type = None
        list_items = []
        normal_lines = []

        def _flush_normal_lines():
            if normal_lines:
                content = "<br>\n".join(normal_lines)
                html_parts.append(f'<p class="nesh-paragraph">{content}</p>')
                normal_lines.clear()

        def _flush_current_list():
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

            list_match = cls._match_list_item(line)
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

    @classmethod
    def _convert_text_to_html(cls, text: str) -> str:
        """
        Converte texto plano NESH em HTML estruturado de alta qualidade.
        """
        if not text:
            return ""

        text = text.replace("\r\n", "\n").replace("\r", "\n")
        blocks = re.split(r"\n\n+", text)
        html_parts = []

        for block in blocks:
            block = block.strip()
            if not block:
                continue

            heading_match = cls.RE_NCM_HEADING.match(block)
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
                cls.RE_LETTER_LIST.match(line.strip())
                or cls.RE_NUMBER_LIST.match(line.strip())
                or cls.RE_ROMAN_LIST.match(line.strip())
                for line in lines
                if line.strip()
            )

            if has_list_marker:
                cls._process_list_block(lines, html_parts)
                continue

            # Bloco normal -> parágrafo
            # Preservar quebras de linha internas como <br>
            paragraph_content = "<br>\n".join(lines)
            html_parts.append(f'<p class="nesh-paragraph">{paragraph_content}</p>')

        return "\n\n".join(html_parts)

    @classmethod
    def inject_note_links(cls, text: str) -> str:
        """
        Transforma referências a notas em elementos clicáveis.

        Exemplo: "ver Nota 3" -> <span class="note-ref" data-note="3">ver Nota 3</span>
        Exemplo: "ver a Nota 6 do Capítulo 84" -> <span class="note-ref" data-note="6" data-chapter="84">ver a Nota 6 do Capítulo 84</span>

        Args:
            text: Texto com referências a notas

        Returns:
            Texto com spans clicáveis
        """

        def replacer(match):
            full_match = match.group(0)
            note_num = match.group(2)
            chapter_num = match.group(3)
            if chapter_num:
                return f'<span class="note-ref" data-note="{note_num}" data-chapter="{chapter_num}">{full_match}</span>'
            return f'<span class="note-ref" data-note="{note_num}">{full_match}</span>'

        return cls.RE_NOTE_REF.sub(replacer, text)

    @classmethod
    def inject_smart_links(cls, text: str, current_chapter: str) -> str:
        """
        Transforma códigos NCM em links de navegação.

        Exemplo: "73.15" -> <a onclick="nesh.smartLinkSearch('7315')">73.15</a>

        Args:
            text: Texto com códigos NCM
            current_chapter: Capítulo atual (para contexto)

        Returns:
            Texto com links clicáveis
        """

        def replacer(match):
            ncm = match.group(1)
            clean_ncm = ncm.replace(".", "")
            return f'<a href="#" class="smart-link" data-ncm="{clean_ncm}">{ncm}</a>'

        if "<" not in text and ">" not in text:
            return cls.RE_NCM_LINK.sub(replacer, text)

        parser = _SmartLinkParser(replacer)
        try:
            parser.feed(text)
            parser.close()
            return parser.get_html()
        except Exception:
            return cls.RE_NCM_LINK.sub(replacer, text)

    @classmethod
    def inject_exclusion_highlights(cls, text: str) -> str:
        """
        Destaca termos de exclusão (exceto, não compreende, etc.) em vermelho.

        Args:
            text: Texto com possíveis termos de exclusão

        Returns:
            Texto com spans de destaque
        """

        def replacer(match):
            term = match.group(0)
            return f'<span class="highlight-exclusion">{term}</span>'

        return cls.RE_EXCLUSION.sub(replacer, text)

    @classmethod
    def inject_unit_highlights(cls, text: str) -> str:
        """
        Destaca unidades de medida (kg, m², litros, etc.) em azul.

        Args:
            text: Texto com possíveis unidades de medida

        Returns:
            Texto com spans de destaque
        """

        def replacer(match: re.Match) -> str:
            raw = match.group(0)
            # Avoid regex-on-regex matching here; split leading whitespace safely.
            stripped = raw.lstrip()
            if stripped != raw:
                leading = raw[: len(raw) - len(stripped)]
                return f'{leading}<span class="highlight-unit">{stripped}</span>'
            return f'<span class="highlight-unit">{raw}</span>'

        # Se não é tags, é texto puro: aplique diretamente.
        if "<" not in text and ">" not in text:
            return cls.RE_UNIT.sub(replacer, text)

        parser = _UnitHighlighter(replacer)
        try:
            parser.feed(text)
            parser.close()
            return parser.get_html()
        except Exception:
            # Fallback seguro: não bloquear renderização caso o HTML seja malformado.
            return cls.RE_UNIT.sub(replacer, text)

    @classmethod
    def inject_glossary_highlights(cls, text: str) -> str:
        """
        Destaca termos do glossário técnico.
        """
        # Import tardio para garantir que o manager já foi inicializado
        from ..data.glossary_manager import glossary_manager

        # Obter regex compilado do manager global
        regex = glossary_manager.get_regex_pattern() if glossary_manager else None

        if not regex:
            return text

        def replacer(match):
            term = match.group(0)
            # Normalizar para lowercase para lookup no JS se necessário,
            # mas mantemos o texto original no display
            return f'<span class="glossary-term" data-term="{term}">{term}</span>'

        return regex.sub(replacer, text)

    @classmethod
    def convert_bold_markdown(cls, text: str) -> str:
        """
        Converte **texto** em <strong>texto</strong> sem quebrar HTML existente.
        """

        def replacer(match):
            inner = match.group(1)
            return f"<strong>{inner}</strong>"

        class _BoldParser(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=False)
                self.out: list[str] = []

            def handle_starttag(self, tag, attrs):
                self.out.append(self.get_starttag_text() or "")

            def handle_endtag(self, tag):
                self.out.append(f"</{tag}>")

            def handle_startendtag(self, tag, attrs):
                self.out.append(self.get_starttag_text() or "")

            def handle_data(self, data):
                if not data:
                    return
                self.out.append(cls.RE_BOLD_MARKDOWN.sub(replacer, data))

            def handle_entityref(self, name):
                self.out.append(f"&{name};")

            def handle_charref(self, name):
                self.out.append(f"&#{name};")

            def get_html(self) -> str:
                return "".join(self.out)

        if "<" not in text and ">" not in text:
            return cls.RE_BOLD_MARKDOWN.sub(replacer, text)

        parser = _BoldParser()
        try:
            parser.feed(text)
            parser.close()
            return parser.get_html()
        except Exception:
            return cls.RE_BOLD_MARKDOWN.sub(replacer, text)

    @classmethod
    def _apply_smart_links_outside_tags(cls, text: str) -> str:
        def smart_replacer(match: re.Match) -> str:
            ncm = match.group(1)
            clean_ncm = ncm.replace(".", "")
            return f'<a href="#" class="smart-link" data-ncm="{clean_ncm}">{ncm}</a>'

        segments = re.split(r"(<[^>]+>)", text)
        for idx, segment in enumerate(segments):
            if not segment or segment.startswith("<"):
                continue
            segments[idx] = cls.RE_NCM_LINK.sub(smart_replacer, segment)
        return "".join(segments)

    @classmethod
    def apply_post_transforms(cls, text: str, current_chapter: str) -> str:
        """
        Apply bold, exclusion, unit, glossary and smart-link transforms in one HTML pass.
        """
        del current_chapter  # Mantido por compatibilidade de assinatura.

        def bold_replacer(match: re.Match) -> str:
            return f"<strong>{match.group(1)}</strong>"

        def exclusion_replacer(match: re.Match) -> str:
            return f'<span class="highlight-exclusion">{match.group(0)}</span>'

        def unit_replacer(match: re.Match) -> str:
            raw = match.group(0)
            stripped = raw.lstrip()
            if stripped != raw:
                leading = raw[: len(raw) - len(stripped)]
                return f'{leading}<span class="highlight-unit">{stripped}</span>'
            return f'<span class="highlight-unit">{raw}</span>'

        transforms: list[tuple[re.Pattern, Callable[[re.Match], str]]] = [
            (cls.RE_BOLD_MARKDOWN, bold_replacer),
            (cls.RE_EXCLUSION, exclusion_replacer),
            (cls.RE_UNIT, unit_replacer),
        ]

        glossary_regex = (
            glossary_manager.get_regex_pattern() if glossary_manager else None
        )
        if glossary_regex:

            def glossary_replacer(match: re.Match) -> str:
                term = match.group(0)
                return f'<span class="glossary-term" data-term="{term}">{term}</span>'

            transforms.append((glossary_regex, glossary_replacer))

        def _run_inline(raw_text: str) -> str:
            result = raw_text
            for pattern, replacer in transforms:
                result = pattern.sub(replacer, result)
            # Smart links need to run after all other transforms and only on text segments.
            return cls._apply_smart_links_outside_tags(result)

        if "<" not in text and ">" not in text:
            return _run_inline(text)

        parser = _MultiTransformParser(
            transforms,
            text_post_processor=cls._apply_smart_links_outside_tags,
            skip_inside_tags={"a"},
        )
        try:
            parser.feed(text)
            parser.close()
            return parser.get_html()
        except Exception:
            return _run_inline(text)

    @classmethod
    def _get_pending_anchors(
        cls, posicoes: list, existing_ids: set[str]
    ) -> list[tuple[str, str]]:
        re_main_pos = re.compile(r"^\d{2}\.\d{2}$")
        pending: list[tuple[str, str]] = []
        for pos in posicoes:
            if not isinstance(pos, dict):
                continue
            pos_code = (pos.get("codigo") or "").strip()
            if not pos_code or not re_main_pos.match(pos_code):
                continue
            anchor_id = generate_anchor_id(pos_code)
            if anchor_id not in existing_ids:
                pending.append((pos_code, anchor_id))
        return pending

    @classmethod
    def _inject_fallback_anchors(
        cls, content: str, posicoes: list, chapter_num: str
    ) -> str:
        """Inject fallback anchors for MAIN positions (XX.XX) when headings are not bold."""
        if not posicoes:
            return content

        logger.debug(
            f"[RENDERER] Checking {len(posicoes)} positions for ID injection fallback in Cap {chapter_num}"
        )
        existing_ids = set(re.findall(r'id="(pos-[^"]+)"', content))

        pending = cls._get_pending_anchors(posicoes, existing_ids)

        if pending:
            code_to_anchor = dict(pending)
            escaped_codes = "|".join(
                re.escape(pos_code) for pos_code in code_to_anchor.keys()
            )
            combined_pattern = re.compile(
                rf"^\s*(?:\*\*|\*)?(?P<code>{escaped_codes})(?:\*\*|\*)?\s*(?:[-\u2013\u2014:])\s*",
                re.MULTILINE,
            )
            injected: set[str] = set()

            def _anchor_replacer(match: re.Match) -> str:
                code = match.group("code")
                if code in injected:
                    return match.group(0)
                anchor_id = code_to_anchor.get(code)
                if not anchor_id:
                    return match.group(0)
                injected.add(code)
                return (
                    f'<span id="{anchor_id}" class="ncm-target ncm-position-title">'
                    f"{match.group(0)}</span>"
                )

            content = combined_pattern.sub(_anchor_replacer, content)

            not_found = len(code_to_anchor) - len(injected)
            logger.debug(
                "[RENDERER] Injected %s/%s fallback anchors for Cap %s (missing=%s)",
                len(injected),
                len(code_to_anchor),
                chapter_num,
                not_found,
            )
        return content

    @classmethod
    def _render_structured_sections(
        cls, sections: dict, chapter_id: str
    ) -> tuple[str, bool]:
        """Renders the HTML for the structured sections: titulo, notas, consideracoes, definicoes."""
        html = ""
        rendered_notes_block = False

        def _render_section_lines(raw_text: str) -> str:
            processed = cls.inject_note_links(raw_text)
            processed = cls.apply_post_transforms(processed, chapter_id)
            lines = []
            for line in processed.split("\n"):
                if line.strip():
                    lines.append(f"<p>{line}</p>")
                else:
                    lines.append("<p><br></p>")
            return "\n".join(lines)

        titulo = str(sections.get("titulo") or "").strip()
        if titulo:
            titulo_processed = cls.apply_post_transforms(
                cls.inject_note_links(titulo), chapter_id
            )
            html += (
                f'<div class="section-titulo" id="chapter-{chapter_id}-titulo">\n'
                f'<h3 class="section-header titulo-header">📖 {titulo_processed}</h3>\n'
                "</div>\n\n"
            )
            rendered_notes_block = True

        notas_sec = str(sections.get("notas") or "").strip()
        if notas_sec:
            notas_html = _render_section_lines(notas_sec)
            html += (
                f'<div class="section-notas" id="chapter-{chapter_id}-notas">\n'
                '<h3 class="section-header notas-header">📝 Notas do Capítulo</h3>\n'
                f'<blockquote class="nesh-blockquote">\n{notas_html}\n</blockquote>\n'
                "</div>\n\n"
            )
            rendered_notes_block = True

        consideracoes = str(sections.get("consideracoes") or "").strip()
        if consideracoes:
            consideracoes_html = _render_section_lines(consideracoes)
            html += (
                f'<div class="section-consideracoes" id="chapter-{chapter_id}-consideracoes">\n'
                '<h3 class="section-header consideracoes-header">📚 Considerações Gerais</h3>\n'
                f'<div class="consideracoes-content">\n{consideracoes_html}\n</div>\n'
                "</div>\n\n"
            )
            rendered_notes_block = True

        definicoes = str(sections.get("definicoes") or "").strip()
        if definicoes:
            definicoes_html = _render_section_lines(definicoes)
            html += (
                f'<div class="section-definicoes" id="chapter-{chapter_id}-definicoes">\n'
                '<h3 class="section-header definicoes-header">📋 Definições Técnicas</h3>\n'
                f'<div class="definicoes-content">\n{definicoes_html}\n</div>\n'
                "</div>\n\n"
            )
            rendered_notes_block = True

        return html, rendered_notes_block

    @classmethod
    def _trim_chapter_content(cls, content: str, current_chapter: str) -> str:
        """Trims accidental content from other chapters or sections."""
        current_chapter_str = str(current_chapter).strip()
        if current_chapter_str:
            trimmed_at = None
            for match in cls.RE_CHAPTER_HEADER.finditer(content):
                chapter_num = (match.group(1) or "").lstrip("0")
                current_num = current_chapter_str.lstrip("0")
                if chapter_num and current_num and chapter_num != current_num:
                    trimmed_at = match.start()
                    break
            if trimmed_at is not None and trimmed_at > 0:
                content = content[:trimmed_at].rstrip()

        section_match = cls.RE_SECTION_HEADER.search(content)
        if section_match and section_match.start() > 0:
            content = content[: section_match.start()].rstrip()
        return content

    @classmethod
    def _structure_headings(cls, content: str, state: dict) -> str:
        def section_wrapper(match):
            pos_code = match.group(1)
            pos_desc = match.group(2)
            anchor_id = generate_anchor_id(pos_code)
            opening = (
                f'<h3 class="nesh-section" id="{anchor_id}" data-ncm="{pos_code}">'
                f"<strong>{pos_code}</strong> - {pos_desc}"
                f"</h3>\n\n"
            )
            state["injected_count"] += 1
            state["ids_injected"].append(anchor_id)
            return opening

        def sub_section_wrapper(match):
            pos_code = match.group(1)
            pos_desc = match.group(2)
            anchor_id = generate_anchor_id(pos_code)
            opening = (
                f'<h4 class="nesh-subsection" id="{anchor_id}" data-ncm="{pos_code}">'
                f"<strong>{pos_code}</strong> - {pos_desc}"
                f"</h4>\n\n"
            )
            state["injected_count"] += 1
            state["ids_injected"].append(anchor_id)
            return opening

        content = cls.RE_NCM_SUBHEADING.sub(sub_section_wrapper, content)
        content = cls.RE_NCM_HEADING.sub(section_wrapper, content)
        return content

    @classmethod
    def _normalize_lines(cls, content: str) -> str:
        """Normalizes bold-only lines (titles) and bullet artifacts."""
        normalized_lines = []
        for line in content.split("\n"):
            if cls.RE_BULLET_ONLY.match(line):
                continue
            bullet_match = cls.RE_BULLET_ITEM.match(line)
            if bullet_match:
                normalized_lines.append(f"- {bullet_match.group(1).strip()}")
                continue

            bold_only = cls.RE_BOLD_ONLY_LINE.match(line)
            if bold_only:
                title = bold_only.group(1).strip()
                normalized_lines.append(f'<h4 class="nesh-subheading">{title}</h4>')
                continue

            bold_inline = cls.RE_BOLD_INLINE.match(line)
            if bold_inline:
                title = bold_inline.group(1).strip()
                rest = bold_inline.group(2).strip()
                normalized_lines.append(
                    f'<span class="nesh-inline-title">{title}</span> {rest}'
                )
                continue

            normalized_lines.append(line)
        return "\n".join(normalized_lines)

    @classmethod
    def _render_general_notes(cls, notas: str, capitulo: str) -> str:
        if not notas:
            return ""
        notas_processed = cls.inject_note_links(notas)
        notas_processed = cls.inject_smart_links(notas_processed, capitulo)
        lines = []
        for line in notas_processed.split("\n"):
            if line.strip():
                lines.append(f"<p>{line}</p>")
            else:
                lines.append("<p><br></p>")
        blockquote_content = "\n".join(lines)
        return (
            f'<div class="regras-gerais" id="chapter-{capitulo}-notas">\n'
            "<h3>Regras Gerais do Capítulo</h3>\n"
            f"<blockquote>\n{blockquote_content}\n</blockquote>\n"
            "</div>\n\n"
        )

    @classmethod
    def render_chapter(cls, data: SearchResult) -> str:
        """
        Gera HTML formatado para um único capítulo.

        Inclui:
            - Header do capítulo
            - Regras gerais (blockquote)
            - Headings para NCMs (h3 com id)
            - Anchors para posições
            - Smart links

        Args:
            data: SearchResult com dados do capítulo

        Returns:
            String HTML formatada
        """
        html = ""

        if not data.get("real_content_found", True):
            logger.warning(
                f"Renderizando erro: Capítulo {data['capitulo']} não encontrado"
            )
            return (
                "<hr>\n\n"
                f'<span id="cap-{data["capitulo"]}"></span>\n\n'
                f"<h2>Capítulo {data['capitulo']}</h2>\n\n"
                "<blockquote><p><strong>Erro:</strong> Capítulo não encontrado.</p></blockquote>\n\n"
            )

        logger.debug(f"Renderizando capítulo {data['capitulo']}")

        content = cls.clean_content(data["conteudo"])
        content = cls._trim_chapter_content(content, data.get("capitulo", ""))
        content = cls.inject_note_links(content)

        state = {"injected_count": 0, "ids_injected": []}
        content = cls._structure_headings(content, state)
        content = cls._normalize_lines(content)

        logger.debug(
            f"Capítulo {data['capitulo']}: {state['injected_count']} seções estruturadas"
        )

        content = cls._inject_fallback_anchors(
            content, data.get("posicoes") or [], data["capitulo"]
        )

        content = cls.apply_post_transforms(content, data["capitulo"])

        html += "<hr>\n\n"
        html += f'<span id="cap-{data["capitulo"]}"></span>\n\n'
        html += f"<h2>Capítulo {data['capitulo']}</h2>\n\n"

        sections = data.get("secoes") or {}
        has_structured_sections = isinstance(sections, dict) and any(
            str(sections.get(key) or "").strip()
            for key in ("titulo", "notas", "consideracoes", "definicoes")
        )
        rendered_notes_block = False

        if has_structured_sections:
            chapter_id = str(data["capitulo"]).strip()
            sections_html, rendered_notes_block = cls._render_structured_sections(
                sections, chapter_id
            )
            html += sections_html

        if not rendered_notes_block:
            notas_html = cls._render_general_notes(
                str(data.get("notas_gerais") or ""),
                data["capitulo"],
            )
            if notas_html:
                html += notas_html
                rendered_notes_block = True

        if rendered_notes_block:
            html += "<hr>\n\n"

        html += content + "\n\n"

        logger.debug(
            f"Capítulo {data['capitulo']}: {state['injected_count']} seções estruturadas"
        )
        return html

    @classmethod
    def render_full_response(cls, results_map: Dict[str, SearchResult]) -> str:
        """
        Concatena renderização de múltiplos capítulos.

        Args:
            results_map: Dict {chapter_num: SearchResult}

        Returns:
            HTML completo com todos os capítulos ordenados
        """
        logger.debug(f"Renderizando {len(results_map)} capítulos")

        full_html = ""
        for _, res_data in sorted(results_map.items()):
            try:
                full_html += cls.render_chapter(res_data)
            except Exception as e:
                logger.error(
                    f"Error rendering chapter {res_data.get('capitulo')}: {e}",
                    exc_info=True,
                )
                full_html += (
                    "<blockquote>"
                    f"<p><strong>Erro:</strong> Falha ao renderizar Capítulo {res_data.get('capitulo')}.</p>"
                    "</blockquote>\n\n"
                )
        return full_html


def inject_comment_marks(html: str, commented_anchor_keys: list[str]) -> str:
    """
    Injeta `<mark class="has-comment">` em volta dos elementos que possuem
    comentários aprovados, identificados pelo anchor_key (= valor do atributo id).

    Estratégia: para cada anchor_key, encontramos o elemento que possui
    `id="<anchor_key>"` e adicionamos a classe `has-comment` a ele.
    Não envolve o texto em outro elemento para preservar a estrutura do DOM.

    Args:
        html: HTML já renderizado pelo HtmlRenderer.
        commented_anchor_keys: Lista de anchor_keys que possuem comentários aprovados.

    Returns:
        HTML modificado com a classe `has-comment` nos elementos relevantes.
    """
    if not commented_anchor_keys or not html:
        return html

    for key in commented_anchor_keys:
        # Escapa o key para uso em regex seguro
        safe_key = re.escape(key)

        # Encontra a tag com id="{key}" e adiciona has-comment à sua classe
        # Suporta: id="key", id='key', class="..." já existente
        def _add_class(match: re.Match) -> str:
            tag = match.group(0)
            if "class=" in tag:
                # Adiciona has-comment à class existente
                tag = re.sub(
                    r'(class=["\'])([^"\']*?)(["\'])',
                    lambda m: f"{m.group(1)}{m.group(2)} has-comment{m.group(3)}",
                    tag,
                    count=1,
                )
            else:
                # Insere class antes do fechamento da tag de abertura
                tag = re.sub(r"(\s*/?>)$", ' class="has-comment"\\1', tag)
            return tag

        html = re.sub(
            rf'<[a-zA-Z][^>]*\bid=["\']?{safe_key}["\']?[^>]*>',
            _add_class,
            html,
            count=1,
        )

    return html
