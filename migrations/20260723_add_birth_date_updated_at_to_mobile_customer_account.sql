ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS birth_date_updated_at TIMESTAMPTZ NULL;
