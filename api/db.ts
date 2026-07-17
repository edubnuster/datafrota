import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

function createPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}) {
  return new Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 3000,
    connectionTimeoutMillis: 2000,
    allowExitOnIdle: true,
    options: "-c client_encoding=LATIN1",
  });
}

const clientPool = createPool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "frota",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

const saasPool = createPool({
  host: process.env.SAAS_PGHOST || process.env.PGHOST || "localhost",
  port: Number(process.env.SAAS_PGPORT || process.env.PGPORT || 5432),
  database: process.env.SAAS_PGDATABASE || "datafrota",
  user: process.env.SAAS_PGUSER || process.env.PGUSER || "postgres",
  password: process.env.SAAS_PGPASSWORD || process.env.PGPASSWORD || "postgres",
});

let schemaReadyPromise: Promise<void> | null = null;
let cashierSchemaReadyPromise: Promise<void> | null = null;
let companiesSchemaReadyPromise: Promise<void> | null = null;
let promotionsSchemaReadyPromise: Promise<void> | null = null;
let saasAdminSchemaReadyPromise: Promise<void> | null = null;
let pdvAgentSchemaReadyPromise: Promise<void> | null = null;

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
  const result = await clientPool.query<T>(text, values);
  return { rows: result.rows };
}

export async function querySaas<T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
  const result = await saasPool.query<T>(text, values);
  return { rows: result.rows };
}

export async function withTransaction<T>(
  callback: (queryFn: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>) => Promise<T>,
): Promise<T> {
  const client = await clientPool.connect();

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

export async function ensureCompaniesSchema(force = false): Promise<void> {
  if (force) {
    companiesSchemaReadyPromise = null;
  }

  if (!companiesSchemaReadyPromise) {
    companiesSchemaReadyPromise = saasPool
      .query(`
        CREATE TABLE IF NOT EXISTS saas_company (
          id TEXT PRIMARY KEY,
          trade_name TEXT NOT NULL,
          cnpj TEXT NOT NULL UNIQUE,
          phone TEXT NOT NULL,
          zip_code TEXT NOT NULL,
          street TEXT NOT NULL,
          district TEXT NOT NULL,
          city TEXT NOT NULL,
          state TEXT NOT NULL,
          address_number TEXT NOT NULL,
          address_complement TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL,
          admin_name TEXT NOT NULL,
          admin_email TEXT NOT NULL UNIQUE,
          temporary_password TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ativa', 'trial', 'suspensa', 'vencida')),
          plan TEXT NOT NULL CHECK (plan IN ('starter', 'professional', 'enterprise')),
          activated_at DATE NOT NULL,
          expires_at DATE NOT NULL,
          created_at DATE NOT NULL DEFAULT CURRENT_DATE,
          domain TEXT NOT NULL UNIQUE,
          monthly_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
          branch_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[]
        );

        CREATE INDEX IF NOT EXISTS idx_saas_company_trade_name
          ON saas_company (trade_name);

        CREATE INDEX IF NOT EXISTS idx_saas_company_status
          ON saas_company (status);

        CREATE TABLE IF NOT EXISTS saas_company_branch (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES saas_company (id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL,
          branch_code TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_local_branch BOOLEAN NOT NULL DEFAULT FALSE,
          first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deactivated_at TIMESTAMPTZ NULL,
          source_agent_id TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (company_id, branch_id)
        );

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS zip_code TEXT;

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS street TEXT;

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS district TEXT;

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS city TEXT;

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS state TEXT;

        ALTER TABLE saas_company_branch
          ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES saas_company (id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_saas_company_branch_company_id
          ON saas_company_branch (company_id);

        CREATE INDEX IF NOT EXISTS idx_saas_company_branch_active
          ON saas_company_branch (company_id, is_active);

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS address_number TEXT;

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS address_complement TEXT NOT NULL DEFAULT '';

        ALTER TABLE saas_company
          ADD COLUMN IF NOT EXISTS branch_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

        UPDATE saas_company
           SET zip_code = COALESCE(zip_code, ''),
               street = COALESCE(street, ''),
               district = COALESCE(district, ''),
               city = COALESCE(city, ''),
               state = COALESCE(state, ''),
               address_number = COALESCE(address_number, ''),
               address_complement = COALESCE(address_complement, ''),
               branch_ids = COALESCE(branch_ids, ARRAY[]::text[]);

        UPDATE saas_company
           SET zip_code = COALESCE(NULLIF(zip_code, ''), '89010-000'),
               street = COALESCE(NULLIF(street, ''), 'Rua das Flores'),
               district = COALESCE(NULLIF(district, ''), 'Centro'),
               city = COALESCE(NULLIF(city, ''), 'Blumenau'),
               state = COALESCE(NULLIF(state, ''), 'SC'),
               address_number = COALESCE(NULLIF(address_number, ''), '1080'),
               address_complement = COALESCE(address_complement, ''),
               address = COALESCE(NULLIF(address, ''), 'Rua das Flores, 1080 - Centro - Blumenau - SC')
         WHERE id = 'company-1';

        INSERT INTO saas_company (
          id,
          trade_name,
          cnpj,
          phone,
          zip_code,
          street,
          district,
          city,
          state,
          address_number,
          address_complement,
          address,
          admin_name,
          admin_email,
          temporary_password,
          status,
          plan,
          activated_at,
          expires_at,
          created_at,
          domain,
          monthly_revenue
        )
        SELECT
          'company-1',
          'Databrev',
          '42.971.554/0001-27',
          '(47) 99154-8827',
          '89010-000',
          'Rua das Flores',
          'Centro',
          'Blumenau',
          'SC',
          '1080',
          '',
          'Rua das Flores, 1080 - Centro, Blumenau - SC',
          'Volnei Girardi',
          'volnei@databrev.com.br',
          'Admin@123',
          'ativa',
          'enterprise',
          DATE '2026-07-11',
          DATE '2026-08-11',
          DATE '2026-07-11',
          'tenant.databrev.com.br',
          599.90
        WHERE NOT EXISTS (
          SELECT 1
          FROM saas_company
        );
      `)
      .then(() => undefined)
      .catch((error) => {
        companiesSchemaReadyPromise = null;
        throw error;
      });
  }

  await companiesSchemaReadyPromise;
}

export async function ensurePromotionsSchema(force = false): Promise<void> {
  if (force) {
    promotionsSchemaReadyPromise = null;
  }

  if (!promotionsSchemaReadyPromise) {
    promotionsSchemaReadyPromise = saasPool
      .query(`
        CREATE TABLE IF NOT EXISTS saas_promotion (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES saas_company (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          voucher_code TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('ativa', 'agendada', 'pausada', 'encerrada')),
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_saas_promotion_status
          ON saas_promotion (status);

        ALTER TABLE saas_promotion
          ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES saas_company (id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_saas_promotion_company_id
          ON saas_promotion (company_id);

        CREATE INDEX IF NOT EXISTS idx_saas_promotion_updated_at
          ON saas_promotion (updated_at DESC);

        CREATE TABLE IF NOT EXISTS saas_promotion_pdv_sync (
          promotion_id TEXT PRIMARY KEY REFERENCES saas_promotion (id) ON DELETE CASCADE,
          authorization_id TEXT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'published', 'cancelled', 'error')),
          error TEXT NULL,
          synced_at TIMESTAMPTZ NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)
      .then(() => undefined)
      .catch((error) => {
        promotionsSchemaReadyPromise = null;
        throw error;
      });
  }

  await promotionsSchemaReadyPromise;
}

export async function ensurePdvAgentSchema(force = false): Promise<void> {
  await ensureCompaniesSchema(force);
  await ensurePromotionsSchema(force);

  if (force) {
    pdvAgentSchemaReadyPromise = null;
  }

  if (!pdvAgentSchemaReadyPromise) {
    pdvAgentSchemaReadyPromise = saasPool
      .query(`
        CREATE TABLE IF NOT EXISTS pdv_agent (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES saas_company (id) ON DELETE CASCADE,
          branch_id TEXT NULL,
          station_code TEXT NULL,
          device_name TEXT NULL,
          device_fingerprint TEXT NULL,
          installed_version TEXT NULL,
          auth_token_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
          paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NULL,
          last_seen_ip TEXT NULL,
          last_seen_user_agent TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pdv_agent_branch_id
          ON pdv_agent (branch_id);

        CREATE INDEX IF NOT EXISTS idx_pdv_agent_status
          ON pdv_agent (status);

        CREATE TABLE IF NOT EXISTS pdv_pairing_token (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES saas_company (id) ON DELETE CASCADE,
          branch_id TEXT NULL,
          station_code TEXT NULL,
          description TEXT NULL,
          token_code TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'cancelled')),
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ NULL,
          used_by_agent_id TEXT NULL REFERENCES pdv_agent (id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_pdv_pairing_branch_id
          ON pdv_pairing_token (branch_id);

        CREATE INDEX IF NOT EXISTS idx_pdv_pairing_status
          ON pdv_pairing_token (status);

        ALTER TABLE pdv_agent
          ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES saas_company (id) ON DELETE CASCADE;

        ALTER TABLE pdv_agent
          ALTER COLUMN branch_id DROP NOT NULL;

        ALTER TABLE pdv_pairing_token
          ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES saas_company (id) ON DELETE CASCADE;

        ALTER TABLE pdv_pairing_token
          ALTER COLUMN branch_id DROP NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_pdv_agent_company_id
          ON pdv_agent (company_id);

        CREATE INDEX IF NOT EXISTS idx_pdv_pairing_company_id
          ON pdv_pairing_token (company_id);
      `)
      .then(() => undefined)
      .catch((error) => {
        pdvAgentSchemaReadyPromise = null;
        throw error;
      });
  }

  await pdvAgentSchemaReadyPromise;
}

export async function ensureSaasAdminSchema(force = false): Promise<void> {
  if (force) {
    saasAdminSchemaReadyPromise = null;
  }

  if (!saasAdminSchemaReadyPromise) {
    saasAdminSchemaReadyPromise = saasPool
      .query(`
        CREATE TABLE IF NOT EXISTS saas_admin_account (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        INSERT INTO saas_admin_account (id, name, email, password, updated_at)
        SELECT
          'saas-admin-1',
          'Volnei Girardi',
          'adm@databrev.com.br',
          'adm@databrev.com.br',
          NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM saas_admin_account
        );
      `)
      .then(() => undefined)
      .catch((error) => {
        saasAdminSchemaReadyPromise = null;
        throw error;
      });
  }

  await saasAdminSchemaReadyPromise;
}

export async function ensureDiscountSchema(force = false): Promise<void> {
  if (force) {
    schemaReadyPromise = null;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = clientPool
      .query(`
        CREATE TABLE IF NOT EXISTS discount_authorization (
          id TEXT PRIMARY KEY,
          company_id TEXT NULL,
          source_branch_id TEXT NULL,
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
          first_purchase_only BOOLEAN NOT NULL DEFAULT FALSE,
          new_customer_days INTEGER NULL,
          branch_ids TEXT[] NULL,
          payment_form_codes TEXT[] NULL,
          payment_form_code TEXT NULL,
          active_weekdays TEXT[] NULL,
          start_time TEXT NULL,
          end_time TEXT NULL,
          birthday_only BOOLEAN NOT NULL DEFAULT FALSE,
          max_discount_per_day NUMERIC(15,2) NULL,
          max_volume_per_day NUMERIC(15,3) NULL,
          max_quantity_per_item NUMERIC(15,3) NULL,
          redemptions_per_customer INTEGER NULL,
          max_purchases_per_week INTEGER NULL,
          max_purchases_per_month INTEGER NULL,
          reusable BOOLEAN NOT NULL DEFAULT FALSE,
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
          ADD COLUMN IF NOT EXISTS company_id TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS source_branch_id TEXT NULL;

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
          ADD COLUMN IF NOT EXISTS first_purchase_only BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS new_customer_days INTEGER NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS branch_ids TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS payment_form_code TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS payment_form_codes TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS active_weekdays TEXT[] NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS start_time TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS end_time TEXT NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS birthday_only BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS max_discount_per_day NUMERIC(15,2) NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS max_volume_per_day NUMERIC(15,3) NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS max_quantity_per_item NUMERIC(15,3) NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS redemptions_per_customer INTEGER NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS max_purchases_per_week INTEGER NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS max_purchases_per_month INTEGER NULL;

        ALTER TABLE discount_authorization
          ADD COLUMN IF NOT EXISTS reusable BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE INDEX IF NOT EXISTS idx_discount_authorization_company_id
          ON discount_authorization (company_id);

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
           SET first_purchase_only = FALSE
         WHERE first_purchase_only IS NULL;

        UPDATE discount_authorization
           SET new_customer_days = NULL
         WHERE new_customer_days IS NOT NULL
           AND new_customer_days <= 0;

        UPDATE discount_authorization
           SET payment_form_codes = ARRAY[payment_form_code]
         WHERE payment_form_code IS NOT NULL
           AND (payment_form_codes IS NULL OR cardinality(payment_form_codes) = 0);

        UPDATE discount_authorization
           SET reusable = FALSE
         WHERE reusable IS NULL;

        UPDATE discount_authorization
           SET birthday_only = FALSE
         WHERE birthday_only IS NULL;
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
    cashierSchemaReadyPromise = clientPool
      .query(`
        CREATE TABLE IF NOT EXISTS datafrota_desconto_pendente (
          grid BIGSERIAL PRIMARY KEY,
          discount_authorization_id TEXT NULL REFERENCES discount_authorization (id),
          company_id TEXT NULL,
          source_branch_id TEXT NULL,
          pdv_agent_id TEXT NULL,
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
          first_purchase_only BOOLEAN NOT NULL DEFAULT FALSE,
          new_customer_days INTEGER NULL,
          branch_ids TEXT[] NULL,
          payment_form_codes TEXT[] NULL,
          payment_form_code TEXT NULL,
          active_weekdays TEXT[] NULL,
          start_time TEXT NULL,
          end_time TEXT NULL,
          birthday_only BOOLEAN NOT NULL DEFAULT FALSE,
          max_discount_per_day NUMERIC(15,2) NULL,
          max_volume_per_day NUMERIC(15,3) NULL,
          max_quantity_per_item NUMERIC(15,3) NULL,
          redemptions_per_customer INTEGER NULL,
          max_purchases_per_week INTEGER NULL,
          max_purchases_per_month INTEGER NULL,
          reusable BOOLEAN NOT NULL DEFAULT FALSE,
          resolved_branch_id TEXT NULL,
          resolved_customer_code TEXT NULL,
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
          ADD COLUMN IF NOT EXISTS company_id TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS source_branch_id TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS pdv_agent_id TEXT NULL;

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
          ADD COLUMN IF NOT EXISTS first_purchase_only BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS new_customer_days INTEGER NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS branch_ids TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS payment_form_code TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS payment_form_codes TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS active_weekdays TEXT[] NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS start_time TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS end_time TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS birthday_only BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS max_discount_per_day NUMERIC(15,2) NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS max_volume_per_day NUMERIC(15,3) NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS max_quantity_per_item NUMERIC(15,3) NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS redemptions_per_customer INTEGER NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS max_purchases_per_week INTEGER NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS max_purchases_per_month INTEGER NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS reusable BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS resolved_branch_id TEXT NULL;

        ALTER TABLE datafrota_desconto_pendente
          ADD COLUMN IF NOT EXISTS resolved_customer_code TEXT NULL;

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
           SET first_purchase_only = FALSE
         WHERE first_purchase_only IS NULL;

        UPDATE datafrota_desconto_pendente
           SET new_customer_days = NULL
         WHERE new_customer_days IS NOT NULL
           AND new_customer_days <= 0;

        UPDATE datafrota_desconto_pendente
           SET payment_form_codes = ARRAY[payment_form_code]
         WHERE payment_form_code IS NOT NULL
           AND (payment_form_codes IS NULL OR cardinality(payment_form_codes) = 0);

        UPDATE datafrota_desconto_pendente
           SET reusable = FALSE
         WHERE reusable IS NULL;

        UPDATE datafrota_desconto_pendente
           SET birthday_only = FALSE
         WHERE birthday_only IS NULL;

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

        ALTER TABLE datafrota_desconto_pendente
          DROP CONSTRAINT IF EXISTS datafrota_desc_codigo_uk;

        DROP INDEX IF EXISTS public.datafrota_desc_codigo_ativo_uk;

        CREATE UNIQUE INDEX datafrota_desc_codigo_ativo_uk
          ON datafrota_desconto_pendente (codigo_desconto)
          WHERE status IN ('P', 'R');

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

        CREATE INDEX IF NOT EXISTS datafrota_desc_company_idx
          ON datafrota_desconto_pendente (company_id);

        CREATE OR REPLACE FUNCTION public.datafrota_resolver_cliente_venda_f(
            p_mlid bigint,
            OUT customer_code text,
            OUT customer_group_code text
        )
        RETURNS record
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_pessoa bigint;
        BEGIN
            customer_code := NULL;
            customer_group_code := NULL;

            IF p_mlid IS NULL THEN
                RETURN;
            END IF;

            SELECT l.pessoa
              INTO v_pessoa
              FROM public.lancto l
             WHERE l.mlid = p_mlid
               AND l.pessoa IS NOT NULL
             LIMIT 1;

            IF v_pessoa IS NULL THEN
                SELECT cv.pessoa
                  INTO v_pessoa
                  FROM public.caixa_venda cv
                 WHERE cv.mlid = p_mlid
                   AND cv.pessoa IS NOT NULL
                 ORDER BY cv.ts DESC NULLS LAST
                 LIMIT 1;
            END IF;

            IF v_pessoa IS NULL THEN
                RETURN;
            END IF;

            customer_code := CAST(v_pessoa AS text);

            SELECT COALESCE(CAST(gp.codigo AS text), CAST(pe.grupo AS text))
              INTO customer_group_code
              FROM public.pessoa pe
              LEFT JOIN public.grupo_pessoa gp
                ON CAST(gp.grid AS text) = CAST(pe.grupo AS text)
                OR CAST(gp.codigo AS text) = CAST(pe.grupo AS text)
             WHERE CAST(pe.grid AS text) = customer_code
             LIMIT 1;
        END;
        $$;

        CREATE OR REPLACE FUNCTION public.datafrota_validar_limites_cliente_f(
            p_desc public.datafrota_desconto_pendente,
            p_customer_code text,
            p_sale_date date
        )
        RETURNS text
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_lancto_date_column text;
            v_first_purchase_at timestamp without time zone;
            v_customer_redemptions integer;
            v_customer_week_purchases integer;
            v_customer_month_purchases integer;
            v_week_start date;
            v_week_end date;
            v_month_start date;
            v_month_end date;
            v_effective_sale_date date;
        BEGIN
            v_effective_sale_date := COALESCE(p_sale_date, p_desc.caixa_data, CURRENT_DATE);

            IF COALESCE(p_desc.first_purchase_only, false)
               OR p_desc.new_customer_days IS NOT NULL
               OR p_desc.redemptions_per_customer IS NOT NULL
               OR p_desc.max_purchases_per_week IS NOT NULL
               OR p_desc.max_purchases_per_month IS NOT NULL THEN
                IF p_customer_code IS NULL THEN
                    RETURN 'Nao foi possivel identificar o cliente para validar os limites da promocao';
                END IF;
            END IF;

            IF COALESCE(p_desc.first_purchase_only, false) THEN
                IF EXISTS (
                    SELECT 1
                      FROM public.lancto l
                     WHERE CAST(l.pessoa AS text) = p_customer_code
                       AND (p_desc.mlid IS NULL OR l.mlid IS DISTINCT FROM p_desc.mlid)
                ) THEN
                    RETURN 'Voucher valido apenas para a primeira compra do cliente';
                END IF;
            END IF;

            IF p_desc.new_customer_days IS NOT NULL AND NOT COALESCE(p_desc.first_purchase_only, false) THEN
                SELECT column_name
                  INTO v_lancto_date_column
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'lancto'
                   AND column_name IN ('data', 'dt', 'emissao', 'created_at', 'ts')
                 ORDER BY CASE column_name
                   WHEN 'data' THEN 1
                   WHEN 'dt' THEN 2
                   WHEN 'emissao' THEN 3
                   WHEN 'created_at' THEN 4
                   ELSE 5
                 END
                 LIMIT 1;

                IF v_lancto_date_column IS NULL THEN
                    RETURN 'Nao foi possivel validar a regra de clientes sem movimentacao';
                END IF;

                EXECUTE format(
                  'SELECT MIN(%1$I)::timestamp FROM public.lancto WHERE CAST(pessoa AS text) = $1 AND %1$I IS NOT NULL AND ($2 IS NULL OR mlid IS DISTINCT FROM $2)',
                  v_lancto_date_column
                )
                  INTO v_first_purchase_at
                  USING p_customer_code, p_desc.mlid;

                IF v_first_purchase_at IS NOT NULL
                   AND (v_effective_sale_date - v_first_purchase_at::date) > p_desc.new_customer_days THEN
                    RETURN 'Voucher valido apenas para clientes novos dentro da janela de dias configurada';
                END IF;
            END IF;

            IF p_desc.redemptions_per_customer IS NOT NULL THEN
                SELECT COUNT(*)
                  INTO v_customer_redemptions
                  FROM public.datafrota_desconto_pendente d
                 WHERE d.discount_authorization_id = p_desc.discount_authorization_id
                   AND d.grid <> p_desc.grid
                   AND d.status IN ('R', 'A')
                   AND d.resolved_customer_code = p_customer_code;

                IF COALESCE(v_customer_redemptions, 0) >= p_desc.redemptions_per_customer THEN
                    RETURN 'Limite de resgates por cliente excedido para esta promocao';
                END IF;
            END IF;

            IF p_desc.max_purchases_per_week IS NOT NULL THEN
                v_week_start := date_trunc('week', v_effective_sale_date::timestamp)::date;
                v_week_end := (v_week_start + INTERVAL '6 days')::date;

                SELECT COUNT(*)
                  INTO v_customer_week_purchases
                  FROM public.datafrota_desconto_pendente d
                 WHERE d.discount_authorization_id = p_desc.discount_authorization_id
                   AND d.grid <> p_desc.grid
                   AND d.status IN ('R', 'A')
                   AND d.resolved_customer_code = p_customer_code
                   AND d.caixa_data BETWEEN v_week_start AND v_week_end;

                IF COALESCE(v_customer_week_purchases, 0) >= p_desc.max_purchases_per_week THEN
                    RETURN 'Limite semanal de compras excedido para este cliente';
                END IF;
            END IF;

            IF p_desc.max_purchases_per_month IS NOT NULL THEN
                v_month_start := date_trunc('month', v_effective_sale_date::timestamp)::date;
                v_month_end := (date_trunc('month', v_effective_sale_date::timestamp) + INTERVAL '1 month - 1 day')::date;

                SELECT COUNT(*)
                  INTO v_customer_month_purchases
                  FROM public.datafrota_desconto_pendente d
                 WHERE d.discount_authorization_id = p_desc.discount_authorization_id
                   AND d.grid <> p_desc.grid
                   AND d.status IN ('R', 'A')
                   AND d.resolved_customer_code = p_customer_code
                   AND d.caixa_data BETWEEN v_month_start AND v_month_end;

                IF COALESCE(v_customer_month_purchases, 0) >= p_desc.max_purchases_per_month THEN
                    RETURN 'Limite mensal de compras excedido para este cliente';
                END IF;
            END IF;

            RETURN NULL;
        END;
        $$;

        CREATE OR REPLACE FUNCTION public.datafrota_venda_tem_forma_pagamento_f(
            p_mlid bigint,
            p_payment_codes text[]
        )
        RETURNS boolean
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_tem_forma boolean;
        BEGIN
            IF p_mlid IS NULL OR cardinality(COALESCE(p_payment_codes, ARRAY[]::text[])) = 0 THEN
                RETURN false;
            END IF;

            SELECT COALESCE(
                     BOOL_OR(CAST(vpv.forma_pgto AS text) = ANY(p_payment_codes)),
                     false
                   )
              INTO v_tem_forma
              FROM public.venda_pgto_view vpv
             WHERE vpv.mlid = p_mlid;

            IF COALESCE(v_tem_forma, false) THEN
                RETURN true;
            END IF;

            SELECT EXISTS (
                SELECT 1
                  FROM public.caixa_venda cv
                 WHERE cv.mlid = p_mlid
                   AND CAST(cv.motivo AS text) = ANY(p_payment_codes)
            )
              INTO v_tem_forma;

            IF COALESCE(v_tem_forma, false) THEN
                RETURN true;
            END IF;

            SELECT EXISTS (
                SELECT 1
                  FROM public.movto mv
                 WHERE mv.mlid = p_mlid
                   AND CAST(mv.motivo AS text) = ANY(p_payment_codes)
            )
              INTO v_tem_forma;

            RETURN COALESCE(v_tem_forma, false);
        END;
        $$;

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
            v_valor_desconto numeric(15,2);
            v_product_code text;
            v_product_group_code text;
            v_product_type text;
            v_customer_code text;
            v_customer_group_code text;
            v_lancto_date_column text;
            v_first_purchase_at timestamp without time zone;
            v_customer_birth_date date;
            v_total_discount_day numeric(15,2);
            v_total_volume_day numeric(15,3);
            v_customer_redemptions integer;
            v_customer_week_purchases integer;
            v_customer_month_purchases integer;
            v_week_start date;
            v_week_end date;
            v_month_start date;
            v_month_end date;
            v_customer_validation_error text;
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
             WHERE d.status = 'P'
               AND d.validade >= now()
               AND split_part(UPPER(COALESCE(d.estacao, '')), '.', 1) =
                   split_part(UPPER(COALESCE(NEW.estacao, '')), '.', 1)
               AND (d.abastecimento IS NULL OR d.abastecimento = NEW.abastecimento)
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
             ORDER BY d.criado_em
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

            IF v_desc.max_discount_per_day IS NOT NULL THEN
                SELECT COALESCE(SUM(COALESCE(d.valor_desconto, 0)), 0)
                  INTO v_total_discount_day
                  FROM public.datafrota_desconto_pendente d
                 WHERE d.discount_authorization_id = v_desc.discount_authorization_id
                   AND d.grid <> v_desc.grid
                   AND d.status IN ('R', 'A')
                   AND d.caixa_data = v_sale_date;

                IF (COALESCE(v_total_discount_day, 0) + v_valor_desconto) > v_desc.max_discount_per_day THEN
                    UPDATE public.datafrota_desconto_pendente
                       SET status = 'E',
                           erro = 'Limite de desconto por dia excedido para esta promocao'
                     WHERE grid = v_desc.grid;

                    RETURN NEW;
                END IF;
            END IF;

            IF v_desc.max_volume_per_day IS NOT NULL THEN
                SELECT COALESCE(SUM(COALESCE(d.quantidade, 0)), 0)
                  INTO v_total_volume_day
                  FROM public.datafrota_desconto_pendente d
                 WHERE d.discount_authorization_id = v_desc.discount_authorization_id
                   AND d.grid <> v_desc.grid
                   AND d.status IN ('R', 'A')
                   AND d.caixa_data = v_sale_date;

                IF (COALESCE(v_total_volume_day, 0) + COALESCE(v_desc.quantidade, NEW.quantidade, 0)) > v_desc.max_volume_per_day THEN
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
                   resolved_branch_id = COALESCE(v_desc.resolved_branch_id, CAST(v_caixa_empresa AS text)),
                   resolved_customer_code = COALESCE(v_desc.resolved_customer_code, v_customer_code),
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
                       AND lancto_caixa = v_desc.lancto_caixa
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
                       AND lancto_caixa = v_desc.lancto_caixa
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
                       AND lancto_caixa = v_desc.lancto_caixa
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
                           AND lancto_caixa = v_desc.lancto_caixa
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
              ('company_id'),
              ('source_branch_id'),
              ('pdv_agent_id'),
              ('percentual_desconto'),
              ('product_codes'),
              ('product_group_codes'),
              ('product_group_code'),
              ('customer_codes'),
              ('customer_code'),
              ('customer_group_codes'),
              ('customer_group_code'),
              ('branch_ids'),
              ('payment_form_codes'),
              ('payment_form_code'),
              ('active_weekdays'),
              ('start_time'),
              ('end_time'),
              ('birthday_only'),
              ('max_discount_per_day'),
              ('max_volume_per_day'),
              ('max_quantity_per_item'),
              ('redemptions_per_customer'),
              ('max_purchases_per_week'),
              ('max_purchases_per_month'),
              ('reusable'),
              ('resolved_branch_id'),
              ('resolved_customer_code'),
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
  await Promise.all([clientPool.end(), saasPool.end()]);
}
