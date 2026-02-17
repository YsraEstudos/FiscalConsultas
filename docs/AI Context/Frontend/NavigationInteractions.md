# Navegacao, Context Menu e Interacoes Cruzadas (estado real 2026-02-17)

Este documento registra como a navegacao entre NESH/TIPI funciona hoje no frontend.

## 1) Componentes-chave

- `client/src/components/CrossNavContextMenu.tsx`
- `client/src/components/ModalManager.tsx`
- `client/src/App.tsx`
- `client/src/components/ResultDisplay.tsx`
- `client/src/components/Sidebar.tsx`
- `client/src/context/CrossChapterNoteContext.tsx`

## 2) Context Menu Cross-Doc

### 2.1 Como abre

- listener global de `contextmenu` por delegacao.
- somente abre se alvo estiver na allowlist:
  - `.smart-link`
  - `.tipi-ncm`
  - `.tipi-result-ncm`
  - `.ncm-target`
  - headings dentro de `.markdown-body`

### 2.2 Como extrai NCM

Ordem de heuristica:

1. `\d{4}(\.\d{2}){1,2}`
2. `\d{2}(\.\d{2}){1,3}`
3. `\d{2,8}`

Tambem usa `data-ncm` quando existir.

### 2.3 Acoes do menu

- ver no outro documento (`onOpenInDoc`)
- copiar NCM
- abrir em nova aba no documento atual (`onOpenInNewTab`)

## 3) Pivot entre documentos (App)

### 3.1 `openInDocCurrentTab`

- se aba atual estiver ocupada (loading/resultados/ncm), desvia para nova aba.
- se estiver livre:
  - troca documento
  - limpa estado
  - executa busca no mesmo tab id.

### 3.2 `openInDocNewTab`

- cria tab e executa busca no novo contexto.

## 4) Smart-links e note-ref por delegacao

`App.tsx` registra click handler global:

- clique em `a.smart-link` -> `handleSearch(ncm)`.
- clique em `.note-ref` -> `handleOpenNote(note, chapter?)`.

Vantagem: evita listeners individuais por item renderizado.

Nota:

- existe ponte global `window.nesh` para compatibilidade (`smartLinkSearch`, `openNote`, `openSettings`).

## 5) Notas Cross-Chapter

Contexto: `CrossChapterNoteContext`.

- cache por capitulo (`MAX_CACHED_CHAPTERS=20`).
- dedup de requests em voo por `inFlightRef`.
- `handleOpenNote` no `App`:
  - usa notas locais quando capitulo presente no resultado
  - senao faz fetch via `/api/nesh/chapter/{chapter}/notes`
  - abre modal (`NotePanel`) quando encontra conteudo

## 6) Navegacao Lateral (Sidebar)

### 6.1 Estrutura

- lista flatten virtualizada (`react-virtuoso`).
- itens: header de capitulo, secoes, posicoes.
- index maps:
  - codigo -> indice
  - anchor_id -> indice

### 6.2 Navegar para alvo

- click em item chama `onNavigate(targetId)` do `ResultDisplay`.
- `ResultDisplay` tenta:
  1. `#targetId`
  2. fallback `generateAnchorId(targetId)`

### 6.3 Auto-follow da query

- sidebar tenta achar indice por match exato, normalizado, prefixo e fallback startsWith.
- destaca item por tempo curto apos scroll programatico.

## 7) Estado de abas e navegacao

`useTabs` guarda por aba:

- `document` (`nesh|tipi`)
- `results`, `ncm`, `loading`, `error`
- `isNewSearch`
- `scrollTop`
- `isContentReady`
- `loadedChaptersByDoc`

`useSearch` usa `loadedChaptersByDoc` para otimizar busca no mesmo capitulo (skip fetch + apenas scroll).

Detalhe critico:

- quando ocorre skip fetch, `useSearch` atualiza `results.query` para manter `targetId` sincronizado no `ResultDisplay`.

## 8) Integracao com Auth e API

- `AuthProvider` registra `getToken` no interceptor axios.
- chamadas de API enviam Bearer automaticamente quando rota nao e publica.
- menu/context/navigation nao dependem de auth para abrir, mas algumas acoes backend podem falhar se sem token.

## 9) Riscos atuais de navegacao

1. concorrencia entre highlight de busca e highlight por `activeAnchorId` na sidebar (estado unico de highlight).
2. dependencia de IDs de secao (`chapter-{cap}-...`) que nem sempre existem no HTML NESH backend.
3. bug de callback de consumo de nova busca em `App` afeta ciclo de scroll/navegacao entre abas.
4. pivot de documento abre nova aba quando a atual esta ocupada; sem UX clara, usuario pode achar que "sumiu" da aba original.

## 10) Contrato de estabilidade

Nao quebrar sem migracao coordenada:

- classes `.smart-link` e `.note-ref`
- atributos `data-ncm`, `data-note`, `data-chapter`
- formato de IDs `pos-...` e `chapter-{cap}-{secao}`
- shape de resposta com `results` + `resultados`
