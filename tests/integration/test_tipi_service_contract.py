"""
Testes de contrato para TipiService.

Valida que a API pública do serviço mantém seu contrato esperado.
Usa banco de dados em memória com fixtures de teste.
"""

import os
import sqlite3
import tempfile
import asyncio
import pytest
from pathlib import Path

from backend.services.tipi_service import TipiService


@pytest.fixture
def test_db():
    """Cria banco de dados temporário com dados de teste."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    db_path = tmp.name

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE tipi_chapters (codigo TEXT PRIMARY KEY, titulo TEXT, secao TEXT)"
        )
        conn.execute(
            "CREATE TABLE tipi_positions (ncm TEXT, capitulo TEXT, descricao TEXT, aliquota TEXT, nivel INTEGER)"
        )

        # FTS opcional
        try:
            conn.execute(
                "CREATE VIRTUAL TABLE tipi_fts USING fts5(ncm, capitulo, descricao, aliquota)"
            )
            fts_available = True
        except sqlite3.OperationalError:
            fts_available = False

        # Capítulos
        conn.execute(
            "INSERT INTO tipi_chapters (codigo, titulo, secao) VALUES ('85', 'Máquinas e aparelhos', 'XVI')"
        )
        conn.execute(
            "INSERT INTO tipi_chapters (codigo, titulo, secao) VALUES ('73', 'Obras de ferro', 'XV')"
        )
        conn.execute(
            "INSERT INTO tipi_chapters (codigo, titulo, secao) VALUES ('84', 'Reatores nucleares, caldeiras, máquinas', 'XVI')"
        )
        conn.execute(
            "INSERT INTO tipi_chapters (codigo, titulo, secao) VALUES ('39', 'Plásticos e obras', 'VII')"
        )

        # Posições para testes de hierarquia
        rows = [
            ("85.17", "85", "Aparelhos telefônicos", "0", 1),
            ("8517.13", "85", "Smartphones", "0", 2),
            ("8517.13.00", "85", "Smartphones portáteis", "0", 3),
            ("73.18", "73", "Parafusos", "5", 1),
            ("84.13", "84", "Bombas para líquidos", "0", 1),
            ("8413.91", "84", "Partes de bombas", "0", 2),
            ("8413.91.90", "84", "Outras partes de bombas", "0", 3),
            # Hierarquia para teste específico (cap 39)
            (
                "39.24",
                "39",
                "Serviços de mesa e outros artigos de uso doméstico",
                "0",
                1,
            ),
            ("3924.90", "39", "Outros artigos de plástico", "0", 2),
            ("3924.90.00", "39", "Outros - especificado", "6.5", 3),
        ]
        conn.executemany(
            "INSERT INTO tipi_positions (ncm, capitulo, descricao, aliquota, nivel) VALUES (?, ?, ?, ?, ?)",
            rows,
        )

        if fts_available:
            conn.executemany(
                "INSERT INTO tipi_fts (ncm, capitulo, descricao, aliquota) VALUES (?, ?, ?, ?)",
                [(r[0], r[1], r[2], r[3]) for r in rows],
            )

        conn.commit()
    finally:
        conn.close()

    yield {"path": Path(os.path.abspath(db_path)), "fts": fts_available}

    # Cleanup
    try:
        os.unlink(db_path)
    except OSError:
        pass


@pytest.fixture
def service(test_db):
    """Cria instância do serviço com banco de teste."""
    return TipiService(db_path=test_db["path"])


class TestTipiServiceContract:
    """Testes de contrato da API pública."""

    def test_is_code_query_heuristic(self, service):
        """Heurística de detecção de query numérica."""
        assert service.is_code_query("85") is True
        assert service.is_code_query("85.17") is True
        assert service.is_code_query("85-17") is True
        assert service.is_code_query("85,73") is True
        assert service.is_code_query("motor eletrico") is False
        assert service.is_code_query("") is False

    @pytest.mark.asyncio
    async def test_search_by_code_contract_non_empty(self, service):
        """Resposta de busca por código deve seguir contrato."""
        resp = await service.search_by_code("85")

        assert resp["success"] is True
        assert resp["type"] == "code"
        assert "query" in resp
        assert "results" in resp
        assert "resultados" in resp
        assert "total" in resp
        assert "total_capitulos" in resp
        assert resp["total"] > 0
        assert resp["total_capitulos"] == 1

        cap = resp["resultados"].get("85")
        assert cap is not None
        assert "posicoes" in cap
        assert len(cap["posicoes"]) > 0

        first = cap["posicoes"][0]
        assert "ncm" in first
        assert "descricao" in first

    @pytest.mark.asyncio
    async def test_search_by_code_sets_posicao_alvo(self, service):
        """Deve definir posicao_alvo para auto-scroll."""
        resp = await service.search_by_code("8517")
        cap = resp["resultados"].get("85")

        assert cap is not None
        assert cap.get("posicao_alvo") == "85.17"

    @pytest.mark.asyncio
    async def test_search_by_code_normalizes_8_digit_ncm_for_scroll(self, service):
        """NCM de 8 dígitos deve ser normalizado para scroll."""
        resp = await service.search_by_code("84139190")
        cap = resp["resultados"].get("84")

        assert cap is not None
        assert cap.get("posicao_alvo") == "8413.91.90"

    @pytest.mark.asyncio
    async def test_search_by_code_contract_empty(self, service):
        """Busca sem resultados deve retornar estrutura vazia."""
        resp = await service.search_by_code("9999")

        assert resp["success"] is True
        assert resp["type"] == "code"
        assert resp["total"] == 0
        assert resp["total_capitulos"] == 0
        assert resp["resultados"] == {}
        assert resp["results"] == {}

    @pytest.mark.asyncio
    async def test_search_text_contract(self, service, test_db):
        """Busca textual deve seguir contrato."""
        if not test_db["fts"]:
            pytest.skip("SQLite FTS5 não disponível neste ambiente")

        resp = await service.search_text("telefônicos")

        assert resp["success"] is True
        assert resp["type"] == "text"
        assert "normalized" in resp
        assert "results" in resp
        assert isinstance(resp["results"], list)


class TestTipiHierarchy:
    """Testes para funcionalidade de hierarquia NCM (modo family)."""

    @pytest.mark.asyncio
    async def test_family_mode_includes_ancestors(self, service):
        """
        Modo family deve incluir posições ancestrais na hierarquia.

        Ao buscar um NCM específico (8 dígitos), deve retornar também
        os NCMs pai (posição 4-dig, subposição 6-dig).
        """
        resp = await service.search_by_code("39249000", view_mode="family")

        assert resp["success"] is True
        cap = resp["resultados"].get("39")
        assert cap is not None, "Capítulo 39 deve estar presente"

        ncms = [p["ncm"] for p in cap.get("posicoes", [])]

        # Deve incluir o item buscado
        assert any("3924.90.00" in n or "39249000" in n for n in ncms), (
            f"Item buscado não encontrado. NCMs retornados: {ncms}"
        )

        # Deve incluir ancestral posição (4 dígitos)
        assert any("39.24" in n or n == "3924" for n in ncms), (
            f"Ancestral posição (39.24) não encontrado. NCMs: {ncms}"
        )

    @pytest.mark.asyncio
    async def test_family_mode_with_6_digit_query(self, service):
        """Busca com 6 dígitos deve incluir ancestral de 4 dígitos."""
        resp = await service.search_by_code("392490", view_mode="family")

        cap = resp["resultados"].get("39")
        assert cap is not None

        ncms = [p["ncm"] for p in cap.get("posicoes", [])]

        # Ancestral de 4 dígitos
        assert any("39.24" in n or n == "3924" for n in ncms), (
            f"Ancestral (39.24) não encontrado. NCMs: {ncms}"
        )

    @pytest.mark.asyncio
    async def test_chapter_mode_returns_full_chapter(self, service):
        """Modo chapter deve retornar capítulo completo sem filtro."""
        resp = await service.search_by_code("39249000", view_mode="chapter")

        cap = resp["resultados"].get("39")
        assert cap is not None

        # Deve ter todas as posições do capítulo
        assert len(cap.get("posicoes", [])) >= 3, (
            "Modo chapter deve retornar todas as posições do capítulo"
        )

    @pytest.mark.asyncio
    async def test_family_mode_filters_unrelated_positions(self, service):
        """Modo family não deve incluir posições de outras famílias."""
        # Busca específica no cap 84
        resp = await service.search_by_code("84139190", view_mode="family")

        cap = resp["resultados"].get("84")
        assert cap is not None

        ncms = [p["ncm"] for p in cap.get("posicoes", [])]

        # Não deve incluir posições de outras famílias (ex: 85.17)
        for ncm in ncms:
            clean = ncm.replace(".", "")
            assert clean.startswith("8413") or clean == "8413", (
                f"NCM {ncm} não pertence à família 8413"
            )
