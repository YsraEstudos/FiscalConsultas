# Representação e Formatação Visual (Technical Reference)

Este documento descreve como os dados processados pelo backend são transformados em elementos visuais no frontend, garantindo acessibilidade, interatividade e suporte ao sistema de autoscroll.

## 1. Renderização da NESH (Texto Rico)

A NESH consiste em grandes blocos de texto que precisam ser parseados para se tornarem amigáveis ao usuário. Essa transformação ocorre principalmente no utilitário `client/src/utils/NeshRenderer.ts`.

### Processo de Transformação

1. **Sanitização**: Todo texto bruto é escapado para evitar ataques de XSS.
2. **Identificação de Estrutura**:
    - **Cabeçalhos (H3)**: Linhas que seguem o padrão `85.17 - Título` são convertidas em tags `<h3>`.
    - **Atributos de Scroll**: Cada `<h3>` recebe um `id` único (ex: `pos-85-17`) e um `data-ncm="8517"` para facilitar a localização pelo motor de busca.
    - **Limpeza de Artefatos**: Marcadores soltos do texto fonte (ex: `- *` ou `*` em linha isolada) são removidos para não virarem listas vazias no renderer.
    - **Subposições Curtas (H4)**: Linhas como `8419.8 - Título` viram `<h4 class="nesh-subsection">` com `id="pos-8419-8"` para permitir scroll direto sem poluir a navegação lateral.
3. **Links Inteligentes**:
    - **NCMs**: Códigos NCM mencionados no texto são envoltos em tags `<a>` com a classe `.smart-link`, tornando-os clicáveis para uma nova busca.
    - **Notas**: Referências como "(Nota 2 do Capítulo 85)" tornam-se links que abrem modais ou navegam para a nota correspondente.
4. **Destaques Visuais**: Termos de exclusão (ex: "não compreende", "exceto") recebem uma classe de highlight para facilitar a leitura técnica.

---

## 2. Renderização da TIPI (Estrutura em Árvore)

Diferente da NESH, a TIPI é enviada pelo backend como uma estrutura de dados organizada (objetos e arrays). Sua renderização ocorre no componente `ResultDisplay.tsx`.

### Elementos Visuais

- **Hierarquia por Indentação**: Cada item possui um `nivel` (0 a 5). O frontend aplica classes CSS (`tipi-nivel-X`) que adicionam padding lateral, visualizando a árvore de subposições.
- **Badges de Alíquota**: O sistema classifica a alíquota do IPI em cores:
  - **Verde (`aliquot-zero` / `aliquot-low`)**: Isento ou até 5%.
  - **Amarelo (`aliquot-med`)**: Entre 5% e 10%.
  - **Vermelho (`aliquot-high`)**: Acima de 10%.
  - **Cinza (`aliquot-nt`)**: Não Tributável.
- **Estrutura de Artigo**: Cada posição é um elemento `<article>` com atributos ARIA para acessibilidade.

---

## 3. Sincronização de IDs (O "Contrato Visual")

Para que o sistema de **Autoscroll** funcione, existe um contrato silencioso entre o Backend, o Parser e o Renderer:

1. **Backend**: Envia o `chapter_num` e a lista de `positions`.
2. **Parser/Renderer**: Garante que o elemento visual "alvo" tenha EXATAMENTE o `id` gerado pela função `generateAnchorId()`.
3. **Limpeza de Duplicatas**: Se um código NCM aparece múltiplas vezes (ex: no título e numa nota de rodapé), o `ResultDisplay` remove o `id` dos elementos secundários, garantindo que o scroll pouse apenas na seção estrutural correta.

---

## 4. Componentes Relacionados

| Recurso | Componente Responsável | Lógica Principal |
| :--- | :--- | :--- |
| **Sumário Lateral** | `Sidebar.tsx` | Lista virtualizada que pula para os IDs gerados. |
| **Busca de Texto** | `TextSearchResults.tsx` | Lista de cartões para resultados que não são códigos diretos. |
| **Glossário** | `GlossaryModal.tsx` | Popups de definições técnicas injetados via links inteligentes. |

> [!TIP]
> **Performance**: Em documentos muito longos, a renderização do Markdown é agendada via `requestIdleCallback` para não travar a interface do usuário durante a navegação.
