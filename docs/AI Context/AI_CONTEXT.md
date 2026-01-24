# Nesh / Fiscal — AI Context (Jan/2026)

Este arquivo contém o contexto técnico essencial para manutenção do projet Nesh/Fiscal. Todas as informações aqui foram verificadas contra o código em produção.

## 1. Visão Geral e Arquitetura

O **Nesh/Fiscal** é um sistema de consulta de NCM local híbrido (Python/FastAPI + React).

### Componentes Principais

* **Backend (`backend/server/app.py` + `Nesh.py`):**
  * FastAPI expõe endpoints em `/api/*`.
  * Serve o frontend compilado (`client/dist`) na raiz `/`.
  * **Entrypoint:** `python Nesh.py` (inicia Uvicorn na porta 8000).
* **Frontend (`client/src`):**
  * React + Vite + TypeScript.
  * Renderiza Markdown injetado com HTML (smart-links, highlights).
  * Gerencia estado de abas e histórico.
  * **Estilos:** CSS Modules por componente + CSS global mínimo em `src/index.css`.
* **Dados:**
  * `nesh.db` (SQLite): Dados das Notas Explicativas + Índice FTS5.
  * `tipi.db` (SQLite): Dados da Tabela TIPI (Alíquotas IPI).

## 2. Lógica de Busca (NESH) - `backend/services/nesh_service.py`

O serviço `NeshService` decide a estratégia baseada na query:

### A. Busca por Código (NCM)

Ativada quando query contém apenas números e pontuação (ex: `8517`, `73.18`).

* Normaliza query (remove pontos).
* Retorna capítulo inteiro em Markdown.
* Frontend rola automaticamente para a âncora `#pos-XXXX`.

### B. Busca Textual (FTS5) - `search_full_text`

Utiliza estratégia de 3 Tiers para relevância (`ranking` implementado em `database.py`):

1. **Tier 1 (Exato):** Procura a frase exata (ex: `"bomba submersível"`). Base score: 1000+.
2. **Tier 2 (AND):** Contém **TODAS** as palavras (com prefix search `*`). Base score: 500+.
3. **Tier 3 (OR):** Contém **QUALQUER** palavra (fallback). Base score: 100+.
    * *Nota:* Tier 3 estima cobertura de palavras para evitar resultados irrelevantes.

**Bônus NEAR:** Adiciona score extra se as palavras estarem próximas (distância configurável).

## 3. Lógica TIPI (IPI) - `backend/services/tipi_service.py`

Diferente da NESH, a TIPI foca em alíquotas.

* **Banco separado:** `tipi.db`.
* **Formato NCM:** `XXXX.XX.XX` (ex: `8517.13.00`).
* **Visualização:** Controlada pelo `view_mode` (Enum):
  * `CHAPTER`: Retorna capítulo completo.
  * `FAMILY`: Busca hierárquica (Ancestrais + Item + Descendentes).
* **Busca:**
  * **Código:** Usa SQL otimizado (`REPLACE` + `LIKE`) para filtrar família sem overhead Python.
  * **Texto:** FTS5 no `tipi.db`.

## 4. Renderização e Contratos Frontend-Backend

O backend (`backend/presentation/renderer.py`) transforma texto bruto em HTML "rico".

### Smart Links (Navegação)

O backend identifica códigos NCM no texto e os transforma em links.

* **Regex:** Detecta códigos como `84.71` ou `8517.12`.
* **Transformação:** Injeta `<a href="#" class="smart-link" data-ncm="8471">84.71</a>`.
* **Interação (Frontend):** `App.tsx` usa **event delegation** para interceptar cliques em `.smart-link`, ler `data-ncm` e disparar nova busca/navegação.
  * *Correção Histórica:* Documentação antiga citava `onclick` inline, mas o código atual usa `data-ncm` + React delegation.

### Highlights de Unidades

O backend injeta spans para unidades de medida (ex: `kg`, `m²`).

* **Segurança:** Usa um parser HTML (`_UnitHighlighter`) para **jamais** injetar highlights dentro de tags existentes (como links), evitando quebrar o HTML.
* **CSS:** Classe `.highlight-unit` (azul no tema padrão).

## 4.1. CSS (Estado Atual)

### CSS Modules (padrão)

- Estilos de UI ficam ao lado do componente em `*.module.css`.
* Componentes importam o módulo e usam `styles.classe`.

### CSS Global (núcleo mínimo)

Mantidos apenas estilos necessários para HTML injetado pelo backend e utilidades globais:
* Tokens/base: [client/src/styles/_variables.css](client/src/styles/_variables.css), [client/src/styles/base.css](client/src/styles/base.css)
* Utilidades: [client/src/styles/utilities](client/src/styles/utilities)
* Conteúdo Markdown/HTML: [client/src/styles/features/nesh.css](client/src/styles/features/nesh.css), [client/src/styles/features/tipi.css](client/src/styles/features/tipi.css), [client/src/styles/components/glossary.css](client/src/styles/components/glossary.css)

## 4.2. NESH — Normalização e Renderização Visual

* O backend converte linhas com `**TÍTULO**` em `<h4 class="nesh-subheading">` e títulos inline em `<span class="nesh-inline-title">`.
* Bullets soltos são removidos e bullets com texto viram listas.
* Antes de injetar smart-links, todo `**texto**` é convertido para `<strong>`, inclusive dentro de parágrafos HTML.
* O frontend encapsula cada seção NESH (`h3.nesh-section`) em um card visual (`.nesh-section-card`), agrupando o texto principal, subtítulos e listas.
* O CSS garante destaque visual, badge NCM com overflow controlado e hierarquia clara entre títulos, subtítulos e conteúdo.

## 5. Performance (Otimizações Verificadas)

* **Regex Cache:** Padrões compilados no nível do módulo (`renderer.py`).
* **LRU Cache (Backend):**
  * Cache de resultados FTS (`nesh_service.py`).
  * Cache de posições TIPI (Desativado temporariamente para garantir consistência).
* **TIPI SQL Filter:** Filtro de família NCM movido para SQL (`REPLACE` + `LIKE`) para evitar overhead em capítulos grandes.
* **Connection Pooling:** `DatabaseAdapter` gerencia pool de conexões SQLite thread-safe.
* **Vite Proxy:** `vite.config.js` configurado para proxy `/api` -> `localhost:8000` em dev.
* **Frontend Optimizations:**
  * **Lazy Loading:** Modais principais carregados sob demanda via `React.lazy` + `Suspense` para reduzir bundle inicial.
  * **Memoization:** `React.memo` em componentes críticos (`Sidebar`, `ResultDisplay`, `TabsBar`) e `useMemo` em hooks (`useTabs`) para prevenir re-renders.
  * **Debug Cleanup:** `console.debug` removidos de produção via utilitário `debug.ts`, reduzindo overhead de serialização.
  * **UX:** Skeleton screens (`ResultSkeleton`) para feedback visual imediato durante o carregamento de buscas.
  * **Observers Debounce:** `useAutoScroll` utiliza debounce para evitar múltiplos repaints em resize/mutation.

## 6. Setup e Comandos Úteis

* **Start Geral:** `start_nesh.bat` (Builda frontend + Roda backend).
* **Dev Backend:** `python Nesh.py`
* **Dev Frontend:** `cd client && npm run dev`
* **Recriar Banco:** `python scripts/setup_database.py` (NESH) / `setup_tipi_database.py` (TIPI).
* **Testes:** `pytest` (Backend) / `npm test` (Frontend).

## 7. Troubleshooting Comum

* **Busca retorna 404 no Frontend Dev:** Verifique se o proxy está configurado no `vite.config.js`.
* **Highlights sumiram:** Verifique se a regex em `constants.py` cobre o caso (espaços, maiúsculas).
* **TIPI desatualizada:** Rode `setup_tipi_database.py` novamente.

## 8. Database Schema (Reference)

Detalhes das tabelas SQLite (`nesh.db`). O banco TIPI (`tipi.db`) segue estrutura similar para capítulos/posições.

### Tabelas Principais (`nesh.db`)

1. **chapters**
    * Armazena o conteúdo completo de cada capítulo em Markdown.
    * `chapter_num` (TEXT UNIQUE): PK natural (ex: "01", "85").
    * `content` (TEXT): Texto completo renderizável.
    * `raw_text` (TEXT): Texto puro para indexação inicial.

2. **positions**
    * Mapeia códigos NCM para descrições.
    * `codigo` (TEXT PK): NCM formatado (ex: "8517.12.31").
    * `chapter_num` (TEXT FK): Link para tabela chapters.

3. **search_index** (FTS5 Virtual Table)
    * Motor de busca textual.
    * `indexed_content`: Conteúdo tokenizado.
    * `rank`: Coluna calculada nativamente pelo FTS5 (BM25).
    * `type`: 'chapter' ou 'position'.

4. **chapter_notes**
    * `chapter_num` (PK).
    * `notes_content`: Texto cru das notas legais.

5. **glossary**
    * `term` (PK): Termo técnico.
    * `definition`: Tooltip text.

### Performance e Índices

* Índices B-Tree em chaves primárias e `chapter_num`.
* PRAGMA `journal_mode=WAL` ativado pelo `DatabaseAdapter`.

## 9. Estrutura de Testes

O diretório `tests/` organiza a suíte de testes do projeto:

* **`unit/`**: Testes unitários de componentes isolados.
* **`integration/`**: Testes de integração (Database, API Services).
* **`scripts/`**: Scripts para debugging e verificações manuais.
* **`performance/`**: Benchmarks e testes de performance.

**Execução:**

* Todos: `pytest` (Usa `pytest-asyncio` para testes assíncronos)
* Apenas Unitários: `pytest tests/unit`
* Scripts: `python tests/scripts/nome_do_script.py`
