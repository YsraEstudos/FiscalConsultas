# Guia Gradual: Unificar a Logica de Parsing em `backend/pkg/nesh_parser`

## Titulo do refactor
Unificar regex e parsing de NCM/Notas em um nucleo unico (`backend/pkg/nesh_parser`), com migracao gradual e valida, sem regressao silenciosa de dados.

## Explicacao simples (para quem nao e tecnico)
Hoje, o sistema "entende" o texto em varios pontos diferentes.  
Quando uma regra muda, precisamos ajustar em varios arquivos e isso aumenta risco de erro.  
Com um parser central, a regra e escrita uma vez e reaproveitada em todo lugar.

## O que nao muda para o usuario final
- Endpoints e contrato externo da API.
- Fluxo geral de busca e renderizacao.
- Objetivo da entrega e interno (qualidade e consistencia), nao uma feature nova.

## Ajustes incorporados neste plano (consenso tecnico)
1. Variacoes de regex podem ser intencionais e precisam de decisao, nao "deduplicacao cega".
2. Os scripts usam formatos de entrada diferentes (`txt`, `txt com markdown`, `md puro`).
3. `ingest_markdown.py` pode ser legado e deve ser classificado antes de migrar.
4. `RegexPatterns` em `backend/config/constants.py` nao pode virar segunda fonte da verdade.
5. Parsing de definicao de nota e referencia inline de nota sao coisas diferentes.
6. `backend/utils/nesh_sections.py` precisa entrar explicitamente no escopo.
7. Divergencia entre `_parse_notes_for_precompute` e runtime e risco critico de dados.
8. Contratos de saida devem ser definidos de forma concreta (nao abstrata).
9. Migracao de consumidores deve separar direta vs indireta.
10. `renderer` tem regex semantico (migra) e regex visual (fica no renderer).
11. Criacao de regex e parser deve entrar no mesmo ciclo de entrega (pattern + uso + teste).
12. Regra de reordenacao de secoes do `setup_database.py` e caso especial obrigatorio.
13. Etapa 1 precisa de entregaveis objetivos e mensuraveis.
14. Rollback deve usar wrappers/delegacao para reversao segura.
15. Performance deve preservar pre-compilacao e caches existentes.

## Contexto tecnico consolidado

### Variacoes observadas de pattern de posicao NCM (exemplo real)
| Arquivo | Separadores | Subposicoes |
| --- | --- | --- |
| `scripts/setup_database.py` | `[\-–—]` | nao |
| `scripts/rebuild_index.py` | `-` | nao |
| `scripts/ingest_markdown.py` | `[-–—:]` | sim |
| `backend/presentation/renderer.py` | `[-\u2013\u2014:]` | heading nao / subheading separado |

### Formatos de entrada por script
| Script | Fonte | Formato principal |
| --- | --- | --- |
| `scripts/setup_database.py` | `data/Nesh.txt` ou `.zip` | texto plano |
| `scripts/rebuild_index.py` | `data/debug_nesh/Nesh.txt` | texto com possivel markdown |
| `scripts/ingest_markdown.py` | `raw_data/nesh.md` | markdown puro |

## Escopo semantico do `nesh_parser`

### O que entra no `nesh_parser` (semantica)
- Identificacao de estrutura de capitulo, posicao, subposicao, secao.
- Parsing de notas (definicao da nota).
- Parsing de referencias semanticas (nota/capitulo e codigo NCM em texto).
- Normalizacao de entrada (quando necessario) para suportar formatos diferentes.

### O que permanece no `renderer` (visual)
- Highlighting visual (`EXCLUSION_TERMS`, `MEASUREMENT_UNITS`).
- Regex de formatacao/limpeza visual estritamente de render.
- Conversoes de markdown para HTML.

## Contratos de saida (decisao explicita)
Os parsers centrais devem convergir para contratos unicos:

```python
from dataclasses import dataclass

@dataclass(slots=True)
class ParsedPosition:
    codigo: str
    descricao: str
    anchor_id: str

@dataclass(slots=True)
class ParsedNote:
    numero: str
    conteudo: str

@dataclass(slots=True)
class ParsedSections:
    titulo: str
    notas: str
    consideracoes: str
    definicoes: str

@dataclass(slots=True)
class ParsedChapter:
    numero: str
    content: str
    positions: list[ParsedPosition]
    notes: list[ParsedNote]
    sections: ParsedSections
```

Regra de truncamento: parser nao trunca descricao.  
Truncamento, quando necessario, fica no consumidor de persistencia.

## Estrutura de regex por categoria funcional
`backend/pkg/nesh_parser/regex.py` deve organizar patterns por categoria:
- Deteccao de estrutura:
  - `CHAPTER_HEADER`
  - `POSITION_HEADER`
  - `SUBPOSITION_HEADER`
  - `NOTE_DEFINITION`
  - `SECTION_HEADER`
- Referencias inline:
  - `NOTE_REFERENCE`
  - `NCM_LINK`
- Limpeza semantica:
  - `PAGE_MARKER`
  - `NESH_INTERNAL_REF`
  - `STANDALONE_NCM`

## Relacao `nesh_parser/regex.py` x `RegexPatterns` (fonte unica)
- `backend/pkg/nesh_parser/regex.py` vira a fonte canonica.
- `backend/config/constants.py` mantem `RegexPatterns` como wrapper temporario de retrocompatibilidade.
- Na etapa final, remover wrapper e deixar apenas o import canonico.

## Estrategia para formatos diferentes de entrada (decisao de arquitetura)
Opcao recomendada: **A**.
- A) Parser central normaliza markdown/bold antes dos patterns.
- B) Patterns aceitam simultaneamente texto plano e markdown.
- C) Cada script limpa markdown antes de chamar parser.

Decisao padrao: usar A.  
B so quando A perder informacao importante.  
C apenas como excecao controlada para legado.

## Plano gradual por etapas

### Etapa 1: Diagnostico objetivo + baseline de verdade
1. Motivo para leigo:
Antes de trocar o motor, precisamos medir o carro atual para ter certeza de que o novo nao piora nada.
2. O que sera feito tecnicamente:
- Levantar todos os regex/parsers e divergencias reais.
- Criar matriz de decisao por pattern com dados reais.
- Comparar saida de `_parse_notes_for_precompute` vs `parse_chapter_notes` em capitulos reais.
- Identificar scripts ativos vs legado (incluindo `scripts/ingest_markdown.py`).
- Mapear a logica especial de mover secoes entre capitulos (`scripts/setup_database.py`).
3. Como fazer da melhor forma:
- Entregaveis obrigatorios:
  - Tabela de regex: origem, flags, exemplos match/no-match.
  - Tabela de parser: entrada, saida, consumidores.
  - Diff de saida entre parsers de nota em ao menos 10 capitulos.
  - Snapshot/golden file de ao menos 5 capitulos representativos.
  - Decisao documentada para cada divergencia.
4. Como validar que deu certo:
- Todos os entregaveis acima existem em docs versionados.
- Divergencias de parser de nota estao explicitas e aprovadas.
- `ingest_markdown.py` classificado como ativo ou legado.

### Etapa 2: Criar `regex.py` e `parser.py` juntos (unidade coesa)
1. Motivo para leigo:
Nao adianta criar apenas "a tabela" sem criar "o manual de uso". Os dois nascem juntos.
2. O que sera feito tecnicamente:
- Criar `backend/pkg/nesh_parser/regex.py` e `backend/pkg/nesh_parser/parser.py` no mesmo ciclo.
- Implementar parsing semantico com base nos contratos de saida.
- Incorporar `backend/utils/nesh_sections.py` no parser central (ou re-export temporario com plano de remocao).
- Cobrir explicitamente:
  - `NOTE_DEFINITION` (conteudo da nota).
  - `NOTE_REFERENCE` (referencia inline no texto).
3. Como fazer da melhor forma:
- Cada pattern entra junto da funcao que o usa e do teste correspondente.
- Patterns compilados no nivel do modulo.
- Patterns dinamicos seguem cache controlado (manter estrategia tipo `lru_cache` onde aplicavel).
4. Como validar que deu certo:
- Existe rastreabilidade 1:1 entre pattern, parser e teste.
- Parsers novos reproduzem baseline aprovado da etapa 1.
- Nao ha dependencia circular entre parser e renderer.

### Etapa 3: Migrar consumidores backend (direto e indireto)
1. Motivo para leigo:
Com a central pronta, os sistemas precisam comecar a consumir a central sem desligar o antigo de imediato.
2. O que sera feito tecnicamente:
- Migracao direta:
  - `backend/services/nesh_service.py`
  - `backend/presentation/renderer.py` (apenas parte semantica)
- Migracao indireta:
  - `backend/utils/ncm_utils.py` vira wrapper/delegacao para `nesh_parser`.
  - `backend/services/tipi_service.py` e `backend/presentation/routes/search.py` migram via `ncm_utils`.
- `backend/config/constants.py` passa a delegar patterns para `nesh_parser` (wrapper temporario).
3. Como fazer da melhor forma:
- Commits pequenos por consumidor.
- Preservar caminhos antigos com delegacao para rollback rapido.
- No renderer, manter regex visual no proprio renderer.
4. Como validar que deu certo:
- Consumidores diretos chamam parser central.
- Consumidores indiretos continuam estaveis via wrapper.
- Contratos e testes de rota/servico permanecem verdes.

### Etapa 4: Migrar scripts ativos e tratar legado
1. Motivo para leigo:
Se o sistema online e os scripts de carga usam regras diferentes, os dados entram errados mesmo com backend correto.
2. O que sera feito tecnicamente:
- Migrar scripts ativos para `nesh_parser`:
  - `scripts/setup_database.py`
  - `scripts/rebuild_index.py`
- Para `scripts/ingest_markdown.py`:
  - se ativo: migrar;
  - se legado: marcar deprecated, remover do escopo ativo e documentar.
- Centralizar a regra de reordenacao de secoes entre capitulos no parser central (se aplicavel aos fluxos ativos).
3. Como fazer da melhor forma:
- Comparar saida antes/depois com fixtures reais.
- Evitar refactor paralelo fora de parsing.
- Registrar claramente decisoes de legado.
4. Como validar que deu certo:
- Scripts ativos usam parser central.
- Saidas de ingestao mantem consistencia com baseline aprovado.
- Status de `ingest_markdown.py` esta documentado (ativo/deprecated).

### Etapa 5: Hardening de consistencia de dados e performance
1. Motivo para leigo:
Depois da migracao, precisamos garantir que os dados pre-calculados e os dados em tempo real continuam falando a mesma lingua.
2. O que sera feito tecnicamente:
- Garantir unica implementacao de parsing de nota para ingestao e runtime.
- Eliminar risco de divergencia em `parsed_notes_json`.
- Medir impacto de performance e preservar estrategias:
  - pre-compilacao de regex em modulo;
  - cache para patterns dinamicos.
3. Como fazer da melhor forma:
- Rodar comparacoes batch em capitulos reais.
- Validar latencia de caminhos criticos de busca/render.
- Corrigir regressao de performance antes da limpeza final.
4. Como validar que deu certo:
- `parsed_notes_json` e parsing runtime convergem nos mesmos capitulos.
- Metricas de performance ficam dentro do baseline aceitavel.
- Nenhum cache critico foi removido sem substituto equivalente.

### Etapa 6: Limpeza final e fechamento de transicao
1. Motivo para leigo:
Quando tudo esta estavel, removemos pecas antigas para evitar que voltem por acidente.
2. O que sera feito tecnicamente:
- Remover wrappers temporarios e codigo duplicado remanescente.
- Remover/arquivar componentes legados aprovados.
- Consolidar documentacao final de extensao do parser.
3. Como fazer da melhor forma:
- Limpeza apenas apos aceite completo das etapas anteriores.
- Remover em lotes pequenos com teste a cada lote.
- Registrar no changelog interno o que foi removido.
4. Como validar que deu certo:
- `backend/pkg/nesh_parser` e a unica autoridade de parsing/regex semantico.
- `RegexPatterns` wrapper removido (ou explicitamente mantido com motivo formal).
- Suite de regressao completa aprovada.

## Riscos e mitigacoes (com criticidade)
- Critico: divergencia entre parser de ingestao e runtime para notas.
  - Mitigacao: funcao unica de parse_notes usada em ambos os lados.
- Alto: padrao canonico escolhido sem dados reais.
  - Mitigacao: matriz de decisao por pattern com falsos positivos/negativos.
- Alto: parser central cobrir apenas um formato de entrada.
  - Mitigacao: estrategia de normalizacao formal (A/B/C) com testes por fonte.
- Medio: regressao de performance por recompilacao/caches removidos.
  - Mitigacao: pre-compilacao em modulo + cache para dinamicos + benchmark.
- Medio: escopo inflado por script legado.
  - Mitigacao: classificar legado na etapa 1 e migrar apenas ativos.

## Plano de rollback seguro (nao generico)
1. Manter modulos antigos funcionais ate a etapa 6.
2. Usar delegacao/wrapper durante a transicao:
   - `ncm_utils` delega ao `nesh_parser`.
   - `RegexPatterns` delega ao `nesh_parser`.
3. Se falhar um consumidor, desativar a delegacao daquele ponto sem perder restante da migracao.
4. Reverter por modulo/feature, nao apenas por "PR inteiro", para evitar mismatch runtime x script.

## Checklist final de conclusao
- [ ] Matriz de decisao de regex concluida e aprovada.
- [ ] Estrategia de normalizacao de entrada documentada (A/B/C) com decisao final.
- [ ] `backend/pkg/nesh_parser/regex.py` e `backend/pkg/nesh_parser/parser.py` entregues no mesmo ciclo com testes.
- [ ] Contratos de saida do parser formalizados e adotados.
- [ ] `backend/utils/nesh_sections.py` incorporado ou re-exportado com plano de remocao.
- [ ] Migracao direta concluida (`NeshService`, parte semantica do `renderer`).
- [ ] Migracao indireta concluida (`ncm_utils` delegando; impacto em `TipiService` e `routes/search` validado).
- [ ] Scripts ativos migrados; `ingest_markdown.py` classificado e tratado.
- [ ] Consistencia `parsed_notes_json` x runtime comprovada.
- [ ] Performance validada sem regressao material.
- [ ] Wrappers temporarios removidos (ou mantidos por decisao formal registrada).

## Resultado esperado
Ao final, o projeto passa a ter uma unica logica semantica de parsing, com menor risco de inconsistencias entre ingestao, runtime e renderizacao, e com caminho seguro de manutencao e rollback.
