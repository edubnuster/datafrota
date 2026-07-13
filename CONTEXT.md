# CONTEXT.md

## Objetivo deste arquivo

Este arquivo e a referencia principal de contexto do projeto para onboarding,
manutencao e continuidade entre desenvolvedores.

Use este documento para entender rapidamente:

- o que o projeto faz;
- quais partes existem;
- quais regras de negocio sao obrigatorias;
- como o fluxo opera de ponta a ponta;
- quais armadilhas ja foram descobertas;
- o que precisa ser registrado em futuras alteracoes.

## Regra de manutencao obrigatoria

Toda alteracao futura relevante deve ser registrada neste arquivo.

Considere "alteracao relevante" qualquer mudanca em:

- regra de negocio;
- fluxo operacional do voucher;
- integracao com banco AutoSystem;
- bootstrap, trigger, funcao SQL ou migration;
- endpoints da API;
- comportamento do app Python do caixa;
- layout/UX que mude operacao do operador;
- restricoes de validacao;
- troubleshooting importante descoberto em producao ou homologacao.

## Como atualizar este arquivo

Sempre que houver uma alteracao relevante:

1. Atualize a secao afetada.
2. Adicione uma entrada em `Historico de mudancas relevantes`.
3. Registre:
   - data;
   - area impactada;
   - resumo da mudanca;
   - motivo;
   - arquivos principais envolvidos;
   - impacto operacional.

Modelo de registro:

```md
## YYYY-MM-DD - Titulo curto da mudanca

- Area: backend | frontend | python | banco | integracao
- Resumo: o que mudou
- Motivo: por que mudou
- Arquivos principais: caminho1, caminho2
- Impacto operacional: o que o time precisa saber
```

## Resumo executivo

O projeto `DATAFROTA` integra a geracao de vouchers de desconto com o processo
de venda do AutoSystem em posto de combustivel.

Hoje o sistema possui 3 frentes principais:

1. Frontend web para gerar e consultar vouchers.
2. Backend Node.js/TypeScript para regras, validacoes, bootstrap e API.
3. App desktop Python/Tkinter para o operador de caixa validar e pre-autorizar
   o voucher antes da venda entrar no PDV.

O objetivo operacional e:

1. Gerar um voucher com regras de uso.
2. Validar o voucher no caixa.
3. Registrar uma pre-autorizacao curta para o terminal/estacao.
4. Quando o item entrar em `lancto_caixa`, uma trigger do banco aplicar o
   desconto automaticamente em `lancto_caixa_promo`.
5. A venda seguir no AutoSystem ja com o desconto visivel no momento correto.

## Arquitetura do projeto

### 1. Backend Node.js/TypeScript

Responsabilidades:

- expor a API principal;
- gerar vouchers;
- validar referencias ativas no banco;
- resolver contexto do caixa;
- registrar pre-autorizacoes;
- garantir bootstrap idempotente da integracao SQL;
- recriar estrutura critica do banco quando necessario.

Arquivos principais:

- `api/app.ts`
- `api/db.ts`
- `api/routes/discountCodes.ts`
- `api/routes/cashierDiscounts.ts`
- `api/routes/referenceData.ts`
- `api/services/discountCodeService.ts`
- `api/services/cashierDiscountService.ts`
- `api/services/referenceDataService.ts`

### 2. Frontend web React + Vite

Responsabilidades:

- criar vouchers de desconto;
- consultar historico;
- selecionar produto, grupo de produto, cliente, grupo de cliente e formas de
  pagamento quando aplicavel;
- exibir para o operador codigos de negocio legiveis enquanto preserva chaves
  internas corretas para validacao.

Arquivos principais:

- `src/components/DiscountForm.tsx`
- `src/components/DiscountHistoryTable.tsx`
- `src/components/ResolveCodeCard.tsx`
- `src/pages/Home.tsx`
- `src/pages/History.tsx`
- `src/hooks/useDiscountStore.ts`
- `src/utils/api.ts`

### 3. App do caixa em Python/Tkinter

Responsabilidades:

- iniciar em segundo plano;
- abrir somente quando o operador usar `F9`;
- validar voucher no backend;
- registrar pre-autorizacao do voucher para o proximo cupom elegivel;
- consultar contexto do caixa e status do voucher;
- esconder a janela com `Esc`;
- encerrar completamente com `Ctrl+Shift+Q`.

Arquivo principal:

- `cashier_app/integracao_frota_app.py`

### 4. Banco PostgreSQL 18 / AutoSystem

Responsabilidades:

- armazenar vouchers e pre-autorizacoes;
- executar trigger de aplicacao do desconto;
- validar contexto da venda no momento em que o item entra no caixa;
- refletir o desconto na tabela que o AutoSystem le (`lancto_caixa_promo`).

Observacoes de infraestrutura:

- o banco homologado para esta stack e `PostgreSQL 18`;
- o banco roda diretamente no sistema operacional, fora do Docker;
- apenas `frontend` e `backend` rodam em containers;
- o backend em container acessa o banco do host por `host.docker.internal`.

Arquivos principais:

- `api/db.ts`
- `migrations/20260710_create_cashier_discount_integration.sql`
- `migrations/20260710_create_discount_authorization.sql`
- `migrations/20260711_update_cashier_discount_next_sale.sql`

## Estrutura de pastas

- `api/`: backend Express + logica de banco e servicos.
- `cashier_app/`: app desktop do operador.
- `docs/`: documentacao tecnica e historico funcional.
- `migrations/`: SQLs de integracao e evolucao do banco.
- `shared/`: contratos e tipos compartilhados entre frontend/backend.
- `src/`: frontend React.
- `.dbg/`: configuracoes e logs de depuracao usados em investigacoes.
- `.trae/documents/`: artefatos anteriores de planejamento/arquitetura.

## Fluxo principal do sistema

### Fluxo 1: geracao do voucher

1. O frontend envia um pedido para `POST /api/discount-codes`.
2. O backend valida formato e regras do payload.
3. O backend valida referencias ativas no banco:
   - produto com `flag = 'A'`;
   - cliente com `flag = 'A'`;
   - forma de pagamento com `flag = 'A'`.
4. O voucher e salvo em `discount_authorization`.
5. O codigo curto gerado e usado depois no caixa.

### Fluxo 2: validacao no caixa

1. O operador abre o app Python com `F9`.
2. O app chama `POST /api/cashier-discounts/bootstrap`.
3. O backend valida/reconstroi a estrutura critica da integracao no banco.
4. O operador informa o voucher.
5. O app chama `GET /api/cashier-discounts/:shortCode`.
6. O backend verifica se o voucher existe, esta valido e pode ser usado.

### Fluxo 3: pre-autorizacao no caixa

1. Com o voucher validado, o operador confirma com `F5`.
2. O app envia `POST /api/cashier-discounts/authorize`.
3. O payload inclui `stationHint` automatico do terminal.
4. O backend resolve a estacao do caixa e cria uma entrada em
   `datafrota_desconto_pendente`.
5. A validade operacional da pre-autorizacao e curta: 5 minutos.
6. O sistema impede conflito com outra pre-autorizacao ativa na mesma estacao.
7. Quando necessario, a pre-autorizacao antiga da mesma estacao e substituida.

### Fluxo 4: aplicacao automatica do desconto no PDV

1. O AutoSystem grava o item em `lancto_caixa`.
2. A trigger `datafrota_aplicar_desconto_f()` e executada.
3. A trigger localiza uma pre-autorizacao `P` compativel com:
   - estacao;
   - abastecimento, quando houver;
   - produto;
   - grupo de produto;
   - cliente;
   - grupo de cliente.
4. A trigger resolve o `mlid` real em `caixa_venda`.
5. O desconto e calculado:
   - usa `valor_desconto` se ja existir;
   - senao calcula pelo `percentual_desconto`.
6. O desconto e inserido em `lancto_caixa_promo`.
7. A pre-autorizacao passa para status `R`.

### Fluxo 5: finalizacao por forma de pagamento

1. O banco acompanha a venda vinculada ao `mlid`.
2. Se a venda finalizar com forma de pagamento compativel, o status vira `A`.
3. Se a venda finalizar sem a forma de pagamento exigida, o desconto e removido
   de `lancto_caixa_promo` e o registro vai para erro.

## Regras de negocio criticas

Estas regras nao devem ser quebradas sem decisao explicita do negocio.

### Regras gerais

- O app Python deve iniciar oculto e ficar em segundo plano.
- A interface deve ser exibida exclusivamente por `F9`.
- `F8` nao deve ser usado porque e reservado pelo AutoSystem.
- Vouchers do caixa expiram em 5 minutos apos confirmacao.
- O voucher deve ser de uso unico.
- Produtos e clientes precisam estar ativos (`flag = 'A'`) para gerar/validar
  vouchers.

### Regras de identificadores

- Exibir `pessoa.codigo` para o usuario quando fizer sentido na interface.
- Persistir e validar usando `pessoa.grid` internamente.
- A validacao no caixa deve comparar `caixa_venda.pessoa` com o identificador
  interno salvo no voucher/pre-autorizacao.

### Regras de estacao

- O nome da estacao deve ser normalizado.
- Comparacoes de estacao devem tratar `MAQUINA` e `MAQUINA.WORKGROUP` como o
  mesmo terminal.
- A normalizacao usada no projeto e `split_part(estacao, '.', 1)`.

### Regras de pre-autorizacao

- So pode existir uma pre-autorizacao ativa por estacao.
- Registros ativos sao os que estao com status `P` ou `R`.
- Quando houver nova autorizacao na mesma estacao, a antiga deve ser
  substituida com seguranca.
- O operador nao deve precisar digitar manualmente conta, estacao ou codigo de
  abastecimento no fluxo automatizado atual.

### Regras de integracao com o PDV

- O desconto precisa existir antes da interface do AutoSystem calcular o valor
  do cupom.
- Inserir o desconto tarde demais nao atualiza a tela do PDV.
- O registro final consultado pelo AutoSystem e `lancto_caixa_promo`.
- O `mlid` deve ser obtido do contexto real do caixa; nao usar aproximacoes
  como "ultimo global".

## Modelo de dados principal

### Tabela `discount_authorization`

Representa o voucher gerado pelo sistema.

Campos importantes:

- `id`
- `short_code`
- `scope`
- `product_code`
- `product_group_code`
- `customer_code`
- `customer_group_code`
- `payment_form_codes`
- `discount_percent`
- `valid_from`
- `valid_until`
- `status`

### Tabela `datafrota_desconto_pendente`

Representa a pre-autorizacao do caixa.

Campos importantes:

- `discount_authorization_id`
- `codigo_desconto`
- `abastecimento`
- `conta`
- `estacao`
- `caixa_data`
- `caixa_turno`
- `caixa_usuario`
- `percentual_desconto`
- `valor_desconto`
- `product_code`
- `product_group_code`
- `customer_code`
- `customer_group_code`
- `payment_form_codes`
- `status`
- `validade`
- `reservado_em`
- `aplicado_em`
- `cancelado_em`
- `lancto_caixa`
- `mlid`
- `erro`

### Status da pre-autorizacao

- `P`: pendente, aguardando item elegivel entrar no caixa.
- `R`: reservado/aplicado em cupom ainda nao concluido.
- `A`: aplicado e confirmado.
- `C`: cancelado.
- `X`: expirado.
- `E`: erro.

## Endpoints principais

### Health e bootstrap

- `GET /api/health`: verifica API e configuracao basica de banco.
- `POST /api/cashier-discounts/bootstrap`: garante estrutura critica do banco.

### Vouchers

- `GET /api/discount-codes`: lista vouchers.
- `POST /api/discount-codes`: cria voucher.
- `GET /api/discount-codes/:shortCode`: resolve voucher.
- `POST /api/discount-codes/:shortCode/cancel`: cancela voucher.

### Caixa

- `GET /api/cashier-discounts/context`: resolve estacao/contexto do caixa.
- `GET /api/cashier-discounts/:shortCode`: valida voucher no contexto do caixa.
- `POST /api/cashier-discounts/authorize`: cria pre-autorizacao.
- `GET /api/cashier-discounts/:shortCode/status`: consulta status operacional.

### Referencias

- `GET /api/reference-data/:type`: carrega dados referenciais para formularios.

## Bootstrap e resiliencia do banco

O projeto adota bootstrap idempotente pelo backend.

Isso significa:

- a API consegue criar estrutura faltante sem apagar dados;
- colunas ausentes podem ser adicionadas automaticamente;
- funcoes SQL podem ser recriadas;
- triggers podem ser recriadas;
- o app Python tenta validar a saude da integracao antes da operacao.

Objetivo:

- evitar que a integracao pare por schema incompleto;
- concentrar a reparacao no backend;
- reduzir dependencia de ajustes manuais no banco.

## Execucao local

### Backend + frontend

Scripts principais em `package.json`:

- `npm run dev`: sobe frontend e backend juntos.
- `npm run client:dev`: sobe apenas frontend Vite.
- `npm run server:dev`: sobe apenas backend com nodemon.
- `npm run build`: build do projeto.
- `npm run lint`: lint.
- `npm run check`: TypeScript sem emitir arquivos.
- `npm run test`: testes Vitest.

### Frontend + backend em Docker

Arquivos principais:

- `docker-compose.yml`
- `Dockerfile.frontend`
- `Dockerfile.backend`
- `docker/nginx/default.conf`
- `reiniciar-datafrota-docker.ps1`

Fluxo operacional:

- `frontend` sobe em `http://127.0.0.1:8080`;
- `backend` sobe em `http://127.0.0.1:3001`;
- o `nginx` do frontend faz proxy de `/api` para o servico `backend`;
- o banco `PostgreSQL 18` permanece no host e nao em container.

Comandos principais:

- `docker compose up -d --build`
- `docker compose down`
- `.\reiniciar-datafrota-docker.ps1`

### App Python do caixa

Executar:

```powershell
python .\cashier_app\integracao_frota_app.py
```

Dependencias operacionais:

- API em `http://127.0.0.1:3001/api`, salvo override por `FROTA_API_URL`;
- acesso ao PostgreSQL configurado por variaveis de ambiente.

### Variaveis de ambiente basicas

Arquivo base: `.env.example`

- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `HOST`
- `PORT`

Padrao atual para uso com Docker no Windows:

- `PGHOST=host.docker.internal`
- `PGPORT=5432`
- `PORT=3001`

## Convencoes de engenharia

- Centralizar reparo de estrutura do banco no backend.
- Evitar depender de configuracao manual do operador.
- Preservar separacao entre:
  - codigo exibido ao usuario;
  - identificador interno usado na regra.
- Normalizar estacao sempre.
- Priorizar validacoes fortes de integridade entre identificadores internos e
  externos.
- Manter o app do caixa rapido, simples e resistente a travamentos.

## Problemas conhecidos e licoes aprendidas

### Porta 3001 ocupada

- O processo Node pode ficar preso na porta `3001`.
- Se a API nao subir, verificar processo antigo antes de reiniciar.

### Divergencia de nome da estacao

- `SAMSUNGNOTE2` e `SAMSUNGNOTE2.WORKGROUP` podem representar a mesma maquina.
- Se nao normalizar, a trigger nao encontra a pre-autorizacao correta.

### Layout operacional importa

- Campos essenciais do fluxo nao podem ficar ocultos ou sobrepostos.
- Quebras visuais no app Python ou no frontend podem bloquear o processo real do
  operador.

### Atalho global F9

- O app precisa conviver com disputas de hotkey no Windows.
- Foi necessario tratar instancia unica, fallback e reabertura com debounce.

### Integracao depende do timing correto

- O desconto deve entrar antes do AutoSystem consolidar a exibicao do cupom.
- Esse ponto e estrutural; nao e detalhe de interface.

## Arquivos mais importantes para entender o projeto

Leitura recomendada para novos desenvolvedores:

1. `CONTEXT.md`
2. `docs/datafrota-autosystem-desconto-promocional.md`
3. `api/db.ts`
4. `api/services/cashierDiscountService.ts`
5. `api/services/discountCodeService.ts`
6. `api/routes/cashierDiscounts.ts`
7. `cashier_app/integracao_frota_app.py`
8. `cashier_app/README.md`
9. `src/components/DiscountForm.tsx`
10. `migrations/20260711_update_cashier_discount_next_sale.sql`

## Historico de mudancas relevantes

## 2026-07-13 - Separacao de frontend e backend em containers

- Area: infraestrutura | backend | frontend
- Resumo: a stack passou a usar dois containers separados, um para o frontend em `nginx` e outro para o backend Node.js, mantendo o banco no host.
- Motivo: simplificar operacao, deploy e isolamento entre interface e API sem containerizar o banco.
- Arquivos principais: `docker-compose.yml`, `Dockerfile.frontend`, `Dockerfile.backend`, `docker/nginx/default.conf`, `reiniciar-datafrota-docker.ps1`, `README.md`
- Impacto operacional: o acesso padrao fica em `:8080` para frontend e `:3001` para backend, com o `PostgreSQL 18` rodando fora do Docker e sendo acessado por `host.docker.internal`.

## 2026-07-11 - App do caixa e fluxo inicial de vouchers

- Area: python | backend | banco
- Resumo: foi implementado o app Tkinter para validar voucher e registrar
  pre-autorizacao para o caixa.
- Motivo: permitir uso operacional do desconto no PDV.
- Arquivos principais: `cashier_app/integracao_frota_app.py`,
  `api/routes/cashierDiscounts.ts`, `api/services/cashierDiscountService.ts`
- Impacto operacional: o fluxo passou a ser validar voucher -> autorizar no
  caixa -> registrar item no PDV.

## 2026-07-11 - Troca do atalho para F9

- Area: python
- Resumo: o atalho principal do app foi alterado para `F9`.
- Motivo: `F8` conflita com o AutoSystem.
- Arquivos principais: `cashier_app/integracao_frota_app.py`
- Impacto operacional: a interface deve ser aberta exclusivamente por `F9`.

## 2026-07-11 - Fluxo automatico por estacao

- Area: backend | python | banco
- Resumo: o operador deixou de informar manualmente conta, estacao e codigo de
  abastecimento no fluxo principal; o sistema passou a usar `stationHint` e
  resolucao automatica.
- Motivo: reduzir erro operacional e simplificar uso no caixa.
- Arquivos principais: `cashier_app/integracao_frota_app.py`,
  `api/services/cashierDiscountService.ts`, `api/db.ts`
- Impacto operacional: o fluxo operacional real ficou mais simples e mais
  dependente da descoberta correta da estacao.

## 2026-07-11 - App oculto na inicializacao

- Area: python
- Resumo: o app passou a iniciar oculto em segundo plano.
- Motivo: evitar abrir janela automaticamente no startup.
- Arquivos principais: `cashier_app/integracao_frota_app.py`
- Impacto operacional: o operador so deve ver a interface ao usar `F9`.

## 2026-07-11 - Correcao de travamentos e instancia unica

- Area: python
- Resumo: foram corrigidos travamentos, janelas brancas/duplicadas e problemas
  na reabertura com `Esc`/`F9` por meio de mutex de instancia unica, debounce e
  ajustes no loop de mensagens.
- Motivo: estabilizar o app do caixa em uso continuo.
- Arquivos principais: `cashier_app/integracao_frota_app.py`
- Impacto operacional: abertura e fechamento da janela ficaram mais rapidos e
  previsiveis.

## 2026-07-11 - Bootstrap idempotente da integracao

- Area: backend | banco | python
- Resumo: a API passou a recompor estrutura critica do banco via bootstrap
  idempotente e o app Python passou a exigir essa verificacao antes do uso.
- Motivo: garantir que tabela, colunas, trigger e funcao existam sem apagar
  dados.
- Arquivos principais: `api/db.ts`, `api/routes/cashierDiscounts.ts`,
  `cashier_app/integracao_frota_app.py`
- Impacto operacional: reduz falha por schema quebrado e centraliza reparo no
  backend.

## 2026-07-11 - Colunas ausentes e constraints corrigidas

- Area: backend | banco
- Resumo: o bootstrap passou a criar colunas faltantes como `reservado_em` e a
  remover restricao indevida de `NOT NULL` em `valor_desconto`.
- Motivo: corrigir falhas de pre-autorizacao encontradas em uso real.
- Arquivos principais: `api/db.ts`
- Impacto operacional: a autorizacao deixou de falhar por schema legado
  incompleto.

## 2026-07-11 - Normalizacao de estacao

- Area: backend | banco | python
- Resumo: comparacoes de estacao passaram a usar forma canonica por
  `split_part(..., '.', 1)`.
- Motivo: resolver falha em que a trigger nao encontrava a pre-autorizacao por
  divergencia de hostname completo.
- Arquivos principais: `api/db.ts`,
  `migrations/20260711_update_cashier_discount_next_sale.sql`,
  `cashier_app/integracao_frota_app.py`
- Impacto operacional: terminais com sufixo de dominio/workgroup passaram a
  funcionar corretamente.

## 2026-07-11 - Substituicao automatica de pre-autorizacao por estacao

- Area: backend | banco
- Resumo: a logica deixou de bloquear nova pre-autorizacao na mesma estacao e
  passou a cancelar/substituir registros ativos anteriores.
- Motivo: alinhar o comportamento com a operacao real do caixa.
- Arquivos principais: `api/services/cashierDiscountService.ts`, `api/db.ts`
- Impacto operacional: o operador nao precisa limpar manualmente pendencias
  antigas da mesma estacao.

## 2026-07-11 - Regra de cliente por grupo e uso de pessoa.grid

- Area: backend | banco | frontend
- Resumo: a validacao passou a considerar grupo de cliente e consolidou o uso
  de `pessoa.grid` internamente com exibicao de `pessoa.codigo` na interface.
- Motivo: garantir integridade entre a selecao comercial e a validacao real no
  PDV.
- Arquivos principais: `api/db.ts`, `api/services/discountCodeService.ts`,
  `src/components/DiscountForm.tsx`
- Impacto operacional: reduz falsos positivos na validacao do voucher e evita
  inconsistencias entre UI e banco.

## 2026-07-11 - Validacao de ativos e ajuste do formulario web

- Area: frontend | backend
- Resumo: a geracao de vouchers passou a exigir produtos e clientes ativos e o
  formulario web foi reorganizado para evitar sobreposicao de campos.
- Motivo: impedir vouchers invalidos e melhorar usabilidade operacional.
- Arquivos principais: `api/services/discountCodeService.ts`,
  `src/components/DiscountForm.tsx`
- Impacto operacional: o operador gera vouchers mais confiaveis e com interface
  mais clara.

## 2026-07-11 - Restricao por forma de pagamento

- Area: backend | banco
- Resumo: a integracao passou a confirmar o desconto somente quando a venda
  finaliza com forma de pagamento compativel.
- Motivo: reforcar a regra comercial do voucher.
- Arquivos principais: `api/db.ts`, `api/services/discountCodeService.ts`
- Impacto operacional: vendas fora da forma exigida nao podem consolidar o
  beneficio.

## Checklist rapido antes de mexer no projeto

- Entender se a mudanca afeta voucher, caixa, trigger ou UI.
- Verificar se a regra usa codigo exibido ou identificador interno.
- Confirmar se precisa atualizar bootstrap/migration/trigger.
- Confirmar se a normalizacao de estacao continua correta.
- Validar se o app Python permanece oculto no startup e abre por `F9`.
- Atualizar este `CONTEXT.md` se a mudanca for relevante.
