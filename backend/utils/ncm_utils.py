import re
from typing import List, Optional, Tuple


def clean_ncm(ncm: str) -> str:
    """
    Remove caracteres não numéricos de uma string NCM.

    Args:
        ncm: String contendo possível código NCM (ex: "85.17-10")

    Returns:
        String contendo apenas dígitos (ex: "851710")
    """
    return re.sub(r"[^0-9]", "", (ncm or "").strip())


def extract_chapter_from_ncm(ncm: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extrai capítulo e posição-alvo de um código NCM.
    Logica original do NeshService.

    Args:
        ncm: Código NCM em qualquer formato
             (ex: "7315", "73.15", "8471.30.19")

    Returns:
        Tupla (capitulo, posicao_alvo)
        - capitulo: Primeiros 2 dígitos com zero à esquerda
        - posicao_alvo:
          - Mantém XXXX.X ou XXXX.XX quando usuário informa subposição curta explícita
            (ex: "8419.8", "8419.80").
          - Caso contrário, usa XX.XX quando houver 4+ dígitos.
          - None quando não há dígitos suficientes.
    """
    raw = (ncm or "").strip()
    compact = re.sub(r"\s+", "", raw)
    # Preserve short subposition like 8419.8 or 8419.80 if user typed it explicitly
    if re.fullmatch(r"\d{4}\.\d{1,2}", compact):
        chapter = compact[:2].zfill(2)
        return chapter, compact

    ncm_clean = clean_ncm(ncm)

    chapter = None
    target = None

    if not ncm_clean:
        return None, None

    if len(ncm_clean) >= 2:
        chapter = ncm_clean[:2].zfill(2)
    elif len(ncm_clean) == 1:
        chapter = ncm_clean.zfill(2)

    if len(ncm_clean) >= 4:
        target = f"{ncm_clean[:2]}.{ncm_clean[2:4]}"

    return chapter, target


def format_ncm_tipi(ncm: str) -> str:
    """
    Normaliza um NCM para o formato esperado pela TIPI (com pontos).
    Logica original do TipiService.

    Args:
        ncm: Código NCM cru (ex: "84139190")

    Returns:
        NCM formatado (ex: "8413.91.90")
    """
    digits = clean_ncm(ncm)
    if not digits:
        return (ncm or "").strip()

    if len(digits) == 8:
        return f"{digits[:4]}.{digits[4:6]}.{digits[6:8]}"
    if len(digits) == 7:
        # 8413110 -> 8413.11.0
        return f"{digits[:4]}.{digits[4:6]}.{digits[6]}"
    if len(digits) == 6:
        # 841311 -> 8413.11
        return f"{digits[:4]}.{digits[4:6]}"
    if len(digits) == 5:
        return f"{digits[:4]}.{digits[4]}"
    if len(digits) == 4:
        return f"{digits[:2]}.{digits[2:4]}"
    if len(digits) == 2:
        return digits
    return digits  # Fallback se não casar com padrões conhecidos


def is_code_query(query: str) -> bool:
    """
    Verifica se a query é composta apenas por códigos/pontuação.
    Heurística para decidir entre busca por código ou texto.
    """
    q = (query or "").strip()
    if not q:
        return False
    # Aceita: dígitos, ponto, traço, vírgula e espaços.
    return re.fullmatch(r"[0-9\.,\-\s]+", q) is not None


def split_ncm_query(query: str) -> List[str]:
    """
    Divide busca multi-NCM (separada por vírgula, ponto-e-vírgula ou espaço).
    Ex: "8517, 8518" -> ["8517", "8518"]
    Ex: "4903.90.00 8417" -> ["4903.90.00", "8417"]
    """
    parts = [p.strip() for p in re.split(r"[;,\s]+", (query or ""))]
    return [p for p in parts if p]
