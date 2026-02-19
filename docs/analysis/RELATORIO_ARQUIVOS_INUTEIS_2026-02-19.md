# Auditoria Ostensiva de Arquivos Inuteis (Seguro + Legado)

Data de referencia: **2026-02-19**

## 1) Resumo executivo

- Escopo aplicado: `Seguro + legado`.
- Total classificado: **42 arquivos**.
- Classe A (`Inutil claro - remocao segura`): **11**.
- Classe B (`Legado sem integracao`): **31**.
- Regra aplicada por item: minimo de 2 evidencias entre:
  - fora do fluxo oficial;
  - obsolescencia/quebra tecnica;
  - hardcode/caminho legado;
  - caracter de script hoc/diagnostico;
  - referencia zero por nome (scan local de 2026-02-19).

## 2) Metodologia e criterios

### 2.1 Criterios de classe

- `Classe A`: inutilidade/quebra objetiva, sem papel no runtime/CI/testes oficiais, com remocao de baixo risco.
- `Classe B`: utilitarios legados de diagnostico/hoc, fora do fluxo oficial, com risco medio por possivel uso manual eventual.

### 2.2 Verificacoes executadas

- Fluxo oficial de testes e exclusoes:
  - `pytest.ini:8`
  - `docs/TESTING.md:36`
- Runtime e comandos oficiais:
  - `README.md:79`
  - `README.md:80`
  - `README.md:81`
  - `README.md:95`
  - `README.md:110`
  - `README.md:240`
  - `start_nesh_dev.bat:134`
  - `start_nesh_dev.bat:139`
  - `start_nesh_dev.bat:148`
- Contratos tecnicos atuais:
  - `backend/services/tipi_service.py:328`
  - `backend/config/settings.py:26`
  - `backend/config/settings.py:27`
  - `client/index.html:6`
- Scan de orfandade por nome (apoio): `rg` em 2026-02-19 com resultado de referencia nominal zero para os candidatos legados mapeados.

## 3) Tabela completa por arquivo

| Arquivo | Classe | Evidencias | Risco de remocao | Acao proposta | Referencias (linha) |
|---|---|---|---|---|---|
| `main.py` | A | E1: placeholder sem runtime real; E2: runtime oficial usa `Nesh.py` | Baixo | Remover no Lote 1 | `main.py:2`, `docs/AI Context/AI_CONTEXT.md:25`, `README.md:95` |
| `scripts/verify_api.py` | A | E1: aponta para teste inexistente em caminho legado; E2: nao consta no fluxo oficial de scripts ativos | Baixo | Remover no Lote 1 | `scripts/verify_api.py:10`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/test_tipi_filter.py` | A | E1: chama API async sem `await`; E2: referencia metodo inexistente `_clean_ncm` | Baixo | Remover no Lote 1 | `scripts/test_tipi_filter.py:10`, `scripts/test_tipi_filter.py:27`, `backend/services/tipi_service.py:328` |
| `scripts/tipi_verification/validate_structure.py` | A | E1: chamadas async sem `await`; E2: script de validacao hoc fora do run oficial | Baixo | Remover no Lote 1 | `scripts/tipi_verification/validate_structure.py:16`, `scripts/tipi_verification/validate_structure.py:22`, `docs/AI Context/AI_CONTEXT.md:46` |
| `scripts/tipi_verification/verify_sequence.py` | A | E1: chamada async sem `await`; E2: script hoc de verificacao sem integracao oficial | Baixo | Remover no Lote 1 | `scripts/tipi_verification/verify_sequence.py:14`, `backend/services/tipi_service.py:328`, `docs/AI Context/AI_CONTEXT.md:46` |
| `scripts/devtools/debug_db_schema.py` | A | E1: usa path absoluto legado de maquina local; E2: devtool fora dos scripts oficiais | Baixo | Remover no Lote 1 | `scripts/devtools/debug_db_schema.py:6`, `scripts/devtools/debug_db_schema.py:7`, `docs/AI Context/AI_CONTEXT.md:46` |
| `scripts/devtools/debug_regex_match.py` | A | E1: hardcode para path absoluto legado; E2: devtool fora dos scripts oficiais | Baixo | Remover no Lote 1 | `scripts/devtools/debug_regex_match.py:5`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/diagnostics/inspect_nesh_content.py` | A | E1: aponta `nesh.db` na raiz; E2: diverge do path canonico configurado | Baixo | Remover no Lote 1 | `scripts/diagnostics/inspect_nesh_content.py:12`, `backend/config/settings.py:26` |
| `scripts/tipi_verification/verify_integrity.py` | A | E1: aponta `tipi.db` na raiz; E2: diverge do path canonico configurado | Baixo | Remover no Lote 1 | `scripts/tipi_verification/verify_integrity.py:10`, `backend/config/settings.py:27` |
| `scripts/tipi_verification/generate_visual_tree.py` | A | E1: aponta `tipi.db` na raiz; E2: diverge do path canonico configurado | Baixo | Remover no Lote 1 | `scripts/tipi_verification/generate_visual_tree.py:7`, `backend/config/settings.py:27` |
| `client/src/assets/react.svg` | A | E1: asset legado do template Vite sem uso no app; E2: favicon real aponta para `vite.svg` | Baixo | Remover no Lote 1 | `client/src/assets/react.svg:1`, `client/index.html:6` |
| `tests/scripts/check_fts_status.py` | B | E1: pasta excluida do run oficial; E2: script diagnostico explicito | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/check_fts_status.py:1` |
| `tests/scripts/debug_tipi_8517_13.py` | B | E1: pasta excluida do run oficial; E2: script de debug explicito | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/debug_tipi_8517_13.py:1` |
| `tests/scripts/debug_tipi_parser.py` | B | E1: pasta excluida do run oficial; E2: script de debug explicito | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/debug_tipi_parser.py:1` |
| `tests/scripts/debug_tipi_search.py` | B | E1: pasta excluida do run oficial; E2: script de debug explicito | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/debug_tipi_search.py:1` |
| `tests/scripts/test_ranking.py` | B | E1: pasta excluida do run oficial; E2: teste scriptado isolado | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/test_ranking.py:1` |
| `tests/scripts/test_regex.py` | B | E1: pasta excluida do run oficial; E2: script de experimento regex | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/test_regex.py:1` |
| `tests/scripts/test_renderer_output.py` | B | E1: pasta excluida do run oficial; E2: teste isolado de renderer | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/test_renderer_output.py:1` |
| `tests/scripts/test_transform_flow.py` | B | E1: pasta excluida do run oficial; E2: debug de pipeline de transformacao | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/test_transform_flow.py:1` |
| `tests/scripts/verify_regression.py` | B | E1: pasta excluida do run oficial; E2: script de verificacao manual por HTTP | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/verify_regression.py:8` |
| `tests/scripts/verify_renderer.py` | B | E1: pasta excluida do run oficial; E2: verificador manual de renderer | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/verify_renderer.py:3` |
| `tests/scripts/verify_setup.py` | B | E1: pasta excluida do run oficial; E2: verificador manual de setup legado | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/verify_setup.py:7` |
| `tests/scripts/verify_tipi_fix.py` | B | E1: pasta excluida do run oficial; E2: verificacao manual direta em SQLite | Medio | Remover no Lote 2 | `pytest.ini:8`, `docs/TESTING.md:36`, `tests/scripts/verify_tipi_fix.py:5` |
| `inspect_databases.py` | B | E1: utilitario de inspecao SQLite manual; E2: nao integra runtime oficial (`Nesh.py`/starter) | Medio | Remover no Lote 2 | `inspect_databases.py:4`, `README.md:95`, `README.md:110` |
| `debug_routes.py` | B | E1: debug manual de rotas com `print`; E2: nao integra runtime oficial | Medio | Remover no Lote 2 | `debug_routes.py:6`, `debug_routes.py:8`, `README.md:95` |
| `debug_redis.py` | B | E1: debug manual de Redis; E2: nao integra runtime oficial | Medio | Remover no Lote 2 | `debug_redis.py:6`, `debug_redis.py:8`, `README.md:95` |
| `debug_middleware.py` | B | E1: teste manual de middleware com app mock; E2: nao integra runtime oficial | Medio | Remover no Lote 2 | `debug_middleware.py:7`, `debug_middleware.py:11`, `README.md:95` |
| `debug_settings_and_db.py` | B | E1: diagnostico manual de settings e DB; E2: nao integra runtime oficial | Medio | Remover no Lote 2 | `debug_settings_and_db.py:6`, `debug_settings_and_db.py:8`, `README.md:95` |
| `check_tables.py` | B | E1: utilitario manual de schema SQLite; E2: nao integra fluxo oficial | Medio | Remover no Lote 2 | `check_tables.py:3`, `check_tables.py:4`, `README.md:95` |
| `check_health.py` | B | E1: check manual por `requests`; E2: health oficial ja documentado por endpoint | Medio | Remover no Lote 2 | `check_health.py:4`, `README.md:121` |
| `scripts/devtools/analyze_repr.py` | B | E1: devtool de analise textual ad hoc; E2: usa `nesh.db` direto fora da config canonica | Medio | Remover no Lote 2 | `scripts/devtools/analyze_repr.py:3`, `backend/config/settings.py:26` |
| `scripts/devtools/check_positions.py` | B | E1: devtool ad hoc para inspecao de posicoes; E2: usa `nesh.db` direto fora da config canonica | Medio | Remover no Lote 2 | `scripts/devtools/check_positions.py:4`, `backend/config/settings.py:26` |
| `scripts/devtools/debug_chapter_content.py` | B | E1: debug ad hoc de conteudo de capitulo; E2: path relativo legado de DB | Medio | Remover no Lote 2 | `scripts/devtools/debug_chapter_content.py:4`, `backend/config/settings.py:26` |
| `scripts/devtools/inspect_db.py` | B | E1: utilitario manual de inspeccao de DB; E2: nao esta na lista de scripts ativos | Medio | Remover no Lote 2 | `scripts/devtools/inspect_db.py:6`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/devtools/inspect_ncm.py` | B | E1: utilitario manual CLI de inspeccao NCM; E2: default usa `../../nesh.db` legado | Medio | Remover no Lote 2 | `scripts/devtools/inspect_ncm.py:8`, `scripts/devtools/inspect_ncm.py:9`, `backend/config/settings.py:26` |
| `scripts/devtools/verify_regex.py` | B | E1: teste regex isolado ad hoc; E2: nao esta na lista de scripts ativos | Medio | Remover no Lote 2 | `scripts/devtools/verify_regex.py:5`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/tipi_verification/check_sort_order.py` | B | E1: simulacao manual em memoria (`items` fixos), sem integracao real; E2: nao esta no fluxo oficial | Medio | Remover no Lote 2 | `scripts/tipi_verification/check_sort_order.py:3`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/debug_search.py` | B | E1: script de benchmark/debug manual; E2: nao consta nos scripts oficiais mapeados | Medio | Remover no Lote 2 | `scripts/debug_search.py:1`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/test_regex.py` | B | E1: experimento de regex isolado; E2: nao consta nos scripts oficiais mapeados | Medio | Remover no Lote 2 | `scripts/test_regex.py:1`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/analyze_tipi_xlsx.py` | B | E1: analise exploratoria manual de planilha; E2: nao consta nos scripts oficiais mapeados | Medio | Remover no Lote 2 | `scripts/analyze_tipi_xlsx.py:1`, `scripts/analyze_tipi_xlsx.py:4`, `docs/AI Context/AI_CONTEXT.md:46` |
| `scripts/CodeExtractor.py` | B | E1: utilitario de consolidacao para dump local (`Scripts results`); E2: nao consta nos scripts oficiais mapeados | Medio | Remover no Lote 2 | `scripts/CodeExtractor.py:8`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |
| `scripts/consolidate_files.py` | B | E1: utilitario de consolidacao local para dump textual; E2: nao consta nos scripts oficiais mapeados | Medio | Remover no Lote 2 | `scripts/consolidate_files.py:5`, `docs/AI Context/AI_CONTEXT.md:46`, `docs/AI Context/AI_CONTEXT.md:52` |

## 4) Plano de remocao por lotes

### Lote 1 (baixo risco) - Classe A inteira

- Remover os 11 itens de Classe A em um commit dedicado.
- Mensagem sugerida: `chore(cleanup): remove arquivos claramente obsoletos/inuteis (lote 1)`.

### Lote 2 (medio risco) - Classe B

- Remover os 31 itens de Classe B em lotes menores por pasta:
  - `tests/scripts/`
  - `scripts/devtools/`
  - `scripts/tipi_verification/check_sort_order.py`
  - utilitarios de raiz e avulsos
- Mensagem sugerida por sublote:
  - `chore(cleanup): remove scripts legados de diagnostico (lote 2.x)`.

### Regra de seguranca para execucao

- Commits pequenos por lote/sub-lote.
- Um commit por conjunto coeso de arquivos.
- Rollback por `git revert <sha>` (nunca por reset destrutivo).

## 5) Estrategia de rollback

- Se remover algo que ainda tinha uso manual:
  - reverter apenas o commit do sub-lote impactado;
  - reintroduzir seletivamente os arquivos necessarios;
  - documentar o motivo no changelog interno.
- Priorizar rollback cirurgico, sem reverter lotes completos sem necessidade.

## 6) Exclusoes explicitas (arquivos ativos que NAO entram)

Estes arquivos **nao** foram classificados como inuteis:

- `scripts/setup_database.py`
- `scripts/setup_fulltext.py`
- `scripts/setup_tipi_database.py`
- `scripts/rebuild_index.py`
- `scripts/migrate_to_postgres.py`
- `start_nesh_dev.bat`
- `Nesh.py`

Base de justificativa:

- `README.md:79`
- `README.md:80`
- `README.md:81`
- `README.md:95`
- `README.md:110`
- `README.md:240`
- `start_nesh_dev.bat:134`
- `start_nesh_dev.bat:139`
- `start_nesh_dev.bat:148`
- `docs/AI Context/AI_CONTEXT.md:46`
- `docs/AI Context/AI_CONTEXT.md:52`

## 7) Testes e cenarios de validacao do proprio relatorio

1. Validar contagem:
   - Classe A = 11
   - Classe B = 31
   - Total = 42
2. Validar exclusao oficial de `tests/scripts/*.py`:
   - `pytest.ini:8`
   - `docs/TESTING.md:36`
3. Validar incompatibilidade async nos 3 scripts TIPI:
   - `scripts/test_tipi_filter.py:10`
   - `scripts/tipi_verification/validate_structure.py:16`
   - `scripts/tipi_verification/verify_sequence.py:14`
   - cruzado com `backend/services/tipi_service.py:328`
4. Validar divergencia de path de banco:
   - `backend/config/settings.py:26`
   - `backend/config/settings.py:27`
5. Validar consistencia do resumo executivo com a tabela (totais e classes).

## 8) Assuncoes e defaults aplicados

1. "Inutil para o sistema" = fora de runtime/CI/testes oficiais e sem integracao documentada.
2. Mencoes em roadmap/contexto nao contam como uso funcional.
3. Ordem de execucao recomendada: Classe A primeiro, Classe B depois.
4. Este relatorio e uma classificacao tecnica; nao remove arquivos automaticamente.
