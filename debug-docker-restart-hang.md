[OPEN] Debug session: docker-restart-hang

## Sintoma
- O script `reiniciar-datafrota-docker.ps1` fica parado em `Subindo frontend e backend com rebuild`.
- Em outra execução, o PowerShell exibiu `NativeCommandError` mesmo com a linha `datafrota-backend Built`.

## Hipoteses
1. O `docker compose up --build` continua aguardando porque um dos serviços entra em attach/log streaming e o script não desanexa corretamente.
2. O PowerShell trata saída de progresso no `stderr` como erro terminante e interrompe o fluxo, mesmo sem falha real do Docker.
3. O fallback implementado para Bake/BuildKit não cobre o caso atual e o processo `docker compose` fica preso durante build ou startup.
4. Há container/processo anterior em estado inconsistente, mantendo o projeto `datafrota` travado no Docker Engine.
5. O wrapper que captura saída (`Tee-Object` ou `Process`) não encerra a leitura do stream, causando bloqueio no script.

## Evidencias
- Leitura do script atual: `Invoke-ComposeUpWithBuildFallback` usa `System.Diagnostics.Process` e executa `docker compose up -d --build` com captura de `stdout`/`stderr`; nao ha mais `Tee-Object` na versao presente em disco.
- Estado do Docker antes da reproducao: `datafrota-backend` e `datafrota-frontend` estavam `Up` e respondendo nas portas `3001` e `8080`.
- Reproducao controlada: ao executar `powershell -ExecutionPolicy Bypass -File .\reiniciar-datafrota-docker.ps1`, o script derrubou os containers, exibiu todo o progresso do build, subiu os servicos e concluiu com sucesso.
- Verificacao de saude: `http://127.0.0.1:3001/api/health` e `http://127.0.0.1:8080/api/health` retornaram `200`.

## Analise
- Hipotese 1 (attach/log stream preso): rejeitada para a versao atual; o comando usa `up -d --build` e retorna corretamente.
- Hipotese 2 (`stderr` tratado como erro terminante): compatível com o erro antigo do usuario, mas nao ocorre na versao atual do arquivo.
- Hipotese 3 (fallback BuildKit incompleto): nao confirmada; o build rodou normalmente com Bake ativo.
- Hipotese 4 (estado preso no Docker Engine): rejeitada; os containers foram removidos e recriados sem bloqueio.
- Hipotese 5 (wrapper bloqueando streams): nao confirmada na versao atual; a captura concluiu e devolveu o controle ao script.

## Conclusao Parcial
- O erro com `Tee-Object` veio de uma revisao anterior do script.
- A versao atual em disco nao reproduz o travamento descrito e conclui normalmente o restart completo da stack.

## Instrumentacao Aplicada
- O script agora imprime o caminho completo do arquivo em execucao e a data/hora da ultima modificacao.
- O wrapper `Invoke-DockerProcess` agora registra o comando Docker iniciado, o PID do processo e a duracao/`exit code` ao terminar.

## Verificacao Pos-Instrumentacao
- Nova execucao do script: `docker compose down --remove-orphans --timeout 10` concluiu em `1.37s` com `exit code 0`.
- `docker compose up -d --build` concluiu em `12.83s` com `exit code 0`.
- Backend e frontend responderam com sucesso nos endpoints de health check e o script terminou com `Ambiente Docker pronto para teste.`

## Ajuste Aplicado
- O wrapper de processo voltou para a estrategia estavel com `ReadToEndAsync`, que ja havia sido validada no ambiente.
- O `docker compose up -d --build` agora executa com timeout explicito de `180` segundos via a variavel `composeUpTimeoutSeconds`.
- O caminho de fallback sem BuildKit/Bake tambem herda o mesmo timeout, evitando terminal preso indefinidamente mesmo em cenarios de erro do Docker Compose.

## Verificacao Pos-Fix
- Execucao apos o ajuste: `docker compose down --remove-orphans --timeout 10` concluiu em `0.22s` com `exit code 0`.
- `docker compose up -d --build` concluiu em `14.37s` com `exit code 0`.
- Backend e frontend voltaram com sucesso, incluindo `http://127.0.0.1:3001/api/health` e `http://127.0.0.1:8080/api/health`.
