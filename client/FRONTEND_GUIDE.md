# Nesh Frontend

Interface React moderna para o sistema Fiscal/Nesh.

## Estrutura

* **`src/`**: Código fonte
  * **`components/`**: Componentes React reutilizáveis
  * **`context/`**: Gerenciamento de estado (SettingsContext, etc)
  * **`services/`**: Camada de API (Axios)
  * **`styles/`**: CSS global mínimo (tokens/base/utilidades + HTML injetado)
  * **`types/`**: Definições TypeScript
  * **`constants.ts`**: Constantes globais (ViewModes, StorageKeys)

  ## CSS (Padrão Atual)

  ### CSS Modules (padrão)
  - Todo estilo de componente deve ficar ao lado do componente em `*.module.css`.
  - Componentes devem importar o módulo e usar `styles.classe`.

  ### CSS Global (núcleo mínimo)
  Somente estes arquivos permanecem globais:
  - Tokens e base: [client/src/styles/_variables.css](client/src/styles/_variables.css), [client/src/styles/base.css](client/src/styles/base.css)
  - Utilidades: [client/src/styles/utilities](client/src/styles/utilities)
  - Conteúdo renderizado pelo backend/Markdown: [client/src/styles/features/nesh.css](client/src/styles/features/nesh.css), [client/src/styles/features/tipi.css](client/src/styles/features/tipi.css), [client/src/styles/components/glossary.css](client/src/styles/components/glossary.css)

  Qualquer novo componente deve usar CSS Modules e não adicionar estilos globais fora desse núcleo.

## Scripts

* `npm run dev`: Inicia servidor de desenvolvimento (v7.3.1)
* `npm run build`: Compila para produção em `dist/`
* `npm test`: Executa testes (Vitest)

## Configuração

O frontend usa proxy para `localhost:8000` (backend) durante o desenvolvimento.
Em produção, o backend serve os arquivos estáticos de `dist/`.

## Performance (Notas)

- Markdown grande é processado em idle time com `requestIdleCallback` (fallback para `setTimeout`) para manter a UI responsiva.
- Resultados textuais extensos usam virtualização via `react-virtuoso` para reduzir custo de render e memória.
- Evite props instáveis em componentes pesados (ex.: `ResultDisplay`) para não disparar re-render em abas inativas.

## Constantes

Use sempre `src/constants.ts` para valores compartilhados como:
* Modos de visualização TIPI (`VIEW_MODE`)
* Chaves de LocalStorage (`STORAGE_KEYS`)
