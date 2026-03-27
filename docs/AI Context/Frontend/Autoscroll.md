# Autoscroll e Sincronizacao de Navegacao

Documento vivo do comportamento atual do autoscroll no frontend.

## Componentes envolvidos

- `client/src/components/ResultDisplay.tsx`
- `client/src/hooks/useRobustScroll.ts`
- `client/src/components/Sidebar.tsx`
- `client/src/hooks/useSearch.ts`
- `client/src/App.tsx`

## Fluxo atual

1. `useSearch` conclui uma busca e marca a aba como `isNewSearch=true`.
2. `ResultDisplay` renderiza o markup do resultado.
3. Durante a renderizacao, `ResultDisplay` separa tres estados diferentes:
   - `isContentReady`: o conteudo ja pode ser exibido na aba.
   - `isFullyRendered`: todos os chunks ja foram anexados ao DOM.
   - `isTargetReady`: pelo menos um candidato real de anchor ja existe no container.
4. `useRobustScroll` so e ativado quando:
   - a aba esta ativa
   - a busca ainda e nova
   - o resultado nao esta sob scroll prioritario do `SearchHighlighter`
   - `isTargetReady=true`
5. Em sucesso, `onComplete(true)` consome `isNewSearch` uma unica vez e persiste o `scrollTop` final.

## Papel do `ResultDisplay`

### Candidatos de anchor

`ResultDisplay` deriva candidatos estaveis com `useMemo` a partir de:

- `anchor_id` vindo de `resultados`
- `posicao_alvo`
- variacoes derivadas do NCM consultado

O componente nao depende mais apenas de `isContentReady` para liberar o scroll.

### Preparacao de anchors

Antes de tentar autoscroll, `ResultDisplay` prepara o DOM:

- garante anchors de secoes estruturadas (`chapter-<capitulo>-<secao>`)
- tenta resolver fallback por `data-ncm` no mesmo fluxo
- aceita `data-ncm` em formatos digit-only e com pontos quando necessario

Esse preparo acontece no mesmo passo que calcula `isTargetReady`.

### Render chunked

Para payloads grandes:

- o primeiro chunk sobe `isContentReady=true`
- os chunks restantes entram via `requestIdleCallback` ou fallback equivalente
- `isTargetReady` continua `false` enquanto o anchor ainda nao existe
- quando o chunk com o alvo entra no DOM, o observer local do `ResultDisplay` atualiza `isTargetReady=true`

Resultado: a UI pode aparecer cedo, mas o autoscroll nao dispara antes do anchor real existir.

## Papel do `useRobustScroll`

### Contrato

- recebe `targetId` como string ou lista de candidatos
- procura o melhor match por prioridade de tag
- executa `scrollIntoView`
- aplica highlight temporario
- chama `onComplete(true)` apenas quando o scroll foi concluido com sucesso

### Logging

Miss inicial de alvo agora e tratado como estado transitorio:

- loga em `debug.log`
- nao emite warning nesse momento

Warning ficou reservado para falha real:

- se nenhum alvo aparecer ate o timeout do observer, emite `debug.warn("[RobustScroll] Timed out waiting for target.")`

### Observer

O `MutationObserver` do hook agora observa apenas:

- `childList`
- `subtree`

Nao observamos mais `attributes`, porque isso so adicionava ruido e nao ajudava no caso real do `84.08`.

## Invariantes que continuam valendo

1. `isNewSearch` so pode ser consumido apos scroll automatico bem-sucedido.
2. Restauracao de `scrollTop` de abas antigas nao pode competir com scroll de busca nova.
3. Clique manual na `Sidebar` continua funcionando independentemente do autoscroll de busca.
4. `activeAnchorId` continua sendo alimentado por scroll spy e usado para highlight na navegacao.
5. O fallback por `data-ncm` continua existindo, mas fica concentrado em `ResultDisplay`, nao espalhado pelo hook.

## Testes relevantes

- `client/tests/unit/useRobustScroll.test.tsx`
  - nao avisa no miss inicial transitorio
  - avisa apenas no timeout real
- `client/tests/unit/ResultDisplay.advanced.test.tsx`
  - so habilita autoscroll quando o alvo existe
  - cobre fallback por `data-ncm`
  - cobre render chunked com alvo em chunk posterior
- `client/tests/integration/NcmScroll.test.tsx`
  - cobre o comportamento real de scroll para NCMs e headings validos

## Resumo operacional

- `isContentReady` significa "o conteudo apareceu"
- `isTargetReady` significa "o anchor certo existe e o autoscroll pode rodar"
- `useRobustScroll` continua sendo o executor do scroll e do timeout final
- o warning residual de "NO TARGET" no caso feliz nao faz mais parte do comportamento esperado
