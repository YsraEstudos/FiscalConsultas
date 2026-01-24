# Strategic Roadmap & Technical Debt Paydown

Este roadmap integra os 20 pontos da auditoria de código com os objetivos de negócio, priorizando segurança, estabilidade e manutenibilidade.

> [!IMPORTANT]
> **Recomendação de Prioridade:** Sim, os itens da **Fase 1 (Estabilização)** devem ser feitos *antes* de novas features complexas. Eles corrigem falhas de segurança (credenciais expostas), problemas de performance (banco síncrono) e fragilidades de arquitetura que tornarão qualquer desenvolvimento futuro mais lento e propenso a bugs.

## Fase 1: Estabilização Crítica (Imediato)

*Foco: Segurança, Performance do Servidor e Integridade de Dados.*

- [x] **[Segurança] Remover Credenciais Hardcoded (#1)**
  - Migrar senhas e chaves de API para variáveis de ambiente (`.env`).
- [x] **[Backend] Fix Banco de Dados Síncrono (#2)**
  - Migrar `DatabaseAdapter` para `aiosqlite` ou usar `run_in_executor` para não bloquear o servidor.
- [x] **[Backend] Padronizar Tratamento de Erros (#5)**
  - Substituir `try/except Exception` genéricos por tratamento específico e `HTTPException`.
- [x] **[Frontend] Implementar Tipagem Forte do Nível de API (#11)**
  - Criar interfaces TypeScript para todas as respostas da API para evitar erros de runtime em produção.
- [ ] **[Build] Garantir Build do Frontend no Startup (#19)**
  - Criar check de inicialização que alerta ou falha se o bundle estático estiver desatualizado.

## Fase 2: Arquitetura e Limpeza (Próximo Sprint)

*Foco: Qualidade de código, Testabilidade e "Developer Experience".*

- [ ] **[Backend] Injeção de Dependência (#7)**
  - Refatorar `AppState` global para usar `Depends()` do FastAPI.
- [ ] **[Architect] Separar View do Backend (#3)**
  - Remover `HtmlRenderer` da API de busca. Retornar apenas JSON puro.
- [ ] **[Config] Centralizar Configurações (#17)**
  - Criar módulo de config único validado com Pydantic.
- [ ] **[Frontend] Refatorar Componente "God" App.tsx (#13)**
  - Extrair Context Providers e rotas para componentes dedicados.
- [ ] **[Frontend] Remover Lógica de Classe de Componentes (#14)**
  - Converter `App.GlossaryState` e similares para Custom Hooks.

## Fase 3: Padronização e Polimento (Ongoing)

*Foco: Profissionalismo e consistência.*

- [ ] **[Code] Padronizar Idioma e Nomenclatura (#9, #18)**
  - Adotar Inglês como padrão para código e comentários. Unificar termos (`results` vs `resultados`).
- [ ] **[API] Versionamento de API (#10)**
  - Mover rotas para `/api/v1/...`.
- [ ] **[Code] Remover Console Logs e Prints (#6, #12)**
  - Substituir por `logger` estruturado no back e remover logs de debug no front.
- [ ] **[DevOps] Arrumar Scripts e Estrutura (#4, #16, #20)**
  - Organizar scripts de debug, limpar arquivos de requisitos e remover manipulação de `sys.path`.

## Fase 4: Features e UX (Q3 2026 - Integrado)

*Itens originais do roadmap mantidos para contexto futuro.*

- [ ] **PWA (Progressive Web App)**
- [ ] **Assistente de IA Integrado 2.0**
- [ ] **Atualizações Automáticas de Dados**
- [ ] **Dockerização e CI/CD** (Moveu para Q2)
- [ ] **Polimento Visual & UX Profissional** (Pode ocorrer em paralelo com Fase 2/3)

📁 Fiscal/
├── 📄 .env
├── 📄 .env.example
├── 📄 .gitignore
├── 📄 Nesh.py
├── 📄 README.md
├── 📄 nesh.db
├── 📄 tipi.db
├── 📄 pytest.ini
├── 📄 requirements.txt
├── 📄 requirements-dev.txt
├── 📄 start_nesh_dev.bat
│
├── 📁 backend/
│   ├── 📄 **init**.py
│   ├── 📁 config/
│   │   ├── 📄 **init**.py
│   │   ├── 📄 constants.py
│   │   ├── 📄 exceptions.py
│   │   ├── 📄 loader.py
│   │   ├── 📄 logging_config.py
│   │   └── 📄 settings.json
│   ├── 📁 data/
│   │   ├── 📄 **init**.py
│   │   ├── 📄 glossary_db.json
│   │   └── 📄 glossary_manager.py
│   ├── 📁 domain/
│   │   ├── 📄 **init**.py
│   │   └── 📄 models.py
│   ├── 📁 infrastructure/
│   │   ├── 📄 **init**.py
│   │   └── 📄 database.py
│   ├── 📁 presentation/
│   │   ├── 📄 **init**.py
│   │   ├── 📄 renderer.py
│   │   └── 📄 tipi_renderer.py
│   ├── 📁 server/
│   │   ├── 📄 **init**.py
│   │   ├── 📄 app.py
│   │   └── 📄 error_handlers.py
│   ├── 📁 services/
│   │   ├── 📄 **init**.py
│   │   ├── 📄 ai_service.py
│   │   ├── 📄 nesh_service.py
│   │   └── 📄 tipi_service.py
│   └── 📁 utils/
│       ├── 📄 **init**.py
│       ├── 📄 id_utils.py
│       ├── 📄 ncm_utils.py
│       └── 📄 text_processor.py
│
├── 📁 client/
│   ├── 📄 .gitignore
│   ├── 📄 FRONTEND_GUIDE.md
│   ├── 📄 eslint.config.js
│   ├── 📄 index.html
│   ├── 📄 package.json
│   ├── 📄 package-lock.json
│   ├── 📄 tsconfig.json
│   ├── 📄 vite.config.js
│   ├── 📁 public/
│   ├── 📁 dist/
│   ├── 📁 src/
│   │   ├── 📄 App.css
│   │   ├── 📄 App.tsx
│   │   ├── 📄 constants.ts
│   │   ├── 📄 index.css
│   │   ├── 📄 main.tsx
│   │   ├── 📄 setupTests.ts
│   │   ├── 📄 vite-env.d.ts
│   │   ├── 📁 assets/
│   │   ├── 📁 components/
│   │   │   ├── 📄 AIChat.tsx
│   │   │   ├── 📄 ComparatorModal.tsx
│   │   │   ├── 📄 CrossNavContextMenu.tsx
│   │   │   ├── 📄 GlossaryModal.tsx
│   │   │   ├── 📄 Header.tsx
│   │   │   ├── 📄 Layout.tsx
│   │   │   ├── 📄 LoginModal.tsx
│   │   │   ├── 📄 MarkdownPane.tsx
│   │   │   ├── 📄 Modal.tsx
│   │   │   ├── 📄 ResultDisplay.tsx
│   │   │   ├── 📄 ResultDisplay.module.css
│   │   │   ├── 📄 SearchBar.tsx
│   │   │   ├── 📄 SettingsModal.tsx
│   │   │   ├── 📄 SettingsModal.module.css
│   │   │   ├── 📄 Sidebar.tsx
│   │   │   ├── 📄 Sidebar.module.css
│   │   │   ├── 📄 StatsModal.tsx
│   │   │   ├── 📄 TabsBar.tsx
│   │   │   ├── 📄 TextSearchResults.tsx
│   │   │   ├── 📄 TextSearchResults.module.css
│   │   │   └── 📄 TutorialModal.tsx
│   │   ├── 📁 context/
│   │   ├── 📁 hooks/
│   │   │   ├── 📄 useAutoScroll.ts
│   │   │   ├── 📄 useHistory.ts
│   │   │   └── 📄 useTabs.ts
│   │   ├── 📁 services/
│   │   ├── 📁 styles/
│   │   │   ├── 📄 _variables.css
│   │   │   ├── 📄 base.css
│   │   │   ├── 📁 components/
│   │   │   │   ├── 📄 context-menu.css
│   │   │   │   ├── 📄 glossary.css
│   │   │   │   ├── 📄 header.css
│   │   │   │   ├── 📄 match-nav.css
│   │   │   │   ├── 📄 modals.css
│   │   │   │   ├── 📄 tabs.css
│   │   │   │   ├── 📄 toast.css
│   │   │   │   └── 📄 tutorial.css
│   │   │   ├── 📁 features/
│   │   │   │   ├── 📄 ai-chat.css
│   │   │   │   ├── 📄 comparator.css
│   │   │   │   ├── 📄 nesh.css
│   │   │   │   ├── 📄 tax-calculator.css
│   │   │   │   └── 📄 tipi.css
│   │   │   └── 📁 utilities/
│   │   │       ├── 📄 highlights.css
│   │   │       ├── 📄 loading.css
│   │   │       └── 📄 scrollbar.css
│   │   ├── 📁 types/
│   │   └── 📁 utils/
│   └── 📁 tests/
│       ├── 📁 integration/
│       ├── 📁 performance/
│       └── 📁 unit/
│
├── 📁 docs/
│   ├── 📄 AI_CONTEXT.md
│   ├── 📄 RECENT_CHANGES.md
│   ├── 📄 ROADMAP.md
│   ├── 📄 SCRIPT_IDEAS.md
│   ├── 📄 tests_ideas.md
│   └── 📁 legacy/
│
├── 📁 scripts/
│   ├── 📄 analyze_tipi_xlsx.py
│   ├── 📄 ingest_markdown.py
│   ├── 📄 rebuild_index.py
│   ├── 📄 setup_database.py
│   ├── 📄 setup_fulltext.py
│   ├── 📄 setup_tipi_database.py
│   ├── 📄 test_regex.py
│   ├── 📄 test_tipi_filter.py
│   ├── 📁 devtools/
│   ├── 📁 diagnostics/
│   └── 📁 tipi_verification/
│
├── 📁 tests/
│   ├── 📄 conftest.py
│   ├── 📁 integration/
│   │   ├── 📄 test_api_regression.py
│   │   ├── 📄 test_exact_match.py
│   │   ├── 📄 test_fts_debug.py
│   │   ├── 📄 test_health.py
│   │   ├── 📄 test_high_level_validation.py
│   │   ├── 📄 test_snapshot.py
│   │   ├── 📄 test_tipi_advanced_structure.py
│   │   ├── 📄 test_tipi_api_integration.py
│   │   └── 📄 test_tipi_service_contract.py
│   ├── 📁 performance/
│   ├── 📁 scripts/
│   └── 📁 unit/
│       ├── 📄 test_renderer_regex.py
│       ├── 📄 test_tipi_renderer_ids.py
│       ├── 📄 test_tipi_unit_highlights.py
│       └── 📄 test_unit_highlights.py
│
├── 📁 raw_data/
│   ├── 📄 nesh.db
│   ├── 📄 nesh.md
│   ├── 📄 tipi.xlsx
│   └── 📄 unspsc-english-v260801.1.xlsx
│
├── 📁 legacy/
├── 📁 snapshots/
└── 📁 MySkills/

## Anexo A: Idéias de Testes

*Foco: Cobertura de testes e garantias de qualidade.*

### Backend (API e Serviços)

- [ ] **Validação de NCM:** Múltiplos formatos (8517, 8517.12, 85.17.12.31).
- [ ] **Performance do FTS5:** Latência abaixo de 200ms em buscas complexas.
- [ ] **Ranking de Relevância:** Tier 1 acima de Tier 3 consistentemente.
- [ ] **Cache LRU:** Verificação de hits e invalidação.
- [ ] **Conexão SQLite:** Concorrência em modo WAL.
- [ ] **Endpoints de API:** Testes de 404 (inexistente) e 400 (inválido).

### Frontend (Interface e UX)

- [ ] **Smart Links:** Clique em link de NCM dispara nova busca.
- [ ] **Highlight de Unidades:** Verificação de "kg", "m²", etc., sem quebra de HTML.
- [ ] **Navegação por Âncoras:** Scroll automático para `#pos-XXXX`.
- [ ] **Responsividade:** Layouts mobile (sm) e desktop (xl).
- [ ] **Histórico de Navegação:** Botão "voltar" entre abas e consultas.

### Lógica TIPI (Tributação)

- [ ] **Busca por Família:** Retorno de itens filhos e alíquotas.
- [ ] **Badges de Alíquota:** Cores dinâmicas por valor.
- [ ] **Consistência tipi.db:** Independência da busca NESH vs TIPI.

### Segurança e Integridade

- [ ] **Injeção de Script:** Sanitização de tags `<script>` no search/markdown.
- [ ] **Caminhos de Arquivo:** Bloqueio de acesso extra-root.
- [ ] **Integridade do Banco:** Script de verificação de chaves estrangeiras (`chapter_num`).

### Performance e Stress

- [ ] **Carga Inicial:** Tempo de carregamento do DB (20MB+).
- [ ] **Buscas por Prefixo:** Eficiência do `*` em termos comuns.
- [ ] **Consumo de Memória:** Monitoramento de RAM no Python durante renderização intensa.

## Anexo B: Idéias de Scripts

*Foco: Automação, performance e observabilidade.*

### 🚀 Performance (Backend & Infra)

- [ ] **`perf/check_cold_start.py`:** Medir Time to Boot.
- [ ] **`perf/benchmark_warm_latency.py`:** Medir p95/p99 com cache quente.
- [ ] **`perf/stress_sqlite_concurrency.py`:** Limite de leituras simultâneas.
- [ ] **`perf/monitor_memory_leak.py`:** Monitoramento de RSS após 10k requests.
- [ ] **`perf/profile_search_query.py`:** `cProfile` para queries lentas.

### ⚡ Performance (Frontend)

- [ ] **`perf/measure_frontend_tti.js`:** Medir TTI/FCP via Playwright.
- [ ] **`perf/audit_bundle_size.js`:** Check pós-build de `dist/assets`.
- [ ] **`perf/lighthouse_ci.js`:** Auditoria automática de SEO/Performance.
- [ ] **`perf/check_re-renders.js`:** React Profiler para monitorar frame budget.
- [ ] **`perf/verify_image_optimization.py`:** Scan por assets pesados (>100kb).

### 🛡️ Integridade de Dados & QA

- [ ] **`data/verify_smart_links.py`:** Detecção de 404s internos no NESH.
- [ ] **`data/validate_html_structure.py`:** Validação de tags (BeautifulSoup).
- [ ] **`data/check_completeness_tipi.py`:** Comparação com dados oficiais da Receita.
- [ ] **`data/detect_duplicate_entries.py`:** Higiene de NCMs e Glossário.
- [ ] **`qa/test_search_relevance.py`:** Regressão de relevância (Top 3).

### 🛠️ DevOps & Manutenção

- [ ] **`ops/hot_backup_db.py`:** `VACUUM INTO` para backup online.
- [ ] **`ops/clean_logs_rotate.py`:** Rotação e compressão de logs antigos.
- [ ] **`ops/check_dependencies_security.py`:** `pip-audit` e `npm audit`.
- [ ] **`ops/generate_sitemap_local.py`:** Gerador de sitemap para SEO/Navegação.
- [ ] **`ops/healthcheck_deep.py`:** Diagnóstico completo (Ping + Banco + Disco).
