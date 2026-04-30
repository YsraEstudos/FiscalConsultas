# Roadmap Mestre: Nomes Únicos, Refatoração e Evolução do Produto

> [!IMPORTANT]
> Documento canônico consolidado. O conteúdo de `ROADMAP_NOMES_UNICOS_IA.md` e `refatoracao.md` foi absorvido aqui para evitar fragmentação e perda de contexto.
> Use este arquivo como fonte única para diagnóstico, renomeação, refatoração e acompanhamento do progresso.

## Prompt Inicial do Agente

> Você é o agente responsável por analisar este repositório para refatoração guiada por nomes únicos, trabalhando um arquivo por vez.
> 1. Escolha um único arquivo do mapa de refatoração, leia apenas o necessário para entendê-lo e diga se ele realmente precisa de refatoração.
> 2. Dentro desse arquivo, identifique todos os nomes genéricos, ambíguos, duplicados ou colidentes, incluindo funções, handlers, utilitários, classes, variáveis públicas e scripts auxiliares.
> 3. Para cada nome problemático, rastreie onde ele é usado, proponha um nome mais específico e valide colisões até que a nova identificação seja única, pesquisável e semanticamente estável no repositório.
> 4. Se o arquivo também tiver funções longas ou responsabilidades concentradas, proponha extração, divisão ou redução de complexidade quando isso melhorar segurança, performance, testabilidade ou legibilidade.
> 5. Produza um plano estruturado para o arquivo analisado, separando bloqueios P0, itens estruturais P1 e limpeza P2, com foco explícito em segurança, performance, qualidade de refatoração e redução de dívida técnica.
> 6. Mantenha um backlog vivo do que ficou pendente e, ao final de cada lote, atualize esta documentação com o que foi concluído, o que foi adiado e qual é o próximo arquivo ou bloco a ser tratado.

## Estado Atual do Documento

| Checkpoint | Status | Saída esperada |
| --- | --- | --- |
| 0. Consolidação | concluído | um único documento canônico |
| 1. Diagnóstico | pendente | inventário de arquivos, hotspots e colisões |
| 2. Nomes únicos | pendente | tabela de renomes canônicos por área |
| 3. Refatoração P0 | em andamento | correções de risco e inconsistências |
| 4. Refatoração P1/P2 | pendente | redução de dívida técnica e limpeza |
| 5. Validação final | pendente | checagem de colisões, scripts e tamanhos |

## Progresso do Lote Atual

- Concluído: criado `scripts/report_long_functions.py` para localizar funções de módulo acima do limite configurado.
- Concluído: adicionados testes cobrindo docstrings multilinha, comentários, diretórios ignorados e exportação JSON com chaves `ITEM_*`.
- Concluído: shortlist das funções acima de 100 linhas incorporada ao roadmap como hotspot funcional confirmado.
- Validado: `pytest tests/unit/test_report_long_functions.py` passou.
- Validado: `python scripts/report_long_functions.py --threshold 20 --no-json` executou com sucesso e gerou inventário do repositório.
- Concluído: alinhei o ciclo de vida do `NbsService` com os nomes canônicos `initializeNbsServiceWithPostgresRepository` e `shutdownNbsServiceResources`, mantendo aliases de compatibilidade.
- Concluído: atualizei os testes de lifecycle do NBS e do bootstrap do app para cobrir o contrato novo.
- Validado: `pytest tests/unit/test_nbs_service.py tests/unit/test_app_lifespan_additional.py` passou com sucesso usando base temp explícita.
- Concluído: movi o ponto principal de execução do NESH para o método canônico `executeNeshSearchWithVectorWeights`, mantendo `process_request` como alias de compatibilidade.
- Concluído: alinhei a rota `/api/search` para chamar o método canônico do serviço.
- Validado: `pytest tests/unit/test_nesh_service_additional.py tests/integration/test_search_route_contracts.py` passou com sucesso.
- Concluído: refatorei `backend/presentation/routes/search.py`, removi o alias legado `search` e mantive `handleGlobalFiscalSearchRequest` como nome canônico público.
- Concluído: renomeei os handlers auxiliares da mesma rota para `listNeshChapters`, `fetchNeshChapterNotes`, `fetchNeshChapterBody` e `lookupGlossaryDefinition`.
- Concluído: extraí helpers específicos para rate limit, normalização de cache, shaping de resposta, serialização e gzip, reduzindo a responsabilidade concentrada do handler principal.
- Concluído: corrigi o fallback de cache para respostas `type="code"` vindas de queries textuais, usando chave de cache consistente com `shape`.
- Validado: `pytest tests/unit/test_cache_key_normalization.py tests/integration/test_search_route_contracts.py tests/unit/test_system_routes_endpoints.py` passou com sucesso após a refatoração.
- Concluído: renomeei o accessor de métricas da busca para `snapshotSearchCodePayloadCacheMetrics` e atualizei `backend/presentation/routes/system.py` para consumir o novo nome.
- Concluído: refatorei `backend/presentation/routes/tipi.py`, removendo aliases implícitos, renomeando handlers públicos para nomes específicos e separando normalização, cache, gzip e highlights.
- Concluído: renomeei o accessor de métricas da TIPI para `snapshotTipiCodePayloadCacheMetrics` e atualizei `backend/presentation/routes/system.py` para consumir o novo nome.
- Concluído: atualizei os testes de highlights, adicionei cobertura unitária para normalização/cache da TIPI e mantive o contrato da rota de busca intacto.
- Validado: `pytest tests/unit/test_tipi_route_cache_key_normalization.py tests/unit/test_tipi_route_highlights.py tests/unit/test_system_routes_endpoints.py` passou com sucesso.
- Concluído: refatorei `backend/services/tipi_service.py`, renomeando a superfície pública para `initializeTipiServiceWithRepositoryFactory`, `searchTipiByNcmCode`, `searchTipiByTextQuery`, `fetchTipiChapterCatalog`, `probeTipiCatalogHealth` e `snapshotTipiInternalCacheMetrics`.
- Concluído: extraí responsabilidades reais do serviço TIPI para o pacote `backend/services/tipi/`, separando health probe e pipeline de busca/cache em módulos menores e mantendo `TipiService` como fachada compatível.
- Concluído: reduzi `backend/services/tipi_service.py` para 379 linhas e preservei os aliases de migração e helpers privados ainda exercitados pela suíte, para não quebrar a transição entre chamadores antigos e novos.
- Validado: `pytest tests/unit/test_tipi_service_additional.py tests/integration/test_tipi_service_contract.py tests/unit/test_system_routes_endpoints.py tests/unit/test_app_lifespan_additional.py tests/integration/test_tipi_api_integration.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: remoção final dos aliases legados de `TipiService` e a troca dos últimos helpers privados genéricos dependem de um passe posterior quando os testes deixarem de depender desses nomes.
- Concluído: extraí o serviço NESH para o pacote `backend/services/nesh/`, separando capítulos/cache e FTS em módulos próprios e reduzindo `backend/services/nesh_service.py` para 270 linhas sem quebrar o contrato público.
- Concluído: removi o fallback com `sys.path` de `backend/services/nesh_service.py`, alinhando o serviço às regras do `AI_CONTEXT.md` sobre imports estáveis e previsíveis.
- Concluído: fechei os últimos helpers internos genéricos do NESH em `backend/services/nesh/chapters.py` e `backend/services/nesh/fts.py`, renomeando o pipeline de capítulos, cache e FTS para nomes específicos.
- Validado: `pytest tests/unit/test_nesh_service_additional.py tests/integration/test_search_route_contracts.py tests/unit/test_system_routes_endpoints.py tests/unit/test_app_lifespan_additional.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: a remoção final da ponte de compatibilidade `_fts_scored_cached` na fachada `NeshService` fica para quando a suíte parar de monkeypatchar esse nome.
- Concluído: refatorei `backend/presentation/routes/system.py`, extraindo normalização/coleta de status para `backend/presentation/routes/system_status.py` e serialização Prometheus para `backend/presentation/routes/system_metrics.py`.
- Concluído: reduzi `backend/presentation/routes/system.py` para 244 linhas, mantendo aliases privados compatíveis para a suíte e aplicando o mesmo limite de rate no `HEAD /status`.
- Validado: `pytest tests/unit/test_system_route_helpers.py tests/unit/test_system_routes_endpoints.py tests/integration/test_search_route_contracts.py tests/unit/test_app_lifespan_additional.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: renomear definitivamente endpoints e helpers genéricos de `system.py` como `get_status`, `get_metrics`, `get_cache_metrics` e `_to_int` fica para o próximo passe de nomenclatura, porque a suíte ainda os referencia diretamente.
- Concluído: reconstruí `backend/server/app.py` como uma fachada fina, separando startup/shutdown em `app_lifecycle.py`, segurança em `app_security.py` e montagem de rotas em `app_routes.py`.
- Concluído: removi os aliases legados públicos de `backend/presentation/routes/system.py` e `backend/services/nesh_service.py`, atualizando os testes para os nomes canônicos.
- Validado: `python -m pytest tests/unit/test_app_lifespan_additional.py tests/unit/test_system_route_helpers.py tests/unit/test_system_routes_endpoints.py tests/unit/test_nesh_service_additional.py tests/integration/test_search_route_contracts.py tests/unit/test_nesh_entrypoint.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: a próxima rodada de nomenclatura pode avançar para os módulos auxiliares de NESH (`backend/services/nesh/chapters.py` e `backend/services/nesh/fts.py`) se quisermos renomear os helpers internos remanescentes.
- Concluído: extraí os helpers puros de rede e contexto de request para `backend/server/middleware_context.py` e `backend/server/middleware_network.py`, além do bloco de JWT/provisionamento para `backend/server/middleware_jwt_support.py`.
- Concluído: enxuguei `backend/server/middleware.py` para mantê-lo como fachada compatível e ponto de montagem da `TenantMiddleware`, preservando os caches e os símbolos públicos ainda usados pelos testes.
- Validado: `python -m py_compile backend/server/middleware.py backend/server/middleware_context.py backend/server/middleware_network.py backend/server/middleware_jwt_support.py` passou com sucesso.
- Validado: `pytest tests/unit/test_middleware_additional.py tests/unit/test_middleware_jwt_cache.py tests/unit/test_app_lifespan_additional.py tests/unit/test_system_routes_endpoints.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: a renomeação final dos helpers stateful do middleware fica para um passe posterior, quando a suíte deixar de depender dos nomes internos antigos.
- Concluído: refatorei `backend/presentation/renderer.py`, extraindo cache/regex para `backend/presentation/renderer_patterns.py`, transforms para `backend/presentation/renderer_text.py` e estrutura/renderização para `backend/presentation/renderer_structure.py`.
- Concluído: reduzi `backend/presentation/renderer.py` para 198 linhas e preservei a compatibilidade dos pontos de monkeypatch usados pela suíte, incluindo o fallback dinâmico do `glossary_manager`.
- Concluído: adicionei o alias `total` ao payload da rota TIPI para manter o contrato de integração enquanto `total_capitulos` continua sendo o campo canônico interno.
- Validado: `pytest tests/unit/test_renderer_additional.py tests/unit/test_renderer_cleanup.py tests/unit/test_renderer_regex.py tests/performance/test_benchmark_renderer.py tests/unit/test_tipi_route_highlights.py tests/unit/test_cache_key_normalization.py tests/integration/test_search_route_contracts.py tests/integration/test_tipi_api_integration.py --basetemp .pytest_tmp` passou com sucesso.
- Concluído: refatorei `backend/services/nbs_service.py`, extraindo bootstrap, cache, health e lógica SQLite para `backend/services/nbs/` e reduzindo a fachada para 183 linhas.
- Concluído: atualizei os chamadores de NBS para os nomes canônicos `searchNbsCatalogEntries`, `fetchNbsCatalogItemDetails`, `fetchNbsCatalogTreePage`, `searchNbsExplanatoryEntries`, `fetchNbsExplanatoryEntryDetails` e `probeNbsCatalogHealth`.
- Concluído: limpei os últimos helpers de rota em `backend/presentation/routes/services.py` e `backend/presentation/routes/system_status.py`, alinhando-os ao contrato canônico da camada NBS.
- Validado: `python -m pytest tests/unit/test_nbs_service.py tests/integration/test_services_route_contract.py tests/unit/test_system_routes_endpoints.py tests/unit/test_app_lifespan_additional.py --basetemp .pytest_tmp` passou com sucesso.
- Adiado: remover os aliases legados de `NbsService` e reescrever os testes que ainda exercitam os nomes antigos fica para um lote posterior, depois que a migração de callers estiver totalmente estável.
- Concluído: refatorei `backend/infrastructure/repositories/nbs_repository.py`, dividindo a persistência NBS em módulos menores e renomeando a superfície pública para `load_nbs_catalog_entries`, `load_nbs_catalog_item_details`, `load_nbs_catalog_tree_page`, `load_nbs_explanatory_entries`, `load_nbs_explanatory_entry_details`, `snapshot_nbs_catalog_counts` e `snapshot_nbs_catalog_metadata`.
- Validado: `python -m pytest tests/unit/test_nbs_repository.py tests/unit/test_nbs_service.py tests/integration/test_services_route_contract.py tests/unit/test_system_routes_endpoints.py tests/unit/test_app_lifespan_additional.py --basetemp .pytest_tmp` passou com sucesso.
- Concluído: adicionei `client/tests/playwright/comments-flow.spec.ts` cobrindo o fluxo crítico de comentários em desktop, mobile e moderação admin com mocks determinísticos de Clerk e das APIs de comentário.
- Concluído: ampliei `client/tests/unit/App.behavior.test.tsx` e `client/tests/unit/ResultDisplay.advanced.test.tsx` para cobrir estados de acesso a serviços, download offline, callbacks de perfil/moderação e variações de sidebar/comentários; `App.tsx` e `ResultDisplay.tsx` chegaram a 100% de linhas.
- Validado: `npm run test -- tests/unit/App.behavior.test.tsx tests/unit/ResultDisplay.advanced.test.tsx tests/unit/ResultDisplay.test.tsx` e `npm run test:e2e -- tests/playwright/comments-flow.spec.ts` passaram com sucesso.
- Concluído: normalizei os testes legados de `Header`, `UserProfilePage` e `services-tabs`, ajustei o timeout do fluxo de deleção do perfil e `npm run test:coverage` voltou a passar.
- Pendente: se quisermos elevar a cobertura além do estado atual, os próximos alvos saem de `App.tsx`/`ResultDisplay.tsx` e passam para os arquivos que ainda aparecem abaixo de 100% no relatório geral.
- Concluído: executei a Fase 1 dos contratos frontend, separando `client/src/types/api.types.ts` em módulos menores (`apiCommon.types.ts`, `apiSearch.types.ts`, `apiServices.types.ts`) e movendo os guards de runtime para `client/src/types/apiResponseGuards.ts`.
- Concluído: refatorei `client/src/utils/nbsChapterNotes.ts` com nomes canônicos (`buildNbsChapterNotesMarkup`, `resolveNbsChapterNumberFromCode`, `lookupNbsChapterNotesEntry`, `buildNbsChapterNotesDocumentHtml`, `openNbsChapterNotesPreviewWindow`) e deixei aliases de transição documentados como deprecated.
- Validado: `npm exec -- vitest run tests/unit/api.types.guards.test.ts src/utils/nbsChapterNotes.test.ts tests/unit/searchResultMarkup.test.ts tests/unit/useSearch.test.tsx tests/unit/ServicesTabContent.test.tsx`, `npm exec -- tsc --noEmit` e `npm run test:coverage` passaram com sucesso.
- Estado após Fase 1: `client/src/utils/nbsChapterNotes.ts` chegou a 100% de linhas; `client/src/types/api.types.ts` virou fachada declarativa; os próximos hotspots do lote continuam sendo `client/src/context/LocalDatabaseContext.tsx` e `client/src/services/api.ts`.

## Protocolo de Execução

1. Analise um arquivo por vez e finalize o diagnóstico completo desse arquivo antes de passar para o próximo.
2. Para cada arquivo, confirme se há refatoração necessária, quais nomes são genéricos ou colidentes e quais dependências precisam ser atualizadas.
3. Quando houver nomes para trocar, valide primeiro as ocorrências textuais e só então proponha o novo nome canônico.
4. Se houver funções longas, responsabilidades misturadas ou trechos difíceis de testar, proponha extração, divisão ou simplificação com foco em segurança, performance e legibilidade.
5. Atualize backend, frontend, scripts e testes afetados pelo nome antigo apenas depois de fechar o diagnóstico do arquivo atual.
6. Reescreva comentários obsoletos que existiam apenas para justificar nomes ruins ou fluxo confuso.
7. Registre o resultado do arquivo no backlog e atualize o progresso deste documento ao encerrar cada lote.

## Regras Para Nomes Únicos

| Regra | Aplicação |
| --- | --- |
| Evitar verbos genéricos | Não usar `process`, `update`, `fetch`, `get`, `handle`, `render`, `parse`, `search`, `sync` sozinho. |
| Explicitar domínio | O nome precisa dizer o objeto e a ação reais, como `generateFiscalAssistanceAiResponse`. |
| Ser único no repositório | Depois de nomear, valide se existe outra definição com o mesmo núcleo semântico. |
| Espelhar semântica entre camadas | Se a API mudar no backend, o nome correspondente no frontend e nos scripts deve refletir o mesmo significado. |
| Preservar rastreabilidade | O nome deve funcionar como ponto de busca direta em `grep`/`ripgrep`. |

### Mapa Inicial de Renomes Canônicos

| Área | Nome genérico atual | Nome canônico sugerido | Observação |
| --- | --- | --- | --- |
| `backend/services/nbs_service.py` | `create_with_repository`, `close` | `initializeNbsServiceWithPostgresRepository`, `shutdownNbsServiceResources` | Já surgindo no bootstrap do app. |
| `backend/services/nesh_service.py` | `search` | `executeNeshSearchWithVectorWeights` | Evitar colisão com outros buscadores. |
| `backend/services/tipi_service.py` | `parse_row` | `parseTipiRegistryRowToDomainModel` | Nome semântico para o parser. |
| `backend/services/ai_service.py` e `comment_service.py` | `get_ai_response` | `generateFiscalAssistanceAiResponse` | Unificar nomenclatura de IA. |
| `backend/services/profile_service.py` | `update_profile` | `updateUserFiscalProfilePreferences` | Foco explícito no perfil fiscal. |
| `backend/presentation/routes/search.py` e `tipi.py` | `get_results` | `handleGlobalFiscalSearchRequest` | Handler de entrada global. |
| `backend/presentation/routes/system.py` e `database_download.py` | `status`, `health` | `getSystemOperationalMetrics`, `fetchStaticDatabaseAsset` | Evitar termos genéricos. |
| `backend/presentation/routes/auth.py`, `profile.py`, `comments.py` | `login` | `handleFiscalUserAuthenticationFlow` | Flow de autenticação explícito. |
| `backend/presentation/routes/webhooks.py` e `services.py` | `on_event` | `processExternalServiceWebhookNotification` | Handler externo inequívoco. |
| `backend/presentation/renderer.py` | `render` | `transformMarkdownToFiscalHtmlStructure` | Nome descritivo para o pipeline. |
| `backend/presentation/tipi_renderer.py` e `schemas/` | `validate` | `validateTipiTaxTableSchemaRegistry` | Validação específica. |
| `client/src/App.tsx` e `main.tsx` | `handleSearch` | `initiateApplicationWideFiscalSearch` | Handler global de busca. |
| `client/src/constants.ts` | `API_URL` | `FISCAL_BACKEND_BASE_ENDPOINT_URL` | Constante explícita e única. |
| `client/src/components/ResultDisplay.tsx` | `handleClick`, `onScroll` | `handleFiscalResultScrollSync`, `toggleSearchTermHighlighterHighlight` | Nomes de interação específicos. |
| `client/src/components/ServicesWorkspace.tsx`, `ServicesTabContent.tsx`, `TabsBar.tsx` | `onChange` | `switchActiveFiscalServiceWorkspaceTab` | Gestão de abas sem ambiguidade. |
| `client/src/components/CommentDrawer.tsx`, `CommentPanel.tsx`, `AIChat.tsx`, `ComparatorModal.tsx` | `submit` | `postAdminFiscalCommentUpdate` | Ação e contexto claros. |
| `client/src/components/Sidebar.tsx`, `Header.tsx`, `Layout.tsx`, `CrossNavContextMenu.tsx` | `toggleSidebar` | `toggleMainNavigationSidebarState` | Estado de navegação explícito. |
| `client/src/services/` | `getData` | `fetchAuthenticatedUserTaxPreferences` | Nome alinhado ao backend. |
| `client/src/hooks/` | `useAuth`, `useFetch` | `useFiscalServiceAuthSession`, `useDebouncedNeshSearchInput` | Hook deve revelar a intenção. |
| `client/src/utils/` | `formatDate` | `formatFiscalSubmissionTimestamp` | Utilitário deve refletir o domínio. |

## Plano de Refatoração Priorizada

### Diagnóstico Rápido

- Hotspots de tamanho: `backend/server/middleware.py` (631), `backend/services/nesh_service.py` (270), `backend/presentation/routes/system.py` (244).
- Hotspots de frontend: `client/src/components/ResultDisplay.tsx` (1865), `client/src/workers/db.worker.js` (1553), `client/src/services/api.ts` (1105), `client/src/context/LocalDatabaseContext.tsx` (946), `client/src/components/ServicesWorkspace.module.css` (908), `client/src/components/SearchHighlighter.tsx` (822), `client/src/App.tsx` (803).
- Complexidade React: `ResultDisplay.tsx` concentra muitos efeitos e lógica de scroll, seleção e fallback.
- Dívida de scripts: muitos arquivos em `scripts/` e testes usam `sys.path.append/insert`.
- Dívida de tipagem: há alto uso de `any` em caminhos centrais do frontend.

### Hotspots Funcionais Confirmados (> 100 linhas)

| Prioridade sugerida | Função | Arquivo | Linhas | Motivo resumido |
| --- | --- | --- | --- | --- |
| P0 | `handleGlobalFiscalSearchRequest` | `backend/presentation/routes/search.py` | 106 | rota crítica, ponto de entrada principal |
| P0 | `run_full_migration` | `scripts/migrate_to_postgres.py` | 115 | migração de dados sensível e longa |
| P1 | `_consolidate_databases` | `scripts/build_offline_db.py` | 292 | núcleo offline com alto acoplamento |
| P1 | `upgrade` | `migrations/versions/012_services_catalog_postgres.py` | 149 | migration grande, precisa segmentação |
| P1 | `upgrade` | `migrations/versions/001_initial.py` | 141 | migration base, revisar legibilidade |
| P1 | `_seed_services_db` | `tests/unit/test_nbs_service.py` | 144 | seed de teste complexo, bom alvo para helpers |
| P1 | `_seed_tipi_db` | `test_support.py` | 133 | suporte de teste pesado, consolidar dados |
| P2 | `create_database` | `scripts/rebuild_index.py` | 113 | script legado com lógica concentrada |
| P2 | `create_database` | `scripts/setup_database.py` | 100 | script legado com lógica concentrada |

Esses nomes entram no próximo lote de corte e extração, em ordem de impacto real no produto e no fluxo de dados.

### P0 - Resolver Primeiro

- [ ] Corrigir o callback de auto-scroll em `client/src/components/ResultDisplay.tsx` e `client/src/App.tsx`.
  - Problema: a assinatura e o consumo do callback estão desalinhados, o que pode quebrar a persistência de scroll entre abas.
- [ ] Fechar o split-brain de renderização entre backend e fallback frontend.
  - Problema: `backend/presentation/renderer.py` e `client/src/utils/NeshRenderer.ts` competem como fontes de verdade.
- [ ] Eliminar o risco de XSS ao confiar no HTML do backend.
  - Problema: a sanitização é pulada em certos caminhos quando `rawMarkdown` vem do backend.
- [ ] Unificar o modelo de domínio duplicado entre `TypedDict` e `SQLModel`.
  - Problema: contratos de resposta vivem em dois lugares com semântica diferente.
- [ ] Centralizar o parsing fragmentado com regex diferentes.
  - Problema: ingestão, runtime e scripts podem divergir na leitura de NCM, NBS e notas.
- [ ] Separar os caminhos legado e novo nos serviços híbridos.
  - Problema: `if self._use_repository` mistura dois fluxos de execução no mesmo arquivo.

### P1 - Refatorar Em Seguida

- [ ] Eliminar a duplicação de cache/gzip nas rotas de busca.
  - Problema: `backend/presentation/routes/search.py` e `backend/presentation/routes/tipi.py` têm payloads quase copiados.
- [ ] Quebrar os arquivos tipo god class/god component.
  - Problema: `ResultDisplay.tsx` ainda concentra scroll, seleção e fallback em um componente grande.
- [ ] Alinhar a geração de `anchor_id` entre backend e frontend.
  - Problema: a estratégia de idempotência não é igual nas duas camadas.
- [ ] Remover hacks de path/import e ruído de debug.
  - Problema: há `sys.path` manual e prints que enfraquecem a execução em IDE, CI e produção.
- [ ] Consolidar configurações duplicadas e conflitantes.
  - Problema: limites e flags aparecem em mais de uma fonte.
- [ ] Controlar o middleware com cache global manual e tarefas fire-and-forget.
  - Problema: lifecycle e observabilidade ficam frágeis.

### P2 - Limpeza Estrutural

- [ ] Aumentar a tipagem do frontend.
  - Problema: o uso de `any` em caminhos centrais reduz segurança de refactor.
- [ ] Cobrir melhor o core NESH com testes.
  - Problema: o contrato de rota é testado, mas a lógica pesada de serviço e parsing ainda precisa de mais foco.
- [ ] Substituir o entrypoint placeholder por uma entrada real do produto.
  - Problema: o arquivo principal não representa o comportamento final da aplicação.

## Auditoria de Tamanho de Arquivos

### Backend acima de 800 linhas

- `backend/server/middleware.py` - 631 linhas
- `backend/services/nbs_service.py` - 183 linhas (fachada após split)
- `backend/services/nesh_service.py` - 920 linhas
- `backend/presentation/routes/system.py` - 875 linhas

### Client acima de 800 linhas

- `client/src/components/ResultDisplay.tsx` - 1865 linhas
- `client/src/workers/db.worker.js` - 1553 linhas
- `client/src/services/api.ts` - 1105 linhas
- `client/src/context/LocalDatabaseContext.tsx` - 946 linhas
- `client/src/components/ServicesWorkspace.module.css` - 908 linhas
- `client/src/components/SearchHighlighter.tsx` - 822 linhas
- `client/src/App.tsx` - 803 linhas

## Checklist Obrigatório de Validação

1. [ ] Rodar busca de colisões para cada nome novo e elevar ainda mais a especificidade se houver mais de uma definição relevante.
2. [ ] Verificar sincronia entre backend e frontend sempre que um nome de API mudar.
3. [ ] Simplificar comentários obsoletos que só existem porque o nome anterior era ruim.
4. [ ] Revisar `scripts/` e `test_support.py` para ajustar helpers que chamam funções renomeadas.
5. [ ] Executar `node client/scripts/verify-file-lengths.cjs` e priorizar os arquivos acima de 800/1000 linhas.
6. [ ] Fazer um teste de navegação textual pedindo para achar a função só pelo nome novo.
7. [ ] Encerrar cada lote atualizando a seção de estado deste documento.

---

## 🚀 Visão 2024: "Nesh Inteligente"

Transformar a busca de palavras-chave em **busca de intenção**, integrando múltiplos domínios (NCM, NBS, UNSPSC) e permitindo colaboração ativa (Assinaturas e Comentários).

## 🏛️ Os Pilares do Estado da Arte (The North Star)

Para atingir o nível de excelência técnica, o projeto deve perseguir estes quatro pilares:

- **Qualidade de Código (SonarQube/Linters):** Código limpo, legível e que segue padrões.
- **Observabilidade e Resiliência:** O sistema avisa quando está morrendo? Ele se recupera sozinho? (Logs, Metrics, Tracing).
- **Testes Automatizados (Cobertura e Qualidade):** Não apenas a porcentagem de cobertura que o Sonar indica, mas se os testes de fato garantem que o software funciona sob estresse.
- **Velocidade de Entrega (CI/CD):** O quão rápido e seguro é o caminho do código da sua máquina para a mão do usuário.

---

## Fase 0: Fundação de Segurança (Imediato)

- [x] **[Seguranca] Remover Credenciais Hardcoded (#1)**
- [x] **[Seguranca] Política de Secrets e Rotação**
  - Definir formato/escopo, prazo de rotação e processo com janela de coexistência.
- [x] **[Seguranca] Autenticação Profissional (JWT)**
  - Migrar para JWT assinado com expiração e suporte a múltiplos usuários (Essencial para Assinaturas).
- [x] **[Seguranca] Rate Limiting e Proteção Anti-Abuso**
  - Limitar tentativas de login e chamadas de IA por IP/usuário.
- [x] **[Seguranca] Hardening de HTTP**
  - CORS estrito, cabeçalhos de segurança (cache) e limitação de métodos.

## Fase 0.5: Segurança Avançada (Futuro) 🔒

*Melhorias contínuas baseadas no baseline atual de segurança.*

- [ ] **[Seguranca] Rate Limit com Redis**
  - Migrar o limiter de in-memory para Redis, tornando o rate limit escalável em múltiplos workers.
- [ ] **[Seguranca] Hardening HTTP Estrito**
  - Adicionar cabeçalhos de proteção (CSP, X-Frame-Options, HSTS, X-Content-Type-Options).
  - Restringir `allow_methods` do CORS para apenas os métodos estritamente necessários.
- [ ] **[Seguranca] Rotação Autenticada**
  - Aplicar os prazos de rotação definidos no recém-criado `SECRETS_POLICY.md`.

## Fase 1: Modernização da Infraestrutura (Crítico) ✅

*Substitui a dependência de SQLite por uma base robusta para dados "vivos".*

- [x] **[Backend] Migração para PostgreSQL + SQLModel**
  - Configurar Docker/Postgres e implementar SQLModel para segurança de tipos.
  - Substituir drivers síncronos/aiosqlite por uma stack PostgreSQL assíncrona.
- [x] **[Backend] Migrações com Alembic**
  - Implementar controle de versão do banco para permitir atualizações sem perda de dados de usuários.
- [x] **[Backend] Padronizar Tratamento de Erros (#5)**
- [ ] **[Backend] Timeout e Circuit Breaker**
- [ ] **[Infra] Backup e Recuperação (Postgres)**
  - Procedimento de backup contínuo (ex: WAL-G ou backups gerenciados).

## Fase 1.5: Refatoração de Coesão (Dívida Técnica) 🧹

*Unificação de lógicas fragmentadas para aumentar a confiabilidade e facilitar mudanças futuras. Baseado na [Análise de Coesão](file:///c:/Users/israe/OneDrive/Documentos/faz%20tudo/Fiscal/docs/analysis/cohesion_analysis.md).*

- [ ] **[Backend] Unificar Lógica de Parsing (Core Lib) (#Refactor)**
  - Criar `backend/pkg/nesh_parser` como autoridade única para regex e parsing de NCMs/Notas.
  - Implementar `regex.py` (patterns centralizados) e `parser.py` (text to domain objects).
  - Eliminar duplicação entre `setup_database.py`, `ingest_markdown.py`, `nesh_service.py` e `renderer.py`.
- [ ] **[Backend] Modelos de Domínio Ricos (Pydantic)**
  - Substituir `TypedDict` por Pydantic Models em `backend/domain/models.py`.
  - Centralizar lógicas de validação e geração de IDs (ex: `anchor_id`) no modelo.
  - Explorar geração automática de tipos TypeScript para o Frontend.
- [ ] **[Scripts] Padronização de Scripts**
  - Refatorar scripts em `scripts/` para importar lógica do backend (`backend.services.ingestion`) em vez de duplicar código.
  - Eliminar hacks de `sys.path.append` centralizando a lógica de execução.
- [ ] **[Backend] Unificação da Camada de Serviço (Engine Pattern)**
  - Criar `backend/infrastructure/search_engine.py` para consolidar `NeshService` e `TipiService`.
  - Abstrair FTS (SQLite/Postgres switch), Connection Pooling e Caching.
- [ ] **[Frontend] Estratégia de Renderização (SSR)**
  - Remover "Split Brain" (desativar fallback de renderização no `NeshRenderer.ts`).
  - Garantir que o Backend seja a única fonte de verdade para o HTML do conteúdo.

## Fase 2: Observabilidade e Qualidade

- [ ] **[Ops] Logging Estruturado**
- [ ] **[Ops] Métricas Básicas (Healthcheck profundo, latência p95)**
- [ ] **[Ops] Endpoint Prometheus `/api/metrics`**
  - Exportar métricas (counters/gauges/histogram) para: latência por rota, p95/p99, tamanho/hit-rate dos caches (payload cache + caches internos), status do banco/Redis.
  - Proteger com allowlist/rede interna ou token admin (não expor publicamente).
- [ ] **[QA] Testes de Regressão Críticos**
  - Cobrir login, search e chat com mocks estáveis.
- [ ] **[Frontend] Tipagem Forte do Nível de API (#11)**
- [ ] **[Code] Remover Console Logs e Prints (#6, #12)**
- [ ] **[CI/Quality] Padronizar análise Sonar no GitHub Actions**
  - Desativar Auto Analysis no SonarCloud: `Administration` -> `Analysis Method` -> desligar `Automatic Analysis`.
  - Adicionar secret no GitHub: `SONAR_TOKEN` (token do SonarCloud).
  - Criar `.github/workflows/sonar.yml`:

```yaml
name: Sonar

on:
  push:
    branches: [main]
  pull_request:

jobs:
  sonar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Sonar scan
        uses: SonarSource/sonarqube-scan-action@v5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        with:
          args: >
            -Dsonar.projectKey=SEU_PROJECT_KEY
            -Dsonar.organization=SUA_ORG
            -Dsonar.python.version=3.13
```

- Garantir `sonar-project.properties` na raiz com `sonar.python.version=3.13`.
- Fazer push e executar nova análise para validar remoção do warning.

## Fase 3: Arquitetura e Inteligência de Busca (IA)

- [ ] **[Backend] Busca Semântica (pgvector)**
  - Gerar embeddings para NCM e NESH; implementar busca por proximidade vetorial.
- [ ] **[Data] Domínio UNSPSC e Multilíngue**
  - Carga da tabela UNSPSC (PT/EN) com busca inteligente por termos relacionados.
- [x] **[Backend] Injeção de Dependência (#7)**
  - Refatorar `AppState` global para `Depends()`.
- [x] **[Config] Centralizar Configurações (#17)**

## Fase 4: Qualidade de Produto (UX e SEO)

- [ ] **[UX] Acessibilidade Básica**
- [ ] **[SEO] Sitemap e Metadados**
- [ ] **[UX] Performance Frontend (Auditoria de bundle)**
- [ ] **[UI] Polimento Visual e Consistência (Premium Look)**
- [ ] **[Feature] Scroll do Mouse Fecha Abas**

## Fase 5: Colaboração e Expansão (SaaS Ready)

- [ ] **[Feature] Comentários Colaborativos (Estilo Google Docs)**
  - Comentários inline nas posições e notas explicativas.
- [ ] **[Feature] Gestão de Mudanças na Lei**
  - Sistema de versionamento para NCMs excluídos ou alterados (vigência temporal).
- [ ] **[Data] Integração NBS (Serviços)**
  - Carga da NBS e Notas Explicativas da NBS.
- [ ] **[Frontend] Painel de Administração e Gestão de Usuários**

---

## 🆕 Fase 6: Frontend B2B (Clerk Integration) ✅

*Conectar o Frontend ao Backend multi-tenant via autenticação Clerk.*

- [x] **[Frontend] Instalar SDK Clerk (`@clerk/clerk-react`)**
- [x] **[Frontend] Configurar `ClerkProvider` no `main.tsx`**
- [x] **[Frontend] Integrar `AuthContext` com hooks Clerk (`useUser`, `useAuth`)**
- [x] **[Frontend] Adicionar interceptor no axios para enviar JWT no header `Authorization`**
- [x] **[Frontend] Componentes de Login (SignIn, SignUp, UserButton, OrganizationSwitcher)**
- [x] **[Backend] Descontinuar login legado (`/api/login`, `/api/logout`) e proteger APIs de auth com JWT Clerk**

## 🆕 Fase 6.1: Refino de Frontend (Tabs & Context)

- [ ] **[Frontend] Extrair `tabs.map()` para `TabContent` memoizado**
  - Pode exigir ajuste fino no `TabPanel`/keep-alive para ganho real de performance.
- [ ] **[Frontend] Split do `CrossChapterNoteContext` em dois contextos (dados/ações)**
  - Por enquanto, ficou com `useMemo` + cache limitado.

## 🆕 Fase 7: Billing Profissional (Asaas) 💰

*Automatizar pagamentos e emissão de NFS-e para clientes B2B.*

- [x] **[Backend] Criar Model `Subscription` e tabela de planos**
- [x] **[Backend] Implementar Webhook `/api/webhooks/asaas`**
- [x] **[Backend] Lógica de provisionamento de Tenant após confirmação de pagamento**
- [ ] **[Infra] Configurar conta Sandbox Asaas e API Key**

## 🆕 Fase 8: Infraestrutura de Produção ☁️

*Tirar tudo do localhost e colocar na nuvem.*

### Guia para Iniciantes: o que o script testar_tudo_local.bat faz (e o que nao faz)

- O script de desenvolvimento ajuda a validar o ambiente local, iniciar backend/frontend e checar se os servicos responderam.
- Isso e excelente para desenvolvimento e testes na sua maquina.
- Isso nao substitui deploy de producao para usuarios reais.

Em resumo:

- Ambiente local (dev): `testar_tudo_local.bat`.
- Ambiente publico (producao): plataforma de deploy + dominio + HTTPS + variaveis seguras + monitoramento.

### Checklist de Publicacao (passo a passo simples)

- [ ] **[Infra] Separar ambiente de Producao do ambiente local**
  - Criar variaveis de ambiente de producao (sem debug, sem valores de teste).
  - Garantir que nenhuma chave fique hardcoded no repositorio.
- [ ] **[Backend] Build e execucao de Producao**
  - Rodar o backend por Dockerfile ou processo gerenciado (nao usar servidor de desenvolvimento).
  - Configurar restart automatico e logs persistentes.
- [ ] **[Frontend] Build estatico de Producao**
  - Gerar build com Vite e publicar artefatos estaticos em plataforma de frontend.
  - Configurar URL do backend via variavel de ambiente do frontend.
- [ ] **[Offline] Anexar artefato offline ao release**
  - Gerar `database/fiscal_offline.enc` e `database/fiscal_offline.meta` a partir dos bancos locais confiaveis.
  - Validar o contrato de metadata antes de publicar o frontend.
- [ ] **[Infra] Banco PostgreSQL gerenciado + backup**
  - Usar banco gerenciado (Neon, Railway, Render, etc.) com backup automatico.
  - Aplicar migracoes Alembic no ambiente de producao.
- [ ] **[Seguranca] Dominio + HTTPS + CORS correto**
  - Apontar dominio do frontend e backend.
  - Ativar TLS/HTTPS obrigatorio.
  - Restringir CORS para os dominios oficiais da aplicacao.
- [ ] **[Ops] Healthcheck e observabilidade minima**
  - Manter endpoint de status ativo.
  - Centralizar logs e acompanhar erros de inicializacao/rotas criticas.
- [ ] **[QA] Teste final antes de abrir para usuarios**
  - Validar login, fluxo principal de busca, webhook Asaas e erros comuns.
  - Confirmar tempo de resposta aceitavel em cenarios reais.

### Rota recomendada (mais facil para iniciantes)

- Frontend: Cloudflare Pages ou GitHub Pages.
- Backend: Render, Railway ou Fly.io.
- Banco: PostgreSQL gerenciado.
- Modo offline: empacotar e distribuir `fiscal_offline.enc` + `fiscal_offline.meta` junto do deploy aplicavel.

Sequencia sugerida:

- Publicar backend e validar endpoint de status.
- Publicar frontend apontando para a URL publica do backend.
- Publicar ou anexar o artefato offline e validar `GET /api/database/version`.
- Configurar dominio e HTTPS.
- Executar checklist de QA e liberar para usuarios.

- [ ] **[Backend] Criar `Dockerfile` otimizado**
- [ ] **[Infra] Setup do Banco PostgreSQL gerenciado (Neon/Railway)**
- [ ] **[Infra] Deploy do Backend (Railway/Render)**
- [ ] **[Infra] Deploy do Frontend (Cloudflare Pages/GitHub Pages)**
- [ ] **[Infra] Configurar domínio e HTTPS**

## 🆕 Fase 8.1: Modo Offline Total no Navegador ✅

*Leitura e pesquisa fiscal local apos instalacao em um botao, mantendo a UX existente.*

- [x] **[Frontend] Instalar banco local com um clique**
  - `DatabaseInstaller` + `LocalDatabaseContext` controlam instalar, atualizar, remover e propagar estado entre abas.
- [x] **[Frontend] Persistir artefato offline em OPFS**
  - o worker local salva o pacote criptografado e reabre sem redownload desnecessario.
- [x] **[Frontend] Cachear o app shell via service worker**
  - `coi-serviceworker.js` passou a cobrir isolamento para SQLite WASM e shell offline.
- [x] **[Frontend] Resolver `NESH`, `TIPI`, `NBS` e `NEBS` localmente**
  - `useSearch` prioriza o worker local apos a instalacao.
- [x] **[Backend] Distribuir artefato offline com metadata e token efemero**
  - `version`, `token` e `download` cobrem o fluxo de distribuicao.
- [ ] **[Release] Automatizar o empacotamento no fluxo oficial de deploy**
  - consolidar `fiscal_offline.enc` e `fiscal_offline.meta` como artefatos obrigatorios do release.

## 🆕 Fase 9: Diferenciais de IA (Avançado) 🧠

*Busca semântica para entender "intenção" do usuário.*

- [ ] **[Backend] Ativar extensão `pgvector` no PostgreSQL**
- [ ] **[Backend] Gerar embeddings para NCMs (OpenAI/Cohere)**
- [ ] **[Backend] Criar endpoint de Busca Semântica**
- [ ] **[Frontend] Exibir resultados semânticos com "score de relevância"**

---

## 🛠️ Comparativo de Evolução

| Característica | Implementação Atual | Alvo Profissional | Motivo |
| :--- | :--- | :--- | :--- |
| **Banco de Dados** | ~~SQLite~~ **PostgreSQL** ✅ | **PostgreSQL + RLS** | Suporte a multi-usuário e Busca IA |
| **Busca** | FTS5/tsvector | **pgvector (Semântica)** | Entender "intenção" do usuário |
| **Schema** | ~~Rebuild Manual~~ **Alembic** ✅ | **Alembic** | Evolução sem perda de comentários |
| **Usuários** | ~~Local/Único~~ **Clerk JWT** | **JWT + Multi-Tenant** | Monetização e Segurança |
| **Conteúdo** | NCM/NESH/TIPI | **+ NBS + UNSPSC** | Plataforma Fiscal Completa |

---
*Assinado: Arquiteto de Backend / Nesh Project*
