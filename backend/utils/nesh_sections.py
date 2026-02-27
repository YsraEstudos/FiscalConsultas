import re

_RE_CHAPTER_HEADER = re.compile(
    r"^(?:\*\*)?Capítulo\s+\d+(?:\*\*)?$", re.IGNORECASE
)
_RE_POSITION_START = re.compile(r"^\*?\*?\d{2}\.\d{2}\s*[-–]")
_RE_NOTAS_HEADER = re.compile(r"^Notas?\.?$", re.IGNORECASE)
_RE_CONSIDERACOES = re.compile(r"^CONSIDERAÇÕES GERAIS", re.IGNORECASE)
_RE_DEF_ITEM = re.compile(r"^\d+\)")
_RE_DEF_CONT_LOWER = re.compile(r"^[a-zà-ÿ]")
_DEF_CONT_PREFIXES = ("-", "–", "—", "•", "(")


def clean_markdown(text: str) -> str:
    """Remove formatação markdown (**, *, _) do texto."""
    cleaned = text
    cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", cleaned)  # Remove **bold**
    cleaned = re.sub(r"\*(.+?)\*", r"\1", cleaned)  # Remove *italic*
    cleaned = re.sub(r"_(.+?)_", r"\1", cleaned)  # Remove _italic_
    cleaned = re.sub(r"(?:^\*\*)|(?:\*\*$)", "", cleaned)  # Remove ** no início/fim
    cleaned = re.sub(r"(?:^\*)|(?:\*$)", "", cleaned)  # Remove * solto
    return cleaned.strip()


class _ChapterSectionParser:
    def __init__(self) -> None:
        self.current_section = "titulo"
        self.section_lines = {
            "titulo": [],
            "notas": [],
            "consideracoes": [],
            "definicoes": [],
        }
        self.titulo_captured = False
        self.last_def_line = ""

    @staticmethod
    def _is_definition_continuation(
        cleaned: str, is_indented: bool, last_def_line: str
    ) -> bool:
        return (
            is_indented
            or _RE_DEF_CONT_LOWER.match(cleaned) is not None
            or cleaned.startswith(_DEF_CONT_PREFIXES)
            or (last_def_line.endswith(":") if last_def_line else False)
        )

    def _consume_headers(self, cleaned: str) -> bool:
        if _RE_NOTAS_HEADER.match(cleaned):
            if not self.titulo_captured:
                self.titulo_captured = True
            self.current_section = "notas"
            return True
        if _RE_CONSIDERACOES.match(cleaned):
            self.current_section = "consideracoes"
            return True
        return False

    def _consume_definition_start(self, cleaned: str) -> bool:
        if self.current_section != "consideracoes":
            return False
        if _RE_DEF_ITEM.match(cleaned) is None:
            return False
        self.current_section = "definicoes"
        self.section_lines["definicoes"].append(cleaned)
        self.last_def_line = cleaned
        return True

    def _consume_definition_body(self, cleaned: str, is_indented: bool) -> bool:
        if self.current_section != "definicoes" or not cleaned:
            return False
        if _RE_DEF_ITEM.match(cleaned) is not None:
            self.section_lines["definicoes"].append(cleaned)
            self.last_def_line = cleaned
            return True
        if self._is_definition_continuation(cleaned, is_indented, self.last_def_line):
            self.section_lines["definicoes"].append(cleaned)
            self.last_def_line = cleaned
            return True
        # Não é definição: volta para considerações e deixa linha seguir fluxo normal.
        self.current_section = "consideracoes"
        return False

    def _consume_title(self, cleaned: str) -> bool:
        if self.titulo_captured or not cleaned:
            return False
        self.section_lines["titulo"].append(cleaned)
        self.titulo_captured = True
        return True

    def consume_line(self, line: str) -> bool:
        """
        Processa uma linha.
        Retorna True quando parsing deve parar (início das posições NCM).
        """
        stripped = line.strip()
        if _RE_CHAPTER_HEADER.match(stripped):
            return False
        if _RE_POSITION_START.match(stripped):
            return True
        if not self.titulo_captured and not stripped:
            return False

        cleaned = clean_markdown(stripped)
        is_indented = len(line) > len(line.lstrip())

        if self._consume_headers(cleaned):
            return False
        if self._consume_definition_start(cleaned):
            return False
        if self._consume_definition_body(cleaned, is_indented):
            return False
        if self._consume_title(cleaned):
            return False

        self.section_lines[self.current_section].append(cleaned)
        return False

    def build(self) -> dict:
        sections = {"titulo": "", "notas": "", "consideracoes": "", "definicoes": ""}
        for key in sections:
            text = "\n".join(self.section_lines[key]).strip()
            sections[key] = re.sub(r"\n{3,}", "\n\n", text)
        return sections


def extract_chapter_sections(chapter_content: str) -> dict:
    """
    Extrai seções estruturadas do capítulo.

    Retorna dict com:
    - titulo: Nome do capítulo
    - notas: Notas oficiais
    - consideracoes: CONSIDERAÇÕES GERAIS
    - definicoes: Definições técnicas
    """
    parser = _ChapterSectionParser()
    for line in chapter_content.split("\n"):
        should_stop = parser.consume_line(line)
        if should_stop:
            break
    return parser.build()
