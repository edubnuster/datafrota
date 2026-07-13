# Debug Session: hotkey-f9

- Status: OPEN
- Sintoma: o app Python abre manualmente pelo PowerShell, mas o atalho global `F9` nao reabre a janela com o AutoSystem em uso.
- Objetivo: descobrir por que o hotkey global nao dispara e ajustar a implementacao com evidencia de execucao.

## Hipoteses

1. O `RegisterHotKey` falha porque `F9` ja esta reservado por outro processo e o app apenas esconde essa falha na UI.
2. O hotkey ate registra, mas o loop baseado em `PeekMessageW` nao esta drenando a fila corretamente dentro do `Tkinter`.
3. O AutoSystem roda em contexto de privilegio diferente e impede a entrega do evento de hotkey para o processo Python.
4. O app registra o hotkey com alvo `None`, mas a thread/janela do `Tkinter` nao possui uma fila de mensagens adequada para receber o `WM_HOTKEY`.
5. O hotkey dispara, mas a rotina `show_window()` nao restaura a janela por causa do estado `withdrawn` ou foco/topmost.

## Plano de coleta

1. Instrumentar o registro do hotkey e o recebimento do `WM_HOTKEY`.
2. Executar o app e verificar os eventos coletados.
3. Confirmar ou rejeitar as hipoteses com base nos logs.
4. Aplicar a menor correcao possivel e validar novamente.

## Evidencias

- Instrumentacao adicionada em `cashier_app/integracao_frota_app.py` nos pontos de registro, loop de mensagens e restauracao da janela.
- Consulta em `GET /logs` apos a primeira reproducao retornou lista vazia.
- Conclusao parcial: a reproducao foi feita com uma instancia anterior do app, sem a instrumentacao carregada, ou a instancia atual nao foi reiniciada apos a alteracao.
