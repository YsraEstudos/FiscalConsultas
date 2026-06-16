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
    safe_chars = "".join(c for c in ncm_code if c.isalnum() or c in ".-")

    clean_code = safe_chars.strip().replace(".", "-")
    return f"pos-{clean_code}"
