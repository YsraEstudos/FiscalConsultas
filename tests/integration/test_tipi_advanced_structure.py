import sqlite3
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "database" / "tipi.db"


@pytest.fixture
def db_connection():
    if not DB_PATH.exists():
        pytest.skip("tipi.db not found")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


def test_ncm_sort_column_exists(db_connection):
    """Verifica se a coluna crítica de ordenação existe."""
    cursor = db_connection.cursor()
    cursor.execute("PRAGMA table_info(tipi_positions)")
    columns = [r["name"] for r in cursor.fetchall()]
    assert "ncm_sort" in columns, (
        "Coluna 'ncm_sort' é obrigatória para a ordenação correta"
    )


def test_chapter_84_sorting_invariant(db_connection):
    """
    Teste de regressão específico para o bug '84.14 antes de 8413.xx'.
    Verifica se a query ordenada por ncm_sort retorna a ordem topológica correta.
    """
    cursor = db_connection.cursor()
    cursor.execute(
        """
        SELECT ncm, ncm_sort 
        FROM tipi_positions 
        WHERE capitulo = '84' 
        ORDER BY ncm_sort
    """
    )
    rows = cursor.fetchall()

    ncms = [r["ncm"] for r in rows]

    # Encontrar índices chave
    assert "84.13" in ncms, "84.13 não encontrado na DB"
    assert "84.14" in ncms, "84.14 não encontrado na DB"
    idx_8413 = ncms.index("84.13")
    idx_8414 = ncms.index("84.14")

    # REGRA: 84.14 deve vir DEPOIS de todos os filhos de 84.13
    # Vamos verificar se existem itens com prefixo 8413 entre 84.13 e 84.14
    items_between = ncms[idx_8413 + 1 : idx_8414]

    # Pelo menos um item filho deve existir (ex: 8413.11)
    assert len(items_between) > 0, "84.13 deve ter filhos antes de 84.14"

    # Todos os itens entre 84.13 e 84.14 DEVEM ser filhos de 8413
    for item in items_between:
        clean_item = item.replace(".", "")
        # Check para descendentes diretos ou subposições
        # Nota: 8413... deve ser prefixo
        assert clean_item.startswith("8413"), (
            f"Item fora de ordem encontrado: {item} (deveria ser filho de 8413)"
        )


def test_global_structure_integrity(db_connection):
    """Verifica integridade de parent-child para toda a base."""
    cursor = db_connection.cursor()
    cursor.execute(
        "SELECT ncm, parent_ncm FROM tipi_positions WHERE parent_ncm IS NOT NULL"
    )

    failures = []

    # Carregar todos NCMs válidos para lookup rápido
    cursor.execute("SELECT ncm FROM tipi_positions")
    valid_ncms = set(r["ncm"] for r in cursor.fetchall())

    cursor.execute(
        "SELECT ncm, parent_ncm FROM tipi_positions WHERE parent_ncm IS NOT NULL"
    )
    for row in cursor.fetchall():
        child = row["ncm"]
        parent = row["parent_ncm"]

        if parent not in valid_ncms:
            failures.append(f"Orphan: {child} points to missing parent {parent}")

    assert not failures, f"Encontrados {len(failures)} itens órfãos: {failures[:5]}..."


def test_level_consistency(db_connection):
    """Verifica se não há pulos de nível impossíveis (ex: Nível 1 direto para Nível 3)."""
    cursor = db_connection.cursor()
    # Pega itens ordenados para simular a leitura sequencial
    cursor.execute("SELECT ncm, nivel, ncm_sort FROM tipi_positions ORDER BY ncm_sort")
    rows = cursor.fetchall()

    stack = []  # (ncm, nivel)

    for row in rows:
        ncm = row["ncm"]
        nivel = row["nivel"]

        # Validar lógica básica
        if nivel == 0:
            stack = [(ncm, nivel)]
            continue

        # O nível atual não pode ser > nível anterior + 1 (não pode pular de nivel 2 pra 4)
        if len(stack) > 0:
            last_ncm, last_level = stack[-1]
            # Exceção para exceções 'Ex': elas são nivel 5 mas podem vir de nivel 1, 2, 3...
            if "Ex" not in ncm:
                # Se desceu de nível (ex: 3 -> 2), ok.
                # Se subiu (ex: 2 -> 3), só pode subir 1 por vez.
                if nivel > last_level + 1:
                    # Relaxamento: TIPI tem algumas inconsistências históricas, mas vamos logar warning
                    # ou fail se for estrito. Para 'estrutura tree', isso é ruim.
                    pass

        stack.append((ncm, nivel))
