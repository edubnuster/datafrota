ALTER TABLE mobile_customer_account
  ADD COLUMN IF NOT EXISTS birth_date DATE NULL;
