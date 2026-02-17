# Representacao Visual e Contrato de Render (estado real 2026-02-17)

Este documento descreve como o backend prepara dados para renderizacao e como isso se conecta ao frontend.

## 1) Regra Atual de Renderizacao

### 1.1 NESH

Fonte principal: backend.

- Rota `GET /api/search` (codigo) chama `HtmlRenderer.render_full_response(results)`.
- O HTML final vai no campo `markdown` (nome legado).
- Campos brutos pesados (`conteudo`) sao removidos antes da resposta.

### 1.2 TIPI

Fluxo de tela atual: frontend.

- Rota TIPI retorna estrutura de dados (`results/resultados`).
- `ResultDisplay.tsx` monta HTML via `renderTipiFallback` quando `markdown` nao vem.
- `backend/presentation/tipi_renderer.py` existe, mas nao e o caminho principal da rota hoje.

## 2) Pipeline do HtmlRenderer (NESH)

Arquivo: `backend/presentation/renderer.py`.

Etapas principais:

1. `clean_content` (remove artefatos de pagina/refs internas/linhas isoladas).
2. `inject_note_links` (spans `.note-ref` com `data-note`/`data-chapter`).
3. Estruturacao de headings (`h3`/`h4`) com `id` e `data-ncm`.
4. Fallback de injecao de anchors em linhas sem heading marcado.
5. `apply_post_transforms` (bold, exclusao, unidade, glossario, smart-links).

## 3) Contrato de IDs de Anchor

### 3.1 Funcao canonica

- Backend: `backend/utils/id_utils.py::generate_anchor_id`
- Frontend: `client/src/utils/id_utils.ts::generateAnchorId`

### 3.2 Regras esperadas

- `84.17` -> `pos-84-17`
- `8517.10.00` -> `pos-8517-10-00`

### 3.3 Divergencia conhecida

- frontend e idempotente (se ja vier `pos-...`, preserva)
- backend nao e idempotente e sempre prefixa `pos-`

Impacto: risco de `pos-pos-...` em fluxos mistos.

## 4) Elementos Interativos no HTML

Gerados no backend/renderer (NESH):

- `.smart-link` + `data-ncm` para navegação por codigo.
- `.note-ref` + `data-note` para abertura de nota.
- `.glossary-term` para tooltip/modal de glossario.
- classes de highlight para exclusao/unidade.

Consumidos no frontend:

- clique delegado em `App.tsx` para `.smart-link` e `.note-ref`.
- menu contextual cross-doc depende dessas classes para extracao de NCM.

## 5) Sidebar e Seções de Capitulo

A sidebar espera anchors de secao no formato:

- `chapter-{capitulo}-titulo`
- `chapter-{capitulo}-notas`
- `chapter-{capitulo}-consideracoes`
- `chapter-{capitulo}-definicoes`

Estado atual:

- no caminho backend NESH, essas secoes nem sempre sao emitidas com IDs correspondentes.
- no caminho fallback frontend (`NeshRenderer.ts`), existem blocos com esses IDs.

Impacto: navegacao de secao pode funcionar melhor no fallback do que no render backend.

## 6) Sanitizacao e Confianca de HTML

- `ResultDisplay` usa DOMPurify somente para fallbacks gerados no cliente.
- Quando `rawMarkdown` vem do backend, o HTML e considerado confiavel e inserido direto.

Risco:

- qualquer regressao de sanitizacao no backend vira risco direto no cliente.

Detalhe operacional:

- deteccao de markdown legado no cliente usa heuristica (`LEGACY_MARKDOWN_PATTERN`).
- se a heuristica errar, pode haver parse/sanitizacao em caminho diferente do esperado.

## 7) Performance de Render

### 7.1 Backend

- NESH chega pre-renderizado e evita parse markdown pesado no cliente.
- response de codigo e cacheada em bytes raw+gzip na rota.

### 7.2 Frontend

- `ResultDisplay` faz render chunked para payloads grandes (`<hr>` boundaries).
- usa `requestIdleCallback`/`setTimeout` para append incremental.
- threshold atual para chunking: 50KB de HTML.
- abas inativas limpam markup e reconstroem quando reativadas (tradeoff de memoria x CPU).

## 8) Contrato de Compatibilidade (nao quebrar)

1. manter campo `markdown` enquanto frontend depender.
2. manter `results` + `resultados`.
3. manter IDs de anchor estaveis para autoscroll/sidebar.
4. nao alterar classes `.smart-link`/`.note-ref` sem atualizar delegacao de clique.

## 9) Refactors Prioritarios

P0:

- alinhar idempotencia de `generate_anchor_id` backend com frontend.
- garantir IDs de secoes no renderer backend para paridade com sidebar.

P1:

- consolidar estrategia de render para reduzir split-brain (backend vs fallback frontend).
- definir politica unica de sanitizacao (trusted backend HTML com validacao de pipeline).
- revisar endpoint `/api/debug/anchors`, que hoje nao usa o mesmo pipeline de render da rota principal.
