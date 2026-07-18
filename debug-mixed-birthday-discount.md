# Debug Session: mixed-birthday-discount [OPEN]

## Sintoma
- No cupom de aniversario com `30%`, o primeiro alfajor recebeu desconto.
- Depois foi adicionado combustivel, que tambem deveria ser elegivel, mas nao recebeu desconto.
- Em seguida foi adicionado outro alfajor, que tambem deveria ser elegivel, mas nao recebeu desconto.

## Comportamento esperado
- O desconto deve ser recalculado sobre todos os itens elegiveis do mesmo cupom, incluindo bomboniere e combustivel quando ambos estiverem liberados na configuracao do voucher.

## Hipoteses iniciais
- H1. O voucher foi reservado corretamente no primeiro alfajor, mas os itens seguintes nao casaram com o mesmo `mlid`.
- H2. O combustivel entrou por um fluxo diferente em `lancto_caixa` e nao atendeu a condicao de reaproveitamento do registro em `R`.
- H3. O cupom foi configurado com grupos de produto que cobrem bomboniere, mas nao cobrem o grupo real do combustivel lancado.
- H4. O recalc incremental encontrou o segundo/terceiro item, mas bloqueou por alguma validacao operacional e gravou erro em `datafrota_desconto_pendente`.
- H5. O segundo alfajor entrou no cupom, mas a trigger deixou de localizar a pre-autorizacao apos o combustivel por divergencia em `abastecimento`, `produto_codigo` ou `estacao`.

## Plano
- Ler o estado atual do voucher `4UGXF` na tabela `datafrota_desconto_pendente`.
- Correlacionar com `lancto_caixa`, `lancto_caixa_promo` e `caixa_venda` do cupom recente.
- Verificar grupos/produtos reais dos itens do cupom para comparar com as restricoes do voucher.
