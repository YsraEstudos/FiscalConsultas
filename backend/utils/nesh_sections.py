import re


def clean_markdown(text: str) -> str:
    """Remove formatação markdown (**, *, _) do texto."""
    cleaned = text
    cleaned = re.sub(r'\*\*(.+?)\*\*', r'\1', cleaned)  # Remove **bold**
    cleaned = re.sub(r'\*(.+?)\*', r'\1', cleaned)  # Remove *italic*
    cleaned = re.sub(r'_(.+?)_', r'\1', cleaned)  # Remove _italic_
    cleaned = re.sub(r'^\*\*|\*\*$', '', cleaned)  # Remove ** no início/fim
    cleaned = re.sub(r'^\*|\*$', '', cleaned)  # Remove * solto
    return cleaned.strip()


def extract_chapter_sections(chapter_content: str) -> dict:
    """
    Extrai seções estruturadas do capítulo.

    Retorna dict com:
    - titulo: Nome do capítulo
    - notas: Notas oficiais
    - consideracoes: CONSIDERAÇÕES GERAIS
    - definicoes: Definições técnicas
    """
    lines = chapter_content.split('\n')

    sections = {
        'titulo': '',
        'notas': '',
        'consideracoes': '',
        'definicoes': ''
    }

    current_section = 'titulo'
    section_lines = {k: [] for k in sections.keys()}
    titulo_captured = False
    last_def_line = ''

    for line in lines:
        stripped = line.strip()
        is_indented = len(line) > len(line.lstrip())

        # Pular linha "Capítulo XX" (header)
        if re.match(r'^(?:\*\*)?Capítulo\s+\d+(?:\*\*)?$', stripped, re.IGNORECASE):
            continue

        # Parar em posição NCM (^XX.XX - ou **XX.XX -)
        if re.match(r'^\*?\*?\d{2}\.\d{2}\s*[-–]', stripped):
            break

        # Ignorar linhas em branco antes do primeiro conteúdo
        if not titulo_captured and not stripped:
            continue

        # Limpar markdown
        cleaned = clean_markdown(stripped)

        # Detectar início da seção "Notas."
        if re.match(r'^Notas?\.?$', cleaned, re.IGNORECASE):
            if not titulo_captured:
                titulo_captured = True
            current_section = 'notas'
            continue

        # Detectar CONSIDERAÇÕES GERAIS
        if re.match(r'^CONSIDERAÇÕES GERAIS', cleaned, re.IGNORECASE):
            current_section = 'consideracoes'
            continue

        # Detectar definições numeradas (1), 2), etc.) dentro de CONSIDERAÇÕES GERAIS
        if current_section == 'consideracoes' and re.match(r'^\d+\)', cleaned):
            current_section = 'definicoes'
            section_lines['definicoes'].append(cleaned)
            last_def_line = cleaned
            continue

        # Se já estamos em definições, decidir se a linha continua ou volta para considerações
        if current_section == 'definicoes' and cleaned:
            is_def_item = re.match(r'^\d+\)', cleaned) is not None
            is_continuation = (
                is_indented
                or re.match(r'^[a-zà-ÿ]', cleaned) is not None
                or cleaned.startswith(('-', '–', '—', '•', '('))
                or (last_def_line.endswith(':') if last_def_line else False)
            )

            if is_def_item:
                section_lines['definicoes'].append(cleaned)
                last_def_line = cleaned
                continue

            if is_continuation:
                section_lines['definicoes'].append(cleaned)
                last_def_line = cleaned
                continue

            # Linha não parece continuação: volta para considerações
            current_section = 'consideracoes'

        # Título é a primeira linha substantiva antes de "Notas."
        if not titulo_captured and cleaned:
            section_lines['titulo'].append(cleaned)
            titulo_captured = True
            continue

        # Adicionar à seção atual
        section_lines[current_section].append(cleaned)

    # Montar resultado
    for key in sections:
        text = '\n'.join(section_lines[key]).strip()
        text = re.sub(r'\n{3,}', '\n\n', text)
        sections[key] = text

    return sections
