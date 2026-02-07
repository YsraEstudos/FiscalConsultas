# Segurança e Rotação de Secrets (Technical Reference)

Este documento descreve como o backend lida com secrets, rotação e hot-reload.

## Escopo

Secrets relevantes hoje:
- `AUTH__ADMIN_PASSWORD`
- `AUTH__ADMIN_PASSWORD_PREVIOUS`
- `AUTH__ADMIN_TOKEN`
- `AUTH__ADMIN_TOKEN_PREVIOUS`
- `AUTH__SECRET_KEY`

Esses valores sao carregados via `.env`/env vars pelo `AppSettings`.

## Janela de coexistência (novo + antigo)

Durante a rotação, o backend aceita **o valor atual e o valor anterior** para:
- Senha admin
- Token admin

Isso evita downtime quando clientes ainda usam o token antigo.

## Rotação via script

O script `scripts/rotate_secrets.py`:
1. Le os valores atuais do `.env`.
2. Grava os valores atuais nos campos `*_PREVIOUS`.
3. Gera novos valores e salva em `AUTH__ADMIN_PASSWORD`, `AUTH__ADMIN_TOKEN` e `AUTH__SECRET_KEY`.

## Hot-reload no backend

Endpoint protegido por token admin:
- `POST /api/admin/reload-secrets`

Esse endpoint recarrega as configurações de env/.env em runtime, sem reiniciar o servidor.

## Operacao recomendada

1. Executar `python scripts/rotate_secrets.py`.
2. Chamar `POST /api/admin/reload-secrets`.
3. Monitorar acessos e, apos a janela definida, remover `*_PREVIOUS` do `.env`.

## Observacoes

- A troca é segura apenas se o token admin for mantido em sigilo.
- Em produção, preferir Secret Manager e variáveis de ambiente injetadas.
