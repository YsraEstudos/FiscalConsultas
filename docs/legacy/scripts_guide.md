# Guia de Scripts Legados

Este diretório contém scripts que foram usados para debugging e reprodução de bugs específicos no passado. Eles foram mantidos para referência futura, caso problemas similares ocorram.

## Scripts Disponíveis

### `check_nesh.py`

Script simples para verificação manual de funcionalidades do Nesh.

- **Uso:** `python tests/scripts/legacy/check_nesh.py`
- **Contexto:** Usado para verificar o estado inicial do banco ou configuração.

### `debug_fetch_8413.py`

Script criado para debugar problemas na busca/renderização do NCM 8413.

- **Uso:** `python tests/scripts/legacy/debug_fetch_8413.py`
- **Problema Original:** Erro na renderização ou busca específica deste capítulo.

### `reproduce_8413.py`

Versão para reprodução isolada do bug do NCM 8413.

- **Uso:** `python tests/scripts/legacy/reproduce_8413.py`
- **Objetivo:** Garantir que o bug pode ser reproduzido fora do servidor web.

## Recomendação

Antes de rodar estes scripts, verifique se as importações estão corretas, pois a estrutura do projeto pode ter mudado. Você pode precisar ajustar o `PYTHONPATH` ou as importações relativas.
