# Roadmap de Correcao MegaLinter (base: 2026-02-22)

## 1) Objetivo

Transformar o resultado atual do MegaLinter em um plano executavel para eliminar erros reais, reduzir falso positivo e manter a pipeline rapida e confiavel.

Fonte principal analisada:

- `docs/analysis/megalinter.log`
- `megalinter-reports/linters_logs/*`

Observacao importante:

- O baseline abaixo e de uma execucao anterior ao ajuste de escopo.
- O arquivo `.mega-linter.yml` ja foi ajustado para reduzir ruido (`.venv`, `client/node_modules`, `client/dist`, `megalinter-reports`, `2ms-report*.json`).
- Antes de atacar correcoes em massa, fazer um novo baseline (Fase 0).

---

## 2) Baseline Atual (snapshot do log)

Resumo extraido de `docs/analysis/megalinter.log` (bloco `+----SUMMARY----+`):

- Falhas em 19 grupos de linter.
- Maior volume de erros:
  - `REPOSITORY_DEVSKIM`: 1148 erros, 2533 warnings
  - `PYTHON_BANDIT`: 908 erros
  - `CSS_STYLELINT`: 515 erros
  - `PYTHON_PYRIGHT`: 298 erros
  - `PYTHON_FLAKE8`: 240 erros
  - `PYTHON_PYLINT`: 159 erros

Grupos com 1 erro (indicam problema pontual/config):

- `YAML_V8R`
- `JSON_JSONLINT`
- `SQL_TSQLLINT`
- `TYPESCRIPT_STANDARD`
- `REPOSITORY_CHECKOV`
- `REPOSITORY_GIT_DIFF`
- `REPOSITORY_KINGFISHER`
- `REPOSITORY_TRIVY`
- `PYTHON_MYPY`

Linters que passaram (importante para manter):

- `REPOSITORY_GITLEAKS`, `REPOSITORY_SECRETLINT`, `REPOSITORY_TRUFFLEHOG`, `REPOSITORY_DUSTILOCK`, `REPOSITORY_SYFT`, `REPOSITORY_TRIVY_SBOM`

---

## 3) Diagnostico: Ruido vs Erro Real

### 3.1 Ruido/Falso positivo dominante

- `DevSkim`: 6218 ocorrencias totais na saida SARIF; quando removido escopo de dependencia/artefato (`.venv`, `node_modules`, `client/dist`, `2ms-report*`), cai para ~67 itens efetivos.
- `Kingfisher`: majoritariamente hits em `.venv`, `node_modules` e arquivos de relatorio.
- `Bandit`: 787 de 908 sao `B101` (assert), em grande parte testes.
- `Pylint/Pyright`: grande parte de `import-error`/`reportMissingImports` por ambiente do container nao refletir deps do projeto.

### 3.2 Erro real prioritario

- Vulnerabilidades de dependencia em lockfiles:
  - `axios` (`CVE-2026-25639`) em `client/package-lock.json`
  - `cryptography` (`CVE-2026-26007`) em `uv.lock`
- `Bandit B608` em SQL dinamico (risco de injecao se qualquer parte vier de input nao confiavel).
- `Checkov` em workflow sem `permissions` explicitas.
- `Pyright` com erros de tipagem reais em backend/repositories/tests (alem de import missing).
- `KICS` com hardening de `docker-compose.yml` (capabilities, bind, healthcheck, security_opt).

---

## 4) Priorizacao de Ataque

### Prioridade P0 (bloqueios e risco real)

1. Rebaseline com novo `.mega-linter.yml`.
2. Corrigir issues pontuais de configuracao:
   - `YAML_V8R` (schema)
   - `TYPESCRIPT_STANDARD` (project file)
   - `JSON_JSONLINT` (comentarios em json strict)
   - `SQL_TSQLLINT` (dialeto inadequado para PostgreSQL)
3. Corrigir `Checkov` no workflow de testes (`permissions`).
4. Atualizar dependencias com CVE alto (`axios`, `cryptography`).

### Prioridade P1 (seguranca e corretude backend)

1. `Bandit` focando `B608` e ignorando estrategicamente ruido de teste (`B101`).
2. `Pyright` e `Pylint` focando backend primeiro (nao testes inicialmente).
3. `Mypy` erro unico de sintaxe.

### Prioridade P2 (qualidade e padronizacao)

1. `Flake8` (E501/W291/E402/F401/F824).
2. `Stylelint` e demais alertas de estilo frontend.
3. `Git diff` (trailing whitespace, fim de arquivo).

### Prioridade P3 (hardening infra)

1. `KICS` (docker-compose hardening).
2. `Grype/Trivy` com politica de severidade e escopo claros.

---

## 5) Plano por Fases (com estimativa)

## Fase 0 - Rebaseline Limpo (0.5-1h)

Objetivo:

- Medir o novo estado com filtros de falso positivo ja aplicados.

Acoes:

- Rodar MegaLinter completo.
- Salvar novo log em `docs/analysis/megalinter_YYYY-MM-DD.log`.
- Comparar contagens com snapshot atual.

Saida esperada:

- Queda forte em `devskim`, `kingfisher`, possivelmente `trivy/grype`.

## Fase 1 - Confiabilidade da Pipeline (2-4h)

Objetivo:

- Remover falhas pontuais que nao sao bug de negocio.

Acoes:

- Garantir `.mega-linter.yml` valido no CI.
- Ajustar `ts-standard` para achar `tsconfig`.
- Resolver `jsonlint` no `client/tsconfig.json` (JSON estrito sem comentario).
- Tratar `tsqllint` (desativar para SQL PostgreSQL ou trocar linter SQL).
- Ajustar workflow para `Checkov` (`permissions` explicitas).

Saida esperada:

- Queda de falhas "1 erro" e menor flakiness de CI.

## Fase 2 - Seguranca Real (4-8h)

Objetivo:

- Eliminar risco de producao imediato.

Acoes:

- Atualizar `axios` para versao fix.
- Atualizar `cryptography` para versao fix.
- Revisar e mitigar `B608` (SQL dinamico) com whitelist/parametrizacao segura.
- Definir regras de excecao documentadas para `B101` em `tests/*`.

Saida esperada:

- Security findings realmente acionaveis tratados.

## Fase 3 - Tipagem e Qualidade Python (1-2 dias)

Objetivo:

- Reduzir erro estrutural em backend sem travar por ruido de teste.

Acoes:

- `Pyright`: resolver primeiro backend/services/repositories.
- `Pylint`: separar import-error de problema real.
- `Mypy`: corrigir erro de sintaxe.
- `Flake8`: aplicar autoformat e limpesa incremental.

Saida esperada:

- Backend com tipagem e lint mais estavel.

## Fase 4 - Hardening Infra e Regras de Gate (0.5-1 dia)

Objetivo:

- Fechar lacunas de infraestrutura sem gerar ruina de produtividade.

Acoes:

- Tratar principais findings `KICS` no `docker-compose.yml`.
- Definir threshold para `Trivy/Grype` (falhar apenas por HIGH/CRITICAL relevantes ao app).
- Mover scanners pesados para job noturno ou manual, mantendo PR rapido.

Saida esperada:

- Seguranca de infra com custo controlado de CI.

---

## 6) Tabela de Acao por Linter

| Linter | Estado atual | O que significa | Acao recomendada | Prioridade | ETA |
|---|---:|---|---|---|---|
| YAML_V8R | 1 | Config invalida | manter schema valido e versionado | P0 | 15m |
| JSON_JSONLINT | 1 | JSON strict falha com comentario | remover comentario/alinhar parser | P0 | 15m |
| TYPESCRIPT_STANDARD | 1 | nao acha tsconfig | ajustar execucao/projeto | P0 | 30m |
| SQL_TSQLLINT | 1 | linter de dialeto errado | trocar/desativar para Postgres | P0 | 20m |
| REPOSITORY_CHECKOV | 1 | policy CI + secrets em relatorio | `permissions` + excluir artefatos | P0 | 30m |
| REPOSITORY_TRIVY | 1 | CVE em lockfiles | atualizar `axios` e `cryptography` | P0 | 1h |
| PYTHON_BANDIT | 908 | muito ruido + B608 real | focar B608, ajustar B101 em tests | P1 | 4-8h |
| PYTHON_PYRIGHT | 298 | imports + tipos reais | corrigir backend primeiro | P1 | 1-2 dias |
| PYTHON_PYLINT | 159 | import-error + poucos reais | alinhar env e corrigir reais | P1 | 4-8h |
| PYTHON_FLAKE8 | 240 | estilo e limpeza | autoformat + ajuste incremental | P2 | 2-6h |
| CSS_STYLELINT | 515 | naming/style css | corrigir naming e uso em TSX | P2 | 1-3h |
| REPOSITORY_KICS | 27 | hardening docker compose | security_opt/cap_drop/healthcheck/bind | P3 | 3-6h |
| REPOSITORY_GRYPE | 38 | CVEs de runtime/toolchain | triagem e policy de severidade | P3 | 2-4h |
| REPOSITORY_DEVSKIM | 1148/2533 | scanner ruidoso sem escopo | manter filtros e tratar 1st-party | P3 | 1-3h |

---

## 7) Definicao de Pronto (DoD) por Etapa

Fase 0 concluida quando:

- existe novo log com baseline atualizado
- comparativo antes/depois documentado

Fase 1 concluida quando:

- nao ha falhas de schema/config pontual
- checks de pipeline estao deterministas

Fase 2 concluida quando:

- CVEs HIGH conhecidas dos lockfiles foram corrigidas
- `B608` revisado e mitigado/documentado

Fase 3 concluida quando:

- Pyright/Pylint backend sem erros bloqueantes
- Mypy sem erro de sintaxe

Fase 4 concluida quando:

- hardening minimo aplicado no compose
- scanners pesados com regra clara de execucao

---

## 8) Sequencia de Execucao Recomendada

1. Rodar Fase 0 (rebaseline) imediatamente.
2. Executar Fase 1 no mesmo PR de qualidade.
3. Abrir PR dedicado para Fase 2 (seguranca).
4. Dividir Fase 3 em PRs menores por modulo backend.
5. Fechar Fase 4 com politica final de CI (rapido para PR, pesado para noturno).

---

## 9) Risco de Nao Fazer

- CI continua lenta e ruidosa, reduzindo confianca no lint.
- Problemas de seguranca reais ficam escondidos em alto volume de falso positivo.
- A equipe tende a ignorar alertas ("alert fatigue").

---

## 10) Proxima Atualizacao Deste Documento

Atualizar este roadmap apos a proxima execucao completa do MegaLinter com o novo `.mega-linter.yml`, registrando:

- novo total por linter
- delta de tempo total
- delta de falso positivo por scanner de repositorio

