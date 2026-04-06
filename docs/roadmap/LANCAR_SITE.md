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

### Estado Atual em Produção (2026-03-31)

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

- [ ] **Correção Definitiva do Autoscroll**:
  - Refatorar internamente o `useRobustScroll.ts` (remover timeouts/observers desnecessários).
  - Passar `targetId` em `ResultDisplay.tsx` para `useMemo` (evitar race conditions).
  - Eliminar mutações imperativas no DOM (fallback `data-ncm`).
- [ ] **Performance de Múltiplas Abas (Multi-tabs)**:
  - Extrair o mapeamento de abas para um `<TabContent>` memorizado.
  - Fazer split do `CrossChapterNoteContext` (dividir entre contexto de dados e contexto de ações) com cache limitado.
- [ ] **Renderização Estrita no Frontend**:
  - Desativar fallback de renderização no frontend (`NeshRenderer.ts`), garantindo que o HTML da NESH chegue unicamente do backend.
- [ ] **Polimento Visual e Interação**:
  - Adicionar indicadores de carregamento (Loading states) consistentes.
  - O clique do scroll do mouse deve fechar a aba atual.

---

## 🔍 4. SEO, Identidade de Marca e Limpeza

Garantir que o site seja encontrável e transmita confiança.

- [ ] **Otimização de Meta Tags (`client/index.html`)**:
  - Adicionar `<title>` descritivo e único.
  - Adicionar `<meta name="description">` com palavras-chave relevantes.
  - Configurar **OpenGraph (OG Tags)** para pré-visualização em redes sociais.
- [ ] **Ativos Visuais e Limpeza**:
  - Substituir o favicon padrão do Vite pelo logo do Nesh.
  - Executar limpeza de código (remover `console.log` no frontend e `prints` vazados no backend).
- [ ] **Indexação**:
  - Criar arquivo `robots.txt`.
  - Gerar `sitemap.xml` para as páginas públicas.

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
  - Expandir o endpoint `/api/status` para reportar detalhes da conexão (DB/Redis).
  - Criar um endpoint Prometheus/métrica oculta (`/api/metrics`) protegido por token.

---

## 🚀 8. Futuro Próximo (Pós-Lançamento)

- [ ] Implementar Base de Dados **NBS** e **UNSPSC**.
- [ ] Habilitar **Busca Semântica IA** (pgvector / embeddings).
- [ ] Sistema de **Comentários Colaborativos** interativos no próprio texto (estilo GDocs).

---

## 📅 Roadmap de Produção Sugerido

- **Sprint 1 (Dívida e UX)**: Refatoração do parsing no Backend e conserto das issues visuais Críticas (Autoscroll, Multi-tabs).
- **Sprint 2 (Docker e Infra)**: Subir ambiente de Produção e testar Deploy Backend + Frontend no banco real.
- **Sprint 3 (SEO e QA Jurídico)**: Identidade visual final, Política de Privacidade e testes reais do Asaas com SSL habilitado.
- **Sprint 4 (Monitoramento e Go-Live)**: Ligar endpoints de observabilidade, validar logs e Lançamento Oficial.

---

## ✅ Validação no Código (auditoria atual)

### Já confirmado no repositório

- As proteções de cabeçalho já existem no backend, incluindo `CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e `HSTS` condicional.
- O endpoint `GET /api/status/details` existe e é restrito a admin, assim como `GET /api/cache-metrics`.
- O suporte a isolamento por tenant/RLS é real: há injeção de `app.current_tenant` e o script `scripts/setup_postgres_rls.sql` aplica `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` e policies.
- O frontend já usa `TabPanel` com lazy loading/keep alive e já exibe `ResultSkeleton` durante carregamento.
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
