# Guia Detalhado: Modelos de Dominio Ricos com Pydantic (Revisado)

## Item do roadmap
`[Backend] Modelos de Dominio Ricos (Pydantic)`

Objetivo deste guia:
- substituir `TypedDict` por modelos Pydantic em `backend/domain/models.py`;
- centralizar validacao e geracao de `anchor_id` no modelo onde fizer sentido;
- estruturar geracao automatica de tipos TypeScript com pre-requisitos reais de rota/OpenAPI.

## O que foi ajustado apos revisao critica
Este plano revisado incorpora explicitamente os pontos de risco encontrados no codigo real:
1. Estrategia de nomes para evitar colisao entre modelos de contrato e ORM.
2. `ServiceResponse` modelado como union discriminada com campos reais (`match_type`, `warning`).
3. Escopo TIPI definido separadamente do NESH.
4. Centralizacao de `anchor_id` restrita ao fluxo de dados de resposta (renderer continua consumidor legitimo de `id_utils`).
5. Ponto exato de validacao definido no hot-path com cache.
6. Delimitacao entre `models.py` (contrato API) e `sqlmodels.py` (ORM + base schemas).
7. `ChapterData` tratado como candidato a deprecacao.
8. Decisao explicita: renderer permanece recebendo `dict` no curto prazo.
9. Estrategia de rigor: `extra="ignore"` no inicio, `extra="forbid"` apenas no hardening final.
10. Justificativa de `model_validator` vs `computed_field` para `anchor_id`.
11. Pre-requisito de `response_model`/`responses` nas rotas para codegen TS.
12. Etapa inicial enxugada e orientada por teste de contrato em vez de burocracia documental excessiva.
13. Estrategia de serializacao para campos `None`.
14. Compatibilidade `results`/`resultados` documentada (NESH e TIPI).
15. Regra de performance: validar somente em construcao de payload (cache miss).

## Estado atual (evidencias do sistema)

### Dominio typed-only
- `backend/domain/models.py` usa `TypedDict` para `Position`, `ChapterData`, `SearchResult`, `ServiceResponse`.
- Isso nao valida runtime e ja esta defasado do shape real em alguns fluxos.

### ORM e schemas coexistindo em outro modulo
- `backend/domain/sqlmodels.py` ja contem `Position` ORM (`table=True`) e response schemas como `PositionRead`, `FTSSearchResponse`, `CodeSearchResponse`.
- Sem delimitacao clara, surgem duas fontes para contratos de API.

### `ServiceResponse` atual nao reflete resposta textual real
- Em NESH text search existem `match_type` e `warning`, mas o `TypedDict` atual nao os descreve.

### `anchor_id` espalhado
- `generate_anchor_id` aparece em service, repositorios e renderer.
- Nem todo uso pode/precisa migrar para modelo (renderer gera IDs de blocos de texto, nao apenas objetos de dominio).

### Frontend sem codegen ativo
- `client/src/types/api.types.ts` e manual.
- Sem `response_model` nas rotas principais, OpenAPI nao entrega schema util para `openapi-typescript`.

## Decisoes de arquitetura (fechadas)

### 1) Estrategia de nomes (critica)
Para evitar colisao semantica com ORM:
- modelos de contrato em `backend/domain/models.py` usar sufixo `Response`/`DTO`.
- exemplos: `NeshPositionResponse`, `TipiPositionResponse`, `CodeSearchResponseNesh`, `TextSearchResponseNesh`.
- `sqlmodels.py` preserva nomes de ORM (`Position`, `TipiPosition`, etc.).

Compatibilidade temporaria:
- `backend/domain/__init__.py` pode exportar aliases legados por um ciclo curto, com comentario `@deprecated`.

### 2) Delimitacao `models.py` vs `sqlmodels.py`
- `models.py`: contratos API (request/response), sem `table=True`.
- `sqlmodels.py`: ORM e schemas de persistencia.
- response schemas duplicados em `sqlmodels.py` devem ser deprecados ou re-exportados de `models.py` no fim da migracao.

### 3) Escopo TIPI
- TIPI fica **in-scope parcial** para contratos de resposta e compatibilidade.
- Nao reutilizar `NeshPositionResponse` para TIPI.
- criar modelo dedicado `TipiPositionResponse` com `ncm`, `codigo`, `descricao`, `aliquota`, `nivel`, `anchor_id`.

### 4) `anchor_id`: regra canonicamente explicita
- `id_utils.generate_anchor_id` continua funcao canonica.
- Modelo de posicao usa validator para preencher `anchor_id` faltante no fluxo de dados de resposta.
- Renderer pode continuar chamando `generate_anchor_id` diretamente para IDs de elementos HTML extraidos do texto.

### 5) Validacao e cache
- Validacao Pydantic ocorre somente na construcao de payload (cache miss).
- Leitura de payload cacheado (`raw/gzip`) nao revalida.

### 6) Serializacao de `None`
- Curto prazo: manter comportamento atual e enviar `null` quando campo existir com `None`.
- Portanto usar `model_dump(exclude_none=False)` nos contratos de resposta, ate decisao de breaking change.

### 7) Rigor progressivo de schema
- Fase inicial: `extra="ignore"` para absorver variacoes ad-hoc existentes.
- Fase final (hardening): `extra="forbid"` apos limpeza e cobertura de testes.

### 8) `model_validator` vs `computed_field`
- Escolha padrao: `model_validator` para suportar `anchor_id` precomputado vindo de banco.
- `computed_field` so se `anchor_id` passar a ser estritamente derivado e imutavel de `codigo`.

### 9) Pre-requisito para codegen TS
- Para `openapi-typescript` funcionar, rotas devem declarar schema de resposta:
  - preferencialmente `response_model=...`; ou
  - `responses={200: {"model": ...}}` se continuar retornando `Response` custom.

## Contratos alvo (Pydantic V2)

### NESH
```python
from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.utils.id_utils import generate_anchor_id

class NeshPositionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    codigo: str
    descricao: str
    anchor_id: Optional[str] = None

    @model_validator(mode="after")
    def fill_anchor(self):
        if not self.anchor_id:
            self.anchor_id = generate_anchor_id(self.codigo)
        return self

class ChapterSectionsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    titulo: Optional[str] = None
    notas: Optional[str] = None
    consideracoes: Optional[str] = None
    definicoes: Optional[str] = None

class SearchResultChapterResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ncm_buscado: str
    capitulo: str
    posicao_alvo: Optional[str] = None
    posicoes: list[NeshPositionResponse] = Field(default_factory=list)
    notas_gerais: Optional[str] = None
    notas_parseadas: dict[str, str] = Field(default_factory=dict)
    conteudo: str
    real_content_found: bool
    erro: Optional[str] = None
    secoes: Optional[ChapterSectionsResponse] = None

class CodeSearchResponseNesh(BaseModel):
    model_config = ConfigDict(extra="ignore")
    success: bool = True
    type: Literal["code"] = "code"
    query: str
    normalized: Optional[str] = None
    results: dict[str, SearchResultChapterResponse] = Field(default_factory=dict)
    resultados: Optional[dict[str, SearchResultChapterResponse]] = None
    total_capitulos: int = 0

class TextSearchResultItemNesh(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ncm: str
    descricao: str
    tipo: str
    relevancia: float
    score: float
    tier: int
    tier_label: str
    near_bonus: Optional[bool] = None

class TextSearchResponseNesh(BaseModel):
    model_config = ConfigDict(extra="ignore")
    success: bool = True
    type: Literal["text"] = "text"
    query: str
    normalized: Optional[str] = None
    match_type: str
    warning: Optional[str] = None
    results: list[TextSearchResultItemNesh] = Field(default_factory=list)
    total_capitulos: int = 0

NeshServiceResponse = Annotated[Union[CodeSearchResponseNesh, TextSearchResponseNesh], Field(discriminator="type")]
```

### TIPI (contrato dedicado)
```python
class TipiPositionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ncm: str
    codigo: str
    descricao: str
    aliquota: str
    nivel: int
    anchor_id: Optional[str] = None
```

## Plano de migracao (executavel)

### Etapa 1 - Contrato real + modelos base (funde baseline e introducao)
1. Motivo:
Resolver rapidamente o gap entre shape real e tipagem antes de espalhar mudanca.
2. Acoes:
- criar modelos Pydantic iniciais em `backend/domain/models.py` com `extra="ignore"`.
- modelar `ServiceResponse` com union discriminada e campos reais (`match_type`, `warning`).
- adicionar testes de contrato que validam respostas reais:
  - `validated = CodeSearchResponseNesh(**raw)`
  - `validated = TextSearchResponseNesh(**raw)`
- classificar `ChapterData`:
  - se nao houver consumo real, marcar `@deprecated` e remover da API publica em etapa final.
3. Criterio de aceite:
- respostas atuais de `search_by_code` e `search_full_text` validam sem alterar shape externo.

### Etapa 2 - Nomeacao, consolidacao e compatibilidade
1. Motivo:
Evitar ambiguidade estrutural entre contrato e ORM.
2. Acoes:
- adotar convencao de nomes `*Response`/`*DTO` em `models.py`.
- revisar `backend/domain/__init__.py` para exportar nomes canonicos e, se necessario, aliases legados temporarios.
- delimitar claramente resposta de `models.py` vs ORM de `sqlmodels.py`.
- registrar deprecacao de response models redundantes em `sqlmodels.py`.
3. Criterio de aceite:
- nenhum conflito de leitura semantica entre `Position` ORM e modelos de resposta.

### Etapa 3 - Centralizar `anchor_id` no fluxo de dados de resposta
1. Motivo:
Reduzir duplicacao sem quebrar uso legitimo no renderer.
2. Acoes:
- preencher `anchor_id` via modelo para objetos de resposta (NESH/TIPI, quando aplicavel).
- manter `id_utils.generate_anchor_id` no renderer para anchors derivados de texto.
- ajustar criterio: proibido set manual de `anchor_id` em construcao de DTOs, permitido no renderer textual.
3. Criterio de aceite:
- services/repositorios deixam de montar `anchor_id` manualmente para DTOs sempre que o modelo puder preencher.

### Etapa 4 - Validacao nas fronteiras e performance com cache
1. Motivo:
Garantir contrato sem degradar hot-path.
2. Acoes:
- validar no service, na construcao do payload antes de serializar/cachear.
- manter retorno externo como `dict` (`model_dump(exclude_none=False)`) para compatibilidade com renderer e rotas atuais.
- nao validar novamente em leitura de payload cacheado.
- manter chaves de compatibilidade `results` e `resultados` (documentar `resultados` como deprecated).
3. Criterio de aceite:
- sem regressao de latencia perceptivel em cache hit.
- payload cache miss validado por Pydantic.

### Etapa 5 - OpenAPI/TypeScript codegen e hardening final
1. Motivo:
Fechar ciclo backend/frontend com schema consistente.
2. Acoes:
- declarar schema de resposta nas rotas relevantes:
  - `response_model=...` ou `responses={200: {"model": ...}}`.
- gerar piloto TS com `openapi-typescript` para `client/src/types/generated/openapi.d.ts`.
- comparar uso real do frontend com tipos gerados.
- so no fim migrar `extra="ignore"` -> `extra="forbid"` e remover aliases legados.
3. Criterio de aceite:
- types gerados sao uteis (nao `any`/`unknown`).
- hardening ativado sem quebrar contrato publico.

## Testes obrigatorios

### Unit
- modelos NESH/TIPI validam payloads reais.
- `anchor_id`:
  - preenche quando ausente;
  - preserva valor precomputado quando presente.

### Integracao
- `search_by_code` e `search_full_text` mantem shape atual esperado.
- fluxo com cache:
  - valida em miss;
  - nao revalida em hit.

### Contrato (substitui snapshot burocratico)
- testes de contrato com Pydantic sao obrigatorios.
- snapshots podem existir como suporte, mas nao sao o principal mecanismo.

### Frontend
- `client` type-check passa com tipos atuais.
- piloto codegen gera contrato coerente com respostas reais.

## Riscos e mitigacoes
1. Colisao de nomenclatura com ORM.
- Mitigacao: convencao `*Response` em `models.py`.

2. Rejeicao de payload por rigidez prematura.
- Mitigacao: iniciar com `extra="ignore"` e endurecer no fim.

3. TIPI quebrar por shape diferente.
- Mitigacao: modelo dedicado TIPI, sem forcar reutilizacao de posicao NESH.

4. Codegen TS inutil por OpenAPI pobre.
- Mitigacao: declarar `response_model`/`responses` antes do piloto.

5. Regressao de latencia.
- Mitigacao: validar apenas em construcao de payload e medir custo em caso com listas grandes.

## Rollback seguro
1. Commits pequenos por etapa.
2. Manter aliases legados temporarios em `domain/__init__.py`.
3. Reverter por modulo sem desmontar toda migracao.
4. Se necessario, manter `extra="ignore"` por mais tempo e postergar hardening.

## Checklist final
- [ ] modelos de contrato Pydantic criados em `backend/domain/models.py` com naming sem colisao.
- [ ] union discriminada de resposta NESH implementada com campos reais.
- [ ] escopo TIPI documentado e, se in-scope, com modelo dedicado.
- [ ] regra de `anchor_id` centralizada para DTOs, com excecao explicita do renderer textual.
- [ ] validacao em cache miss e sem revalidacao em cache hit.
- [ ] rotas com schema de resposta declarado para OpenAPI util.
- [ ] piloto de codegen TS executado e avaliado.
- [ ] hardening final aplicado (`extra="forbid"`) apenas apos estabilizacao.

## Resultado esperado
O backend passa a ter contratos de resposta validados em runtime, sem ambiguidade entre contrato e ORM, com compatibilidade preservada no curto prazo e trilha real para tipos TS sincronizados com a API.
