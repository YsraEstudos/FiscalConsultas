# Fontes de Dados e Ingestao (estado real 2026-02-17)

Este documento cobre fontes, scripts e riscos de consistencia de dados no estado atual.

## 1) Fontes Primarias

### 1.1 NESH

Arquivos possiveis:

- `data/Nesh.txt`
- `data/Nesh.zip` (contendo txt)
- `data/debug_nesh/Nesh.txt` (fonte alternativa usada por rebuild)

Regra observada no setup principal:

- `scripts/setup_database.py` usa prioridade `Nesh.txt > Nesh.zip`.
- o script pode compactar `Nesh.txt` para `Nesh.zip` ao final (economia de espaco).

Formato pratico:

- texto semiestruturado com marcadores de capitulo, notas, secoes e linhas de posicao.

### 1.2 TIPI

- `data/tipi.xlsx`
- parse por `openpyxl` em `scripts/setup_tipi_database.py`

### 1.3 Glossario

- `backend/data/glossary_db.json`
- carga via `backend/data/glossary_manager.py`

## 2) Bancos e Tabelas

### 2.1 SQLite NESH (`database/nesh.db`)

Tabelas principais:

- `chapters`
- `positions`
- `chapter_notes`
- `search_index` (FTS)

### 2.2 SQLite TIPI (`database/tipi.db`)

Tabelas principais:

- `tipi_chapters`
- `tipi_positions`
- `tipi_fts`

### 2.3 PostgreSQL (opcional)

- schema por Alembic (`migrations/versions/*.py`)
- modelos em `backend/domain/sqlmodels.py`

## 3) Scripts de Ingestao (matriz)

| Script | Papel atual | Observacoes |
|---|---|---|
| `scripts/setup_database.py` | Setup principal NESH SQLite | extrai capitulos/posicoes/notas/secoes; precompute `parsed_notes_json` |
| `scripts/setup_fulltext.py` | Cria/atualiza FTS no SQLite NESH | complementar ao setup principal |
| `scripts/setup_tipi_database.py` | Setup principal TIPI SQLite | parse de xlsx + hierarquia + aliquota |
| `scripts/migrate_to_postgres.py` | migracao SQLite -> PostgreSQL | necessario quando muda para engine postgres |
| `scripts/rebuild_index.py` | rebuild alternativo NESH | usa fonte `data/debug_nesh/Nesh.txt`; nao necessariamente igual ao setup principal |
| `scripts/ingest_markdown.py` | fluxo alternativo/legado | usa `raw_data/nesh.md`; regex e regras proprias; reescreve chapters/positions por heuristica |

## 4) Risco Principal: Divergencia de Parser

Hoje ha parsing de NESH em varios lugares com regras diferentes:

- `scripts/setup_database.py`
- `scripts/rebuild_index.py`
- `scripts/ingest_markdown.py`
- runtime (`backend/services/nesh_service.py` + `backend/utils/nesh_sections.py`)

Impacto:

- `parsed_notes_json` precomputado pode divergir do parse em runtime.
- padroes de posicao/nota diferentes produzem payloads diferentes entre ambientes.
- FTS pode ficar inconsistente se pipeline alternativo nao reconstruir `search_index` com a mesma regra esperada pelo runtime.

## 5) Fluxo Recomendado (SQLite local)

```powershell
python scripts/setup_tipi_database.py
$env:PYTHONUTF8="1"; python scripts/setup_database.py
$env:PYTHONUTF8="1"; python scripts/setup_fulltext.py
```

## 6) Fluxo Recomendado (PostgreSQL)

```powershell
docker compose up -d
alembic upgrade head
python scripts/migrate_to_postgres.py
```

Nota:

- o migrador usa `ON CONFLICT DO NOTHING` para inserts em lote.
- ao final, atualiza `search_vector` de `chapters`, `positions` e `tipi_positions`.

## 7) Validacao Minima Pos-Ingestao

1. `GET /api/status` deve retornar `database.status=online` e `tipi.status=online`.
2. Busca de codigo NESH (`/api/search?ncm=8517`) deve retornar `type=code` e `total_capitulos>0`.
3. Busca textual NESH (`/api/search?ncm=bomba`) deve retornar `type=text`.
4. Busca TIPI (`/api/tipi/search?ncm=8413`) deve retornar estrutura com `results/resultados`.

## 8) Decisoes de Governanca de Dados

- Tratar `setup_database.py` + `setup_fulltext.py` como pipeline canonica de SQLite NESH.
- Considerar `rebuild_index.py` e `ingest_markdown.py` como caminhos especiais ate consolidacao do parser central.
- Toda mudanca de regex/parsing deve validar:
  - setup
  - runtime
  - contratos de rota

## 9) Debt de Curto Prazo

1. Unificar parser semantico (NCM/Notas/Secoes) em modulo unico.
2. Remover duplicacao de regras regex em scripts e runtime.
3. Definir status formal de `ingest_markdown.py` (ativo vs legado) no roadmap.
4. Declarar pipeline oficial unico para reconstruir FTS sem ambiguidade (`setup_fulltext.py` vs `rebuild_index.py`).
