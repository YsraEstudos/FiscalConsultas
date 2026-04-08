# Render Production Checklist

Este checklist cobre a parte operacional que precisa ser aplicada fora do código para manter `NBS/NEBS` rápidos em produção.

## 1. Backend sempre ativo

- Não use `Free` para o backend de produção.
- O guia oficial do Render informa que serviços `Free` podem entrar em idle após 15 minutos sem tráfego e não são recomendados para produção.
- Troque o web service da API para uma instância paga e mantenha o health check configurado em `/api/status`.

## 2. Mesma região do banco

- Garanta que o web service da API, o Postgres e o Key Value fiquem na mesma região.
- O Render recomenda usar a mesma região e a URL interna do banco/Key Value para minimizar latência e usar a private network.
- Se a API ou o banco já estiverem em outra região, o próprio Render documenta que a região não é alterada in-place; nesse caso, crie um novo recurso na região correta e faça a migração.

## 3. Redis para cache compartilhado

- Provisione um Redis compatível com o backend, como Upstash.
- Se você preferir o ecossistema do Render, um Key Value também funciona.
- Configure a variável `CACHE__ENABLE_REDIS=true`.
- Configure `CACHE__REDIS_URL` com a URL do Redis que você criou.

## 4. Variáveis recomendadas

- `DATABASE__ENGINE=postgresql`
- `DATABASE__POSTGRES_URL=<internal postgres url>`
- `CACHE__ENABLE_REDIS=true`
- `CACHE__REDIS_URL=<upstash redis url>`
- `CACHE__SERVICES_SEARCH_TTL=600`
- `CACHE__SERVICES_DETAIL_TTL=1800`
- `CACHE__STATUS_CACHE_TTL=20`

## 5. Health check

- Em `Settings` do web service, defina `Health Check Path` como `/api/status`.
- O endpoint deve continuar leve e responder rápido; por isso agora ele usa snapshot cacheado no backend.

## Referências oficiais

- Regions: https://render.com/docs/regions
- Postgres/internal URL: https://render.com/docs/databases
- Redis: https://upstash.com/redis
- Health checks: https://render.com/docs/health-checks
- Free limitations: https://render.com/docs/free
