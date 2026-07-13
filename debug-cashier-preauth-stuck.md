# Debug Session: cashier-preauth-stuck

Status: OPEN

## Sintoma
- No segundo `F5`, a tela fica em `Registrando pre-autorizacao...`.
- O operador abre o abastecimento no caixa e o desconto nao e aplicado.
- A expectativa e registrar a pre-autorizacao e fechar automaticamente a tela de integracao.

## Hipoteses
- H1. A requisicao `POST /api/cashier-discounts/authorize` fica bloqueada antes de responder ao app Python.
- H2. A deteccao automatica da `estacao` falha ou retorna contexto inconsistente, e a API nao conclui a gravacao.
- H3. A `INSERT` em `datafrota_desconto_pendente` entra em espera por lock ou indice unico e o app fica aguardando indefinidamente.
- H4. A trigger nao consome a pendencia porque a `estacao` resolvida no integrador nao bate com a `estacao` gravada em `lancto_caixa`.
- H5. A tela nao fecha porque o app nunca recebe sucesso da autorizacao, entao permanece no estado `busy`.

## Plano
- Instrumentar app Python e API para rastrear inicio/fim da autorizacao, contexto resolvido e tempo de resposta.
- Reproduzir o segundo `F5` com logs `pre-fix`.
- Confirmar a hipotese verdadeira pelos logs.
- Aplicar a menor correcao possivel.
- Validar com logs `post-fix` e pedir sua confirmacao.

## Evidencias
- O log `hotkey-f9` mostrou uma instancia com `RegisterHotKey executado` e `registered: false, last_error: 1409`, o que indica hotkey ja registrado por outro processo.
- No mesmo momento houve `Fallback GetAsyncKeyState detectou F9` e tambem `WM_HOTKEY recebido`, seguido por dois `show_window acionado` quase simultaneos.
- Isso confirma coexistencia de mais de uma instancia do integrador, cada uma reagindo de forma diferente ao `F9`.
- O log `cashier-preauth-stuck` mostrou chamadas duplicadas de contexto apos a reabertura, reforcando que a UI entrou em estado invalido apos `Esc` e `F9`.

## Conclusao Parcial
- H2, H5: ainda pendentes para o fluxo do segundo `F5`.
- Nova hipotese confirmada: o problema do `Esc`/`F9` decorre de multiplas instancias + reabertura duplicada sem debouncing.

## Evidencia Adicional
- Ao executar o app em Python 3.14, ocorreu `NameError` em `integracao_frota_app.py` no callback `self.root.after(... lambda: self._apply_context_error(str(exc), silent))`.
- O mesmo padrao existia em `_run_async` com `lambda: self._handle_error(str(exc))`.
- Isso confirma uma falha de callback assíncrono no Tkinter, causada pela limpeza da variavel `exc` apos o bloco `except`, interrompendo a atualizacao de UI e afetando o comportamento de `Esc`/`F9`.

## Correcao Aplicada
- Capturar a mensagem de erro em variavel local antes do `lambda` e repassar por default argument.
- Manter bloqueio de instancia unica e debounce do `F9`.

## Evidencia Hotkey Pos-Correcao
- Simulacao automatizada executou `Esc -> F9 -> Esc -> F9 -> F9`.
- Nos logs `hotkey-f9`:
- `1783802167621`: `hide_window` com `state_before: normal`
- `1783802169449`: `Fallback GetAsyncKeyState detectou F9`
- `1783802169480`: `show_window acionado` com `state_before: withdrawn`
- `1783802170652`: `hide_window` com `state_before: normal`
- `1783802174737`: `Fallback GetAsyncKeyState detectou F9`
- `1783802174767`: `show_window acionado` com `state_before: withdrawn`
- `1783802199690`: `WM_HOTKEY recebido`
- `1783802199697`: `show_window acionado` com `state_before: normal`

## Leitura Atual
- A reabertura por `F9` funcionou em pelo menos duas repeticoes completas durante a simulacao automatizada.
- O ultimo `F9` foi recebido quando a janela ja estava `normal`, entao nao reproduziu o estado de falha nessa rodada.
- O problema restante pode estar intermitente e dependente do ritmo da tecla ou do foco do AutoSystem no uso manual.

## Causa Confirmada da Lentidao
- O loop `_poll_hotkey()` estava usando `PeekMessageW(..., 0, 0, PM_REMOVE)`, removendo todas as mensagens da fila da thread, nao apenas `WM_HOTKEY`.
- Os logs anteriores mostravam centenas de capturas da mensagem `15` (`WM_PAINT`), o que confirma drenagem indevida da fila do Windows.
- Isso explica a UI lenta, os repaints incompletos e o campo de voucher sem aceitar digitacao de forma confiavel.

## Correcao Aplicada Agora
- `_poll_hotkey()` passa a consumir apenas mensagens `WM_HOTKEY`.
- As demais mensagens permanecem com o loop normal do Tkinter, preservando digitacao, foco e repaint.

## Evidencia de Ambiente
- Ao validar o voucher, o integrador exibiu `Nao foi possivel conectar na API do DataFrota.`
- Confirmacao local:
- `Invoke-WebRequest http://127.0.0.1:3001/api/health` retornou `Impossivel conectar-se ao servidor remoto`
- `Get-NetTCPConnection -LocalPort 3001` nao retornou listener
- `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|tsx' }` nao encontrou processo da API

## Conclusao Atual
- O app desktop esta respondendo rapido.
- A validacao do voucher falha porque a API do projeto nao esta em execucao na porta `3001`.
- Nao ha evidencia de regressao no integrador neste ponto; o bloqueio restante e operacional/ambiente.

## Evidencia da Pre-Autorizacao
- Com a API em execucao, o voucher `DXWN8LJ4` validou corretamente.
- A chamada manual `POST /api/cashier-discounts/authorize` retornou:
- `{"success":false,"error":"Nao foi possivel registrar a pre-autorizacao do voucher.","details":"column \"reservado_em\" does not exist"}`

## Causa Confirmada
- O schema real da tabela `datafrota_desconto_pendente` neste ambiente esta desatualizado em relacao ao fluxo novo.
- O bootstrap `ensureCashierSchema()` ainda nao adicionava `reservado_em` e `cancelado_em` quando a tabela ja existia.

## Correcao Aplicada
- `ensureCashierSchema()` agora adiciona automaticamente:
- `reservado_em`
- `cancelado_em`
