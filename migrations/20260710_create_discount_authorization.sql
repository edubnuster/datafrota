CREATE TABLE IF NOT EXISTS discount_authorization (
    id TEXT PRIMARY KEY,
    short_code TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('ALL_PRODUCTS', 'PRODUCT', 'PRODUCT_GROUP')),
    product_code TEXT NULL,
    product_group_code TEXT NULL,
    customer_code TEXT NULL,
    customer_group_code TEXT NULL,
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
