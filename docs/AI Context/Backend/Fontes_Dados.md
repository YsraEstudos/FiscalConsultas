# Fontes de Dados e Ingestão (Technical Reference)

Este documento descreve os arquivos base utilizados para popular os bancos de dados do sistema e a lógica de processamento de cada um.

## 1. Nesh (Notas Explicativas)

O conteúdo da NESH é derivado de um documento de texto exaustivo que segue a estrutura oficial da Receita Federal.

- **Arquivo Base**: `data/Nesh.zip` (contém um `.txt`).
- **Formato**: Texto semiformatado (Markdown-like).
- **Estrutura Interna**:
  - **Capítulos**: Identificados pela string `Capítulo X` no início da linha.
  - **Notas**: Texto explicativo que aparece logo após o título do capítulo.
  - **Posições**: Linhas iniciadas por `XX.XX - Descrição` (ex: `84.13 - Bombas para líquidos`).
- **Processo de Ingestão (`setup_database.py`)**:
    1. O script lê o arquivo e usa **Regex** para quebrar o texto em blocos de capítulos.
    2. Dentro de cada bloco, extrai as posições e suas descrições curtas.
    3. As "Notas" são separadas das posições para permitir a visualização em abas separadas no frontend.

---

## 2. TIPI (Tabela de Incidência do IPI)

A TIPI é processada a partir de uma planilha Excel oficial, que contém a árvore completa de NCMs e suas respectivas alíquotas.

- **Arquivo Base**: `data/tipi.xlsx`.
- **Formato**: Excel (`.xlsx`).
- **Colunas Principais**:
  - **NCM**: Código numérico (ex: `8413.11.00`).
  - **EX**: Indicador de Exceção tarifária.
  - **Descrição**: Texto descritivo da mercadoria.
  - **Alíquota**: Valor do IPI ou `NT` (Não Tributável).
- **Processo de Ingestão (`setup_tipi_database.py`)**:
    1. Lê a planilha usando a biblioteca `openpyxl`.
    2. **Cálculo de Hierarquia**: O backend calcula o "nível" do NCM baseado no comprimento do código (2 dígitos = capítulo, 4 = posição, 8 = subitem).
    3. **Tratamento de Exceções**: Se houver um valor na coluna `EX`, o script cria uma entrada filha vinculada ao NCM pai.
    4. **Otimização de Busca**: Gera uma `ncm_sort` (chave de ordenação) para garantir que a árvore apareça na ordem correta, mesmo com códigos formatados de forma variada.

---

## Fluxo de Atualização

Sempre que um arquivo base em `data/` é alterado, os scripts de setup devem ser executados para refletir as mudanças nos bancos de dados SQLite:

```bash
# Atualizar NESH
python scripts/setup_database.py

# Atualizar TIPI
python scripts/setup_tipi_database.py

# Reconstruir índice de busca (FTS)
python scripts/rebuild_index.py
```

> [!IMPORTANT]
> O arquivo `Nesh.txt` é automaticamente compactado para `Nesh.zip` após a importação para economizar espaço em disco.
