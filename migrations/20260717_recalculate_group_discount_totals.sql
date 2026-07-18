ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS subtotal_elegivel NUMERIC(15,2) NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS quantidade_elegivel NUMERIC(15,3) NULL;

UPDATE public.datafrota_desconto_pendente
   SET subtotal_elegivel = ROUND((valor_desconto * 100.0) / NULLIF(percentual_desconto, 0), 2)
 WHERE subtotal_elegivel IS NULL
   AND status IN ('R', 'A')
   AND valor_desconto IS NOT NULL
   AND percentual_desconto IS NOT NULL;

UPDATE public.datafrota_desconto_pendente
   SET quantidade_elegivel = quantidade
 WHERE quantidade_elegivel IS NULL
   AND quantidade IS NOT NULL;

CREATE OR REPLACE FUNCTION public.datafrota_aplicar_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_mlid bigint;
    v_pessoa bigint;
    v_sale_ts timestamp without time zone;
    v_sale_time time without time zone;
    v_caixa_data date;
    v_caixa_turno integer;
    v_caixa_usuario text;
    v_caixa_empresa bigint;
    v_sale_date date;
    v_sale_weekday text;
    v_subtotal_elegivel numeric(15,2);
    v_quantidade_elegivel numeric(15,3);
    v_valor_desconto_total numeric(15,2);
    v_valor_desconto_anterior numeric(15,2);
    v_valor_desconto_delta numeric(15,2);
    v_product_code text;
    v_product_group_code text;
    v_product_type text;
    v_customer_code text;
    v_customer_group_code text;
    v_customer_validation_error text;
    v_total_discount_day numeric(15,2);
    v_total_volume_day numeric(15,3);
BEGIN
    IF NEW.valor IS NULL OR NEW.valor <= 0 THEN
        RETURN NEW;
    END IF;

    IF NEW.produto IS NULL AND NEW.produto_codigo IS NULL THEN
        RETURN NEW;
    END IF;

    v_product_code := COALESCE(NEW.produto_codigo, CAST(NEW.produto AS text));

    SELECT cv.mlid, cv.pessoa, cv.ts
      INTO v_mlid, v_pessoa, v_sale_ts
      FROM public.caixa_venda cv
     WHERE cv.conta = NEW.conta
       AND cv.estacao = NEW.estacao
       AND cv.mlid IS NOT NULL
     ORDER BY cv.ts DESC
     LIMIT 1;

    IF v_product_code IS NOT NULL THEN
        SELECT CAST(gp.codigo AS text), UPPER(COALESCE(p.tipo, ''))
          INTO v_product_group_code, v_product_type
          FROM public.produto p
          LEFT JOIN public.grupo_produto gp
            ON CAST(gp.grid AS text) = CAST(p.grupo AS text)
         WHERE p.codigo = v_product_code
            OR CAST(p.grid AS text) = CAST(NEW.produto AS text)
         ORDER BY p.grid DESC
         LIMIT 1;
    END IF;

    IF COALESCE(v_product_type, '') NOT IN ('M', 'C', 'K') THEN
        RETURN NEW;
    END IF;

    IF v_pessoa IS NOT NULL THEN
        v_customer_code := CAST(v_pessoa AS text);

        SELECT COALESCE(CAST(gp.codigo AS text), CAST(pe.grupo AS text))
          INTO v_customer_group_code
          FROM public.pessoa pe
          LEFT JOIN public.grupo_pessoa gp
            ON CAST(gp.grid AS text) = CAST(pe.grupo AS text)
            OR CAST(gp.codigo AS text) = CAST(pe.grupo AS text)
         WHERE CAST(pe.grid AS text) = CAST(v_pessoa AS text)
         LIMIT 1;
    END IF;

    SELECT c.data, c.turno, c.usuario, c.empresa
      INTO v_caixa_data, v_caixa_turno, v_caixa_usuario, v_caixa_empresa
      FROM public.caixa c
     WHERE c.conta = NEW.conta
       AND c.fechamento IS NULL
     ORDER BY c.data DESC NULLS LAST, c.abertura DESC NULLS LAST
     LIMIT 1;

    v_sale_ts := COALESCE(v_sale_ts, NEW.ts, now());
    v_sale_date := COALESCE(v_sale_ts::date, NEW.dia_fiscal, v_caixa_data, CURRENT_DATE);
    v_sale_weekday := (ARRAY['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])[EXTRACT(DOW FROM v_sale_date)::integer + 1];
    v_sale_time := v_sale_ts::time;

    SELECT d.*
      INTO v_desc
      FROM public.datafrota_desconto_pendente d
     WHERE d.validade >= now()
       AND split_part(UPPER(COALESCE(d.estacao, '')), '.', 1) =
           split_part(UPPER(COALESCE(NEW.estacao, '')), '.', 1)
       AND (
         (d.status = 'P' AND (d.abastecimento IS NULL OR d.abastecimento = NEW.abastecimento))
         OR (d.status = 'R' AND d.mlid = v_mlid)
       )
       AND (
         cardinality(COALESCE(d.branch_ids, ARRAY[]::text[])) = 0
         OR CAST(v_caixa_empresa AS text) = ANY(COALESCE(d.branch_ids, ARRAY[]::text[]))
       )
       AND (
         cardinality(COALESCE(d.active_weekdays, ARRAY[]::text[])) = 0
         OR v_sale_weekday = ANY(COALESCE(d.active_weekdays, ARRAY[]::text[]))
       )
       AND (
         cardinality(
           COALESCE(
             d.product_codes,
             CASE
               WHEN d.product_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.product_code]
             END
           )
         ) = 0
         OR v_product_code = ANY(
           COALESCE(
             d.product_codes,
             CASE
               WHEN d.product_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.product_code]
             END
           )
         )
         OR CAST(NEW.produto AS text) = ANY(
           COALESCE(
             d.product_codes,
             CASE
               WHEN d.product_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.product_code]
             END
           )
         )
       )
       AND (
         cardinality(
           COALESCE(
             d.product_group_codes,
             CASE
               WHEN d.product_group_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.product_group_code]
             END
           )
         ) = 0
         OR v_product_group_code = ANY(
           COALESCE(
             d.product_group_codes,
             CASE
               WHEN d.product_group_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.product_group_code]
             END
           )
         )
       )
       AND (
         cardinality(
           COALESCE(
             d.customer_codes,
             CASE
               WHEN d.customer_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.customer_code]
             END
           )
         ) = 0
         OR v_customer_code = ANY(
           COALESCE(
             d.customer_codes,
             CASE
               WHEN d.customer_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.customer_code]
             END
           )
         )
       )
       AND (
         cardinality(
           COALESCE(
             d.customer_group_codes,
             CASE
               WHEN d.customer_group_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.customer_group_code]
             END
           )
         ) = 0
         OR v_customer_group_code = ANY(
           COALESCE(
             d.customer_group_codes,
             CASE
               WHEN d.customer_group_code IS NULL THEN ARRAY[]::text[]
               ELSE ARRAY[d.customer_group_code]
             END
           )
         )
       )
     ORDER BY
       CASE
         WHEN d.status = 'R' AND d.mlid = v_mlid THEN 0
         ELSE 1
       END,
       d.criado_em
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF v_desc.start_time IS NOT NULL AND v_sale_time < v_desc.start_time::time THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Voucher fora do horario inicial permitido para esta promocao'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_desc.end_time IS NOT NULL AND v_sale_time > v_desc.end_time::time THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Voucher fora do horario final permitido para esta promocao'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_desc.max_quantity_per_item IS NOT NULL
       AND COALESCE(v_desc.quantidade, NEW.quantidade, 0) > v_desc.max_quantity_per_item THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Quantidade do item acima do limite configurado para a promocao'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_mlid IS NULL THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Venda aberta sem MLID correspondente a conta/estacao'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_desc.status = 'R' AND v_desc.mlid = v_mlid THEN
        v_subtotal_elegivel := COALESCE(
            v_desc.subtotal_elegivel,
            ROUND((COALESCE(v_desc.valor_desconto, 0) * 100.0) / NULLIF(v_desc.percentual_desconto, 0), 2),
            0
        ) + NEW.valor;
        v_quantidade_elegivel := COALESCE(v_desc.quantidade_elegivel, 0) + COALESCE(NEW.quantidade, 0);
        v_valor_desconto_anterior := COALESCE(v_desc.valor_desconto, 0);
    ELSE
        v_subtotal_elegivel := NEW.valor;
        v_quantidade_elegivel := COALESCE(NEW.quantidade, 0);
        v_valor_desconto_anterior := 0;
    END IF;

    v_valor_desconto_total := ROUND((v_subtotal_elegivel * (v_desc.percentual_desconto / 100.0))::numeric, 2);
    v_valor_desconto_delta := v_valor_desconto_total - v_valor_desconto_anterior;

    IF v_valor_desconto_total <= 0 THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Valor de desconto invalido'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_valor_desconto_delta < 0 THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Recalculo do desconto retornou valor inconsistente'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_valor_desconto_delta > NEW.valor THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Desconto incremental superior ao valor do item'
         WHERE grid = v_desc.grid;
        RETURN NEW;
    END IF;

    IF v_desc.max_discount_per_day IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE(d.valor_desconto, 0)), 0)
          INTO v_total_discount_day
          FROM public.datafrota_desconto_pendente d
         WHERE d.discount_authorization_id = v_desc.discount_authorization_id
           AND d.grid <> v_desc.grid
           AND d.status IN ('R', 'A')
           AND d.caixa_data = v_sale_date;

        IF (COALESCE(v_total_discount_day, 0) + v_valor_desconto_total) > v_desc.max_discount_per_day THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = 'Limite de desconto por dia excedido para esta promocao'
             WHERE grid = v_desc.grid;
            RETURN NEW;
        END IF;
    END IF;

    IF v_desc.max_volume_per_day IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE(d.quantidade_elegivel, d.quantidade, 0)), 0)
          INTO v_total_volume_day
          FROM public.datafrota_desconto_pendente d
         WHERE d.discount_authorization_id = v_desc.discount_authorization_id
           AND d.grid <> v_desc.grid
           AND d.status IN ('R', 'A')
           AND d.caixa_data = v_sale_date;

        IF (COALESCE(v_total_volume_day, 0) + v_quantidade_elegivel) > v_desc.max_volume_per_day THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = 'Limite de volume por dia excedido para esta promocao'
             WHERE grid = v_desc.grid;
            RETURN NEW;
        END IF;
    END IF;

    IF v_customer_code IS NOT NULL THEN
        SELECT public.datafrota_validar_limites_cliente_f(v_desc, v_customer_code, v_sale_date)
          INTO v_customer_validation_error;

        IF v_customer_validation_error IS NOT NULL THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = v_customer_validation_error
             WHERE grid = v_desc.grid;
            RETURN NEW;
        END IF;
    END IF;

    IF v_valor_desconto_delta > 0 THEN
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
            v_valor_desconto_delta,
            COALESCE(v_desc.mensagem_doc, 'DESCONTO FIDELIDADE DATAFROTA'),
            COALESCE(v_desc.mensagem_pdv, 'DATAFROTA - CODIGO ' || v_desc.codigo_desconto),
            v_mlid,
            v_desc.codigo_desconto,
            COALESCE(NEW.quantidade, 0),
            false,
            0,
            NULL
        );
    END IF;

    UPDATE public.datafrota_desconto_pendente
       SET status = 'R',
           reservado_em = COALESCE(v_desc.reservado_em, now()),
           conta = NEW.conta,
           abastecimento = COALESCE(v_desc.abastecimento, NEW.abastecimento),
           caixa_data = COALESCE(v_desc.caixa_data, v_caixa_data, NEW.dia_fiscal),
           caixa_turno = COALESCE(v_desc.caixa_turno, v_caixa_turno),
           caixa_usuario = COALESCE(v_desc.caixa_usuario, v_caixa_usuario),
           resolved_branch_id = COALESCE(v_desc.resolved_branch_id, CAST(v_caixa_empresa AS text)),
           resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code),
           lancto_caixa = NEW.codigo,
           mlid = v_mlid,
           valor_desconto = v_valor_desconto_total,
           subtotal_elegivel = v_subtotal_elegivel,
           quantidade_elegivel = v_quantidade_elegivel,
           erro = NULL
     WHERE grid = v_desc.grid;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        IF v_desc.grid IS NOT NULL THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = SQLSTATE || ' - ' || SQLERRM
             WHERE grid = v_desc.grid;
        END IF;
        RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.datafrota_validar_pagamento_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_pagamento_ativo boolean;
    v_tem_forma_requerida boolean;
    v_total_pago numeric(15,2);
    v_valor_venda numeric(15,2);
    v_customer_code text;
    v_customer_group_code text;
    v_customer_validation_error text;
    v_payment_codes text[];
BEGIN
    IF NEW.mlid IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM public.forma_pgto fp
         WHERE CAST(fp.grid AS text) = CAST(NEW.motivo AS text)
           AND fp.flag = 'A'
    )
      INTO v_pagamento_ativo;

    IF NOT v_pagamento_ativo THEN
        RETURN NEW;
    END IF;

    SELECT customer_code, customer_group_code
      INTO v_customer_code, v_customer_group_code
      FROM public.datafrota_resolver_cliente_venda_f(NEW.mlid);

    FOR v_desc IN
        SELECT d.*
          FROM public.datafrota_desconto_pendente d
         WHERE d.mlid = NEW.mlid
           AND d.status IN ('R', 'A')
           AND (
             (d.payment_form_codes IS NOT NULL AND cardinality(d.payment_form_codes) > 0)
             OR d.payment_form_code IS NOT NULL
           )
         ORDER BY d.criado_em
         FOR UPDATE
    LOOP
        SELECT public.datafrota_validar_limites_cliente_f(
                 v_desc,
                 COALESCE(v_desc.resolved_customer_code, v_customer_code),
                 COALESCE(v_desc.caixa_data, CURRENT_DATE)
               )
          INTO v_customer_validation_error;

        IF v_customer_validation_error IS NOT NULL THEN
            DELETE FROM public.lancto_caixa_promo
             WHERE codigo = v_desc.codigo_desconto
               AND mlid = v_desc.mlid;

            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = v_customer_validation_error,
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code)
             WHERE grid = v_desc.grid;

            CONTINUE;
        END IF;

        v_payment_codes := COALESCE(
          v_desc.payment_form_codes,
          CASE
            WHEN v_desc.payment_form_code IS NULL THEN ARRAY[]::text[]
            ELSE ARRAY[v_desc.payment_form_code]
          END
        );

        SELECT
            public.datafrota_venda_tem_forma_pagamento_f(v_desc.mlid, v_payment_codes),
            COALESCE(MAX(vpv.total_forma_pgto), 0),
            COALESCE(MAX(vpv.valor_venda), 0)
          INTO v_tem_forma_requerida, v_total_pago, v_valor_venda
          FROM public.venda_pgto_view vpv
         WHERE vpv.mlid = v_desc.mlid;

        IF v_tem_forma_requerida THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'A',
                   aplicado_em = COALESCE(aplicado_em, now()),
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code),
                   erro = NULL
             WHERE grid = v_desc.grid;
        ELSIF v_valor_venda > 0 AND v_total_pago >= v_valor_venda THEN
            DELETE FROM public.lancto_caixa_promo
             WHERE codigo = v_desc.codigo_desconto
               AND mlid = v_desc.mlid;

            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = 'Forma de pagamento do voucher nao encontrada na venda finalizada',
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code)
             WHERE grid = v_desc.grid;
        END IF;
    END LOOP;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.datafrota_confirmar_venda_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_tem_regra_pagamento boolean;
    v_tem_forma_requerida boolean;
    v_total_pago numeric(15,2);
    v_valor_venda numeric(15,2);
    v_customer_code text;
    v_customer_group_code text;
    v_customer_validation_error text;
    v_payment_codes text[];
BEGIN
    IF NEW.mlid IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT customer_code, customer_group_code
      INTO v_customer_code, v_customer_group_code
      FROM public.datafrota_resolver_cliente_venda_f(NEW.mlid);

    FOR v_desc IN
        SELECT d.*
          FROM public.datafrota_desconto_pendente d
         WHERE d.mlid = NEW.mlid
           AND d.status IN ('R', 'A')
         ORDER BY d.criado_em
         FOR UPDATE
    LOOP
        IF NOT COALESCE(v_desc.reusable, FALSE) THEN
            UPDATE public.discount_authorization
               SET status = 'CANCELLED',
                   cancelled_at = COALESCE(cancelled_at, now())
             WHERE id = v_desc.discount_authorization_id
               AND status = 'ACTIVE';
        END IF;

        v_tem_regra_pagamento :=
            (
              (v_desc.payment_form_codes IS NOT NULL AND cardinality(v_desc.payment_form_codes) > 0)
              OR v_desc.payment_form_code IS NOT NULL
            );

        SELECT public.datafrota_validar_limites_cliente_f(
                 v_desc,
                 COALESCE(v_desc.resolved_customer_code, v_customer_code),
                 COALESCE(v_desc.caixa_data, CURRENT_DATE)
               )
          INTO v_customer_validation_error;

        IF v_customer_validation_error IS NOT NULL THEN
            DELETE FROM public.lancto_caixa_promo
             WHERE codigo = v_desc.codigo_desconto
               AND mlid = v_desc.mlid;

            UPDATE public.datafrota_desconto_pendente
               SET status = 'E',
                   erro = v_customer_validation_error,
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code)
             WHERE grid = v_desc.grid;
        ELSIF NOT v_tem_regra_pagamento THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'A',
                   aplicado_em = COALESCE(aplicado_em, now()),
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code),
                   erro = NULL
             WHERE grid = v_desc.grid
               AND status = 'R';
        ELSE
            v_payment_codes := COALESCE(
              v_desc.payment_form_codes,
              CASE
                WHEN v_desc.payment_form_code IS NULL THEN ARRAY[]::text[]
                ELSE ARRAY[v_desc.payment_form_code]
              END
            );

            SELECT
                public.datafrota_venda_tem_forma_pagamento_f(v_desc.mlid, v_payment_codes),
                COALESCE(MAX(vpv.total_forma_pgto), 0),
                COALESCE(MAX(vpv.valor_venda), 0)
              INTO v_tem_forma_requerida, v_total_pago, v_valor_venda
              FROM public.venda_pgto_view vpv
             WHERE vpv.mlid = v_desc.mlid;

            IF v_tem_forma_requerida THEN
                UPDATE public.datafrota_desconto_pendente
                   SET status = 'A',
                       aplicado_em = COALESCE(aplicado_em, now()),
                       resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code),
                       erro = NULL
                 WHERE grid = v_desc.grid;
            ELSIF v_valor_venda > 0 AND v_total_pago >= v_valor_venda THEN
                DELETE FROM public.lancto_caixa_promo
                 WHERE codigo = v_desc.codigo_desconto
                   AND mlid = v_desc.mlid;

                UPDATE public.datafrota_desconto_pendente
                   SET status = 'E',
                       erro = 'Forma de pagamento do voucher nao encontrada na venda finalizada',
                       resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code)
                 WHERE grid = v_desc.grid;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$;
