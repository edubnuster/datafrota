CREATE OR REPLACE FUNCTION public.datafrota_confirmar_venda_desconto_f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_desc public.datafrota_desconto_pendente%ROWTYPE;
    v_tem_regra_pagamento boolean;
BEGIN
    IF NEW.mlid IS NULL THEN
        RETURN NEW;
    END IF;

    FOR v_desc IN
        SELECT d.*
          FROM public.datafrota_desconto_pendente d
         WHERE d.mlid = NEW.mlid
           AND d.status IN ('R', 'A')
         ORDER BY d.criado_em
         FOR UPDATE
    LOOP
        UPDATE public.discount_authorization
           SET status = 'CANCELLED',
               cancelled_at = COALESCE(cancelled_at, now())
         WHERE id = v_desc.discount_authorization_id
           AND status = 'ACTIVE';

        v_tem_regra_pagamento :=
            (
              (v_desc.payment_form_codes IS NOT NULL AND cardinality(v_desc.payment_form_codes) > 0)
              OR v_desc.payment_form_code IS NOT NULL
            );

        IF NOT v_tem_regra_pagamento THEN
            UPDATE public.datafrota_desconto_pendente
               SET status = 'A',
                   aplicado_em = COALESCE(aplicado_em, now()),
                   erro = NULL
             WHERE grid = v_desc.grid
               AND status = 'R';
        END IF;
    END LOOP;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger tg
    INNER JOIN pg_class cls
      ON cls.oid = tg.tgrelid
    INNER JOIN pg_namespace ns
      ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND cls.relname = 'lancto'
      AND tg.tgname = 'trg_datafrota_confirmar_venda_desconto'
      AND NOT tg.tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.lancto ENABLE TRIGGER trg_datafrota_confirmar_venda_desconto';
  ELSE
    EXECUTE '
      CREATE TRIGGER trg_datafrota_confirmar_venda_desconto
      AFTER INSERT ON public.lancto
      FOR EACH ROW
      EXECUTE FUNCTION public.datafrota_confirmar_venda_desconto_f()
    ';
  END IF;
END $$;
