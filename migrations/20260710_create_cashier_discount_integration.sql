CREATE TABLE IF NOT EXISTS public.datafrota_desconto_pendente (
    grid BIGSERIAL PRIMARY KEY,
    discount_authorization_id TEXT NULL REFERENCES public.discount_authorization (id),
    codigo_desconto TEXT NOT NULL,
    abastecimento BIGINT NOT NULL,
    conta TEXT NULL,
    estacao TEXT NULL,
    percentual_desconto NUMERIC(5,2) NOT NULL,
    valor_desconto NUMERIC(15,2) NULL,
    quantidade NUMERIC(15,3) NULL,
    status CHAR(1) NOT NULL DEFAULT 'P',
    validade TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    reservado_em TIMESTAMP WITHOUT TIME ZONE NULL,
    aplicado_em TIMESTAMP WITHOUT TIME ZONE NULL,
    cancelado_em TIMESTAMP WITHOUT TIME ZONE NULL,
    lancto_caixa BIGINT NULL,
    mlid BIGINT NULL,
    product_code TEXT NULL,
    product_group_code TEXT NULL,
    customer_group_code TEXT NULL,
    mensagem_doc TEXT NULL,
    mensagem_pdv TEXT NULL,
    erro TEXT NULL,
    CONSTRAINT datafrota_desc_valor_ck
        CHECK (valor_desconto IS NULL OR valor_desconto > 0),
    CONSTRAINT datafrota_desc_percentual_ck
        CHECK (percentual_desconto > 0 AND percentual_desconto <= 100),
    CONSTRAINT datafrota_desc_status_ck
        CHECK (status IN ('P', 'R', 'A', 'C', 'X', 'E'))
);

CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_codigo_ativo_uk
    ON public.datafrota_desconto_pendente (codigo_desconto)
    WHERE status IN ('P', 'R', 'A');

CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_abast_ativo_uk
    ON public.datafrota_desconto_pendente (abastecimento)
    WHERE status IN ('P', 'R');

CREATE INDEX IF NOT EXISTS datafrota_desc_busca_idx
    ON public.datafrota_desconto_pendente (abastecimento, status, validade);

CREATE INDEX IF NOT EXISTS datafrota_desc_codigo_busca_idx
    ON public.datafrota_desconto_pendente (codigo_desconto);

CREATE OR REPLACE FUNCTION public.datafrota_aplicar_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_mlid bigint;
    v_valor_desconto numeric(15,2);
BEGIN
    IF NEW.abastecimento IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT d.*
      INTO v_desc
      FROM public.datafrota_desconto_pendente d
     WHERE d.abastecimento = NEW.abastecimento
       AND d.status = 'P'
       AND d.validade >= now()
       AND (d.conta IS NULL OR d.conta = NEW.conta)
       AND (d.estacao IS NULL OR d.estacao = NEW.estacao)
     ORDER BY d.criado_em
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

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

DROP TRIGGER IF EXISTS trg_datafrota_aplicar_desconto
ON public.lancto_caixa;

CREATE TRIGGER trg_datafrota_aplicar_desconto
AFTER INSERT
ON public.lancto_caixa
FOR EACH ROW
EXECUTE FUNCTION public.datafrota_aplicar_desconto_f();
