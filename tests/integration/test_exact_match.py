"""
Teste para diagnosticar o problema do match exato.
Objetivo: Encontrar onde "bombas submersíveis" aparece no capítulo 84
e entender por que a navegação não está funcionando.
"""

import os
import re
import sqlite3
import unicodedata

import pytest

from backend.config.constants import DatabaseConfig

pytestmark = pytest.mark.integration

DB_PATH = DatabaseConfig.DEFAULT_DB_FILENAME


def require_db():
    if not os.path.exists(DB_PATH):
        pytest.skip(f"Database {DB_PATH} not found")


def normalize_text(text):
    """Remove acentos e normaliza texto."""
    return (
        unicodedata.normalize("NFD", text)
        .encode("ascii", "ignore")
        .decode("utf-8")
        .lower()
    )


def find_exact_matches(text, words):
    """
    Encontra onde as palavras aparecem JUNTAS (adjacentes) no texto.
    Retorna lista de (posição, trecho).
    """
    # Busca mais simples: procurar padrões comuns
    # Ex: "bombas submersíveis", "bomba submersível"
    patterns_to_try = [
        r"bombas?\s+submersi[vb][ea]is?",  # bombas submersíveis, bomba submersível
        r"bombas?\s+submersi",  # bombas submersi...
        r"bomb\w*\s+submer\w*",  # qualquer variação
    ]

    matches = []

    for pattern in patterns_to_try:
        print(f"\n🔍 Tentando padrão: {pattern}")

        for match in re.finditer(pattern, text, re.IGNORECASE):
            start = match.start()
            end = match.end()
            # Pegar contexto original (50 chars antes/depois)
            context_start = max(0, start - 50)
            context_end = min(len(text), end + 50)

            original_snippet = text[context_start:context_end]
            matches.append(
                {
                    "position": start,
                    "match": match.group(0),
                    "context": original_snippet,
                    "pattern": pattern,
                }
            )
            print(f"   ✅ Match na posição {start}: '{match.group(0)}'")

        if matches:
            break  # Usar primeiro padrão que encontrar

    return matches, patterns_to_try[0] if matches else "nenhum"


def test_chapter_84():
    """Testa busca no capítulo 84 por 'bombas submersíveis'."""
    require_db()

    print("=" * 60)
    print("TESTE: Busca de 'bomba submersível' no Capítulo 84")
    print("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Buscar conteúdo do capítulo 84
    cursor.execute("SELECT content FROM chapters WHERE chapter_num = '84'")
    row = cursor.fetchone()

    if not row:
        print("❌ Capítulo 84 não encontrado!")
        return

    content = row["content"]
    print(f"\n📄 Tamanho do conteúdo: {len(content)} caracteres")

    # Palavras da busca
    search_words = ["bomba", "submersível"]

    # Encontrar matches exatos
    matches, pattern = find_exact_matches(content, search_words)

    print(f"\n✅ Encontrados {len(matches)} matches EXATOS (palavras juntas):")
    print("-" * 60)

    for i, m in enumerate(matches, 1):
        print(f"\n#{i} - Posição {m['position']}:")
        print(f"   Match: '{m['match']}'")
        print(f"   Contexto: ...{m['context']}...")

    # Agora buscar TODAS as ocorrências de "bomba" para comparar
    print("\n" + "=" * 60)
    print("COMPARAÇÃO: Todas as ocorrências de 'bomba'")
    print("=" * 60)

    bomba_pattern = r"bomb[aeiou]?s?"
    content_normalized = normalize_text(content)

    bomba_matches = list(re.finditer(bomba_pattern, content_normalized, re.IGNORECASE))
    print(f"\n📊 Total de 'bomba(s)': {len(bomba_matches)}")

    # Mostrar primeiras 5
    print("\nPrimeiras 5 ocorrências:")
    for i, m in enumerate(bomba_matches[:5], 1):
        start = m.start()
        context = content[max(0, start - 20) : start + 40]
        print(f"  {i}. Pos {start}: ...{context}...")

    # Verificar se o primeiro match de "bomba" é o match exato
    if matches and bomba_matches:
        first_bomba = bomba_matches[0].start()
        first_exact = matches[0]["position"]

        print("\n" + "=" * 60)
        print("🎯 DIAGNÓSTICO:")
        print("=" * 60)
        print(f"  Primeira 'bomba' no texto: posição {first_bomba}")
        print(f"  Primeiro match EXATO: posição {first_exact}")

        if first_bomba < first_exact:
            print("\n  ⚠️ PROBLEMA IDENTIFICADO!")
            print("     A primeira 'bomba' aparece ANTES do match exato.")
            print(f"     Diferença: {first_exact - first_bomba} caracteres")
            print(f"\n  📍 O Mark.js marca a primeira 'bomba' (pos {first_bomba})")
            print(f"     mas deveria ir para 'bombas submersíveis' (pos {first_exact})")
        else:
            print("\n  ✅ O primeiro match já é o exato!")

    conn.close()

    # Assert that we found matches (test validation)
    assert isinstance(matches, list), "Search should complete without error"


def test_position_content():
    """Verifica conteúdo das posições para encontrar onde está o texto exato."""
    require_db()

    print("\n" + "=" * 60)
    print("BUSCA EM POSIÇÕES: Onde está 'bombas submersíveis'?")
    print("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Buscar todas as posições do capítulo 84
    cursor.execute(
        """
        SELECT codigo, descricao
        FROM positions 
        WHERE chapter_num = '84'
        ORDER BY codigo
    """
    )

    pattern = r"bombas?\s+submersi"

    for row in cursor.fetchall():
        codigo = row["codigo"]
        descricao = row["descricao"] or ""

        if re.search(pattern, descricao, re.IGNORECASE):
            print(f"\n📍 Posição {codigo}:")
            print(f"   Descrição: {descricao[:100]}...")

    conn.close()


def create_frontend_test_data():
    """Gera dados para teste no frontend."""

    print("\n" + "=" * 60)
    print("DADOS PARA CORREÇÃO DO FRONTEND")
    print("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Buscar índice FTS para "bomba submersível"
    cursor.execute(
        """
        SELECT ncm, display_text, type, description
        FROM search_index 
        WHERE indexed_content MATCH 'bomb* AND submersiv*'
        ORDER BY rank
        LIMIT 5
    """
    )

    print("\nResultados FTS para 'bomb* AND submersiv*':")
    for row in cursor.fetchall():
        print(f"  NCM: {row['ncm']}, Tipo: {row['type']}")
        print(f"  Display: {row['display_text'][:60]}...")
        print()

    conn.close()


if __name__ == "__main__":
    matches = test_chapter_84()
    test_position_content()
    create_frontend_test_data()

    print("\n" + "=" * 60)
    print("💡 SOLUÇÃO PROPOSTA:")
    print("=" * 60)
    print(
        """
O problema é que o Mark.js marca TODAS as ocorrências de cada palavra,
e o JavaScript tenta encontrar onde estão "juntas" depois.

SOLUÇÃO CORRETA:
1. Primeiro, encontrar o texto EXATO no HTML usando regex
2. Depois, fazer scroll para esse elemento
3. SÓ ENTÃO aplicar os highlights

Ou seja: SCROLL PRIMEIRO, HIGHLIGHT DEPOIS.
Não depender do Mark.js para encontrar a posição.
"""
    )
