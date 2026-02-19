"""
Testes para validar que a rota TIPI aplica highlights nas descrições antes de retornar JSON.
Testa a função _apply_highlights_to_descriptions isoladamente.
"""
from backend.presentation.routes.tipi import _apply_highlights_to_descriptions


class TestApplyHighlightsToDescriptions:
    """Testa a transformação de descrições no resultado da rota TIPI."""

    def test_code_search_applies_unit_highlights(self):
        """Busca por código: result["results"] é dict de capítulos."""
        result = {
            "type": "code",
            "results": {
                "85": {
                    "capitulo": "85",
                    "titulo": "Capítulo 85",
                    "posicoes": [
                        {"ncm": "8516.10", "descricao": "Aquecedor de 1500 W", "aliquota": "5"},
                        {"ncm": "8414.30", "descricao": "Compressor de 10 kW", "aliquota": "10"},
                    ]
                }
            }
        }
        _apply_highlights_to_descriptions(result)
        desc1 = result["results"]["85"]["posicoes"][0]["descricao"]
        desc2 = result["results"]["85"]["posicoes"][1]["descricao"]
        assert 'highlight-unit">W</span>' in desc1
        assert 'highlight-unit">kW</span>' in desc2

    def test_text_search_applies_unit_highlights(self):
        """Busca por texto: result["results"] é lista de dicts."""
        result = {
            "type": "text",
            "results": [
                {"ncm": "8516.10", "descricao": "Aquecedor de 1500 W", "aliquota": "5"},
                {"ncm": "8414.30", "descricao": "Compressor de 10 kW", "aliquota": "10"},
            ]
        }
        _apply_highlights_to_descriptions(result)
        assert 'highlight-unit">W</span>' in result["results"][0]["descricao"]
        assert 'highlight-unit">kW</span>' in result["results"][1]["descricao"]

    def test_applies_exclusion_highlights(self):
        """Deve aplicar highlight de exclusões (exceto, excluindo, etc.)."""
        result = {
            "type": "code",
            "results": {
                "84": {
                    "capitulo": "84",
                    "posicoes": [
                        {"ncm": "8414", "descricao": "Compressores, exceto os de uso doméstico", "aliquota": "10"},
                    ]
                }
            }
        }
        _apply_highlights_to_descriptions(result)
        desc = result["results"]["84"]["posicoes"][0]["descricao"]
        assert 'highlight-exclusion' in desc

    def test_empty_results_no_error(self):
        """Resultado vazio não deve causar erro."""
        result = {"type": "code", "results": {}}
        _apply_highlights_to_descriptions(result)
        assert result["results"] == {}

    def test_none_results_no_error(self):
        """Resultado None não deve causar erro."""
        result = {"type": "code"}
        _apply_highlights_to_descriptions(result)

    def test_empty_description_no_error(self):
        """Descrição vazia não deve causar erro."""
        result = {
            "type": "code",
            "results": {
                "01": {
                    "posicoes": [
                        {"ncm": "0101", "descricao": "", "aliquota": "0"},
                    ]
                }
            }
        }
        _apply_highlights_to_descriptions(result)
        assert result["results"]["01"]["posicoes"][0]["descricao"] == ""

    def test_no_units_no_highlights(self):
        """Descrições sem unidades ficam intactas (exceto highlight-exclusion se houver)."""
        result = {
            "type": "text",
            "results": [
                {"ncm": "0101", "descricao": "Cavalos vivos", "aliquota": "0"},
            ]
        }
        _apply_highlights_to_descriptions(result)
        assert result["results"][0]["descricao"] == "Cavalos vivos"

    def test_new_units_applied(self):
        """Novas unidades (dB, Ω, psi, etc.) devem ser destacadas."""
        result = {
            "type": "text",
            "results": [
                {"ncm": "8518", "descricao": "Nível de ruído de 85 dB", "aliquota": "5"},
                {"ncm": "8533", "descricao": "Resistor de 10 kΩ", "aliquota": "5"},
                {"ncm": "8414", "descricao": "Pressão de 30 psi", "aliquota": "10"},
            ]
        }
        _apply_highlights_to_descriptions(result)
        assert 'highlight-unit">dB</span>' in result["results"][0]["descricao"]
        assert 'highlight-unit">kΩ</span>' in result["results"][1]["descricao"]
        assert 'highlight-unit">psi</span>' in result["results"][2]["descricao"]
