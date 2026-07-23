# Debug Session: mobile-reload-stuck

- Status: OPEN
- StartedAt: 2026-07-22
- Scope: app mobile Expo preso em carregamento apos restart/reload

## Sintoma
- Apos restart, o Expo mostra `Reloading apps` e URLs do Metro, mas o app permanece carregando.

## Hipoteses
1. Erro JS em runtime apos a ultima alteracao no `mobile_app/App.tsx`.
2. Fluxo inicial travado em `fetchBootstrap()` ou recuperacao de sessao.
3. Problema de conectividade entre o dispositivo e a API local apos o restart.
4. Bundle/cache inconsistente no Expo Go apos recarga.
5. Loop visual causado por estado `loading` nao finalizado.

## Evidencias
- `npm run check` concluiu sem erros.
- `mobile_app/App.tsx` esta sem diagnosticos.
- `BRAND_API_ORIGIN` aponta para `http://192.168.1.3:3001`.
- `GET /api/mobile-customers/bootstrap?companyId=company-1` respondeu `200` com payload valido.
- `app.json` mantem `usesCleartextTraffic: true` no Android.

## Analise Parcial
- Hipotese 1 enfraquecida: nao ha erro de compilacao TypeScript.
- Hipotese 2 enfraquecida no backend: o bootstrap responde corretamente a partir da maquina local.
- Hipotese 3 ainda possivel no dispositivo: o celular pode nao ter retomado o acesso apos o reload.
- Hipotese 4 forte: cache/bundle inconsistente do Expo Go apos restart.
- Hipotese 5 ainda possivel: estado visual preso no cliente apos recarga parcial.

## Evidencias Adicionais
- O `INSERT INTO discount_authorization` em `discountCodeService.ts` agora possui `45 colunas` e `45 placeholders`.
- O erro persistente `INSERT has more target columns than expressions` apos a correcao sugere processo antigo da API ainda em memoria.

## Plano
1. Coletar evidencias sem alterar regra de negocio.
2. Verificar diagnosticos, typecheck e pontos de bootstrap do app.
3. Instrumentar somente se a evidencia atual nao bastar.
