# Databrev Cliente Teste

App mobile em `React Native + Expo` para cadastro e login do cliente final.
Esta build esta fixada no tenant ficticio `Databrev` para validar o modelo `1 app por rede`.

## Rodando local

1. Garanta que a API principal esteja ativa em `http://127.0.0.1:3001`.
2. Copie `.env.example` para `.env` se precisar sobrescrever a URL da API ou o tenant.
3. Instale as dependencias:

```bash
npm install
```

4. Inicie o Expo:

```bash
npm start
```

5. Para testar em aparelho fisico com QR Code, prefira o tunel:

```bash
npm run start:tunnel
```

## API esperada

- `GET /api/mobile-customers/bootstrap`
- `POST /api/mobile-customers/register`
- `POST /api/mobile-customers/login`

## Observacoes

- Android Emulator usa `10.0.2.2` automaticamente quando `EXPO_PUBLIC_API_URL` nao esta definido.
- iOS Simulator usa `127.0.0.1` automaticamente.
- Em aparelho fisico, defina `EXPO_PUBLIC_API_URL` com o IP da maquina onde a API estiver rodando.
- O Metro do mobile usa a porta `8082` para evitar conflito com outros servicos locais.
- O `expo web` usa a porta `8083`.
- O tenant de testes atual eh `company-1`, correspondente a `Databrev`.
- Para outra rede no futuro, replique esta estrutura trocando `EXPO_PUBLIC_TENANT_ID`, `EXPO_PUBLIC_APP_NAME`, `EXPO_PUBLIC_BRAND_NAME` e os assets.
