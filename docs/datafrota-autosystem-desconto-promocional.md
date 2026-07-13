# Integracao DataFrota x AutoSystem

Documento tecnico de referencia para balizar a integracao de desconto
promocional no frente de caixa. O conteudo abaixo foi preservado como base do
projeto.

```sql
/* 
 =============================================================================== 
 INTEGRAÇÃO DATAFROTA x AUTOSYSTEM 
 Aplicação de desconto promocional no Frente de Caixa 
 =============================================================================== 
 
 OBJETIVO 
 -------- 
 Permitir que o operador: 
 
 1. Digite no app DataFrota um código de desconto. 
 2. Selecione o abastecimento correspondente. 
 3. O app registre uma pré-autorização de desconto. 
 4. O operador baixe o abastecimento normalmente no AutoSystem. 
 5. O cupom abra já com o desconto exibido. 
 
 DESCOBERTAS CONFIRMADAS 
 ----------------------- 
 
 1. O item da venda aberta é gravado em: 
 
    public.lancto_caixa 
 
 2. O identificador do item usado pela promoção é: 
 
    lancto_caixa.codigo 
        = 
    lancto_caixa_promo.lancto_caixa 
 
 3. O identificador da venda é: 
 
    caixa_venda.mlid 
        = 
    lancto_caixa_promo.mlid 
 
 4. O AutoSystem calcula o campo "Desc. Promocionais" por meio de: 
 
    SELECT SUM(COALESCE(valor_desconto, 0)) 
    FROM lancto_caixa_promo 
    WHERE lancto_caixa = <lancto_caixa.codigo>; 
 
 5. Inserir o desconto depois que a tela já abriu não atualiza a interface, 
    pois o AutoSystem mantém o valor em memória. 
 
 6. A solução testada e aprovada foi: 
 
    - registrar o desconto antes de baixar o abastecimento; 
    - associar o desconto ao abastecimento.codigo; 
    - usar uma trigger AFTER INSERT em lancto_caixa; 
    - capturar o MLID real de caixa_venda; 
    - inserir em lancto_caixa_promo antes de o AutoSystem calcular a tela. 
 
 7. Teste aprovado: 
 
    Subtotal:              R$ 52,81 
    Desconto promocional:   R$ 6,37 
    Total:                 R$ 46,44 
 
 O teste confirmou que não é necessário prever o MLID global e nem forçar 
 refresh da tela. O MLID é obtido da venda aberta na conta/estação correta. 
 =============================================================================== 
 */ 
 
 
 -- ============================================================================ 
 -- 1. TABELA DE PRÉ-AUTORIZAÇÕES DO DATAFROTA 
 -- ============================================================================ 
 
 CREATE TABLE IF NOT EXISTS public.datafrota_desconto_pendente ( 
     grid bigserial PRIMARY KEY, 
 
     /* 
      * Código digitado pelo operador no app DataFrota. 
      * Deve ser único e preferencialmente gerado pelo servidor DataFrota. 
      */ 
     codigo_desconto text NOT NULL, 
 
     /* 
      * Código do abastecimento ao qual o desconto será aplicado. 
      * Esta é a principal chave de associação com o AutoSystem. 
      */ 
     abastecimento bigint NOT NULL, 
 
     /* 
      * Restrições opcionais do caixa. 
      * Quando preenchidas, impedem que outro caixa aplique o desconto. 
      */ 
     conta text, 
     estacao text, 
 
     /* 
      * Valor monetário total do desconto. 
      */ 
     valor_desconto numeric(15,2) NOT NULL, 
 
     /* 
      * Quantidade beneficiada. 
      * Pode ficar NULL; nesse caso será usada a quantidade do lancto_caixa. 
      */ 
     quantidade numeric(15,3), 
 
     /* 
      * Estados sugeridos: 
      * 
      * P = pendente, aguardando abertura do cupom 
      * R = reservado/aplicado em cupom ainda não finalizado 
      * A = venda finalizada com sucesso 
      * C = cancelado 
      * X = expirado 
      * E = erro 
      */ 
     status char(1) NOT NULL DEFAULT 'P', 
 
     validade timestamp without time zone NOT NULL, 
     criado_em timestamp without time zone NOT NULL DEFAULT now(), 
     reservado_em timestamp without time zone, 
     aplicado_em timestamp without time zone, 
     cancelado_em timestamp without time zone, 
 
     /* 
      * Identificadores preenchidos depois que o AutoSystem abrir o cupom. 
      */ 
     lancto_caixa bigint, 
     mlid bigint, 
 
     mensagem_doc text, 
     mensagem_pdv text, 
 
     erro text, 
 
     CONSTRAINT datafrota_desc_valor_ck 
         CHECK (valor_desconto > 0), 
 
     CONSTRAINT datafrota_desc_status_ck 
         CHECK (status IN ('P', 'R', 'A', 'C', 'X', 'E')), 
 
     CONSTRAINT datafrota_desc_codigo_uk 
         UNIQUE (codigo_desconto) 
 ); 
 
 
 COMMENT ON TABLE public.datafrota_desconto_pendente IS 
 'Pré-autorização de descontos do DataFrota antes da abertura do cupom no AutoSystem.'; 
 
 
 -- Impede duas pré-autorizações ativas para o mesmo abastecimento. 
 
 CREATE UNIQUE INDEX IF NOT EXISTS 
     datafrota_desc_abast_ativo_uk 
 ON public.datafrota_desconto_pendente (abastecimento) 
 WHERE status IN ('P', 'R'); 
 
 
 -- Índice para a consulta executada pela trigger. 
 
 CREATE INDEX IF NOT EXISTS 
     datafrota_desc_busca_idx 
 ON public.datafrota_desconto_pendente ( 
     abastecimento, 
     status, 
     validade 
 ); 
 
 
 -- ============================================================================ 
 -- 2. FUNÇÃO QUE APLICA O DESCONTO NA ABERTURA DO CUPOM 
 -- ============================================================================ 
 
 CREATE OR REPLACE FUNCTION public.datafrota_aplicar_desconto_f() 
 RETURNS trigger 
 LANGUAGE plpgsql 
 AS $$ 
 DECLARE 
     v_desc public.datafrota_desconto_pendente%ROWTYPE; 
     v_mlid bigint; 
 BEGIN 
     /* 
      * A integração atual atende somente itens originados de abastecimento. 
      */ 
     IF NEW.abastecimento IS NULL THEN 
         RETURN NEW; 
     END IF; 
 
     /* 
      * Localiza a pré-autorização correspondente ao abastecimento. 
      * 
      * FOR UPDATE: 
      * impede que duas sessões tentem consumir simultaneamente o mesmo código. 
      */ 
     SELECT d.* 
       INTO v_desc 
       FROM public.datafrota_desconto_pendente d 
      WHERE d.abastecimento = NEW.abastecimento 
        AND d.status = 'P' 
        AND d.validade >= now() 
 
        AND ( 
             d.conta IS NULL 
             OR d.conta = NEW.conta 
        ) 
 
        AND ( 
             d.estacao IS NULL 
             OR d.estacao = NEW.estacao 
        ) 
 
      ORDER BY d.criado_em 
      LIMIT 1 
      FOR UPDATE; 
 
     /* 
      * Não existe desconto pendente para esse abastecimento. 
      * A venda segue normalmente sem desconto DataFrota. 
      */ 
     IF NOT FOUND THEN 
         RETURN NEW; 
     END IF; 
 
     /* 
      * Obtém o MLID real da venda aberta no mesmo caixa. 
      * 
      * Não utilizar: 
      * - MAX(mlid); 
      * - last_value de sequence; 
      * - nextval antecipado; 
      * - último MLID global. 
      * 
      * O MLID é global e outro caixa pode gerar valores entre as operações. 
      */ 
     SELECT cv.mlid 
       INTO v_mlid 
       FROM public.caixa_venda cv 
      WHERE cv.conta = NEW.conta 
        AND cv.estacao = NEW.estacao 
        AND cv.mlid IS NOT NULL 
      ORDER BY cv.ts DESC 
      LIMIT 1; 
 
     IF v_mlid IS NULL THEN 
         UPDATE public.datafrota_desconto_pendente 
            SET status = 'E', 
                erro = 'Venda aberta sem MLID correspondente à conta/estação' 
          WHERE grid = v_desc.grid; 
 
         RETURN NEW; 
     END IF; 
 
     /* 
      * Validações básicas. 
      */ 
     IF v_desc.valor_desconto <= 0 THEN 
         UPDATE public.datafrota_desconto_pendente 
            SET status = 'E', 
                erro = 'Valor de desconto inválido' 
          WHERE grid = v_desc.grid; 
 
         RETURN NEW; 
     END IF; 
 
     IF v_desc.valor_desconto > NEW.valor THEN 
         UPDATE public.datafrota_desconto_pendente 
            SET status = 'E', 
                erro = 'Desconto superior ao valor do item' 
          WHERE grid = v_desc.grid; 
 
         RETURN NEW; 
     END IF; 
 
     /* 
      * Registra o desconto na tabela que o AutoSystem consulta para montar 
      * o campo "Desc. Promocionais". 
      */ 
     INSERT INTO public.lancto_caixa_promo ( 
         lancto_caixa, 
         beneficio, 
         valor_desconto, 
         mensagem_doc, 
         mensagem_pdv, 
         mlid, 
         codigo, 
         quantidade, 
         resgate, 
         appid, 
         parametro_opcional 
     ) 
     VALUES ( 
         NEW.codigo, 
         'DATAFROTA', 
         v_desc.valor_desconto, 
 
         COALESCE( 
             v_desc.mensagem_doc, 
             'DESCONTO FIDELIDADE DATAFROTA' 
         ), 
 
         COALESCE( 
             v_desc.mensagem_pdv, 
             'DATAFROTA - CÓDIGO ' || v_desc.codigo_desconto 
         ), 
 
         v_mlid, 
         v_desc.codigo_desconto, 
 
         COALESCE( 
             v_desc.quantidade, 
             NEW.quantidade 
         ), 
 
         false, 
         0, 
         NULL 
     ); 
 
     /* 
      * O código fica reservado porque o item entrou no cupom, mas a venda 
      * ainda pode ser cancelada. 
      * 
      * O status A deve ser utilizado somente quando identificarmos a 
      * finalização efetiva da venda. 
      */ 
     UPDATE public.datafrota_desconto_pendente 
        SET status = 'R', 
            reservado_em = now(), 
            lancto_caixa = NEW.codigo, 
            mlid = v_mlid, 
            erro = NULL 
      WHERE grid = v_desc.grid; 
 
     RETURN NEW; 
 
 EXCEPTION 
     WHEN OTHERS THEN 
         /* 
          * O erro do DataFrota não deve impedir o AutoSystem de inserir o item. 
          * A falha fica registrada para análise e monitoramento. 
          */ 
         IF v_desc.grid IS NOT NULL THEN 
             UPDATE public.datafrota_desconto_pendente 
                SET status = 'E', 
                    erro = SQLSTATE || ' - ' || SQLERRM 
              WHERE grid = v_desc.grid; 
         END IF; 
 
         RETURN NEW; 
 END; 
 $$; 
 
 
 -- ============================================================================ 
 -- 3. TRIGGER NO LANCTO_CAIXA 
 -- ============================================================================ 
 
 DROP TRIGGER IF EXISTS 
     trg_datafrota_aplicar_desconto 
 ON public.lancto_caixa; 
 
 
 CREATE TRIGGER trg_datafrota_aplicar_desconto 
 AFTER INSERT 
 ON public.lancto_caixa 
 FOR EACH ROW 
 EXECUTE FUNCTION public.datafrota_aplicar_desconto_f(); 
 
 
 -- ============================================================================ 
 -- 4. EXEMPLO DE PRÉ-AUTORIZAÇÃO GERADA PELO APP DATAFROTA 
 -- ============================================================================ 
 
 /* 
 O app deve executar esta operação depois que: 
 
 1. o operador digitar o código; 
 2. o DataFrota validar o código; 
 3. o operador selecionar o abastecimento; 
 4. antes de baixar o abastecimento no AutoSystem. 
 */ 
 
 INSERT INTO public.datafrota_desconto_pendente ( 
     codigo_desconto, 
     abastecimento, 
     conta, 
     estacao, 
     valor_desconto, 
     quantidade, 
     validade, 
     mensagem_doc, 
     mensagem_pdv 
 ) 
 VALUES ( 
     'DF-EXEMPLO-000001', 
     247874, 
     '1.1.2.7', 
     'SAMSUNGNOTE2.WORKGROUP', 
     6.37, 
     NULL, 
     now() + interval '15 minutes', 
     'DESCONTO FIDELIDADE DATAFROTA', 
     'DATAFROTA - CÓDIGO DF-EXEMPLO-000001' 
 ); 
 
 
 -- ============================================================================ 
 -- 5. CONSULTA PARA O APP ACOMPANHAR O RESULTADO 
 -- ============================================================================ 
 
 SELECT 
     grid, 
     codigo_desconto, 
     abastecimento, 
     valor_desconto, 
     status, 
     lancto_caixa, 
     mlid, 
     criado_em, 
     reservado_em, 
     aplicado_em, 
     erro 
 FROM public.datafrota_desconto_pendente 
 WHERE codigo_desconto = 'DF-EXEMPLO-000001'; 
 
 
 /* 
 Interpretação: 
 
 P = aguardando o abastecimento ser baixado 
 R = desconto inserido no cupom 
 A = venda finalizada 
 C = código cancelado 
 X = código expirado 
 E = erro 
 */ 
 
 
 -- ============================================================================ 
 -- 6. CONSULTA DE CONFERÊNCIA DO DESCONTO NO AUTOSYSTEM 
 -- ============================================================================ 
 
 SELECT 
     lcp.lancto_caixa, 
     lcp.beneficio, 
     lcp.valor_desconto, 
     lcp.mensagem_doc, 
     lcp.mensagem_pdv, 
     lcp.mlid, 
     lcp.codigo, 
     lcp.quantidade, 
     lcp.resgate, 
     lcp.appid, 
 
     lc.abastecimento, 
     lc.conta, 
     lc.estacao, 
     lc.produto, 
     lc.produto_nome, 
     lc.quantidade AS quantidade_item, 
     lc.valor AS subtotal, 
 
     lc.valor - lcp.valor_desconto AS total_liquido 
 
 FROM public.lancto_caixa_promo lcp 
 
 JOIN public.lancto_caixa lc 
   ON lc.codigo = lcp.lancto_caixa 
 
 WHERE lcp.codigo = 'DF-EXEMPLO-000001'; 
 
 
 -- ============================================================================ 
 -- 7. CANCELAMENTO MANUAL DE UMA PRÉ-AUTORIZAÇÃO 
 -- ============================================================================ 
 
 UPDATE public.datafrota_desconto_pendente 
    SET status = 'C', 
        cancelado_em = now(), 
        erro = 'Cancelado pelo operador' 
  WHERE codigo_desconto = 'DF-EXEMPLO-000001' 
    AND status = 'P'; 
 
 
 -- ============================================================================ 
 -- 8. EXPIRAÇÃO DE CÓDIGOS NÃO UTILIZADOS 
 -- ============================================================================ 
 
 UPDATE public.datafrota_desconto_pendente 
    SET status = 'X', 
        erro = 'Código expirado antes da abertura do cupom' 
  WHERE status = 'P' 
    AND validade < now(); 
 
 
 -- ============================================================================ 
 -- 9. MONITORAMENTO DE ERROS 
 -- ============================================================================ 
 
 SELECT 
     grid, 
     codigo_desconto, 
     abastecimento, 
     conta, 
     estacao, 
     valor_desconto, 
     criado_em, 
     erro 
 FROM public.datafrota_desconto_pendente 
 WHERE status = 'E' 
 ORDER BY criado_em DESC; 
 
 
 -- ============================================================================ 
 -- 10. CONSULTA DE DESCONTOS RESERVADOS E AINDA NÃO FINALIZADOS 
 -- ============================================================================ 
 
 SELECT 
     grid, 
     codigo_desconto, 
     abastecimento, 
     valor_desconto, 
     lancto_caixa, 
     mlid, 
     reservado_em 
 FROM public.datafrota_desconto_pendente 
 WHERE status = 'R' 
 ORDER BY reservado_em; 
 
 
 -- ============================================================================ 
 -- 11. PENDÊNCIA PARA A PRÓXIMA ETAPA 
 -- ============================================================================ 
 
 /* 
 Ainda deve ser identificado o evento exato de finalização e cancelamento 
 da venda no AutoSystem. 
 
 Quando a venda for concluída: 
 
     UPDATE datafrota_desconto_pendente 
        SET status = 'A', 
            aplicado_em = now() 
      WHERE mlid = <MLID DA VENDA> 
        AND status = 'R'; 
 
 Quando o item ou a venda for cancelado: 
 
 Opção 1: 
     retornar para P, caso ainda esteja válido; 
 
 Opção 2: 
     marcar como C e exigir nova autorização. 
 
 A regra dependerá da política comercial do DataFrota. 
 
 Não é recomendado considerar o código definitivamente utilizado apenas 
 quando ele entra em lancto_caixa, porque a venda ainda pode ser cancelada. 
 */ 
 
 
 -- ============================================================================ 
 -- 12. REMOÇÃO COMPLETA DA INTEGRAÇÃO EM HOMOLOGAÇÃO 
 -- ============================================================================ 
 
 /* 
 DROP TRIGGER IF EXISTS 
     trg_datafrota_aplicar_desconto 
 ON public.lancto_caixa; 
 
 DROP FUNCTION IF EXISTS 
     public.datafrota_aplicar_desconto_f(); 
 
 DROP TABLE IF EXISTS 
     public.datafrota_desconto_pendente; 
 *  /plan
```
