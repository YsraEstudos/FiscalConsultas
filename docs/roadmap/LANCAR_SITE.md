# Checklist de Lançamento Profissional - Nesh/Fiscal

Este documento detalha os passos necessários para transformar o ambiente de desenvolvimento atual em uma plataforma pronta para o público (Produção).

## 🏗️ 1. Infraestrutura e Deploy (Crítico)

O objetivo é tirar a aplicação do "localhost" e garantir alta disponibilidade.

- [ ] **Dockerfile Multi-stage**:
  - Estágio de build para o Frontend (Vite/React).
  - Estágio de runtime para o Backend (FastAPI) servindo os arquivos estáticos.
- [x] **Hospedagem em Nuvem**:
  - Configurar conta no **Railway**, **Render** ou **AWS**.
  - Configurar variáveis de ambiente no painel do provedor (secrets) separadas de desenvolvimento.
- [x] **Banco de Dados Gerenciado**:
  - Provisionar instância de **PostgreSQL** profissional (ex: Neon ou Railway Postgres).
  - Realizar a migração final do schema via `alembic upgrade head`.
- [ ] **HTTPS e SSL / Domínio**:
  - Redirecionar o domínio para o Frontend e a rota da API para o Backend.
  - Garantir certificados SSL (HTTPS) ativos para o funcionamento do Clerk, Webhooks do Asaas e segurança geral.
  - Configurar `SERVER__CORS_ALLOWED_ORIGINS` com lista JSON apenas dos domínios oficiais (sem curingas em produção).

### Estado Atual em Produção (2026-04-09)

- Backend FastAPI publicado no Render e respondendo healthcheck em produção.
- Banco PostgreSQL gerenciado no Neon provisionado com migrações e carga inicial já aplicadas.
- Frontend segue em modo local para desenvolvimento; publicação pública do frontend permanece como etapa pendente de go-live.

---

## 🔧 2. Refatoração de Backend e Dívida Técnica (Essencial)

Garantir que o código esteja robusto, coeso e fácil de manter antes do lançamento.

- [ ] **Unificação da Lógica de Parsing (Core Lib)**:
  - Criar o pacote `backend/pkg/nesh_parser` como fonte da verdade para as Regexes.
  - Unificar os scripts dispersos (`setup_database.py`, `ingest_markdown.py`, `nesh_service.py` e `renderer.py`).
- [ ] **Modelos de Domínio com Pydantic**:
  - Substituir `TypedDict` por Pydantic em `backend/domain/models.py`.
  - Centralizar as validações e as lógicas de gerar IDs (como `anchor_id`) diretamente nos modelos.
- [ ] **Limpeza da Camada de Serviço (Engine Pattern)**:
  - Criar `backend/infrastructure/search_engine.py` para consolidar as buscas (`NeshService` e `TipiService`).

---

## ⚡ 3. Performance e UX Visual (Frontend)

Garantir que a plataforma seja fluida, rápida e passe uma percepção de produto "Premium".

- [x] **Autoscroll robusto e sincronização de navegação**
  - `useRobustScroll.ts` já recebe candidatos de anchor, usa `MutationObserver` e timeout real.
  - `ResultDisplay.tsx` já prepara o DOM antes do scroll e evita corrida entre restauração e auto-scroll.
- [x] **Tabs com lazy loading, keep alive e loading states**
  - `TabPanel` já faz lazy mount + keep alive.
  - `ResultSkeleton` já cobre o carregamento das abas.
  - `TabsBar.tsx` já preserva a visibilidade no strip horizontal e fecha a aba com o botão do meio.
- [ ] **Split do `CrossChapterNoteContext`**
  - Separar dados de notas de ações/fetch para reduzir acoplamento e re-renders.
- [ ] **Renderização Estrita no Frontend**:
  - Desativar o fallback legado em `ResultDisplay.tsx`/`NeshRenderer.ts`, garantindo que o HTML chegue unicamente do backend.

---

## 🔍 4. SEO, Identidade de Marca e Limpeza

Garantir que o site seja encontrável e transmita confiança.

- [ ] **Metadados e indexação**:
  - Adicionar `<meta name="description">` com palavras-chave relevantes.
  - Configurar **OpenGraph (OG Tags)** para pré-visualização em redes sociais.
  - Criar `robots.txt`.
  - Gerar `sitemap.xml` para as páginas públicas.
- [ ] **Ativos Visuais e Limpeza**:
  - Substituir o favicon padrão do Vite pelo logo do Nesh.
  - Executar limpeza de código (remover `console.log` no frontend e `prints` vazados no backend).

---

## 💰 5. Billings, Contratos e Jurídico

Preparar a monetização e proteção legal da plataforma.

- [ ] **Produção Asaas**:
  - Alterar chaves de API da Sandbox para Produção.
  - Validar o `BILLING__ASAAS_WEBHOOK_TOKEN` em ambiente real.
- [ ] **Documentos Legais**:
  - Criar página de **Termos de Uso**.
  - Criar página de **Política de Privacidade** (Conformidade com LGPD).
- [ ] **Fluxo de Onboarding**:
  - Testar o ciclo completo de assinatura: Cadastro -> Pagamento -> Liberação automática de Tenant Pro.

---

## 🛡️ 6. Segurança e Robustez

Proteção contra abusos e falhas técnicas para operação contínua.

- [ ] **Rate Limiting e Cache de Produção**:
  - Migrar rate limit e cache de sessão para Redis em produção.
- [ ] **Auditoria de Variáveis e Log**:
  - Verificar que nenhuma API Key (`GOOGLE_API_KEY`, senhas de DB) existe solta no código.
  - Adequar o `backend/config/logging_config.py` para nível condizente com produção (reduzir DEBUG desnecessário).
- [ ] **Tratamento de Erros Client-Side**:
  - Implementar Error Boundaries no React para telas de erro amigáveis ao invés de "tela branca".

---

## 📊 7. Observabilidade e Monitoramento

- [ ] **Monitoramento de Erros e Logs (APM)**:
  - Integrar logs com Sentry, Datadog ou ferramentas nativas em nuvem.
- [ ] **Healthcheck e Métricas**:
  - Criar um endpoint Prometheus/métrica oculta (`/api/metrics`) protegido por token.

---

## 🚀 8. Futuro Próximo (Pós-Lançamento)

- [ ] Implementar Base de Dados **NBS** e **UNSPSC**.
- [ ] Habilitar **Busca Semântica IA** (pgvector / embeddings).
- [ ] Sistema de **Comentários Colaborativos** interativos no próprio texto (estilo GDocs).

---

## 📅 Roadmap de Produção Sugerido

- **Sprint 1 (Dívida e UX)**: Refatoração do parsing no Backend e os últimos ajustes de UX ainda em aberto (Split do `CrossChapterNoteContext` e renderização estrita no frontend).
- **Sprint 2 (Docker e Infra)**: Subir ambiente de Produção e testar Deploy Backend + Frontend no banco real.
- **Sprint 3 (SEO e QA Jurídico)**: Identidade visual final, Política de Privacidade e testes reais do Asaas com SSL habilitado.
- **Sprint 4 (Monitoramento e Go-Live)**: Ligar endpoints de observabilidade, validar logs e Lançamento Oficial.

---

## ✅ Validação no Código (auditoria atual)

### Já confirmado no repositório

- O shell SPA em `client/index.html` já publica `Content-Security-Policy`, `referrer` policy e `Permissions-Policy` via meta tags, mas isso ainda não substitui um middleware backend centralizado para todas as respostas de API.
- O `client/index.html` já tem `<title>`; o que continua pendente para SEO é `meta description`, OpenGraph, `robots.txt` e `sitemap.xml`.
- O endpoint `GET /api/status/details` existe e é restrito a admin, assim como `GET /api/cache-metrics`.
- O suporte a isolamento por tenant/RLS é real: há injeção de `app.current_tenant` e o script `scripts/setup_postgres_rls.sql` aplica `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` e policies.
- O frontend já usa `TabPanel` com lazy loading/keep alive e já exibe `ResultSkeleton` durante carregamento.
- O clique do meio na `TabsBar` já fecha a aba, então isso não precisa voltar para backlog.
- O callback de `onConsumeNewSearch` já está alinhado entre `ResultDisplay.tsx` e `App.tsx`; o bug descrito no doc de refatoração não se confirma no código atual.
- O fluxo de sanitização de HTML continua passando por `sanitizeRichHtml`, então a hipótese de bypass direto de sanitização não bate com a implementação atual.

### Ainda parcial ou ausente

- O `client/index.html` ainda não tem `meta description`, OpenGraph, `robots.txt` nem `sitemap.xml`.
- Não encontrei `ErrorBoundary` no frontend nem um endpoint `/api/metrics` no backend.
- O `ai_chat_rate_limiter` ainda é em memória; apenas parte dos rate limits já usa Redis.
- O `Dockerfile` já é orientado à produção, mas continua single-stage.
- `ResultDisplay.tsx` ainda mantém o fallback imperativo que cria âncoras por `data-ncm`.
- `NeshRenderer.ts` ainda existe como fallback de frontend, então a renderização não está 100% centralizada no backend.
- `CrossChapterNoteContext` ainda concentra estado e ações no mesmo contexto.

### Leitura correta do checklist

- Trate como concluído apenas o que estiver na seção acima de validação.
- O restante do roadmap continua sendo dívida técnica real ou trabalho de lançamento ainda pendente.

---

## 🛠️ 9. Guia de Operação e Diagnóstico (Onde Investigar?)

Para manutenção rápida e resolução de incidentes em produção, siga este mapa:

| Serviço | Utilidade no Projeto | Onde olhar em caso de erro (Logs) |
| :--- | :--- | :--- |
| **Render** | Hospeda o Backend (API FastAPI) | Painel do Render > Web Service > Aba **Logs** |
| **Neon** | Banco de Dados Principal (PostgreSQL) | Console do Neon > Aba **Operations/Logs** |
| **Upstash** | Cache Global e Rate Limit (Redis) | Console do Upstash > Aba **Logs/Metrics** |
| **Clerk** | Autenticação e Gestão de Usuários | Console do Browser (F12) ou Dashboard do Clerk > **Logs** |

---

## 📉 10. Estratégias para Consumo Mínimo (Neon/Upstash)

O Neon cobra por "Compute Hours" (CU-hrs). Para manter o custo próximo de zero:

- [ ] **10.1 Ativação do Upstash (Crítico)**:
  - Garantir que `CACHE__ENABLE_REDIS=true` e `CACHE__REDIS_URL` estejam configurados.
  - Com Redis, buscas repetidas **não acordam o Neon**, economizando 100% de CU nesses casos.
- [ ] **10.2 Otimização de Busca (Short-circuit)**:
  - Modificar o `NeshService` para interromper buscas secundárias (Tier 3) se o Tier 1 encontrar resultados exatos de alta qualidade.
- [ ] **10.3 Expansão do Cache L1 (In-memory)**:
  - Aumentar `_FTS_CACHE_SIZE` para 256 e `CHAPTER_CACHE_SIZE` para 128 diretamente no código.
- [ ] **10.4 Diagnóstico de "Wake-ups"**:
  - Se o Neon estiver acordando demais sem motivo, verificar o intervalo de polling do endpoint `/api/status` no Frontend ou integrações externas.
