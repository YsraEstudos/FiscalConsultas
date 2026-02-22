from backend.presentation.tipi_renderer import TipiRenderer
from backend.presentation.renderer import HtmlRenderer


class TestTipiApiIntegration:
    """Testes de integração para o endpoint /api/tipi/search usando TestClient."""

    def test_tipi_search_returns_success_true(self, client):
        """Endpoint TIPI deve retornar success: true para consultas válidas."""
        resp = client.get("/api/tipi/search?ncm=85")
        assert resp.status_code == 200
        data = resp.json()

        assert data.get("success") is True, "success deve ser True"
        assert data.get("type") == "code"
        assert "resultados" in data

    def test_tipi_search_returns_aliquota_data(self, client):
        """TIPI deve retornar dados com alíquota nas posições."""
        resp = client.get("/api/tipi/search?ncm=01")
        assert resp.status_code == 200
        data = resp.json()

        resultados = data.get("resultados", {})
        assert len(resultados) > 0, "Deve ter pelo menos 1 capítulo"

        # Pegar primeiro capítulo
        first_cap = list(resultados.values())[0]
        posicoes = first_cap.get("posicoes", [])
        assert len(posicoes) > 0, "Deve ter pelo menos 1 posição"

        # Verificar que alíquota existe
        first_pos = posicoes[0]
        assert "aliquota" in first_pos, "Posição deve ter campo aliquota"

    def test_tipi_markdown_contains_aliquota_class(self, client):
        """Renderização da TIPI deve conter classes tipi-aliquota."""
        resp = client.get("/api/tipi/search?ncm=01")
        assert resp.status_code == 200
        data = resp.json()

        resultados = data.get("resultados", {})
        rendered = TipiRenderer.render_full_response(resultados)
        assert "tipi-aliquota" in rendered, (
            "Renderização deve conter classe tipi-aliquota"
        )

    def test_tipi_differs_from_nesh(self, client):
        """Mesma consulta em TIPI e NESH deve retornar conteúdos diferentes."""
        resp_tipi = client.get("/api/tipi/search?ncm=85")
        tipi_data = resp_tipi.json()

        resp_nesh = client.get("/api/search?ncm=85")
        nesh_data = resp_nesh.json()

        tipi_md = TipiRenderer.render_full_response(tipi_data.get("resultados", {}))
        nesh_md = HtmlRenderer.render_full_response(nesh_data.get("resultados", {}))

        # TIPI tem tipi-aliquota, NESH não
        assert "tipi-aliquota" in tipi_md
        assert "tipi-aliquota" not in nesh_md

    def test_tipi_search_8517_returns_results(self, client):
        """Busca por 8517 deve retornar resultados (caso específico reportado)."""
        resp = client.get("/api/tipi/search?ncm=8517")
        assert resp.status_code == 200
        data = resp.json()

        # Check success logic (API might return 200 even if empty results, but success=False?
        # Original test asserted success=True)
        assert data.get("success") is True
        assert data.get("total", 0) > 0, (
            "Busca por 8517 deve retornar pelo menos 1 resultado"
        )

        # Check if 85 is in results keys (Chapter 85)
        # Original: self.assertIn("85", data.get("resultados", {}))
        assert "85" in data.get("resultados", {}), "Deve conter capítulo 85"
