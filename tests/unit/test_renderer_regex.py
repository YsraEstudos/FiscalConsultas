from backend.presentation.renderer import HtmlRenderer, _get_position_pattern


class TestRendererRegex:
    """
    Testes focados na correção do Regex para injeção de âncoras.
    Contexto: O backend falhava ao identificar NCMs precedidos por espaços.
    """

    def test_regex_standard_ncm(self):
        """Cenário Feliz: NCM no início da linha sem espaços."""
        code = "8517"
        pattern = _get_position_pattern(code)
        content = "8517 - Telefones..."
        match = pattern.search(content)
        assert match is not None
        assert match.group(0).strip().startswith("8517")

    def test_regex_indented_ncm(self):
        """Cenário da Correção: NCM indentado ou com espaços antes."""
        code = "8517"
        pattern = _get_position_pattern(code)

        # Casos que falhavam antes
        cases = [
            " 8517 - Telefones",
            "  8517 - Telefones",
            "\t8517 - Telefones",
            " \t 8517 - Telefones",
        ]

        for case in cases:
            match = pattern.search(case)
            assert match is not None, f"Falhou para caso: '{case}'"

    def test_regex_fallback_logic(self):
        """Testa se o renderizador injeta corretamente usando a lógica completa."""
        renderer = HtmlRenderer()
        # Mocking data dict similiar to SearchResult
        data = {
            "capitulo": "85",
            "posicoes": [{"codigo": "85.17"}],
            "conteudo": "  85.17 - Aparelhos telefônicos\n\nOutro texto...",
            "real_content_found": True,
        }

        rendered = renderer.render_chapter(data)

        # Verifica se o ID foi injetado
        expected_id = 'id="pos-85-17"'
        assert expected_id in rendered, (
            f"ID não encontrado no HTML gerado:\n{rendered[:200]}..."
        )

    def test_regex_false_positives(self):
        """Garante que não casamos números no meio de frases."""
        code = "8517"
        pattern = _get_position_pattern(code)

        content = "A norma 8517 diz que..."
        match = pattern.search(content)
        assert match is None, "Regex não deveria casar no meio da frase"

    def test_regex_with_dots(self):
        """Testa NCM com pontos (85.17)."""
        code = "85.17"
        pattern = _get_position_pattern(code)
        content = "  85.17 - Aparelhos..."
        match = pattern.search(content)
        assert match is not None
