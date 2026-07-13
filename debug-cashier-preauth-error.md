[OPEN] Debug session: cashier-preauth-error

## Sintoma
- O voucher valida no integrador do caixa.
- Ao confirmar a pré-autorização no segundo `F5`, a UI mostra `Nao foi possivel registrar a pre-autorizacao do voucher.`

## Hipoteses
- H1. O backend está falhando por incompatibilidade de schema em `datafrota_desconto_pendente`.
- H2. A resolução automática da `estacao` produz um valor aceito pela UI, mas inválido para persistência/consulta no backend.
- H3. Existe alguma restrição única ou conflito de pendência ativa na gravação da pré-autorização.
- H4. A API retorna erro interno do PostgreSQL por coluna/campo recém-adicionado ainda ausente no banco real.
- H5. O integrador está enviando payload válido, mas a rota `/authorize` está mapeando errado os campos opcionais.

## Evidencias a coletar
- Resposta real do endpoint `POST /api/cashier-discounts/authorize`
- Logs instrumentados do backend e do integrador para a tentativa com o voucher novo
- Estrutura atual da tabela `datafrota_desconto_pendente`

## Evidencia Coletada
- Reproducao manual do endpoint:
- `POST /api/cashier-discounts/authorize` com `shortCode=6UKYUBYE` e `stationHint=SAMSUNGNOTE2`
- Resposta:
- `{"success":false,"error":"Nao foi possivel registrar a pre-autorizacao do voucher.","details":"null value in column \"valor_desconto\" of relation \"datafrota_desconto_pendente\" violates not-null constraint"}`

## Hipoteses
- H1. Confirmada: o schema real do banco neste ambiente ainda exige `valor_desconto NOT NULL`.
- H2. Rejeitada: a `estacao` foi resolvida e nao foi a causa do erro.
- H3. Rejeitada nesta tentativa: nao houve conflito de unicidade; a falha ocorreu antes, por constraint de coluna.
- H4. Confirmada: trata-se de incompatibilidade entre schema real e migration/fluxo novo.
- H5. Rejeitada: o payload do integrador chegou corretamente ao backend.

## Correcao Aplicada
- `ensureCashierSchema()` agora executa `ALTER COLUMN valor_desconto DROP NOT NULL`, alinhando o banco antigo com a migration atual que permite `valor_desconto` nulo na pre-autorizacao.
