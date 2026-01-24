import pytest
import sqlite3
import os
from backend.config import CONFIG

def test_database_integrity():
    """Validação de integridade do banco de dados (anteriormente debug_nesh.py)"""
    db_path = CONFIG.db_path
    assert os.path.exists(db_path), f"Banco de dados NESH não encontrado em {db_path}"
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Verificar FTS (Full Text Search)
    cursor.execute("SELECT COUNT(*) FROM search_index")
    fts_count = cursor.fetchone()[0]
    assert fts_count > 0, "O índice FTS está vazio"
    
    # Verificar Capítulos
    cursor.execute("SELECT COUNT(*) FROM chapters")
    chapter_count = cursor.fetchone()[0]
    assert chapter_count >= 97, f"Esperado ao menos 97 capítulos, encontrado {chapter_count}"
    
    conn.close()

def test_nesh_search_code(client):
    """Validação de busca por código na NESH (anteriormente verify_search.py)"""
    response = client.get("/api/search?ncm=85")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["type"] == "code"
    assert "total_capitulos" in data
    assert data["total_capitulos"] > 0

def test_nesh_search_text(client):
    """Validação de busca por texto na NESH (anteriormente verify_search.py)"""
    response = client.get("/api/search?ncm=motor")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data.get("results", [])) > 0
    # Verifica se o primeiro resultado tem os campos esperados
    first_result = data["results"][0]
    assert "ncm" in first_result
    assert "descricao" in first_result

def test_tipi_search_code(client):
    """Validação de busca por código na TIPI (anteriormente verify_search.py)"""
    response = client.get("/api/tipi/search?ncm=8517")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["total"] > 0

def test_tipi_search_text(client):
    """Validação de busca por texto na TIPI (anteriormente verify_search.py)"""
    response = client.get("/api/tipi/search?ncm=telefone")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["total"] > 0

def test_chapter_84_data(client):
    """Validação de dados do Capítulo 84 (anteriormente verify_chapter_data.py)"""
    # Nota: A rota interna de serviço nesh_service.fetch_chapter_data é usada 
    # indiretamente pelo endpoint /api/search?ncm=84 ou outra rota de visualização.
    # Vamos validar via endpoint público de busca que retorna dados do capítulo.
    response = client.get("/api/search?ncm=84")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    
    # Se a API retorna estrutura de capítulos (NESH) - para tipo "code" é um dicionário
    if data["type"] == "code":
        results = data.get("results", {})
        assert "84" in results, "Capítulo 84 não encontrado no dicionário de resultados"
        assert results["84"]["real_content_found"] is True
        assert len(results["84"]["posicoes"]) > 0
    else:
        # Fallback para busca textual se "84" for interpretado assim (improvável dado regex)
        results = data.get("results", [])
        cap84 = next((r for r in results if isinstance(r, dict) and (r.get("codigo") == "84" or "84" in r.get("ncm", ""))), None)
        assert cap84 is not None, "Capítulo 84 não encontrado nos resultados textuais"
        
    # Teste específico para posições se o endpoint suportar detalhamento (usando nesh_service via infra se necessário)
    # Mas como o objetivo é alto nível (API), focamos no retorno do servidor.
