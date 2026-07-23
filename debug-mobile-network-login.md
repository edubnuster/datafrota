# Debug Session: mobile-network-login

Status: OPEN

## Sintoma
- O app mobile abriu para testar a nova promocao, mas retornou `Network Request Failed` e nao conseguiu logar.
- Esperado: o app deve conseguir autenticar no backend do tenant usando o endereco de rede correto.

## Hipoteses
1. O app mobile esta apontando para `localhost` ou `10.0.2.2` em vez do IP da LAN.
2. A API/backend nao esta acessivel pela rede local na porta configurada.
3. O app em execucao esta com config antiga e nao com a URL atual do tenant.
4. O endpoint de login mobile esta montado com `basePath` incorreto.
5. A falha ocorre antes da autenticacao, por conectividade HTTP da URL configurada.

## Plano
1. Inspecionar a configuracao atual do mobile (`brand.ts`, `api.ts`, servico de auth).
2. Confirmar a URL efetiva usada no login.
3. Verificar se a API responde localmente e pela LAN na rota de login.
4. Comparar com o ambiente em execucao do app.
5. Corrigir minimamente apenas apos evidencias conclusivas.

## Evidencias
- O mobile esta configurado para `http://192.168.1.3:3001` em `mobile_app/src/config/brand.ts`.
- A API efetiva vira `http://192.168.1.3:3001/api` em `mobile_app/src/config/api.ts`.
- O IP atual da maquina continua `192.168.1.3`.
- O backend responde tanto em `127.0.0.1:3001` quanto em `192.168.1.3:3001` para `/api/mobile-customers/bootstrap`.
- A porta `3001` esta em escuta no host.
- O Expo Go do celular conecta normalmente ao Metro em `192.168.1.3:8082`, entao a rede Wi-Fi entre celular e notebook esta funcionando.
- Nao existe regra liberando a porta `3001` no Firewall do Windows para entrada.
- A rede ativa do Wi-Fi esta no perfil `Private`.
- A tentativa de criar a regra `DATAFROTA API 3001` falhou com `Acesso negado`, confirmando que o processo atual nao tem privilegio administrativo para abrir a porta.

## Correcao Aplicada
- Adicionado `android.usesCleartextTraffic = true` em `mobile_app/app.json`.

## Conclusao Atual
- O endereco configurado continua correto.
- O motivo mais provavel para o `Network Request Failed` no Expo Go e o Firewall do Windows bloqueando a porta `3001` para o celular.
- O ajuste de `usesCleartextTraffic` continua util para dev build/app instalado, mas nao resolve sozinho o caso do Expo Go se a porta `3001` estiver bloqueada no host.
