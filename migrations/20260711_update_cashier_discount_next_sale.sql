ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS discount_authorization_id TEXT NULL REFERENCES public.discount_authorization (id);

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS percentual_desconto NUMERIC(5,2);

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS product_code TEXT NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS product_group_code TEXT NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS customer_code TEXT NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS customer_group_code TEXT NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS caixa_data DATE NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS caixa_turno INTEGER NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ADD COLUMN IF NOT EXISTS caixa_usuario TEXT NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ALTER COLUMN abastecimento DROP NOT NULL;

UPDATE public.datafrota_desconto_pendente
   SET percentual_desconto = COALESCE(percentual_desconto, 1)
 WHERE percentual_desconto IS NULL;

ALTER TABLE public.datafrota_desconto_pendente
    ALTER COLUMN percentual_desconto SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_caixa_ativo_uk
    ON public.datafrota_desconto_pendente (conta, estacao)
    WHERE status IN ('P', 'R')
      AND conta IS NOT NULL
      AND estacao IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_estacao_ativa_uk
    ON public.datafrota_desconto_pendente (estacao)
    WHERE status IN ('P', 'R')
      AND estacao IS NOT NULL;

CREATE OR REPLACE FUNCTION public.datafrota_aplicar_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_mlid bigint;
    v_pessoa bigint;
    v_caixa_data date;
    v_caixa_turno integer;
    v_caixa_usuario text;
    v_valor_desconto numeric(15,2);
    v_product_code text;
    v_product_group_code text;
    v_customer_code text;
    v_customer_group_code text;
BEGIN
    IF NEW.abastecimento IS NULL THEN
        RETURN NEW;
    END IF;

    v_product_code := COALESCE(NEW.produto_codigo, CAST(NEW.produto AS text));

    SELECT cv.mlid, cv.pessoa
      INTO v_mlid, v_pessoa
      FROM public.caixa_venda cv
     WHERE cv.conta = NEW.conta
       AND cv.estacao = NEW.estacao
       AND cv.mlid IS NOT NULL
     ORDER BY cv.ts DESC
     LIMIT 1;

    IF v_product_code IS NOT NULL THEN
        SELECT CAST(gp.codigo AS text)
          INTO v_product_group_code
          FROM public.produto p
          LEFT JOIN public.grupo_produto gp
            ON CAST(gp.grid AS text) = CAST(p.grupo AS text)
         WHERE p.codigo = v_product_code
            OR CAST(p.grid AS text) = CAST(NEW.produto AS text)
         ORDER BY p.grid DESC
         LIMIT 1;
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

    SELECT c.data, c.turno, c.usuario
      INTO v_caixa_data, v_caixa_turno, v_caixa_usuario
      FROM public.caixa c
     WHERE c.conta = NEW.conta
       AND c.fechamento IS NULL
     ORDER BY c.data DESC NULLS LAST, c.abertura DESC NULLS LAST
     LIMIT 1;

    SELECT d.*
      INTO v_desc
      FROM public.datafrota_desconto_pendente d
     WHERE d.status = 'P'
       AND d.validade >= now()
       AND split_part(UPPER(COALESCE(d.estacao, '')), '.', 1) =
           split_part(UPPER(COALESCE(NEW.estacao, '')), '.', 1)
       AND (d.abastecimento IS NULL OR d.abastecimento = NEW.abastecimento)
       AND (
           d.product_code IS NULL
           OR d.product_code = v_product_code
           OR d.product_code = CAST(NEW.produto AS text)
       )
       AND (d.product_group_code IS NULL OR d.product_group_code = v_product_group_code)
       AND (d.customer_code IS NULL OR d.customer_code = v_customer_code)
       AND (d.customer_group_code IS NULL OR d.customer_group_code = v_customer_group_code)
     ORDER BY d.criado_em
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF v_mlid IS NULL THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Venda aberta sem MLID correspondente a conta/estacao'
         WHERE grid = v_desc.grid;

        RETURN NEW;
    END IF;

    IF v_desc.valor_desconto IS NOT NULL THEN
        v_valor_desconto := v_desc.valor_desconto;
    ELSE
        v_valor_desconto := ROUND((NEW.valor * (v_desc.percentual_desconto / 100.0))::numeric, 2);
    END IF;

    IF v_valor_desconto <= 0 THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Valor de desconto invalido'
         WHERE grid = v_desc.grid;

        RETURN NEW;
    END IF;

    IF v_valor_desconto > NEW.valor THEN
        UPDATE public.datafrota_desconto_pendente
           SET status = 'E',
               erro = 'Desconto superior ao valor do item'
         WHERE grid = v_desc.grid;

        RETURN NEW;
    END IF;

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
        v_valor_desconto,
        COALESCE(v_desc.mensagem_doc, 'DESCONTO FIDELIDADE DATAFROTA'),
        COALESCE(v_desc.mensagem_pdv, 'DATAFROTA - CODIGO ' || v_desc.codigo_desconto),
        v_mlid,
        v_desc.codigo_desconto,
        COALESCE(v_desc.quantidade, NEW.quantidade),
        false,
        0,
        NULL
    );

    UPDATE public.datafrota_desconto_pendente
       SET status = 'R',
           reservado_em = now(),
           conta = NEW.conta,
           abastecimento = COALESCE(v_desc.abastecimento, NEW.abastecimento),
           caixa_data = COALESCE(v_desc.caixa_data, v_caixa_data, NEW.dia_fiscal),
           caixa_turno = COALESCE(v_desc.caixa_turno, v_caixa_turno),
           caixa_usuario = COALESCE(v_desc.caixa_usuario, v_caixa_usuario),
           lancto_caixa = NEW.codigo,
           mlid = v_mlid,
           valor_desconto = v_valor_desconto,
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
