CREATE TABLE IF NOT EXISTS mobile_customer_account (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES saas_company (id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('cpf', 'cnpj')),
  document_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES saas_company (id) ON DELETE CASCADE;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS document_type TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS document_number TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS full_name TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;

UPDATE mobile_customer_account
   SET status = COALESCE(NULLIF(status, ''), 'active'),
       updated_at = COALESCE(updated_at, NOW()),
       created_at = COALESCE(created_at, NOW());

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_customer_company_email
  ON mobile_customer_account (company_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_customer_company_document
  ON mobile_customer_account (company_id, document_type, document_number);

CREATE INDEX IF NOT EXISTS idx_mobile_customer_company_status
  ON mobile_customer_account (company_id, status);

CREATE INDEX IF NOT EXISTS idx_mobile_customer_last_login
  ON mobile_customer_account (last_login_at DESC NULLS LAST);
