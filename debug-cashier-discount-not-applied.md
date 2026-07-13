[OPEN] Debug session: cashier-discount-not-applied

## Sintoma
- O voucher valida no integrador do caixa.
- O segundo `F5` registra a pre-autorizacao sem erro.
- Ao iniciar o abastecimento/cupom no caixa, o desconto nao aparece.

## Hipoteses
- H1. A pre-autorizacao foi gravada, mas com `status`, `estacao`, `conta` ou `validade` que impedem o consumo pela trigger.
- H2. O lancamento do caixa nao encontra a pendencia por divergencia entre `estacao`, `conta`, `dia_fiscal`, `turno` ou `mlid`.
- H3. As restricoes de produto, grupo de produto ou grupo de cliente bloqueiam corretamente o desconto, mas sem feedback operacional.
- H4. A trigger/function que aplica o desconto nao esta sendo executada, falha em runtime, ou grava erro em `datafrota_desconto_pendente`.
- H5. A API grava a pendencia em um contexto de banco diferente do consumido pelo fluxo do caixa.

## Evidencias Iniciais
- Usuario confirmou que o gerador web abriu.
- Usuario confirmou que o segundo `F5` executou sem falha.
- Cupom exibido no caixa sem desconto aplicado.

## Evidencias Coletadas
- A pendencia mais recente foi gravada como `codigo_desconto = 'UH6AVJ2R'`, `status = 'P'`, `estacao = 'SAMSUNGNOTE2'`, sem `reservado_em`, sem `lancto_caixa` e sem `erro`.
- O item lancado no caixa logo apos a pre-autorizacao entrou em `lancto_caixa` com `codigo = 664169`, `conta = '1.1.2.7'`, `estacao = 'SAMSUNGNOTE2.WORKGROUP'`, `abastecimento = 247874`, `produto_codigo = '1'` e `valor = 52.81`.
- O registro correlato em `caixa_venda` foi gravado com `conta = '1.1.2.7'`, `estacao = 'SAMSUNGNOTE2.WORKGROUP'` e `mlid = '17212099067'`.
- A trigger `trg_datafrota_aplicar_desconto` esta ativa em `lancto_caixa`.
- A function `public.datafrota_aplicar_desconto_f()` busca a pendencia com `d.estacao = NEW.estacao`, isto e, exige igualdade exata de estacao.
- O endpoint `/api/cashier-discounts/context?stationHint=SAMSUNGNOTE2` hoje resolve `estacao = 'SAMSUNGNOTE2.WORKGROUP'`, confirmando que existe alias/sufixo na estacao real usada pelo caixa.

## Analise
- H1 confirmado parcialmente: a pre-autorizacao foi gravada, mas com `estacao` curta demais.
- H2 confirmado: o lancamento do caixa nao encontrou a pendencia por divergencia entre `SAMSUNGNOTE2` e `SAMSUNGNOTE2.WORKGROUP`.
- H3 rejeitado para este caso: o produto do cupom (`1`) coincide com a restricao do voucher.
- H4 rejeitado para este caso: a trigger existe e esta habilitada; o problema ocorreu antes da insercao do desconto.
- H5 rejeitado para este caso: a API e o caixa estao olhando o mesmo banco, pois os registros correlatos aparecem na mesma base.

## Correcao Aplicada
- O integrador Python agora envia `estacao` e `conta` resolvidas do contexto atual no segundo `F5`, reduzindo a dependencia exclusiva do `stationHint`.
- O bootstrap da API agora recria `public.datafrota_aplicar_desconto_f()` e `trg_datafrota_aplicar_desconto` no startup.
- A function passou a comparar a estacao por nome canonico da maquina (`split_part(..., '.', 1)`), aceitando `MAQUINA` e `MAQUINA.WORKGROUP` como o mesmo terminal.
- A migration `20260711_update_cashier_discount_next_sale.sql` foi atualizada para refletir a mesma regra.
- O backend passou a canonizar `estacao` e `stationHint` antes de gravar a pendencia, evitando duplicidade logica entre variantes com e sem sufixo.
- A pendencia residual `UH6AVJ2R` foi cancelada no banco para liberar o proximo teste no mesmo terminal.

## Plano de Coleta
- Inspecionar o estado atual da pendencia em `datafrota_desconto_pendente`.
- Revisar a migration/function/trigger responsavel pelo consumo do desconto.
- Verificar no banco os registros correlatos em `lancto_caixa`, `caixa`, `caixa_venda` e possiveis mensagens de erro.
- Confirmar se a API e o caixa apontam para o mesmo banco e mesmo contexto operacional.
