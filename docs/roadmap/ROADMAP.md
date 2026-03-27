# Strategic Roadmap & Technical Debt Paydown - Nesh/Fiscal

Este roadmap organiza a evolução do Nesh de uma ferramenta de busca estática para uma **Plataforma de Inteligência Fiscal e Classificação Colaborativa**. A prioridade mantém-se em Segurança e Estabilidade, seguida pela modernização da infraestrutura e novas funcionalidades de IA.

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

### Guia para Iniciantes: o que o script start_nesh_dev.bat faz (e o que nao faz)

- O script de desenvolvimento ajuda a validar o ambiente local, subir Docker, iniciar backend/frontend e checar se os servicos responderam.
- Isso e excelente para desenvolvimento e testes na sua maquina.
- Isso nao substitui deploy de producao para usuarios reais.

Em resumo:

- Ambiente local (dev): start_nesh_dev.bat.
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

- Frontend: Vercel ou Netlify.
- Backend: Render, Railway ou Fly.io.
- Banco: PostgreSQL gerenciado.

Sequencia sugerida:

- Publicar backend e validar endpoint de status.
- Publicar frontend apontando para a URL publica do backend.
- Configurar dominio e HTTPS.
- Executar checklist de QA e liberar para usuarios.

- [ ] **[Backend] Criar `Dockerfile` otimizado**
- [ ] **[Infra] Setup do Banco PostgreSQL gerenciado (Neon/Railway)**
- [ ] **[Infra] Deploy do Backend (Railway/Render)**
- [ ] **[Infra] Deploy do Frontend (Vercel/Netlify)**
- [ ] **[Infra] Configurar domínio e HTTPS**

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
