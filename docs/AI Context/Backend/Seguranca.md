# Seguranca, Auth e Operacao de Secrets (estado real 2026-02-17)

Este documento consolida os mecanismos de seguranca **efetivamente ativos** no backend.

## 1) Superficie de Protecao

### 1.1 Middleware de Tenant/Auth

Arquivo: `backend/server/middleware.py`.

- processa apenas rotas `/api/*`.
- ignora rotas publicas definidas em whitelist:
  - `/api/auth/me`
  - `/api/status`
  - `/api/webhooks`
  - prefixo `/api/webhooks/`
- extrai JWT do header `Authorization: Bearer ...`.
- extrai `org_id` do payload Clerk para contexto multi-tenant.
- em desenvolvimento (`debug_mode=true`), pode usar fallback `_tenant` query param ou `org_default`.

### 1.2 Validacao JWT Clerk

Funcao: `decode_clerk_jwt`.

Comportamento:

- producao: valida assinatura com JWKS (`AUTH__CLERK_DOMAIN`).
- desenvolvimento:
  - so aceita decode sem assinatura quando `settings.features.debug_mode=true`.
- tokens expirados/invalidos retornam `None`.

Cache interno:

- cache de decode por hash de token (TTL curto, in-memory).
- objetivo: reduzir custo de validacao repetida.

## 2) Multi-Tenant e RLS

- `TenantMiddleware` define `tenant_context` por request.
- `db_engine.get_session()` injeta `app.current_tenant` via `set_config` quando em Postgres.
- Repositories usam tenant filtering adicional em queries quando aplicavel.

Observacao:

- provisioning de `Tenant`/`User` local ocorre em background com `asyncio.create_task` (best effort).

## 3) Autorizacao Admin

### 3.1 Token administrativo

- header: `X-Admin-Token`
- validacao com `is_valid_admin_token` aceita valor atual e previous.

### 3.2 Fallback por role JWT

- util: `is_admin_payload`
- roles aceitas: `admin`, `owner`, `superadmin`

### 3.3 Rotas protegidas por admin

- `GET /api/cache-metrics`
- `GET /api/debug/anchors` (alem de `debug_mode=true`)
- `POST /api/admin/reload-secrets`

## 4) Endpoint de IA

Arquivo: `backend/presentation/routes/auth.py`.

- `POST /api/ai/chat` exige JWT valido.
- limite de tamanho de mensagem (`settings.security.ai_chat_max_message_chars`).
- rate limit por sliding window (`backend/server/rate_limit.py`):
  - chave por usuario (`sub`) quando possivel
  - fallback por IP
  - retorna `429` com `Retry-After`.
- limitador e in-memory por processo (nao compartilhado entre replicas/workers).

## 5) Webhook Asaas

Arquivo: `backend/presentation/routes/webhooks.py`.

Controles:

- token no header (`asaas-access-token` ou `x-asaas-access-token`) quando configurado.
- limite de payload por `settings.billing.asaas_max_payload_bytes`.
- validacao de JSON e `event`.
- processa apenas `PAYMENT_CONFIRMED`; demais eventos sao ignorados com resposta `processed=false`.

## 6) IP Real e Proxies Confiaveis

Arquivo: `backend/utils/auth.py`.

- `extract_client_ip` usa `X-Forwarded-For` somente se o peer imediato estiver em `trusted_proxy_ips`.
- em desenvolvimento, localhost e auto-confiavel.

Implicacao:

- se `trusted_proxy_ips` nao estiver correto em producao com proxy/LB, o sistema pode usar IP errado para rate limit/auditoria.

## 7) Secrets e Rotacao

### 7.1 Carregamento

- `AppSettings` carrega `.env` + `settings.json`.
- campos admin aceitam current + previous para janela de coexistencia.

### 7.2 Rotacao

- script: `scripts/rotate_secrets.py`
- endpoint de reload: `POST /api/admin/reload-secrets`

Fluxo recomendado:

1. executar script de rotacao
2. chamar endpoint de reload
3. monitorar
4. remover previous apos janela

## 8) Hardening Ja Presente

- padrao de erro controlado via handlers globais.
- webhook com size guard.
- auth de IA com rate limit.
- comparacao de segredo/token com `secrets.compare_digest`.
- CORS configurado com regex mais estrita em desenvolvimento local (`:5173`).

## 9) Lacunas e Riscos Abertos

1. cache de JWT e provisioning sao in-memory (nao compartilhados entre multiplas instancias).
2. ausencia de middleware dedicado para headers de seguranca HTTP (CSP, HSTS, X-Frame-Options, etc.).
3. fluxo dev com decode sem assinatura (aceitavel so em debug, mas sensivel se mal configurado).
4. `TenantMiddleware` usa task background sem observabilidade forte de falha.
5. endpoint `/api/auth/me` e publico por design (retorna apenas `authenticated`), mas depende de contrato claro para nao crescer escopo sensivel no futuro.

## 10) Checklist Operacional de Seguranca

- [ ] `AUTH__CLERK_DOMAIN` configurado em producao.
- [ ] `SERVER__ENV` diferente de development em producao.
- [ ] `features.debug_mode=false` em producao.
- [ ] `trusted_proxy_ips` definido quando houver proxy/LB.
- [ ] `BILLING__ASAAS_WEBHOOK_TOKEN` configurado.
- [ ] rotação periodica de admin token/senha/secret key.
- [ ] monitorar respostas 401/403/429/5xx nos endpoints sensiveis.
