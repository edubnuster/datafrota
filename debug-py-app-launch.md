# [OPEN] Debug Session: py-app-launch

## Sintoma
- `python .\cashier_app\integracao_frota_app.py` nao abre nenhuma janela visivel.
- O atalho `F9` tambem nao reabre a interface.

## Hipoteses
1. O app inicia, mas permanece oculto porque a janela principal comeca em `withdraw()` e nenhum fluxo chama `show_window()` no primeiro boot.
2. A tela inicial de configuracao do banco falha em abrir ou fecha imediatamente, fazendo o processo encerrar sem UI visivel.
3. Ja existe uma instancia em background segurando o mutex global, e a segunda execucao apenas sinaliza um evento que nao esta sendo consumido.
4. O registro do hotkey global `F9` falha no ambiente atual, entao o app fica oculto sem mecanismo de reabertura.
5. O processo encontra um erro de runtime antes do `mainloop()`, mas o erro nao chega claramente ao usuario.

## Plano de Evidencia
- Reproduzir a execucao pelo terminal para observar se o processo termina imediatamente ou permanece residente.
- Coletar evidencias do fluxo de inicializacao, do mutex e do estado da janela antes de tocar na logica.
- Instrumentar apenas pontos de inicializacao/visibilidade se a reproducao nao fornecer sinais suficientes.
