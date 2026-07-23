# Debug Session: pdv-snapshot-sync

Status: OPEN

## Sintoma
- O usuario acionou o `app-py` no PDV via F9, mas o tenant nao recebeu snapshot publicado.
- Esperado: a chamada do agente ao endpoint de sync deve disparar `syncTenantReferenceSnapshot()` e publicar ao menos a versao inicial do snapshot do tenant.

## Hipoteses
1. O `app-py` nao esta chamando `/api/pdv-agents/me/sync` com uma sessao valida do agente.
2. O backend recebe a chamada, mas `syncTenantReferenceSnapshot()` retorna sem publicar por lock, lease ou janela de tempo.
3. O backend entra na sincronizacao, mas falha ao ler as tabelas operacionais e registra erro no estado do snapshot.
4. O snapshot publica corretamente, mas a leitura do modulo web usa contexto de tenant incorreto.
5. O F9 do PDV aciona outro fluxo e nao o sync de promocoes/referencias.

## Plano
1. Coletar evidencias do caminho real do F9 no `app-py`.
2. Instrumentar apenas logs no `app-py` e no backend de sync.
3. Reproduzir o fluxo.
4. Analisar logs e tabelas de estado.
5. Corrigir minimamente apenas apos evidencia conclusiva.

## Evidencias
- O `app-py` realmente chamou `GET /api/pdv-agents/me/sync` com sucesso em `c:\DATAFROTA\log\pdv-vouchers.log`.
- O agente ativo do tenant foi identificado como `pdvagt_mrppxrw20pmhnu4b`, da `company-1`.
- Antes da correcao, `tenant_reference_snapshot_state` mostrava:
  - `published_version = 0`
  - `sync_status = error`
  - `last_error = column "subgrupo" does not exist`
- Logs desta sessao confirmaram um segundo defeito:
  - o codigo pulava a tentativa por janela minima mesmo com `published_version = 0`, porque o valor vinha como string `"0"` e era tratado como truthy.

## Causa Raiz
1. A consulta de `pessoa` assumia a existencia da coluna opcional `subgrupo`, mas esta base do cliente nao possui essa coluna.
2. O guard de janela minima considerava `published_version` como truthy sem converter para numero, impedindo nova tentativa imediata quando o snapshot ainda nao havia sido publicado.

## Pos Correcao
- O sync forçado do tenant executou com sucesso.
- Estado atual:
  - `published_version = 1`
  - `sync_status = idle`
  - `last_error = ''`
- Itens publicados:
  - `products = 3272`
  - `product-groups = 21`
  - `customers = 10414`
  - `payment-forms = 61`
  - `customer-groups = 31`

## Nova Evidencia
- A promocao com erro no PDV nao falhava por tenant/snapshot; falhava porque o pipeline operacional aceitava apenas `discount_percent`.
- Evidencia estatica:
  - `discount_authorization` tinha apenas `discount_percent`.
  - `datafrota_desconto_pendente` tinha apenas `percentual_desconto`.
  - `datafrota_aplicar_desconto_f()` calculava `valor_desconto` exclusivamente a partir de `percentual_desconto`.
- A mensagem de erro na promocao vinha da regra em `pdvPromotionService.ts`.

## Ajuste Em Andamento
- O modelo operacional foi estendido para suportar:
  - `discount_type = percent|fixed`
  - `discount_value` na autorizacao
  - `tipo_desconto` e `valor_fixo_configurado` no pendente do caixa
- O calculo no trigger passou a aceitar `fixed`, distribuindo o valor fixo ao longo dos itens elegiveis sem exceder o subtotal acumulado.
- Validacao de runtime:
  - `ensureCashierSchema(true)` executou com sucesso.
  - Um voucher de teste `FIXTEST1` foi criado e resolvido com:
    - `discountType = fixed`
    - `discountValue = 0.15`
