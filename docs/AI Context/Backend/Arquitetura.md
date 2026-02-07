# Arquitetura e Funcionamento do Backend (Technical Reference)

Este documento atua como a fonte única da verdade para a arquitetura, lógica de negócio e infraestrutura do servidor Nesh.

## Visão Geral

O backend do Nesh é uma API de alto desempenho construída com **FastAPI**, projetada para processar buscas complexas em documentos fiscais (NCM e TIPI). Ele não apenas serve dados, mas também orquestra a inteligência de busca, o ranking de relevância e a entrega otimizada de conteúdo para o frontend React.

### Objetivos do Sistema

1. **Busca Híbrida Inteligente**: Distinguir automaticamente entre códigos numéricos e termos textuais.
2. **Performance Assíncrona**: Utilizar I/O não-bloqueante para suportar múltiplas requisições simultâneas.
3. **Ranking por Relevância**: Aplicar lógica de "tiers" para garantir que os resultados mais exatos apareçam primeiro.
4. **Consistência de Identidade**: Garantir que IDs gerados no backend sejam idênticos aos esperados pelo frontend (Anchor Sync).

---

## Arquitetura de Software

O sistema utiliza uma **Arquitetura Modular (Clean Architecture)** simplificada, isolando a infraestrutura da lógica de negócio.

### Estrutura de Camadas

| Camada | Responsabilidade | Localização |
| :--- | :--- | :--- |
| **Apresentação** | Roteamento HTTP, validação de entrada e serialização de saída (JSON). | `backend/presentation/routes/` |
| **Serviços** | Lógica de negócio, parsing de capítulos, ranking de busca e gerenciamento de cache. | `backend/services/` |
| **Infraestrutura** | Acesso ao banco de dados SQLite, connection pooling e interface FTS5. | `backend/infrastructure/` |
| **Domínio** | Definições de tipos e modelos de dados (TypedDicts). | `backend/domain/` |

---

## Componentes Principais

### 1. Engine de Busca (NeshService)

O coração da aplicação. Decide como processar cada query recebida.

- **Heurística de Tipo**: Se a query contém essencialmente dígitos/pontos, é tratada como `search_by_code`. Caso contrário, `search_full_text`.
- **Cache LRU**: Mantém os capítulos e resultados FTS mais acessados em memória para resposta instantânea.
- **Normalização**: Limpa a query, remove *stopwords* e prepara os termos para o motor FTS5.

### 2. Infraestrutura SQLite (DatabaseAdapter)

Gerencia a persistência com foco em velocidade e segurança.

- **Connection Pool**: Mantém um pool de conexões abertas (`aiosqlite`) para evitar o custo de abrir o banco a cada requisição.
- **FTS5 (Full-Text Search)**: Utiliza a extensão oficial do SQLite para busca textual avançada em índices pré-calculados.
- **WAL Mode**: Banco configurado em *Write-Ahead Logging* para permitir leituras e escritas concorrentes sem travamentos.

### 3. Sistema de Ranking por Tiers

Para buscas textuais, o backend aplica uma cascata de tentativas de busca:

| Nível | Nome | Estratégia SQL | Objetivo |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Exato** | `MATCH '"termo buscado"'` | Encontrar a frase exata. |
| **Tier 2** | **AND** | `MATCH 'termo* AND buscado*'` | Todas as palavras presentes (com wildcard). |
| **Tier 3** | **OR** | `MATCH 'termo* OR buscado*'` | Busca parcial/aproximada. |

> [!TIP]
> **Bônus de Proximidade (NEAR)**: Se o motor encontra os termos próximos (dentro de 10 palavras), aplica um `NEAR_BONUS` no score de relevância.

---

## Fluxo de Dados (Life of a Request)

1. **Entrada**: O cliente chama `GET /api/search?ncm=...`.
2. **Roteamento**: `backend/presentation/routes/search.py` recebe a requisição.
3. **Orquestração**: O `NeshService` analisa a string.
4. **Processamento**:
    - Se for código, o `DatabaseAdapter` busca na tabela `chapters` join `positions`.
    - Se for texto, executa a cascata de Tiers no índice FTS.
5. **Parsing**: Notas de capítulo brutas são processadas por regex para gerar o dicionário `parsed_notes`.
6. **Saída**: O backend envia um JSON estruturado contendo resultados, metadados de relevância e IDs de âncora.

---

## Protocolos de Sincronização e IDs

Para que o **Autoscroll** do frontend funcione, o backend deve seguir regras estritas de geração de IDs.

- **Geração de Anchor IDs**: Utiliza `backend/utils/id_utils.py`.
- **Regra**: Codes como `84.17` devem ser transformados em `pos-84-17`.
- **Estabilidade**: O algorítmo é determinístico. Qualquer mudança aqui quebra a navegação no frontend.

---

## Performance e Otimizações

- **GZip Middleware**: Todas as respostas JSON > 1KB são compactadas automaticamente para economizar banda.
- **Asyncio Everywhere**: Todo o fluxo (desde a rota até o banco) é assíncrono, permitindo alta escalabilidade.
- **FastAPI Lifespan**: O banco de dados e os serviços são inicializados uma única vez no startup e fechados graciosamente no shutdown.

---

## Segurança e Secrets

- **Carregamento de config**: Secrets são lidos via `.env`/env vars pelo `AppSettings`.
- **Rotação com coexistência**: Tokens e senhas aceitam valor atual e anterior (janela de convivência).
- **Hot-reload**: Endpoint `POST /api/admin/reload-secrets` recarrega secrets sem reiniciar.
- **Script de rotação**: `scripts/rotate_secrets.py` gera novos valores e preserva os anteriores.

Para detalhes operacionais, veja `docs/AI Context/Backend/Seguranca.md`.

---

## Debugging

Para diagnosticar problemas no backend:

1. **Logs do Servidor**: Verificado no terminal de execução do `Nesh.py`. Logs de SQL e lógica de serviço estão habilitados.
2. **Health Check**: Endpoint `GET /api/system/health` verifica a integridade dos bancos `nesh.db` e `tipi.db`.
3. **Exceptions**: Erros são capturados globalmente e retornam JSON padronizado com `detail` e código de erro (`NeshError`).
