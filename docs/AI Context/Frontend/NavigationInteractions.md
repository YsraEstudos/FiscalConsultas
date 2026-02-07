# Sistema de Navegação Cruzada e Menus Contextuais (Technical Reference)

Este documento detalha os mecanismos de interação que permitem ao usuário transitar fluidamente entre os documentos TIPI e NESH, além de garantir a navegação interna via referências inteligentes.

## Visão Geral

A aplicação Fiscal foi desenhada para eliminar a barreira entre a Tabela TIPI e as Notas Explicativas (NESH). O sistema de navegação permite "pivos" instantâneos (Change Document Pivot) e "bifurcações" (New Tab Fork) através de cliques contextuais e links inteligentes.

### Objetivos do Sistema

1. **Interconectividade Total**: Qualquer menção a um NCM, seja texto ou link, deve ser um portal para aquele código.
2. **Contexto Documental**: Permitir troca rápida de contexto (Ex: "Onde isso fica na TIPI?") sem perder o código alvo.
3. **Preservação de Trabalho**: Proteger abas ativas de sobrescrita acidental durante a navegação.

---

## Arquitetura de Componentes

### 1. Menu de Contexto Cruzado (`CrossNavContextMenu`)

Responsável por interceptar o clique direito e oferecer opções de transição de documento.

| Componente | Função | Localização |
| :--- | :--- | :--- |
| **CrossNavContextMenu** | Detecta clique direito, extrai NCM sob o cursor e renderiza menu flutuante. | `client/src/components/CrossNavContextMenu.tsx` |
| **ModalManager** | Injeta o menu na árvore de componentes (via Portal/Suspense) e passa callbacks de navegação. | `client/src/components/ModalManager.tsx` |
| **App** | Define a lógica de execução das ações (abrir na mesma aba vs nova aba). | `client/src/App.tsx` |

**Fluxo de Detecção (Hit Testing):**

O menu não é anexado a cada elemento. Ele usa um listener global (`document.addEventListener('contextmenu')`) e verifica se o alvo pertence a classes específicas:

- `.smart-link` (Links internos)
- `.tipi-ncm`, `.tipi-result-ncm` (Tabelas TIPI)
- `.ncm-target` (Highlight de NESH)
- Headers do Markdown (`h2`, `h3`, etc.)

**Extração de NCM (Regex Heurística):**

Ao clicar em um elemento de texto (ex: título "84.71 - Máquinas..."), o sistema extrai o NCM usando prioridade de regex:

1. Padrão com pontos e formatação completa (`8404.10.00`)
2. Padrão curto com pontos (`84.71`)
3. Sequência de dígitos crua (`845010`)

---

## Funcionalidades de Navegação

### 1. "Ver na [Outro Documento]" (Pivot)

Permite alternar entre TIPI e NESH mantendo o foco no mesmo NCM.

- **Trigger**: Opção no Menu de Contexto.
- **Lógica (`App.tsx` -> `openInDocCurrentTab`)**:
    1. Verifica se a aba atual está "Ocupada" (carregando ou com resultados não triviais).
    2. **Se Ocupada**: Redireciona para fluxo de *Nova Aba* (Safety Fallback).
    3. **Se Livre**:
        - Atualiza o estado da aba: `document = otherDoc`.
        - Reseta caches (`isContentReady: false`, limpa resultados).
        - Dispara `executeSearchForTab` com o NCM alvo.

### 2. "Abrir em Nova Aba" (Fork)

Permite investigar um NCM paralelo sem perder o contexto atual.

- **Trigger**: Opção no Menu de Contexto.
- **Lógica (`App.tsx` -> `openInDocNewTab`)**:
    1. Cria nova aba via `createTab(docType)`.
    2. Executa busca imediatamente na nova ID.
    3. Interface foca automaticamente na nova aba.

### 3. Smart Links (Navegação Interna)

Links clicáveis dentro das Notas Explicativas (ex: "Ver Nota 2 de 84.50").

- **Mecanismo**: Delegação global de eventos em `App.tsx`.
- **Selector**: `a.smart-link` (Gerados pelo `NeshRenderer` ou Markdown parser).
- **Ação**:
  - Intercepta `click`.
  - Lê `data-ncm`.
  - Executa `handleSearch` na aba ativa (preservando o tipo de documento atual).

---

## Tratamento de Dados e Formatação

Para garantir que a navegação funcione entre sistemas diferentes (TIPI vs NESH), existe uma normalização de IDs.

- **NESH para TIPI**: Ao ir da NESH (onde NCMs podem ser parciais "84.15") para TIPI, o sistema formata o ID para garantir match na tabela.
- **Utils**: `client/src/utils/id_utils.ts` -> `formatNcmTipi`.

---

## Debugging

Problemas comuns de navegação e como investigar:

1. **Menu não aparece**:
   - Verifique se o elemento clicado possui uma das classes da *allowlist* em `CrossNavContextMenu.tsx`.
   - Verifique se o elemento possui texto contendo números ou atributo `data-ncm`.

2. **NCM Errado extraído**:
   - O regex prioriza formatos com ponto. Se o texto for ambíguo (ex: "Artigo 84"), verifique as regras de regex em `extractNcm`.

3. **Navegação sobrescreve trabalho**:
   - Verifique a lógica de "Aba Ocupada" em `openInDocCurrentTab`. Ela deve detectar `activeTab.results` ou `loading`.
