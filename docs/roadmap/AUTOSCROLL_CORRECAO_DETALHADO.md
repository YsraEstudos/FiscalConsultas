# Autoscroll: Analise Completa + Plano de Correcao

## Objetivo funcional
Na primeira busca, o conteudo deve abrir ja posicionado no NCM alvo, sem animacao visivel de scroll.

## Escopo analisado no codigo real
- `client/src/hooks/useRobustScroll.ts`
- `client/src/components/ResultDisplay.tsx`
- `client/src/components/Sidebar.tsx`
- `client/src/App.tsx`
- `backend/presentation/renderer.py`
- `backend/presentation/tipi_renderer.py`
- `backend/utils/id_utils.py`
- `client/src/styles/features/nesh.css`
- `client/src/styles/features/tipi.css`
- `client/src/components/ResultDisplay.module.css`
- `client/tests/unit/useRobustScroll.test.tsx` (impacto em testes)

## O que eu concordo do relatorio

### 1) `useRobustScroll.ts` precisa de reescrita estrutural
Concordo.

Evidencias no estado atual:
- multiplas tentativas com `scrollIntoView` + timeouts (100/400/700ms);
- timers de 100ms/400ms nao sao rastreados para cleanup;
- observer observa `attributes` desnecessariamente;
- `onComplete` esta nas deps do effect principal;
- `TAG_PRIORITY` esta dentro do hook (recriado por render).

Impacto:
- scroll visivel na primeira busca;
- risco de timers orfaos e efeitos concorrentes;
- custo extra de observacao de mutacoes.

### 2) `targetId` em `ResultDisplay.tsx` via `useEffect` + `setState` cria janela de corrida
Concordo.

Evidencia:
- `targetId` e estado derivado de `data`/`codeResults`.
- ha render intermediario onde `isContentReady` pode estar `true` com `targetId` ainda antigo.

Recomendacao:
- `targetId` derivado por `useMemo`.

### 3) Fallback `data-ncm` imperativo em `ResultDisplay.tsx` deve sair do componente
Concordo.

Evidencia:
- effect que muta DOM e ainda faz `setTargetId`.
- melhor centralizar toda estrategia de localizacao no proprio hook de scroll.

### 4) Race condition entre auto-scroll e restore de `initialScrollTop`
Concordo.

Evidencia:
- `handleAutoScrollComplete` consome flag de nova busca.
- outro effect restaura scroll quando `isNewSearch` fica `false`.
- sem guarda temporal, pode haver sobrescrita do scroll final.

### 5) `Sidebar.tsx`: highlight de busca conflita com highlight de ancora ativa
Concordo.

Evidencia:
- um unico estado `highlightedIndex` e usado para dois fluxos com semantica diferente (busca temporaria e sincronizacao por ancora).

### 6) `renderer.py` nao renderiza IDs de secoes esperados pela sidebar
Concordo.

Evidencia:
- sidebar navega para `chapter-{cap}-notas|consideracoes|definicoes`.
- renderer backend atual so garante `cap-{cap}` e anchors de posicoes; notas entram em `.regras-gerais` sem ID de secao estruturada.

### 7) `tipi_renderer.py` ordena capitulos como string
Concordo.

Evidencia:
- `sorted(..., key=lambda kv: str(kv[0]))`.

### 8) `backend/utils/id_utils.py` sem idempotencia
Concordo.

Evidencia:
- backend sempre prefixa `pos-`; se entrada ja vier com prefixo, vira `pos-pos-...`.
- frontend ja esta idempotente; backend deve alinhar.

### 9) CSS com `scroll-margin-top` sem fallback explicito
Concordo parcialmente.

Observacao:
- hoje existe `--scroll-offset` global em `client/src/styles/_variables.css`.
- ainda vale adicionar fallback local em regras criticas para robustez (`var(--scroll-offset, 80px)`).

### 10) `will-change: transform` em massa em `tipi.css`
Concordo.

Evidencia:
- `article.tipi-position` aplica `will-change` sempre.
- com listas grandes, pode inflar memoria/compositor sem ganho proporcional.

## O que eu ajustaria no relatorio (nao descarto, mas refino)

### A) `scrollInstant` deve usar geometria por `getBoundingClientRect`, nao soma de `offsetTop`
Motivo:
- cadeia `offsetParent` pode falhar em layouts com wrappers transformados/virtualizados.

Forma recomendada:
- `targetScroll = elementRect.top - containerRect.top + container.scrollTop - offset`.

### B) `handleNavigate` pode continuar `smooth`
Motivo:
- requisito de "sem animacao" e para primeira busca automatica.
- navegacao manual por clique na sidebar pode permanecer suave por UX.

### C) fallback `data-ncm` deve normalizar formatos
Motivo:
- `data-ncm` pode estar em formatos diferentes (com ponto/sem ponto).
- o fallback deve testar representacoes equivalentes antes de desistir.

### D) nao assumir "40% mais leve" sem benchmark local
Motivo:
- manter afirmacoes mensuraveis evita overclaim.

## Melhorias adicionais que eu adicionaria

### 1) Correcao critica no `App.tsx` (assinatura de callback)
Problema atual:
- `ResultDisplay` chama `onConsumeNewSearch(tabId, finalScrollTop)`.
- no `App.tsx`, callback foi declarado como `(_finalScroll) => ...`.
- na pratica, primeiro argumento recebido e `tabId` (string), nao scroll.

Impacto:
- persistencia de `scrollTop` final pode falhar.

Correcao:
- ajustar assinatura para `(incomingTabId, finalScrollTop) => ...` e usar `finalScrollTop`.

### 2) Atualizar testes apos trocar `scrollIntoView` por `scrollTop` direto
Impacto esperado:
- `client/tests/unit/useRobustScroll.test.tsx` hoje valida chamada de `scrollIntoView`.
- precisa passar a validar `container.scrollTop` e callback de sucesso/falha.

### 3) Guardar refs estaveis para callbacks no hook
Mesmo ajuste sugerido no relatorio:
- `onCompleteRef`, `expectedTagsRef`.
- evita rerun do effect principal por identidade de funcao/array.

### 4) Critico de desempenho: validar apenas em cache miss (lado backend ja alinhado por desenho)
Relacionamento com auto-scroll:
- manter render rapido para nao atrasar momento do primeiro posicionamento.
- evitar trabalho extra em hot-path.

### 5) Alinhar backend renderer e fallback frontend (`NeshRenderer`)
Motivo:
- fallback frontend ja gera IDs de secoes (`chapter-{cap}-notas` etc).
- backend deve gerar os mesmos IDs para consistencia e reduzir caminhos divergentes.

## Plano objetivo de implementacao

### Etapa 1 - Hook de scroll
- reescrever `useRobustScroll` para:
  - `scrollTop` direto (instantaneo);
  - 1 confirmacao via rAF;
  - observer somente `childList/subtree`;
  - cleanup total de timers/rAF;
  - fallback por `data-ncm` interno ao hook.

Critério de aceite:
- primeira busca abre no alvo sem animacao perceptivel.

### Etapa 2 - ResultDisplay
- trocar `targetId` para `useMemo`;
- remover effect de fallback `data-ncm` do componente;
- adicionar guarda temporal contra conflito com restore;
- corrigir callback de consumo no `App.tsx`.

Critério de aceite:
- sem corrida entre auto-scroll e restore;
- scroll final persistido corretamente.

### Etapa 3 - Sidebar
- separar estados:
  - `scrollHighlightIndex` (persistente por ancora);
  - `searchHighlightIndex` (temporario por busca).

Critério de aceite:
- highlight nao "pisca/some" de forma incorreta durante sincronizacao.

### Etapa 4 - Backend renderer + TIPI + utilitarios
- `renderer.py`: IDs de secoes estruturadas + ordenacao numerica em `render_full_response`;
- `tipi_renderer.py`: ordenacao numerica;
- `backend/utils/id_utils.py`: idempotencia.

Critério de aceite:
- sidebar encontra sempre targets de secao e capitulo.

### Etapa 5 - CSS
- adicionar fallback de `scroll-margin-top` nas regras criticas;
- remover `will-change` global de `article.tipi-position` e aplicar apenas quando necessario (hover/interacao).

Critério de aceite:
- alvo nao fica escondido sob header;
- sem inflacao desnecessaria de memoria em listas grandes.

### Etapa 6 - Testes de regressao
- atualizar testes unit/integration para nova estrategia de scroll instantaneo;
- adicionar teste de race auto-scroll vs restore;
- adicionar teste de navegacao para IDs de secao.

## Checklist final
- [ ] primeira busca posiciona instantaneamente no target sem animacao visivel;
- [ ] nenhum timer/rAF fica orfao no hook;
- [ ] callback `onConsumeNewSearch` persistindo scroll final corretamente;
- [ ] sidebar navegando para `chapter-{n}-notas|consideracoes|definicoes`;
- [ ] backend e fallback frontend gerando IDs de secao consistentes;
- [ ] ordenacao numerica de capitulos em NESH/TIPI;
- [ ] testes ajustados para `scrollTop` direto e novos cenarios de corrida.
