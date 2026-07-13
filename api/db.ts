import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "frota",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  max: 3,
  idleTimeoutMillis: 3000,
  connectionTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

pool.on("connect", (client) => {
  void client.query("SET client_encoding TO 'LATIN1'");
});

let schemaReadyPromise: Promise<void> | null = null;
let cashierSchemaReadyPromise: Promise<void> | null = null;

export type IntegrationBootstrapCheck = {
  key: string;
  ok: boolean;
  details: string;
};

export type CashierIntegrationBootstrapStatus = {
  ok: boolean;
  checkedAt: string;
  checks: IntegrationBootstrapCheck[];
};

export async function query<T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
  const result = await pool.query<T>(text, values);
  return { rows: result.rows };
}

export async function withTransaction<T>(
  callback: (queryFn: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const scopedQuery = async <R>(text: string, values: unknown[] = []): Promise<{ rows: R[] }> => {
      const result = await client.query<R>(text, values);
      return { rows: result.rows };
    };

    const result = await callback(scopedQuery);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDiscountSchema(force = false): Promise<void> {
  if (force) {
    schemaReadyPromise = null;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS discount_authorization (
          id TEXT PRIMARY KEY,
          short_code TEXT NOT NULL UNIQUE,
          scope TEXT NOT NULL CHECK (scope IN ('ALL_PRODUCTS', 'PRODUCT', 'PRODUCT_GROUP')),
          product_codes TEXT[] NULL,
          product_code TEXT NULL,
          product_group_codes TEXT[] NULL,
          product_group_code TEXT NULL,
          customer_codes TEXT[] NULL,
          customer_code TEXT NULL,
          customer_group_codes TEXT[] NULL,
          customer_group_code TEXT NULL,
          payment_form_codes TEXT[] NULL,
          payment_form_code TEXT NULL,
          discount_percent NUMERIC(5,2) NOT NULL,
          valid_from TIMESTAMPTZ NULL,
          valid_until TIMESTAMPTZ NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          cancelled_at TIMESTAMPTZ NULL
        );

        CREATE INDEX IF NOT EXISTS idx_discount_authorization_short_code
          ON discount_authorization (short_code);

        CREATE INDEX IF NOT EXISTS idx_discount_authorization_status
          ON discount_authorization (status);

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS product_codes TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS customer_code TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS product_group_codes TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS customer_codes TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS customer_group_codes TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS payment_form_code TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS payment_form_codes TEXT[] NULL;

        UPDATE discount_authorization
           SET product_codes = ARRAY[product_code]
         WHERE product_code IS NOT NULL
           AND (product_codes IS NULL OR cardinality(product_codes) = 0);

        UPDATE discount_authorization
           SET product_group_codes = ARRAY[product_group_code]
         WHERE product_group_code IS NOT NULL
           AND (product_group_codes IS NULL OR cardinality(product_group_codes) = 0);

        UPDATE discount_authorization
           SET customer_codes = ARRAY[customer_code]
         WHERE customer_code IS NOT NULL
           AND (customer_codes IS NULL OR cardinality(customer_codes) = 0);

        UPDATE discount_authorization
           SET customer_group_codes = ARRAY[customer_group_code]
         WHERE customer_group_code IS NOT NULL
           AND (customer_group_codes IS NULL OR cardinality(customer_group_codes) = 0);

        UPDATE discount_authorization
           SET payment_form_codes = ARRAY[payment_form_code]
         WHERE payment_form_code IS NOT NULL
           AND (payment_form_codes IS NULL OR cardinality(payment_form_codes) = 0);
      `)
      .then(() => undefined)
      .catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
  }

  await schemaReadyPromise;
}

export async function ensureCashierSchema(force = false): Promise<void> {
  await ensureDiscountSchema(force);

  if (force) {
    cashierSchemaReadyPromise = null;
  }

  if (!cashierSchemaReadyPromise) {
    cashierSchemaReadyPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS datafrota_desconto_pendente (
          grid BIGSERIAL PRIMARY KEY,
          discount_authorization_id TEXT NULL REFERENCES discount_authorization (id),
          codigo_desconto TEXT NOT NULL,
          abastecimento BIGINT NULL,
          conta TEXT NULL,
          estacao TEXT NULL,
          caixa_data DATE NULL,
          caixa_turno INTEGER NULL,
          caixa_usuario TEXT NULL,
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
          product_codes TEXT[] NULL,
          product_code TEXT NULL,
          product_group_codes TEXT[] NULL,
          product_group_code TEXT NULL,
          customer_codes TEXT[] NULL,
          customer_code TEXT NULL,
          customer_group_codes TEXT[] NULL,
          customer_group_code TEXT NULL,
          payment_form_codes TEXT[] NULL,
          payment_form_code TEXT NULL,
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

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS discount_authorization_id TEXT NULL REFERENCES discount_authorization (id);

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS percentual_desconto NUMERIC(5,2);

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS product_codes TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS product_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS product_group_codes TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS product_group_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS customer_codes TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS customer_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS customer_group_codes TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS customer_group_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS payment_form_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS payment_form_codes TEXT[] NULL;

        UPDATE datafrota_desconto_pendente
           SET product_codes = ARRAY[product_code]
         WHERE product_code IS NOT NULL
           AND (product_codes IS NULL OR cardinality(product_codes) = 0);

        UPDATE datafrota_desconto_pendente
           SET product_group_codes = ARRAY[product_group_code]
         WHERE product_group_code IS NOT NULL
           AND (product_group_codes IS NULL OR cardinality(product_group_codes) = 0);

        UPDATE datafrota_desconto_pendente
           SET customer_codes = ARRAY[customer_code]
         WHERE customer_code IS NOT NULL
           AND (customer_codes IS NULL OR cardinality(customer_codes) = 0);

        UPDATE datafrota_desconto_pendente
           SET customer_group_codes = ARRAY[customer_group_code]
         WHERE customer_group_code IS NOT NULL
           AND (customer_group_codes IS NULL OR cardinality(customer_group_codes) = 0);

        UPDATE datafrota_desconto_pendente
           SET payment_form_codes = ARRAY[payment_form_code]
         WHERE payment_form_code IS NOT NULL
           AND (payment_form_codes IS NULL OR cardinality(payment_form_codes) = 0);

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS caixa_data DATE NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS caixa_turno INTEGER NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS caixa_usuario TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS reservado_em TIMESTAMP WITHOUT TIME ZONE NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMP WITHOUT TIME ZONE NULL;

        ALTER TABLE datafrota_desconto_pendente
          ALTER COLUMN abastecimento DROP NOT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ALTER COLUMN valor_desconto DROP NOT NULL;

        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'datafrota_desconto_pendente'
              AND column_name = 'percentual_desconto'
          ) THEN
            EXECUTE '
              UPDATE datafrota_desconto_pendente
              SET percentual_desconto = COALESCE(percentual_desconto, 1)
              WHERE percentual_desconto IS NULL
            ';
            EXECUTE '
              ALTER TABLE datafrota_desconto_pendente
              ALTER COLUMN percentual_desconto SET NOT NULL
            ';
          END IF;
        END $$;

        CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_codigo_ativo_uk
          ON datafrota_desconto_pendente (codigo_desconto)
          WHERE status IN ('P', 'R', 'A');

        CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_abast_ativo_uk
          ON datafrota_desconto_pendente (abastecimento)
          WHERE status IN ('P', 'R');

        CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_caixa_ativo_uk
          ON datafrota_desconto_pendente (conta, estacao)
          WHERE status IN ('P', 'R') AND conta IS NOT NULL AND estacao IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS datafrota_desc_estacao_ativa_uk
          ON datafrota_desconto_pendente (estacao)
          WHERE status IN ('P', 'R') AND estacao IS NOT NULL;

        CREATE INDEX IF NOT EXISTS datafrota_desc_busca_idx
          ON datafrota_desconto_pendente (abastecimento, status, validade);

        CREATE INDEX IF NOT EXISTS datafrota_desc_codigo_busca_idx
          ON datafrota_desconto_pendente (codigo_desconto);

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
                SELECT
                    COALESCE(
                      BOOL_OR(
                        CAST(vpv.forma_pgto AS text) = ANY(
                          COALESCE(
                            v_desc.payment_form_codes,
                            CASE
                              WHEN v_desc.payment_form_code IS NULL THEN ARRAY[]::text[]
                              ELSE ARRAY[v_desc.payment_form_code]
                            END
                          )
                        )
                      ),
                      false
                    ),
                    COALESCE(MAX(vpv.total_forma_pgto), 0),
                    COALESCE(MAX(vpv.valor_venda), 0)
                  INTO v_tem_forma_requerida, v_total_pago, v_valor_venda
                  FROM public.venda_pgto_view vpv
                 WHERE vpv.mlid = v_desc.mlid;

                IF v_tem_forma_requerida THEN
                    UPDATE public.datafrota_desconto_pendente
                       SET status = 'A',
                           aplicado_em = COALESCE(aplicado_em, now()),
                           erro = NULL
                     WHERE grid = v_desc.grid;
                ELSIF v_valor_venda > 0 AND v_total_pago >= v_valor_venda THEN
                    DELETE FROM public.lancto_caixa_promo
                     WHERE codigo = v_desc.codigo_desconto
                       AND lancto_caixa = v_desc.lancto_caixa
                       AND mlid = v_desc.mlid;

                    UPDATE public.datafrota_desconto_pendente
                       SET status = 'E',
                           erro = 'Forma de pagamento do voucher nao encontrada na venda finalizada'
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
              AND cls.relname = 'lancto_caixa'
              AND tg.tgname = 'trg_datafrota_aplicar_desconto'
              AND NOT tg.tgisinternal
          ) THEN
            EXECUTE 'ALTER TABLE public.lancto_caixa ENABLE TRIGGER trg_datafrota_aplicar_desconto';
          ELSE
            EXECUTE '
              CREATE TRIGGER trg_datafrota_aplicar_desconto
              AFTER INSERT ON public.lancto_caixa
              FOR EACH ROW
              EXECUTE FUNCTION public.datafrota_aplicar_desconto_f()
            ';
          END IF;
        END $$;

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
              AND cls.relname = 'movto'
              AND tg.tgname = 'trg_datafrota_validar_pagamento_desconto'
              AND NOT tg.tgisinternal
          ) THEN
            EXECUTE 'ALTER TABLE public.movto ENABLE TRIGGER trg_datafrota_validar_pagamento_desconto';
          ELSE
            EXECUTE '
              CREATE TRIGGER trg_datafrota_validar_pagamento_desconto
              AFTER INSERT ON public.movto
              FOR EACH ROW
              EXECUTE FUNCTION public.datafrota_validar_pagamento_desconto_f()
            ';
          END IF;
        END $$;

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
      `)
      .then(() => undefined)
      .catch((error) => {
        cashierSchemaReadyPromise = null;
        throw error;
      });
  }

  await cashierSchemaReadyPromise;
}

type ExistsRow = {
  exists: boolean;
};

type MissingColumnRow = {
  column_name: string;
};

export async function getCashierIntegrationBootstrapStatus(): Promise<CashierIntegrationBootstrapStatus> {
  const [discountAuthTable, pendingTable, triggerTargetTable, functionExists, triggerState, missingColumns] =
    await Promise.all([
      query<ExistsRow>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'discount_authorization'
          ) AS exists
        `,
      ),
      query<ExistsRow>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'datafrota_desconto_pendente'
          ) AS exists
        `,
      ),
      query<ExistsRow>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'lancto_caixa'
          ) AS exists
        `,
      ),
      query<ExistsRow>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pg_proc proc
            INNER JOIN pg_namespace ns
              ON ns.oid = proc.pronamespace
            WHERE ns.nspname = 'public'
              AND proc.proname = 'datafrota_aplicar_desconto_f'
          ) AS exists
        `,
      ),
      query<{ exists: boolean; enabled: boolean }>(
        `
          SELECT
            EXISTS (
              SELECT 1
              FROM pg_trigger tg
              INNER JOIN pg_class cls
                ON cls.oid = tg.tgrelid
              INNER JOIN pg_namespace ns
                ON ns.oid = cls.relnamespace
              WHERE ns.nspname = 'public'
                AND cls.relname = 'lancto_caixa'
                AND tg.tgname = 'trg_datafrota_aplicar_desconto'
                AND NOT tg.tgisinternal
            ) AS exists,
            COALESCE((
              SELECT tg.tgenabled <> 'D'
              FROM pg_trigger tg
              INNER JOIN pg_class cls
                ON cls.oid = tg.tgrelid
              INNER JOIN pg_namespace ns
                ON ns.oid = cls.relnamespace
              WHERE ns.nspname = 'public'
                AND cls.relname = 'lancto_caixa'
                AND tg.tgname = 'trg_datafrota_aplicar_desconto'
                AND NOT tg.tgisinternal
              LIMIT 1
            ), false) AS enabled
        `,
      ),
      query<MissingColumnRow>(
        `
          SELECT required.column_name
          FROM (
            VALUES
              ('discount_authorization_id'),
              ('percentual_desconto'),
              ('product_codes'),
              ('product_group_codes'),
              ('product_group_code'),
              ('customer_codes'),
              ('customer_code'),
              ('customer_group_codes'),
              ('customer_group_code'),
              ('payment_form_codes'),
              ('payment_form_code'),
              ('reservado_em'),
              ('cancelado_em')
          ) AS required(column_name)
          WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns cols
            WHERE cols.table_schema = 'public'
              AND cols.table_name = 'datafrota_desconto_pendente'
              AND cols.column_name = required.column_name
          )
          ORDER BY required.column_name
        `,
      ),
    ]);

  const checks: IntegrationBootstrapCheck[] = [
    {
      key: "discount_authorization_table",
      ok: Boolean(discountAuthTable.rows[0]?.exists),
      details: discountAuthTable.rows[0]?.exists
        ? "Tabela discount_authorization disponivel."
        : "Tabela discount_authorization ausente.",
    },
    {
      key: "pending_table",
      ok: Boolean(pendingTable.rows[0]?.exists),
      details: pendingTable.rows[0]?.exists
        ? "Tabela datafrota_desconto_pendente disponivel."
        : "Tabela datafrota_desconto_pendente ausente.",
    },
    {
      key: "lancto_caixa_table",
      ok: Boolean(triggerTargetTable.rows[0]?.exists),
      details: triggerTargetTable.rows[0]?.exists
        ? "Tabela lancto_caixa disponivel para a trigger."
        : "Tabela lancto_caixa ausente no banco do terceiro.",
    },
    {
      key: "cashier_function",
      ok: Boolean(functionExists.rows[0]?.exists),
      details: functionExists.rows[0]?.exists
        ? "Function datafrota_aplicar_desconto_f ativa."
        : "Function datafrota_aplicar_desconto_f ausente.",
    },
    {
      key: "cashier_trigger",
      ok: Boolean(triggerState.rows[0]?.exists) && Boolean(triggerState.rows[0]?.enabled),
      details: !triggerState.rows[0]?.exists
        ? "Trigger trg_datafrota_aplicar_desconto ausente."
        : triggerState.rows[0]?.enabled
          ? "Trigger trg_datafrota_aplicar_desconto ativa."
          : "Trigger trg_datafrota_aplicar_desconto existe, mas esta desabilitada.",
    },
    {
      key: "pending_columns",
      ok: missingColumns.rows.length === 0,
      details:
        missingColumns.rows.length === 0
          ? "Colunas obrigatorias da integracao conferidas."
          : `Colunas ausentes: ${missingColumns.rows.map((item) => item.column_name).join(", ")}`,
    },
  ];

  return {
    ok: checks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

export async function bootstrapCashierIntegration(): Promise<CashierIntegrationBootstrapStatus> {
  await ensureCashierSchema(true);
  return getCashierIntegrationBootstrapStatus();
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
