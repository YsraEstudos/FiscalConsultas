import re

# Pre-compiled regex for stripping unsafe characters in anchor IDs (performance optimization)
_RE_UNSAFE_ANCHOR_CHARS = re.compile(r"[^a-zA-Z0-9\.\-]")


def generate_anchor_id(ncm_code: str) -> str:
    """
    Gera um ID único e seguro para âncoras HTML de posições NCM.

    Regra Canônica:
    - Substitui TODOS os pontos por traços.
    - Remove espaços.
    - Adiciona prefixo 'pos-'.

    Exemplos:
        "85.17" -> "pos-85-17"
        "8517.10.00" -> "pos-8517-10-00"
        "8517" -> "pos-8517"

    Args:
        ncm_code: Código NCM (ex: "85.17")

    Returns:
        String formatada para uso em id="" e href="#..."
    """
    if not ncm_code:
        return ""

    # Security: Remove any character that is not alphanumeric, dot, or dash
    # This prevents HTML injection vulnerabilities via ID attributes
    safe_chars = _RE_UNSAFE_ANCHOR_CHARS.sub("", ncm_code)

    clean_code = safe_chars.strip().replace(".", "-")
    return f"pos-{clean_code}"
