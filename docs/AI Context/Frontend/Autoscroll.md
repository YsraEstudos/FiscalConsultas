# Autoscroll e Sincronizacao de Navegacao (estado real 2026-02-17)

Este documento descreve como o autoscroll funciona hoje no frontend e onde estao os riscos reais.

## 1) Componentes envolvidos

- `client/src/hooks/useRobustScroll.ts`
- `client/src/components/ResultDisplay.tsx`
- `client/src/hooks/useSearch.ts`
- `client/src/components/Sidebar.tsx`
- `client/src/App.tsx`

## 2) Fluxo atual de auto-scroll

1. Busca termina em `useSearch` e marca `isNewSearch=true` na aba.
   - no caso "mesmo capitulo", `useSearch` pode pular fetch e atualizar so `results.query`.
2. `ResultDisplay` renderiza/inyecta markup no container.
3. Quando `isContentReady=true`, calcula candidatos de `targetId`.
4. `useRobustScroll` roda se:
   - aba ativa
   - `isNewSearch=true`
   - `isContentReady=true`
   - resposta de `type!="text"`
5. Em sucesso, callback deve consumir `isNewSearch` e persistir scroll final.

## 3) Como `useRobustScroll` funciona hoje

### 3.1 Localizacao do alvo

- aceita `targetId` string ou lista de candidatos.
- busca elementos por `#id` dentro do container.
- escolhe melhor candidato por prioridade de tag.

Prioridade atual no codigo:

- `H6` (130), `H5` (120), `H4` (110), `H3` (100), `H2` (90), `H1` (80), `ARTICLE` (70), `SECTION` (60), `DIV` (50).

### 3.2 Estrategia de scroll

- `scrollIntoView({ behavior: 'auto', block: 'start' })`
- retries adicionais:
  - `requestAnimationFrame`
  - `setTimeout` 100ms
  - `setTimeout` 400ms
  - `setTimeout` 700ms
- fallback com `MutationObserver` (ate 5s).

### 3.3 Observacao de DOM

Observer monitora:

- `childList`
- `subtree`
- `attributes` (`id`, `class`)

## 4) Papel de `ResultDisplay` no autoscroll

### 4.1 Calculo de alvo

- tenta `anchor_id` vindo de `results/resultados`.
- tenta `posicao_alvo`.
- gera variacoes de ID por heuristica de digitos.
- possui fallback que injeta `id` via elemento `data-ncm` se nenhum alvo for encontrado.

### 4.2 Persistencia/restauracao

- persiste `scrollTop` quando aba fica inativa.
- restaura `initialScrollTop` quando aba volta ativa e `isNewSearch=false`.
- ignora restauracao durante nova busca para priorizar autoscroll.

### 4.3 Render chunked

Para payloads grandes:

- divide por `<hr>`.
- renderiza primeiro chunk imediatamente.
- chunks restantes via `requestIdleCallback`/`setTimeout`.
- `isContentReady` sobe apos primeiro chunk.
- se aba estiver inativa, o markup pode ser limpo e re-renderizado ao voltar ativa.

## 5) Sidebar e scroll spy

- `ResultDisplay` usa `IntersectionObserver` para calcular `activeAnchorId`.
- `Sidebar` recebe `activeAnchorId` e destaca item correspondente.
- sidebar tambem faz autoscroll proprio por query usando `react-virtuoso`.

## 6) Problemas conhecidos (importante)

### 6.1 Bug de callback entre `ResultDisplay` e `App`

- contrato esperado em `ResultDisplay`: `onConsumeNewSearch(tabId, finalScrollTop?)`.
- implementacao em `App` trata callback como se recebesse apenas `_finalScroll`.

Impacto:

- consumo de `isNewSearch` e persistencia de scroll podem ficar incorretos.

### 6.2 Estrategia agressiva de retries/timers

- multiplos `setTimeout` e observer com `attributes` podem causar ruido em cenarios de DOM pesado.

### 6.3 Fallback de injecao de `id` no DOM

- manipula DOM apos render para forcar target.
- aumenta complexidade e pode mascarar problema de contrato de IDs na origem.

### 6.4 Prioridade de tags invertida vs expectedTags

- `TAG_PRIORITY` favorece `H6 > H5 > ... > H1`.
- `expectedTags` passados por `ResultDisplay` favorecem heading alto nivel (`H1-H4`).
- combinacao atual pode selecionar alvo menos intuitivo quando existem IDs duplicados.

## 7) Contrato que nao pode quebrar

1. IDs de anchor precisam permanecer estaveis (`pos-...`).
2. `isNewSearch` deve ser consumido apenas apos scroll bem-sucedido.
3. restauracao de scroll nao pode competir com auto-scroll da mesma busca.
4. classe `.smart-link` e atributos `data-ncm`/`data-note` devem continuar consistentes.

## 8) Testes relacionados

- `client/tests/unit/useRobustScroll.test.tsx`
- `client/tests/unit/ResultDisplay.test.tsx`
- `client/tests/integration/NcmScroll.test.tsx`
- `client/tests/integration/TabScrollPersistence.test.tsx`
- `client/tests/integration/SameChapterNavigation.test.tsx`

## 9) Refatoracao recomendada (ordem)

1. corrigir assinatura de `onConsumeNewSearch` no `App.tsx`.
2. simplificar `useRobustScroll` para uma estrategia unica de posicionamento + confirmacao curta.
3. mover fallback `data-ncm` para contrato de render/anchor (evitar mutacao tardia).
4. separar highlight temporario de busca e highlight de anchor ativa na `Sidebar`.
