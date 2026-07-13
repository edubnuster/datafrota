# App do Caixa em Python

Aplicativo desktop em `Tkinter` para o operador de caixa validar o voucher do app frota e registrar a pre-autorizacao para o proximo abastecimento do mesmo caixa no AutoSystem.

## Atalhos

- `F9`: abre novamente a janela do app quando ele estiver em segundo plano
- `F5`: valida o voucher ou confirma a pre-autorizacao
- `Esc`: oculta a janela
- `Ctrl+Shift+Q`: encerra totalmente o app

## Como executar

1. Garanta que a API Node esteja ativa em `http://127.0.0.1:3001/api` ou ajuste a variavel `FROTA_API_URL`.
2. Execute:

```powershell
python .\cashier_app\integracao_frota_app.py
```

## Fluxo operacional

1. O operador informa o voucher do app frota.
2. O app consulta `GET /api/cashier-discounts/:shortCode`.
3. Se o voucher estiver valido, o app mostra a regra resolvida.
4. Ao confirmar com `F5`, o app envia um `stationHint` automatico do terminal.
5. O backend resolve a `estacao` automaticamente e grava a pendencia em `datafrota_desconto_pendente`.
6. Quando o item entra em `lancto_caixa`, a trigger usa `lancto_caixa.conta` para localizar o caixa aberto correspondente na tabela `caixa` e preencher `conta`, `data`, `turno` e `usuario` da operacao.
7. O desconto so entra se a venda for da mesma `estacao` e respeitar produto, grupo de produto e grupo de cliente do voucher.

## Observacao importante

Os SQLs de integracao do caixa foram salvos em:

- `migrations/20260710_create_cashier_discount_integration.sql`
- `migrations/20260711_update_cashier_discount_next_sale.sql`

As duas migrations devem ser aplicadas no banco do AutoSystem para o desconto entrar automaticamente em `lancto_caixa_promo` no fluxo novo por `conta + estacao`.
