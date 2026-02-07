# Seguranca e Rotacao de Secrets (Technical Reference)

Este documento descreve como o backend lida com secrets, rotacao e hot-reload.

## Escopo

Secrets relevantes hoje:
- `AUTH__ADMIN_PASSWORD`
- `AUTH__ADMIN_PASSWORD_PREVIOUS`
- `AUTH__ADMIN_TOKEN`
- `AUTH__ADMIN_TOKEN_PREVIOUS`
- `AUTH__SECRET_KEY`

Esses valores sao carregados via `.env`/env vars pelo `AppSettings`.

## Janela de coexistencia (novo + antigo)

Durante a rotacao, o backend aceita **o valor atual e o valor anterior** para:
- Senha admin
- Token admin

Isso evita downtime quando clientes ainda usam o token antigo.

## Rotacao via script

O script `scripts/rotate_secrets.py`:
1. Le os valores atuais do `.env`.
2. Grava os valores atuais nos campos `*_PREVIOUS`.
3. Gera novos valores e salva em `*_ADMIN_PASSWORD`, `*_ADMIN_TOKEN` e `AUTH__SECRET_KEY`.

## Hot-reload no backend

Endpoint protegido por token admin:
- `POST /api/admin/reload-secrets`

Esse endpoint recarrega as configuracoes de env/.env em runtime, sem reiniciar o servidor.

## Operacao recomendada

1. Executar `python scripts/rotate_secrets.py`.
2. Chamar `POST /api/admin/reload-secrets`.
3. Monitorar acessos e, apos a janela definida, remover `*_PREVIOUS` do `.env`.

## Observacoes

- A troca e segura apenas se o token admin for mantido em sigilo.
- Em producao, preferir Secret Manager e variaveis de ambiente injetadas.
