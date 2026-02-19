# Procura Absurda de Refatoracao (com explicacao para crianca)

Data da varredura: 2026-02-17  
Escopo varrido: `backend/`, `client/`, `scripts/`, `tests/`, `docs/roadmap/`.

## Termometro rapido

- Hotspots de tamanho: `backend/presentation/renderer.py` (768 linhas), `backend/services/nesh_service.py` (703), `backend/services/tipi_service.py` (549), `client/src/components/ResultDisplay.tsx` (620), `client/src/App.tsx` (381).
- Complexidade de efeitos React: `client/src/components/ResultDisplay.tsx` tem 13 `useEffect`.
- Sinais de divida de scripts: 15 arquivos com `sys.path.append/insert` em scripts/test scripts.
- Divida de tipagem frontend: 50 ocorrencias de `any` em `client/src`.

## P0 (refatorar primeiro)

1. **Bug real no callback de auto-scroll**
Onde: `client/src/components/ResultDisplay.tsx:138`, `client/src/components/ResultDisplay.tsx:354`, `client/src/App.tsx:409`
Problema tecnico: `ResultDisplay` chama `onConsumeNewSearch(tabId, finalScrollTop)`, mas `App` recebe como se viesse so um numero (`_finalScroll`).
Explicacao para crianca: voce pediu "guarda a posicao da pagina", mas entregaram primeiro o "nome da aba". O caderno salva no lugar errado.
Por que refatorar agora: pode quebrar persistencia de scroll e causar comportamento aleatorio entre abas.

2. **Renderizacao com "duas verdades" (backend + fallback frontend)**
Onde: `client/src/components/ResultDisplay.tsx:441`, `client/src/components/ResultDisplay.tsx:442`, `client/src/utils/NeshRenderer.ts:151`, `backend/presentation/renderer.py:629`
Problema tecnico: existe renderer no backend e outro no frontend como fallback.
Explicacao para crianca: e como ter dois professores ensinando a mesma materia com regras diferentes.
Por que refatorar agora: gera bugs de navegacao/ancora que aparecem so em certos fluxos.

3. **Risco XSS por confiar 100% em HTML do backend**
Onde: `client/src/components/ResultDisplay.tsx:492`, `client/src/components/ResultDisplay.tsx:495`, `client/src/components/ResultDisplay.tsx:497`
Problema tecnico: DOMPurify e pulado quando `rawMarkdown` vem do backend.
Explicacao para crianca: voce abriu a porta porque "acha" que so amigo entra; se entrar alguem malvado, bagunca a casa.
Por que refatorar agora: e superficie de seguranca.

4. **Modelo de dominio duplicado e inconsistente (TypedDict vs SQLModel)**
Onde: `backend/domain/models.py:9`, `backend/domain/models.py:70`, `backend/domain/sqlmodels.py:220`, `backend/domain/sqlmodels.py:232`, `backend/domain/__init__.py:2`
Problema tecnico: contratos de resposta vivem em dois lugares com semantica diferente.
Explicacao para crianca: dois mapas diferentes para chegar no mesmo lugar.
Por que refatorar agora: dificulta evolucao de API e aumenta chance de regressao silenciosa.

5. **Parsing fragmentado em varios pontos com regex diferentes**
Onde: `scripts/setup_database.py:32`, `scripts/setup_database.py:117`, `scripts/rebuild_index.py:44`, `scripts/ingest_markdown.py:103`, `backend/config/constants.py:96`, `backend/services/nesh_service.py:48`
Problema tecnico: regras de parse de notas/NCM divergem entre ingestao e runtime.
Explicacao para crianca: varias pessoas montando o mesmo quebra-cabeca com pecas parecidas, mas nao iguais.
Por que refatorar agora: risco de dados diferentes entre banco precomputado e resposta da API.

6. **Servicos com modo hibrido legado + novo no mesmo arquivo**
Onde: `backend/services/nesh_service.py:76`, `backend/services/nesh_service.py:94`, `backend/services/nesh_service.py:226`, `backend/services/tipi_service.py:55`, `backend/services/tipi_service.py:328`
Problema tecnico: muitos `if self._use_repository` misturando dois caminhos de execucao.
Explicacao para crianca: um carro com dois volantes; cada curva vira uma confusao.
Por que refatorar agora: manutencao cara e alto risco de bug em edge cases.

## P1 (refatorar em seguida)

7. **Duplicacao grande de cache/gzip nas rotas search**
Onde: `backend/presentation/routes/search.py:52`, `backend/presentation/routes/search.py:63`, `backend/presentation/routes/tipi.py:30`, `backend/presentation/routes/tipi.py:41`
Problema tecnico: logica de payload cache quase copiada entre rotas.
Explicacao para crianca: copiar o mesmo dever duas vezes; quando corrige um, esquece o outro.
Por que refatorar: reduzir bug de comportamento divergente e facilitar tuning de performance.

8. **Arquivos "god class/god component"**
Onde: `backend/presentation/renderer.py`, `backend/services/nesh_service.py`, `backend/services/tipi_service.py`, `client/src/components/ResultDisplay.tsx`
Problema tecnico: muitos papeis no mesmo modulo (parsing, render, cache, fallback, observacao de DOM).
Explicacao para crianca: uma mochila com tudo dentro, fica dificil achar o lapis.
Por que refatorar: melhora previsibilidade e testes.

9. **Geracao de anchor id nao alinhada entre backend e frontend**
Onde: `backend/utils/id_utils.py:2`, `backend/utils/id_utils.py:32`, `client/src/utils/id_utils.ts:85`, `client/src/utils/id_utils.ts:89`
Problema tecnico: frontend e idempotente (`pos-` nao duplica), backend nao.
Explicacao para crianca: um amigo coloca etiqueta uma vez, outro cola etiqueta em cima da etiqueta.
Por que refatorar: evita inconsistencias de scroll/anchor.

10. **Hacks de path/import e ruido de debug**
Onde: `backend/services/nesh_service.py:41`, `backend/services/nesh_service.py:42`, `scripts/setup_database.py:17`, `scripts/rebuild_index.py:16`, `scripts/ingest_markdown.py:68`
Problema tecnico: `sys.path` manual e muito `print/debug`.
Explicacao para crianca: puxadinhos na casa para tudo funcionar "na marra".
Por que refatorar: reduz fragilidade entre ambientes (IDE, CI, prod).

11. **Configuracoes duplicadas e conflitantes**
Onde: `backend/config/constants.py:37`, `backend/config/settings.py:63`, `backend/config/constants.py:31`, `backend/server/app.py:162`
Problema tecnico: limites/flags em mais de uma fonte (`MAX_QUERY_LENGTH`, gzip level).
Explicacao para crianca: duas placas dizendo velocidades diferentes na mesma rua.
Por que refatorar: governanca de configuracao.

12. **Middleware com cache global manual e tarefa fire-and-forget**
Onde: `backend/server/middleware.py:30`, `backend/server/middleware.py:35`, `backend/server/middleware.py:317`
Problema tecnico: caches globais manuais + `asyncio.create_task(...)` sem controle de lifecycle.
Explicacao para crianca: deixar varios brinquedos rodando sozinhos sem adulto olhando.
Por que refatorar: risco operacional e observabilidade ruim.

## P2 (limpeza estruturante)

13. **Tipagem frouxa no frontend**
Onde: `client/src/components/ResultDisplay.tsx`, `client/src/components/Sidebar.tsx`, `client/src/services/api.ts`, `client/src/utils/NeshRenderer.ts`
Problema tecnico: uso alto de `any` em caminhos centrais.
Explicacao para crianca: caixas sem etiqueta; voce abre para descobrir o que tem.
Por que refatorar: reduz bugs em refactors futuros.

14. **Cobertura fraca nos pontos mais criticos do core NESH**
Onde: `tests/unit/test_ncm_utils.py` (5 linhas), `tests/integration/test_search_route_contracts.py` (usa fakes em vez de exercitar `NeshService` real)
Problema tecnico: contrato de rota e testado, mas logica pesada de servico/parsing ainda tem pouco teste focado.
Explicacao para crianca: testou a porta da casa, mas nao testou os canos por dentro.
Por que refatorar: confiabilidade de mudancas no parser e ranking.

15. **Entrypoint placeholder sem funcao real**
Onde: `main.py:1`, `main.py:2`
Problema tecnico: arquivo principal imprime "Hello from fiscal!" e nao representa o produto real.
Explicacao para crianca: botao falso no elevador.
Por que refatorar: higiene arquitetural e onboarding.

## Ordem sugerida de execucao

1. Corrigir bug do callback de scroll (item 1).
2. Fechar split-brain de renderizacao e politica de sanitizacao (itens 2 e 3).
3. Unificar contratos de dominio e parser central (itens 4 e 5).
4. Separar caminhos legado/novo em servicos e extrair cache compartilhado de rota (itens 6 e 7).
5. Atacar limpeza de estrutura, configuracao e testes (itens 8 a 15).

