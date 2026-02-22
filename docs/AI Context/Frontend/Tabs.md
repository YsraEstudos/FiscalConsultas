# Sistema de Abas: arquitetura, fluxo e pontos de interferencia (estado real 2026-02-21)

Este documento descreve em detalhes como o sistema de abas funciona no frontend hoje, quais arquivos controlam cada parte e onde mudancas em abas impactam outros fluxos (busca, scroll, sidebar, notas, contexto NESH/TIPI, modais e testes).

## 1) Escopo

Cobertura deste guia:

- ciclo de vida das abas (criar, ativar, fechar, reordenar)
- estado por aba e contrato entre componentes
- integracao com busca (`useSearch`) e renderizacao (`ResultDisplay`)
- persistencia/restauracao de scroll por aba
- comportamentos cross-doc (NESH/TIPI) que abrem nova aba automaticamente
- testes que protegem regressoes relacionadas a abas

Fora de escopo:

- regras de negocio da API backend
- detalhes internos de parser/render NESH/TIPI sem relacao direta com ciclo de abas

## 2) Mapa dos arquivos principais

- `client/src/hooks/useTabs.ts`
- `client/src/components/TabsBar.tsx`
- `client/src/components/TabsBar.module.css`
- `client/src/components/Tabs/TabPanel.tsx`
- `client/src/App.tsx`
- `client/src/hooks/useSearch.ts`
- `client/src/components/ResultDisplay.tsx`

Arquivos de validacao (testes):

- `client/tests/unit/useTabs.test.tsx`
- `client/tests/unit/TabsBar.test.tsx`
- `client/tests/unit/App.behavior.test.tsx`
- `client/tests/integration/TabScrollPersistence.test.tsx`
- `client/tests/integration/SameChapterNavigation.test.tsx`

## 3) Modelo de estado por aba (`Tab`)

Fonte: `useTabs.ts`.

Campos principais e interferencias:

| Campo | Quem escreve | Quem consome | Interferencia |
| :--- | :--- | :--- | :--- |
| `id` | `createTab` | App, TabsBar, TabPanel, ResultDisplay | Identidade da aba e chave de renderizacao |
| `title` | `createTab`, `executeSearchForTab` | TabsBar | Rotulo visual da aba |
| `document` (`nesh`/`tipi`) | `createTab`, `setDoc`, `openInDocCurrentTab` | TabsBar, App, busca | Define endpoint e badge da aba |
| `ncm` | `executeSearchForTab` | App/ResultDisplay | Ultima busca por codigo da aba |
| `results` | `executeSearchForTab` | App, ResultDisplay, sidebar | Conteudo principal da aba |
| `content` | `executeSearchForTab` | fallback de renderizacao | Compatibilidade de payload legado |
| `loading` | `executeSearchForTab` | App/ResultSkeleton/Layout | Skeleton e bloqueios de UX |
| `error` | `executeSearchForTab` | App | Estado de erro por aba |
| `isNewSearch` | `executeSearchForTab`, `onConsumeNewSearch` | ResultDisplay/App | Controla auto-scroll vs restore scroll |
| `latestTextQuery` | `executeSearchForTab` (busca textual) | `SearchHighlighter` | Highlight textual por aba |
| `scrollTop` | `onPersistScroll`, `onConsumeNewSearch` | ResultDisplay | Persistencia de scroll por aba |
| `isContentReady` | App (`onContentReady`) e busca | ResultDisplay/Skeleton | Sincroniza pronto visual do conteudo |
| `loadedChaptersByDoc` | `createTab`, `executeSearchForTab`, `setDoc` | `useSearch` | Otimizacao de navegacao no mesmo capitulo |

## 4) Ciclo de vida das abas

## 4.1 Criacao de aba

Origem 1: botao `+` em `TabsBar`.

- App passa `onNewTab={() => createTab(activeTab.document)}`.
- nova aba herda contexto de documento da aba ativa.

Origem 2: busca com varios termos no `handleSearch` (App).

- se aba ativa estiver vazia, primeiro termo roda na aba ativa e demais em abas novas.
- se aba ativa estiver ocupada, cada termo abre em nova aba.

Origem 3: pivot de documento (context menu/modais).

- `openInDocCurrentTab`: reutiliza aba se estiver vazia.
- `openInDocCurrentTab`: abre nova aba se a atual estiver ocupada.
- `openInDocNewTab`: sempre cria nova aba.

## 4.2 Ativacao de aba

- `switchTab(tabId)` em `useTabs`.
- `TabsBar` dispara por clique e teclado (`Enter`/`Space`).
- `TabsBar` faz `scrollIntoView` da aba ativa para manter visibilidade horizontal.
- App propaga `activeTabId` para `TabPanel` e `ResultDisplay`.

## 4.3 Fechamento de aba

- `closeTab(event, tabId)` em `useTabs`.
- ultima aba nao pode ser fechada.
- ao fechar aba ativa:
  - tenta aba anterior na ordem atual
  - fallback para a primeira restante
- TabsBar suporta:
  - botao de fechar
  - clique do botao do meio do mouse

## 4.4 Reordenacao de abas (drag-and-drop)

Estado/UI:

- `TabsBar` marca aba arrastada (`tabButtonDragging`) e alvo (`tabButtonDropTarget`).

Fluxo:

1. `onDragStart` guarda `draggedTabId`.
2. `onDragOver` define `dropTargetTabId`.
3. `onDrop` chama `onReorder(sourceTabId, targetTabId)`.
4. `useTabs.reorderTabs` move item no array `tabs`.

Importante:

- reordenacao altera somente a ordem visual/logica da lista de abas.
- nao altera `activeTabId`.
- influencia quem vira "aba anterior" na regra de fechamento da aba ativa.

## 4.5 Renderizacao lazy + keep alive

`TabPanel` implementa:

- lazy mount: aba nunca ativada nao monta filhos.
- keep alive: apos ativar uma vez, componente permanece montado e so fica oculto quando inativo.

Efeito pratico:

- estado interno de `ResultDisplay` de uma aba tende a persistir entre trocas.
- melhora retorno rapido para abas ja abertas.

## 5) Onde abas interferem em outros modulos

## 5.1 Busca e API (`useSearch`)

`executeSearchForTab(tabId, doc, query, saveHistory)`:

- toda escrita de resultados e loading eh por `tabId`.
- endpoint muda por `doc` (`searchNCM` vs `searchTipi`).
- atualiza titulo da aba com a query.

Otimizacao critica:

- se query pertence a capitulo ja carregado na aba (`loadedChaptersByDoc`) e ja existe `results`, evita fetch.
- nesse caso, atualiza `results.query` e `isNewSearch=true` para disparar autoscroll no conteudo ja presente.

Interferencia direta:

- mudancas no estado de abas afetam dedup e heuristica de "mesmo capitulo".
- reset de `loadedChaptersByDoc` (ao trocar doc) muda estrategia de busca subsequente.

## 5.2 Scroll, autoscroll e restauracao (`ResultDisplay` + App)

Contrato entre App e ResultDisplay por aba:

- `tabId`
- `isActive`
- `isNewSearch`
- `initialScrollTop`
- `onPersistScroll(tabId, top)`
- `onConsumeNewSearch(tabId, finalScrollTop?)`
- `onContentReady()`

Comportamento:

- ao ficar inativa, aba persiste scroll em `scrollTop`.
- ao reativar com `isNewSearch=false`, restaura `initialScrollTop`.
- quando nova busca conclui autoscroll, App consome `isNewSearch` e opcionalmente atualiza `scrollTop`.

Interferencia direta:

- quebrar assinatura de callbacks ou `tabId` quebra persistencia/autoscroll entre abas.
- `isNewSearch` errado causa conflito entre auto-scroll e restore-scroll.

## 5.3 Sidebar e navegacao de anchors

- `ResultDisplay` calcula `activeAnchorId` por aba ativa.
- `Sidebar` recebe `results` da aba atual e sincroniza highlight/navegacao.
- IDs de container usam `results-content-${tabId}`.

Interferencia direta:

- troca de aba altera origem dos anchors e do observer.
- ids estaveis por tab sao obrigatorios para scroll e testes de integracao.

## 5.4 Smart-links, notas e menu contextual

- handler global em App usa aba ativa para decidir busca/nota.
- smart-link dispara `handleSearch` no contexto da aba ativa.
- abrir no outro documento pode reutilizar aba ou abrir nova, dependendo do estado da aba ativa.

Interferencia direta:

- sem controle correto de estado por aba, o usuario pode sobrescrever contexto de outra navegacao.

## 5.5 Layout mobile e menu lateral

- `mobileMenuOpen` fica no App (estado global), mas apenas aba ativa recebe `true`.
- abas inativas recebem `false` para evitar efeito colateral visual cruzado.

Interferencia direta:

- se esse gating for removido, painel lateral pode aparecer em aba errada.

## 5.6 Comentarios/highlight por aba

- `ResultDisplay` possui estado interno de comentarios, drawer e selecao.
- com `TabPanel` keep-alive, esse estado tende a ficar preservado por instancia de aba.

Interferencia direta:

- alteracoes em montagem/desmontagem de tabs podem resetar UX de comentarios sem intencao.

## 6) Contratos que nao devem quebrar sem migracao coordenada

1. `Tab.id` como chave estavel em toda pipeline.
2. Callback `onConsumeNewSearch(tabId, finalScrollTop?)`.
3. Callback `onPersistScroll(tabId, scrollTop)`.
4. Formato de container id: `results-content-${tabId}`.
5. Semantica de `isNewSearch` (auto-scroll primeiro, restore depois).
6. `loadedChaptersByDoc` segmentado por documento (`nesh`, `tipi`).
7. `TabsBar` deve manter suporte a click, teclado, close e drag/drop.

## 7) Matriz rapida de impacto por arquivo

| Arquivo alterado | Impacto esperado |
| :--- | :--- |
| `useTabs.ts` | Regras de negocio do estado de abas |
| `TabsBar.tsx` | UX de interacao (abrir/fechar/trocar/reordenar) |
| `TabPanel.tsx` | Persistencia em memoria vs custo de montagem |
| `App.tsx` | Orquestracao central e handoff de callbacks por aba |
| `useSearch.ts` | Busca vinculada a aba + otimizacao de mesmo capitulo |
| `ResultDisplay.tsx` | Scroll, anchors, sidebar, comentarios e rendering por aba |

## 8) Testes de regressao recomendados ao mexer em abas

Minimo:

- `client/tests/unit/useTabs.test.tsx`
- `client/tests/unit/TabsBar.test.tsx`
- `client/tests/unit/App.behavior.test.tsx`

Fluxos criticos:

- `client/tests/integration/TabScrollPersistence.test.tsx`
- `client/tests/integration/SameChapterNavigation.test.tsx`

Comandos uteis:

```powershell
cd client
npm run test -- useTabs
npm run test -- TabsBar
npm run test -- App.behavior
npm run test -- TabScrollPersistence
npm run test -- SameChapterNavigation
```

## 9) Checklist para mudancas futuras no sistema de abas

1. Verificar se `activeTabId` continua consistente apos create/close/reorder.
2. Garantir que `isNewSearch` seja consumido apenas apos auto-scroll.
3. Validar persistencia/restauracao de `scrollTop` em troca rapida de abas.
4. Confirmar que switch de documento nao sobrescreve aba ocupada indevidamente.
5. Confirmar que drag-and-drop nao quebra close de aba ativa.
6. Rodar testes unitarios e integracao de tabs/scroll.
7. Atualizar este documento e `NavigationInteractions.md` quando houver mudanca de contrato.

