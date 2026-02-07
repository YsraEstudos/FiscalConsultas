# Sistema de Autoscroll e Navegação (Technical Reference)

Este documento atua como a fonte única da verdade para todos os mecanismos de rolagem, posicionamento e sincronização de navegação da aplicação.

## Visão Geral

O sistema "Autoscroll" não é um único script, mas um conjunto de subsistemas que garantem que o usuário sempre pouse no conteúdo exato que procura, eliminando a fricção de navegar em documentos fiscais de milhares de páginas.

### Objetivos do Sistema

1. **Pulo Instantâneo**: Eliminar a busca manual após o carregamento.
2. **Resiliência a Reflow**: Garantir o alvo mesmo em layouts instáveis (imagens carregando).
3. **Sincronização Bidirecional**:
    - Busca -> Rola Conteúdo (+) Rola Sidebar
    - Rolagem Manual -> Atualiza Sidebar (Scroll Spy)

---

## Arquitetura de Componentes

### 1. Main Content Scroll (O "Pulo")

Responsável por levar o usuário ao NCM/Capítulo no texto principal.

| Componente | Função | Localização |
| :--- | :--- | :--- |
| **useRobustScroll** | Engine que executa o scroll com retries e observação do DOM. | `client/src/hooks/useRobustScroll.ts` |
| **ResultDisplay** | Orquestrador. Gerencia o estado de scroll (restauração/persistência) e aciona o hook. | `client/src/components/ResultDisplay.tsx` |
| **NeshRenderer** | Gerador de HTML. Garante que headings (`H3/H4`) tenham `id` e `data-ncm`. | `client/src/utils/NeshRenderer.ts` |
| **useSearch** | Gatilho. Define a flag `isNewSearch=true` e gerencia a transição de scroll inicial. | `client/src/hooks/useSearch.ts` |

**Fluxo de Execução:**

1. `useSearch` termina → `isNewSearch = true`.
2. `ResultDisplay` renderiza o conteúdo (idle callback) e seta `isContentReady = true`.
3. `ResultDisplay` calcula o `targetId` baseado na query.
4. `useRobustScroll` tenta rolar (Tempo 0ms).
5. Se falhar (elemento não existe), ativa `MutationObserver` por até 5s.
6. Se houver reflow, re-tenta em 100ms, 400ms e 700ms.
7. Ao sucesso, dispara callback e consome `isNewSearch` com o `scrollTop` final.

### 2. Sidebar Scroll (Virtualizada)

Responsável por destacar e centralizar o item na lista lateral.

| Componente | Função | Localização |
| :--- | :--- | :--- |
| **Sidebar** | Lista virtualizada. Gerencia scroll independente e highlights. | `client/src/components/Sidebar.tsx` |
| **Virtuoso** | Lib externa (`react-virtuoso`) que gerencia a janela de renderização. | `npm:react-virtuoso` |

**Lógica de Encontro (Matching):**
A sidebar possui lógica própria de normalização para encontrar o índice correto na lista virtual:

1. Tenta Match Exato (Query vs Código).
2. Tenta Match com/sem pontos (Query limpa vs Código limpo).
3. Tenta Prefixo de 4 dígitos (para encontrar Posição quando a busca é específica, ex: `8417.10.00` → `84.17`).
4. Tenta `startsWith` como último recurso.

### 3. Text Search Scroll

Responsável pela lista de resultados textuais (não NCM).

| Componente | Função | Localização |
| :--- | :--- | :--- |
| **TextSearchResults** | Renderiza lista de cartões. | `client/src/components/TextSearchResults.tsx` |

**Comportamento:**

- Usa **Virtualização Condicional**: Se `results.length >= 60`, ativa `Virtuoso` para performance.
- Recebe `scrollParentRef` para gerenciar o scroll do container pai se necessário.

---

## Mecanismos de Robustez e Fallback

O sistema assume que o DOM é hostil (pode conter notas de rodapé duplicadas, erros de formatação, IDs faltando).

### Estratégias de IDs (Target Resolution)

O alvo é resolvido por **IDs candidatos** (gerados no `ResultDisplay`) e busca direta por `id` no DOM. Se o ID não existir, há um fallback que **cria** o ID usando `data-ncm` (quando disponível).

**Candidatos gerados (ordem):**
1. `anchor_id` vindo do backend (quando existe).
2. `generateAnchorId` baseado no `ncm/query` (ex.: `84.17` → `pos-84-17`).
3. Variações por dígitos (ex.: `8517` → `pos-85-17`, `pos-8517`, `pos-8517-10`, `pos-8517-10-00`).

**Fallback por `data-ncm`:**
- Se nenhum ID existir, o `ResultDisplay` procura um elemento com `data-ncm` formatado (ex.: `84.17`) e **injeta** o `id` correspondente.

### Duplicidade de IDs (Seleção por Prioridade de Tag)

Em casos raros podem existir múltiplos elementos com o mesmo `id`. O sistema **não remove** IDs do DOM; ele escolhe o melhor alvo por prioridade de tag.

- **Ação**: `useRobustScroll` escolhe o elemento com maior score de tag.
- **Prioridade**: `H3` > `H2` > `H1` > `ARTICLE` > `SECTION` > `DIV`.

### Protocolo de Geração de IDs

Para que o alinhamento funcione, Backend e Frontend devem concordar estritamente na geração de strings.

- **Regra**: `[a-zA-Z0-9.-]` apenas. Pontos viram traços.
- **Backend**: `backend/utils/id_utils.py` -> `generate_anchor_id`
- **Frontend**: `client/src/utils/id_utils.ts` -> `generateAnchorId`

**Exemplo:**

- Entrada: `84.17`
- Saída: `pos-84-17`

---

## Sincronização Inversa (Scroll Spy)

Quando o usuário rola manualmente o conteúdo principal, a Sidebar deve atualizar para mostrar onde ele está.

- **Tecnologia**: `IntersectionObserver` instanciado em `ResultDisplay.tsx`.
- **Lógica**: Observa os IDs das posições (NCMs) presentes em `resultados`. O elemento visível mais próximo do topo define o `activeAnchorId`.
- **Config**: `root = containerRef`, `rootMargin = '0px 0px -60% 0px'`, `threshold = 0.1`.
- **Atualização**: `ResultDisplay` passa `activeAnchorId` para a `Sidebar`, que atualiza o highlight visual (mas *não* faz autoscroll da sidebar para evitar briga de scrolls).

---

## Persistência entre Abas (Cross-Tab Persistence)

O sistema garante que a posição de rolagem seja mantida ao alternar rapidamente entre abas (ex: NESH vs TIPI), mesmo se o componente for desmontado ou otimizado.

### Mecanismo de Salvamento

- **Fluxo**: `ResultDisplay` captura o `scrollTop` através do evento de scroll.
- **Callback**: Dispara `onPersistScroll`, que atualiza o `scrollTop` no estado global da aba em `App.tsx`.
- **Restauração**: Ao retornar para a aba, o `App.tsx` passa o `initialScrollTop` de volta para o `ResultDisplay`.

### Robustez em Pesquisas Rápidas

Ao realizar uma nova pesquisa, a função `onConsumeNewSearch` agora aceita um parâmetro opcional `_finalScroll`. Se fornecido, ele limpa a flag `isNewSearch` e simultaneamente define a posição final de scroll, evitando "pulos" visuais ou resets indesejados para o topo.

---

## Offset de Scroll (Header Fix)

O offset é unificado via CSS variable e aplicado em dois pontos:

- **Container**: `ResultDisplay.module.css` aplica `scroll-padding-top: var(--scroll-offset)`.
- **Âncoras**: `nesh.css` e `tipi.css` aplicam `scroll-margin-top: var(--scroll-offset)` em headings e posições.

---

## Debugging

Para investigar problemas de scroll:

1. **Logs**: O sistema emite logs detalhados via `utils/debug.ts` com prefixo `[RobustScroll]` ou `[Sidebar]`.
2. **Verificar Renderização**: O elemento alvo possui `id="pos-..."` e `data-ncm="..."`? Se não, verifique o `NeshRenderer.ts` ou o Backend.
3. **Sidebar Desalinhada**: Se a sidebar não rola, verifique se a query de busca está normalizada corretamente em `Sidebar.tsx`.
