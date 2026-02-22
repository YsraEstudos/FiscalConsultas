# Checklist de Lançamento Profissional - Nesh/Fiscal

Este documento detalha os passos necessários para transformar o ambiente de desenvolvimento atual em uma plataforma pronta para o público (Produção).

---

## 🏗️ 1. Infraestrutura e Deploy (Crítico)

O objetivo é tirar a aplicação do "localhost" e garantir alta disponibilidade.

- [ ] **Dockerfile Multi-stage**:
  - Estágio de build para o Frontend (Vite/React).
  - Estágio de runtime para o Backend (FastAPI) servindo os arquivos estáticos.
- [ ] **Hospedagem em Nuvem**:
  - Configurar conta no **Railway**, **Render** ou **AWS**.
  - Configurar variáveis de ambiente no painel do provedor (secrets).
- [ ] **Banco de Dados Gerenciado**:
  - Provisionar instância de **PostgreSQL** profissional (ex: Neon ou Railway Postgres).
  - Realizar a migração final do schema via `alembic upgrade head`.
- [ ] **HTTPS e SSL**:
  - Garantir certificados SSL ativos para o funcionamento do Clerk e Webhooks do Asaas.

---

## 🔍 2. SEO e Identidade de Marca

Garantir que o site seja encontrável e transmita confiança profissional.

- [ ] **Otimização de Meta Tags (`client/index.html`)**:
  - Adicionar `<title>` descritivo e único.
  - Adicionar `<meta name="description">` com palavras-chave relevantes.
  - Configurar **OpenGraph (OG Tags)** para pré-visualização em redes sociais.
- [ ] **Ativos Visuais**:
  - Substituir o favicon padrão do Vite pelo logo do Nesh.
  - Garantir que logotipos e cores estejam consistentes (Premium Look).
- [ ] **Indexação**:
  - Criar arquivo `robots.txt`.
  - Gerar `sitemap.xml` para as páginas públicas.

---

## 💰 3. Billings e Jurídico

Preparar a monetização e proteção legal da plataforma.

- [ ] **Produção Asaas**:
  - Alterar chaves de API da Sandbox para Produção.
  - Validar o `BILLING__ASAAS_WEBHOOK_TOKEN` em ambiente real.
- [ ] **Documentos Legais**:
  - Criar página de **Termos de Uso**.
  - Criar página de **Política de Privacidade** (Conformidade com LGPD).
- [ ] **Fluxo de Onboarding**:
  - Testar o ciclo completo: Cadastro -> Pagamento -> Liberação automática de Tenant Pro.

---

## 🛡️ 4. Segurança e Robustez

Proteção contra abusos e falhas técnicas.

- [ ] **Rate Limiting de Produção**:
  - Garantir que o rate limit de IA esteja usando um **Redis** persistente em produção.
- [ ] **Auditoria de Variáveis**:
  - Verificar que nenhuma chave de API (`GOOGLE_API_KEY`, etc.) ficou no código-fonte.
- [ ] **Tratamento de Erros**:
  - Implementar telas de erro amigáveis (Error Boundaries) para evitar "tela branca".

---

## 📊 5. Observabilidade e Qualidade

Manutenção e monitoramento pós-lançamento.

- [ ] **Logging Estruturado**:
  - Integrar logs com um serviço externo (ex: Sentry, Logtail ou BetterStack).
- [ ] **Healthcheck Profundo**:
  - Expandir o `/api/status` para reportar a saúde da conexão com o Banco e Redis.
- [ ] **Limpeza de Código**:
  - Executar `npm run lint` e remover todos os `console.log` e comentários de depuração.
- [ ] **Build Final**:
  - Rodar `npm run build` e validar o bundle final para performance máxima.

---

## 📅 Roadmap de Produção

* **Semana 1**: Docker, Deploy em Staging e HTTPS.
- **Semana 2**: SEO, Jurídico e Integração Asaas Produção.
- **Semana 3**: Testes de carga, Auditoria de Segurança e **Go-Live**.
