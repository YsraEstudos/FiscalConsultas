"""Chapter structure and response assembly helpers for presentation rendering."""

from collections.abc import Callable, Iterable, Mapping
from typing import TypedDict
import logging
import re

from backend.domain import SearchResult
from backend.utils.id_utils import generate_anchor_id

from .renderer_patterns import _RendererRegexProtocol, _get_fallback_anchor_pattern
from .renderer_text import (
    _apply_post_transforms,
    _clean_content,
    _GlossaryManagerProtocol,
    _inject_note_links,
    _inject_smart_links,
)


class _ChapterRenderState(TypedDict):
    injected_count: int
    ids_injected: list[str]


def _get_pending_anchors(
    posicoes: Iterable[object], existing_ids: set[str]
) -> list[tuple[str, str]]:
    re_main_pos = re.compile(r"^\d{2}\.\d{2}$")
    pending: list[tuple[str, str]] = []
    for pos in posicoes:
        if not isinstance(pos, Mapping):
            continue
        pos_code = str(pos.get("codigo") or "").strip()
        if not pos_code or not re_main_pos.match(pos_code):
            continue
        anchor_id = generate_anchor_id(pos_code)
        if anchor_id not in existing_ids:
            pending.append((pos_code, anchor_id))
    return pending


def _inject_fallback_anchors(
    content: str,
    posicoes: Iterable[object],
    chapter_num: str,
    *,
    logger: logging.Logger,
) -> str:
    pos_list = list(posicoes)
    if not pos_list:
        return content

    logger.debug(
        "[RENDERER] Checking %s positions for ID injection fallback in Cap %s",
        len(pos_list),
        chapter_num,
    )
    existing_ids = set(re.findall(r'id="(pos-[^"]+)"', content))
    pending = _get_pending_anchors(pos_list, existing_ids)

    if pending:
        code_to_anchor = dict(pending)
        combined_pattern = _get_fallback_anchor_pattern(tuple(code_to_anchor.keys()))
        injected: set[str] = set()

        def _anchor_replacer(match: re.Match[str]) -> str:
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


def _render_structured_sections(
    renderer: _RendererRegexProtocol,
    sections: Mapping[str, str | None],
    chapter_id: str,
    *,
    glossary_manager_obj: _GlossaryManagerProtocol | None,
) -> tuple[str, bool]:
    html = ""
    rendered_notes_block = False

    def _render_section_lines(raw_text: str) -> str:
        processed = _inject_note_links(renderer, raw_text)
        processed = _apply_post_transforms(renderer, processed, glossary_manager_obj)
        lines: list[str] = []
        for line in processed.split("\n"):
            if line.strip():
                lines.append(f"<p>{line}</p>")
            else:
                lines.append("<p><br></p>")
        return "\n".join(lines)

    titulo = str(sections.get("titulo") or "").strip()
    if titulo:
        titulo_processed = _apply_post_transforms(
            renderer,
            _inject_note_links(renderer, titulo),
            glossary_manager_obj,
        )
        html += (
            f'<div class="section-titulo" id="chapter-{chapter_id}-titulo">\n'
            f'<h3 class="section-header titulo-header">📖 {titulo_processed}</h3>\n'
            "</div>\n\n"
        )

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

    definicoes = str(sections.get("definicoes") or "").strip()
    if definicoes:
        definicoes_html = _render_section_lines(definicoes)
        html += (
            f'<div class="section-definicoes" id="chapter-{chapter_id}-definicoes">\n'
            '<h3 class="section-header definicoes-header">📋 Definições Técnicas</h3>\n'
            f'<div class="definicoes-content">\n{definicoes_html}\n</div>\n'
            "</div>\n\n"
        )

    return html, rendered_notes_block


def _trim_chapter_content(
    renderer: _RendererRegexProtocol, content: str, current_chapter: str
) -> str:
    current_chapter_str = str(current_chapter).strip()
    if current_chapter_str:
        trimmed_at = None
        for match in renderer.RE_CHAPTER_HEADER.finditer(content):
            chapter_num = (match.group(1) or "").lstrip("0")
            current_num = current_chapter_str.lstrip("0")
            if chapter_num and current_num and chapter_num != current_num:
                trimmed_at = match.start()
                break
        if trimmed_at is not None and trimmed_at > 0:
            content = content[:trimmed_at].rstrip()

    section_match = renderer.RE_SECTION_HEADER.search(content)
    if section_match and section_match.start() > 0:
        content = content[: section_match.start()].rstrip()
    return content


def _structure_headings(
    renderer: _RendererRegexProtocol, content: str, state: _ChapterRenderState
) -> str:
    def section_wrapper(match: re.Match[str]) -> str:
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

    def sub_section_wrapper(match: re.Match[str]) -> str:
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

    content = renderer.RE_NCM_SUBHEADING.sub(sub_section_wrapper, content)
    content = renderer.RE_NCM_HEADING.sub(section_wrapper, content)
    return content


def _normalize_bullet_content(
    renderer: _RendererRegexProtocol, line: str
) -> str | None:
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


def _normalize_special_line(renderer: _RendererRegexProtocol, line: str) -> str | None:
    bold_only = renderer.RE_BOLD_ONLY_LINE.match(line)
    if bold_only:
        title = bold_only.group(1).strip()
        return f'<h4 class="nesh-subheading">{title}</h4>'

    bold_inline = renderer.RE_BOLD_INLINE.match(line)
    if bold_inline:
        title = bold_inline.group(1).strip()
        rest = bold_inline.group(2).strip()
        return f'<span class="nesh-inline-title">{title}</span> {rest}'

    return None


def _normalize_lines(renderer: _RendererRegexProtocol, content: str) -> str:
    normalized_lines: list[str] = []
    for line in content.split("\n"):
        bullet_content = _normalize_bullet_content(renderer, line)

        if bullet_content == "":
            continue
        if bullet_content is not None:
            if len(bullet_content) <= 1:
                continue
            normalized_lines.append(f"- {bullet_content}")
            continue

        special_line = _normalize_special_line(renderer, line)
        if special_line is not None:
            normalized_lines.append(special_line)
            continue

        normalized_lines.append(line)
    return "\n".join(normalized_lines)


def _render_general_notes(
    renderer: _RendererRegexProtocol,
    notas: str,
    capitulo: str,
) -> str:
    if not notas:
        return ""
    notas_processed = _inject_note_links(renderer, notas)
    notas_processed = _inject_smart_links(renderer, notas_processed)
    lines: list[str] = []
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


def _render_chapter(
    renderer: _RendererRegexProtocol,
    data: SearchResult,
    *,
    glossary_manager_obj: _GlossaryManagerProtocol | None,
    logger: logging.Logger,
) -> str:
    html = ""

    if not data.get("real_content_found", True):
        logger.warning(
            "Renderizando erro: Capítulo %s não encontrado", data["capitulo"]
        )
        return (
            "<hr>\n\n"
            f'<span id="cap-{data["capitulo"]}"></span>\n\n'
            f"<h2>Capítulo {data['capitulo']}</h2>\n\n"
            "<blockquote><p><strong>Erro:</strong> Capítulo não encontrado.</p></blockquote>\n\n"
        )

    logger.debug("Renderizando capítulo %s", data["capitulo"])

    content = _clean_content(renderer, data["conteudo"])
    content = _trim_chapter_content(renderer, content, data.get("capitulo", ""))
    content = _inject_note_links(renderer, content)

    state: _ChapterRenderState = {"injected_count": 0, "ids_injected": []}
    content = _structure_headings(renderer, content, state)
    content = _normalize_lines(renderer, content)

    content = _inject_fallback_anchors(
        content,
        data.get("posicoes") or [],
        data["capitulo"],
        logger=logger,
    )

    content = _apply_post_transforms(renderer, content, glossary_manager_obj)

    html += "<hr>\n\n"
    html += f'<span id="cap-{data["capitulo"]}"></span>\n\n'
    html += f"<h2>Capítulo {data['capitulo']}</h2>\n\n"

    sections = data.get("secoes") or {}
    has_structured_sections = isinstance(sections, Mapping) and any(
        str(sections.get(key) or "").strip()
        for key in ("titulo", "notas", "consideracoes", "definicoes")
    )
    rendered_notes_block = False

    if has_structured_sections:
        chapter_id = str(data["capitulo"]).strip()
        sections_html, rendered_notes_block = _render_structured_sections(
            renderer,
            sections,
            chapter_id,
            glossary_manager_obj=glossary_manager_obj,
        )
        html += sections_html

    if not rendered_notes_block:
        notas_html = _render_general_notes(
            renderer,
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
        "Capítulo %s: %s seções estruturadas",
        data["capitulo"],
        state["injected_count"],
    )
    return html


def _render_full_response(
    results_map: Mapping[str, SearchResult],
    render_chapter_fn: Callable[[SearchResult], str],
    *,
    logger: logging.Logger,
) -> str:
    logger.debug("Renderizando %s capítulos", len(results_map))

    full_html = ""
    for _, res_data in sorted(results_map.items()):
        try:
            full_html += render_chapter_fn(res_data)
        except Exception as exc:
            logger.error(
                "Error rendering chapter %s: %s",
                res_data.get("capitulo"),
                exc,
                exc_info=True,
            )
            full_html += (
                "<blockquote>"
                f"<p><strong>Erro:</strong> Falha ao renderizar Capítulo {res_data.get('capitulo')}.</p>"
                "</blockquote>\n\n"
            )
    return full_html


def inject_comment_marks(html: str, commented_anchor_keys: list[str]) -> str:
    """Add ``has-comment`` markers to rendered elements identified by anchor id."""
    if not commented_anchor_keys or not html:
        return html

    target_keys = set(commented_anchor_keys)
    class_attr_pattern = re.compile(  # NOSONAR
        r'(?<![\w-])(class=["\'])([^"\']*)(["\'])'
    )  # NOSONAR

    def _replacer(match: re.Match[str]) -> str:
        found_id = match.group(1) or match.group(2) or match.group(3)
        if found_id not in target_keys:
            return match.group(0)

        target_keys.remove(found_id)

        tag = match.group(0)
        if class_attr_pattern.search(tag):
            tag = class_attr_pattern.sub(
                lambda m: f"{m.group(1)}{m.group(2)} has-comment{m.group(3)}",
                tag,
                count=1,
            )
        else:
            tag = re.sub(r"(\s*/?>)$", ' class="has-comment"\\1', tag)
        return tag

    return re.sub(  # NOSONAR
        r'<[a-zA-Z][^\s>]*\s+(?:[^\s>]+(?:\s+[^\s>]+)*\s+)?id=(?:"([^"]*)"|\'([^\']*)\'|([^\s/>]+))(?=[\s/>]|$)[^>]*>',  # NOSONAR
        _replacer,
        html,
    )
