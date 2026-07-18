# DATAFROTA

Aplicacao web com frontend em React + Vite e backend em Express/Node.js. O banco `PostgreSQL 18` roda fora dos containers, diretamente no sistema operacional.

## Layout de diretorios no Windows

- SaaS web com Docker: `C:\databrev`
- App Python do caixa: `C:\Program Files\Datafrota`
- Dados gravaveis do app do caixa (cache, credenciais, config e logs): `C:\ProgramData\Datafrota`

## Estrutura de containers

- `frontend`: build do Vite servido por `nginx`
- `backend`: API Node.js na porta `3001`
- `postgresql 18`: fora do Docker, instalado no host

## Arquivos Docker

- `Dockerfile.frontend`
- `Dockerfile.backend`
- `docker-compose.yml`
- `docker/nginx/default.conf`

## Variaveis de ambiente

Copie `.env.example` para `.env` e ajuste conforme sua instancia local do `PostgreSQL 18`:

```bash
PGHOST=host.docker.internal
PGPORT=5432
PGDATABASE=frota
PGUSER=postgres
PGPASSWORD=postgres
SAAS_PGHOST=host.docker.internal
SAAS_PGPORT=5432
SAAS_PGDATABASE=datafrota
SAAS_PGUSER=postgres
SAAS_PGPASSWORD=postgres
HOST=0.0.0.0
PORT=3001
```

Observacoes:

- `PG*` aponta para a base operacional do cliente, como `frota`.
- `SAAS_PG*` aponta para a base do sistema SaaS, como `datafrota`.
- Em Docker, o backend usa `DOCKER_PGHOST` e `DOCKER_SAAS_PGHOST` quando definidos; se nao estiverem definidos, usa `host.docker.internal`.
- Em Windows e Docker Desktop, `host.docker.internal` costuma funcionar direto.
- Em Linux, o `docker-compose.yml` ja inclui `extra_hosts` com `host-gateway`.
- Se o `PostgreSQL 18` estiver escutando apenas em `localhost`, confirme se ele aceita conexoes vindas do Docker no host.

## Subir com Docker

```bash
docker compose up -d --build
```

Ou use o script de reinicio completo:

```powershell
.\reiniciar-datafrota-docker.ps1
```

O script usa `C:\databrev` como raiz do ambiente SaaS/Docker por padrao.

Acessos:

- Frontend: [http://localhost:8080](http://localhost:8080)
- Backend health: [http://localhost:3001/api/health](http://localhost:3001/api/health)

## Parar containers

```bash
docker compose down
```

## Desenvolvimento local

Para rodar sem Docker:

```bash
npm install
npm run dev
```

API isolada:

```bash
npm run server:start
```

O script `reiniciar-datafrota.ps1` sobe o SaaS local a partir de `C:\databrev` e inicia o app do caixa a partir de `C:\Program Files\Datafrota`.
