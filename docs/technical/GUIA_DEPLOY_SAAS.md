# Guia de Estratégia e Implementação SaaS B2B (Brasil)

> **Status:** Atualizado com análise estratégica para Solopreneurs.
> **Foco:** Time-to-market, Conformidade Fiscal (NFS-e) e Segurança por Design.

Este guia define a arquitetura de referência para vender o Nesh/Fiscal para empresas, priorizando a eficiência operacional de uma "eu-equipe".

---

## 1. Arquitetura de Dados: PostgreSQL & Row-Level Security

A premissa de usar SQLite é válida para protótipos, mas inviável para B2B Multi-tenant devido a travamento em escritas (locking) e falta de segurança nativa.

### A Mudança de Paradigma

* **De:** SQLite (Arquivo local, tipagem dinâmica, segurança na aplicação).
* **Para:** **PostgreSQL** (Servidor, tipagem estrita, segurança no banco).

### Onde a Mágica Acontece: Row-Level Security (RLS)

Em vez de confiar que o programador *nunca* vai esquecer um `WHERE tenant_id = X`, nós configuramos o banco para bloquear isso fisicamente.

* **Como funciona:** O banco de dados sabe quem é o "tenant atual" da sessão. Se o usuário tentar fazer `SELECT * FROM sales`, o banco retorna *apenas* as linhas dele, mesmo que a query não tenha filtro.
* **Benefício:** Elimina vazamento de dados acidental entre clientes (risco existencial em B2B).

---

## 2. Gestão de Identidade (IAM): Não faça o seu próprio Auth

Para B2B, autenticação não é só "login/senha". É:

* Convites por email.
* Múltiplos usuários por empresa com níveis de acesso diferentes (Admin vs Leitor).
* Alternar entre organizações.

### Recomendação: **Clerk.com** ou **Supabase Auth**

* **Por que não fazer na mão?** Criar tabelas de `users`, `organizations`, `members`, `invites` e fluxos de recuperação de senha consome semanas e gera dívida técnica.
* **Por que Clerk?** Possui componentes prontos (React) para "Criar Organização", "Convidar Membros" e "Perfil". Entrega o `org_id` direto no Token para o Backend.

---

## 3. Billing & Fiscal: O Nó Brasileiro (NFS-e)

Vender SaaS no Brasil exige emissão de Nota Fiscal de Serviço (NFS-e) para cada pagamento.

### O Problema do Stripe/Mercado Pago

Eles processam o pagamento, mas **não emitem a nota fiscal de serviço** automaticamente para sua prefeitura. Você teria que contratar um *middleware* (como eNotas) e integrá-lo, adicionando um ponto de falha.

### A Solução: **Asaas** (Recomendado)

O Asaas é "All-in-One" para o Brasil.

* **Cobrança:** Aceita PIX, Boleto e Cartão.
* **Fiscal:** Emite a NFS-e automaticamente após o pagamento e envia para o cliente.
* **Inadimplência:** Tem régua de cobrança automática (SMS/Zap/Email).

**Veredito:** Use Asaas para eliminar a necessidade de codar integração fiscal.

---

## 4. Stack de Referência (O Roteiro da Vitória)

| Camada | Tecnologia | Motivo |
| :--- | :--- | :--- |
| **Banco** | **PostgreSQL** | Suporte a RLS, JSONB e Concurrência real. |
| **Auth** | **Clerk** | Front-end pronto para gestão de Org e Users. |
| **Backend** | **FastAPI** | Async nativo. Middleware injeta `tenant_id` do Clerk no Postgres. |
| **Billing** | **Asaas** | Resolve Pagamento + Nota Fiscal em uma única API. |
| **Infra** | **Railway/Render** | Zero ops. Deploy automático via Git. |

---

## 5. Plano de Migração Técnica

### Fase 1: Fundação Sólida (Semana 1)

1. **Migrar para Postgres:** Rodar Postgres localmente via Docker.
2. **Implementar RLS:** Criar tabelas com coluna `tenant_id` e políticas de segurança.
3. **Refatorar Models:** Adaptar `SQLModel` para usar a nova estrutura.

### Fase 2: Identidade B2B (Semana 2)

1. **Setup Clerk:** Criar conta e configurar projeto.
2. **Frontend:** Substituir login atual pelos componentes `<SignIn />` e `<OrganizationSwitcher />` do Clerk.
3. **Backend Middleware:** Validar JWT do Clerk e setar contexto do RLS no banco a cada request.

### Fase 3: Dinheiro & Notas (Semana 3)

1. **Conta Asaas:** Habilitar emissão de notas.
2. **Webhook:** Criar endpoint que recebe `PAYMENT_CONFIRMED` do Asaas e libera acesso no sistema.

### Fase 4: Produção (Semana 4)

1. **Deploy:** Subir no Railway.
2. **Domínio:** Configurar HTTPS e DNS.

---

> **Nota do Especialista:** Esta arquitetura permite que você opere como uma empresa grande. Enquanto seus concorrentes gastam tempo arrumando servidor ou integrando nota fiscal na mão, você foca em melhorar o produto.
