import {
  buildDiscountScope,
  createShortCode,
  getEffectiveStatus,
  normalizeCreateDiscountInput,
  type CreateDiscountCodeInput,
  type DiscountAuthorization,
  type ResolveDiscountCodeResponse,
  validateCreateDiscountInput,
} from "../../shared/discount.js";
import { ensureDiscountSchema, query } from "../db.js";

function createAuthorizationId(): string {
  return `dau_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class DiscountValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "Erro de validacao");
    this.name = "DiscountValidationError";
  }
}

async function generateUniqueShortCode(existingCodes: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = createShortCode(8);
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  return createShortCode(10);
}

function withEffectiveStatus(item: DiscountAuthorization): DiscountAuthorization {
  return {
    ...item,
    status: getEffectiveStatus(item),
  };
}

type ActiveCountRow = {
  total: string | number;
};

async function validateActiveReferences(input: CreateDiscountCodeInput): Promise<string[]> {
  const issues: string[] = [];

  if (input.productCodes && input.productCodes.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(DISTINCT CAST(grid AS TEXT)) AS total
        FROM produto
        WHERE (codigo = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
          AND flag = 'A'
      `,
      [input.productCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.productCodes.length) {
      issues.push("Um ou mais produtos informados nao existem ou nao estao ativos.");
    }
  }

  if (input.productGroupCodes && input.productGroupCodes.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(DISTINCT CAST(gp.codigo AS TEXT)) AS total
        FROM grupo_produto gp
        INNER JOIN produto p
          ON CAST(p.grupo AS TEXT) = CAST(gp.grid AS TEXT)
        WHERE CAST(gp.codigo AS TEXT) = ANY($1::text[])
          AND p.flag = 'A'
      `,
      [input.productGroupCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.productGroupCodes.length) {
      issues.push("Um ou mais grupos de produto informados nao existem ou nao estao ativos.");
    }
  }

  if (input.customerCodes && input.customerCodes.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(DISTINCT CAST(grid AS TEXT)) AS total
        FROM pessoa
        WHERE (CAST(codigo AS TEXT) = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
          AND flag = 'A'
      `,
      [input.customerCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.customerCodes.length) {
      issues.push("Um ou mais clientes informados nao existem ou nao estao ativos.");
    }
  }

  if (input.customerGroupCodes && input.customerGroupCodes.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(DISTINCT CAST(codigo AS TEXT)) AS total
        FROM grupo_pessoa
        WHERE CAST(codigo AS TEXT) = ANY($1::text[])
          AND flag = 'A'
      `,
      [input.customerGroupCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.customerGroupCodes.length) {
      issues.push("Um ou mais grupos de cliente informados nao existem ou nao estao ativos.");
    }
  }

  if (input.paymentFormCodes && input.paymentFormCodes.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(DISTINCT CAST(grid AS TEXT)) AS total
        FROM forma_pgto
        WHERE (CAST(codigo AS TEXT) = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
          AND flag = 'A'
      `,
      [input.paymentFormCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.paymentFormCodes.length) {
      issues.push("Uma ou mais formas de pagamento informadas nao existem ou nao estao ativas.");
    }
  }

  return issues;
}

type DiscountAuthorizationRow = {
  id: string;
  short_code: string;
  scope: DiscountAuthorization["scope"];
  product_codes: string[] | null;
  product_group_codes: string[] | null;
  customer_codes: string[] | null;
  customer_group_codes: string[] | null;
  payment_form_codes: string[] | null;
  discount_percent: string | number;
  valid_from: string | null;
  valid_until: string | null;
  status: DiscountAuthorization["status"];
  created_at: string | Date;
  cancelled_at: string | Date | null;
};

function mapRow(row: DiscountAuthorizationRow): DiscountAuthorization {
  return {
    id: row.id,
    shortCode: row.short_code,
    scope: row.scope,
    productCodes: row.product_codes ?? [],
    productGroupCodes: row.product_group_codes ?? [],
    customerCodes: row.customer_codes ?? [],
    customerGroupCodes: row.customer_group_codes ?? [],
    paymentFormCodes: row.payment_form_codes ?? [],
    discountPercent: Number(row.discount_percent),
    validFrom: row.valid_from ? new Date(row.valid_from).toISOString() : null,
    validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
  };
}

function buildLegacyCompatibleArraySql(alias: string, arrayColumn: string, legacyColumn: string): string {
  return `
    COALESCE(
      ${alias}.${arrayColumn},
      CASE
        WHEN ${alias}.${legacyColumn} IS NULL THEN ARRAY[]::text[]
        ELSE ARRAY[${alias}.${legacyColumn}]
      END
    )
  `;
}

function buildProductCodesSql(alias: string): string {
  return `
    COALESCE((
      SELECT array_agg(COALESCE(prod.codigo, selected.code) ORDER BY selected.ord)
      FROM unnest(${buildLegacyCompatibleArraySql(alias, "product_codes", "product_code")}) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN produto prod
        ON CAST(prod.grid AS TEXT) = selected.code
        OR prod.codigo = selected.code
    ), ARRAY[]::text[])
  `;
}

function buildCustomerCodesSql(alias: string): string {
  return `
    COALESCE((
      SELECT array_agg(COALESCE(CAST(pe.codigo AS text), selected.code) ORDER BY selected.ord)
      FROM unnest(${buildLegacyCompatibleArraySql(alias, "customer_codes", "customer_code")}) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN pessoa pe
        ON CAST(pe.grid AS TEXT) = selected.code
        OR CAST(pe.codigo AS TEXT) = selected.code
    ), ARRAY[]::text[])
  `;
}

function buildPaymentFormCodesSql(alias: string): string {
  return `
    COALESCE((
      SELECT array_agg(COALESCE(fp.codigo::text, selected.code) ORDER BY selected.ord)
      FROM unnest(
        ${buildLegacyCompatibleArraySql(alias, "payment_form_codes", "payment_form_code")}
      ) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN forma_pgto fp
        ON CAST(fp.grid AS TEXT) = selected.code
        OR CAST(fp.codigo AS TEXT) = selected.code
    ), ARRAY[]::text[])
  `;
}

async function resolveProductCodes(
  productCodes: string[],
): Promise<{ displayCodes: string[]; internalCodes: string[] }> {
  if (productCodes.length === 0) {
    return { displayCodes: [], internalCodes: [] };
  }

  const result = await query<{ display_code: string; internal_code: string }>(
    `
      SELECT DISTINCT ON (CAST(grid AS TEXT))
        codigo AS display_code,
        CAST(grid AS TEXT) AS internal_code
      FROM produto
      WHERE (codigo = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
        AND flag = 'A'
      ORDER BY CAST(grid AS TEXT), CASE WHEN codigo = ANY($1::text[]) THEN 0 ELSE 1 END, grid DESC
    `,
    [productCodes],
  );

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const row of result.rows) {
    resolvedByCode.set(row.display_code, row);
    resolvedByCode.set(row.internal_code, row);
  }

  const resolved = productCodes
    .map((code) => resolvedByCode.get(code))
    .filter((row): row is { display_code: string; internal_code: string } => Boolean(row));

  return {
    displayCodes: resolved.map((row) => row.display_code),
    internalCodes: resolved.map((row) => row.internal_code),
  };
}

async function resolveCustomerCodes(
  customerCodes: string[],
): Promise<{ displayCodes: string[]; internalCodes: string[] }> {
  if (customerCodes.length === 0) {
    return { displayCodes: [], internalCodes: [] };
  }

  const result = await query<{ display_code: string; internal_code: string }>(
    `
      SELECT DISTINCT ON (CAST(grid AS TEXT))
        CAST(codigo AS TEXT) AS display_code,
        CAST(grid AS TEXT) AS internal_code
      FROM pessoa
      WHERE (CAST(codigo AS TEXT) = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
        AND flag = 'A'
      ORDER BY CAST(grid AS TEXT), CASE WHEN CAST(codigo AS TEXT) = ANY($1::text[]) THEN 0 ELSE 1 END, grid DESC
    `,
    [customerCodes],
  );

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const row of result.rows) {
    resolvedByCode.set(row.display_code, row);
    resolvedByCode.set(row.internal_code, row);
  }

  const resolved = customerCodes
    .map((code) => resolvedByCode.get(code))
    .filter((row): row is { display_code: string; internal_code: string } => Boolean(row));

  return {
    displayCodes: resolved.map((row) => row.display_code),
    internalCodes: resolved.map((row) => row.internal_code),
  };
}

async function resolvePaymentFormCodes(
  paymentFormCodes: string[],
): Promise<{ displayCodes: string[]; internalCodes: string[] }> {
  if (paymentFormCodes.length === 0) {
    return { displayCodes: [], internalCodes: [] };
  }

  const result = await query<{ display_code: string; internal_code: string }>(
    `
      SELECT DISTINCT ON (CAST(grid AS TEXT))
        CAST(codigo AS TEXT) AS display_code,
        CAST(grid AS TEXT) AS internal_code
      FROM forma_pgto
      WHERE (CAST(codigo AS TEXT) = ANY($1::text[]) OR CAST(grid AS TEXT) = ANY($1::text[]))
        AND flag = 'A'
      ORDER BY CAST(grid AS TEXT), CASE WHEN CAST(codigo AS TEXT) = ANY($1::text[]) THEN 0 ELSE 1 END, grid DESC
    `,
    [paymentFormCodes],
  );

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const row of result.rows) {
    resolvedByCode.set(row.display_code, row);
    resolvedByCode.set(row.internal_code, row);
  }

  const resolved = paymentFormCodes
    .map((code) => resolvedByCode.get(code))
    .filter((row): row is { display_code: string; internal_code: string } => Boolean(row));

  return {
    displayCodes: resolved.map((row) => row.display_code),
    internalCodes: resolved.map((row) => row.internal_code),
  };
}

async function getExistingCodes(): Promise<Set<string>> {
  await ensureDiscountSchema();
  const result = await query<{ short_code: string }>("SELECT short_code FROM discount_authorization");
  return new Set(result.rows.map((row) => row.short_code));
}

export async function listDiscountCodes(): Promise<DiscountAuthorization[]> {
  await ensureDiscountSchema();
  const result = await query<DiscountAuthorizationRow>(`
    SELECT
      da.id,
      da.short_code,
      da.scope,
      ${buildProductCodesSql("da")} AS product_codes,
      ${buildLegacyCompatibleArraySql("da", "product_group_codes", "product_group_code")} AS product_group_codes,
      ${buildCustomerCodesSql("da")} AS customer_codes,
      ${buildLegacyCompatibleArraySql("da", "customer_group_codes", "customer_group_code")} AS customer_group_codes,
      ${buildPaymentFormCodesSql("da")} AS payment_form_codes,
      da.discount_percent,
      da.valid_from,
      da.valid_until,
      da.status,
      da.created_at,
      da.cancelled_at
    FROM discount_authorization da
    ORDER BY da.created_at DESC
  `);

  return result.rows
    .map(mapRow)
    .map(withEffectiveStatus)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export async function createDiscountCode(
  input: CreateDiscountCodeInput,
): Promise<DiscountAuthorization> {
  const issues = validateCreateDiscountInput(input);
  if (issues.length > 0) {
    throw new DiscountValidationError(issues);
  }

  const normalized = normalizeCreateDiscountInput(input);
  await ensureDiscountSchema();
  const referenceIssues = await validateActiveReferences(normalized);
  if (referenceIssues.length > 0) {
    throw new DiscountValidationError(referenceIssues);
  }

  const resolvedProducts = await resolveProductCodes(normalized.productCodes ?? []);
  normalized.productCodes = resolvedProducts.internalCodes;
  const resolvedCustomers = await resolveCustomerCodes(normalized.customerCodes ?? []);
  normalized.customerCodes = resolvedCustomers.internalCodes;
  const resolvedPaymentForms = await resolvePaymentFormCodes(normalized.paymentFormCodes ?? []);
  normalized.paymentFormCodes = resolvedPaymentForms.internalCodes;

  const shortCode = await generateUniqueShortCode(await getExistingCodes());

  const created: DiscountAuthorization = {
    id: createAuthorizationId(),
    shortCode,
    scope: buildDiscountScope(normalized),
    productCodes: resolvedProducts.displayCodes,
    productGroupCodes: normalized.productGroupCodes ?? [],
    customerCodes: resolvedCustomers.displayCodes,
    customerGroupCodes: normalized.customerGroupCodes ?? [],
    paymentFormCodes: resolvedPaymentForms.displayCodes,
    discountPercent: normalized.discountPercent,
    validFrom: normalized.validFrom ?? null,
    validUntil: normalized.validUntil ?? null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    cancelledAt: null,
  };

  await query(
    `
      INSERT INTO discount_authorization (
        id,
        short_code,
        scope,
        product_codes,
        product_code,
        product_group_codes,
        product_group_code,
        customer_codes,
        customer_code,
        customer_group_codes,
        customer_group_code,
        payment_form_codes,
        payment_form_code,
        discount_percent,
        valid_from,
        valid_until,
        status,
        created_at,
        cancelled_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `,
    [
      created.id,
      created.shortCode,
      created.scope,
      normalized.productCodes,
      normalized.productCodes[0] ?? null,
      created.productGroupCodes,
      created.productGroupCodes[0] ?? null,
      normalized.customerCodes,
      normalized.customerCodes[0] ?? null,
      created.customerGroupCodes,
      created.customerGroupCodes[0] ?? null,
      normalized.paymentFormCodes,
      normalized.paymentFormCodes[0] ?? null,
      created.discountPercent,
      created.validFrom,
      created.validUntil,
      created.status,
      created.createdAt,
      created.cancelledAt,
    ],
  );

  return withEffectiveStatus(created);
}

export async function resolveDiscountCode(shortCode: string): Promise<ResolveDiscountCodeResponse> {
  const code = shortCode.trim().toUpperCase();
  if (!code) {
    return { found: false, reason: "NOT_FOUND" };
  }

  await ensureDiscountSchema();
  const result = await query<DiscountAuthorizationRow>(
    `
      SELECT
        da.id,
        da.short_code,
        da.scope,
        ${buildProductCodesSql("da")} AS product_codes,
        ${buildLegacyCompatibleArraySql("da", "product_group_codes", "product_group_code")} AS product_group_codes,
        ${buildCustomerCodesSql("da")} AS customer_codes,
        ${buildLegacyCompatibleArraySql("da", "customer_group_codes", "customer_group_code")} AS customer_group_codes,
        ${buildPaymentFormCodesSql("da")} AS payment_form_codes,
        da.discount_percent,
        da.valid_from,
        da.valid_until,
        da.status,
        da.created_at,
        da.cancelled_at
      FROM discount_authorization da
      WHERE da.short_code = $1
      LIMIT 1
    `,
    [code],
  );

  if (result.rows.length === 0) {
    return { found: false, reason: "NOT_FOUND" };
  }

  const authorization = withEffectiveStatus(mapRow(result.rows[0]));

  if (authorization.status === "CANCELLED") {
    return { found: false, reason: "CANCELLED", authorization };
  }

  if (authorization.status === "EXPIRED") {
    return { found: false, reason: "EXPIRED", authorization };
  }

  return { found: true, authorization };
}

export async function cancelDiscountCode(shortCode: string): Promise<DiscountAuthorization | null> {
  const code = shortCode.trim().toUpperCase();
  await ensureDiscountSchema();
  const result = await query<DiscountAuthorizationRow>(
    `
      UPDATE discount_authorization
      SET status = 'CANCELLED', cancelled_at = NOW()
      WHERE short_code = $1
      RETURNING
        id,
        short_code,
        scope,
        product_codes,
        product_code,
        product_group_codes,
        product_group_code,
        customer_codes,
        customer_code,
        customer_group_codes,
        customer_group_code,
        payment_form_codes,
        discount_percent,
        valid_from,
        valid_until,
        status,
        created_at,
        cancelled_at
    `,
    [code],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return withEffectiveStatus(mapRow(result.rows[0]));
}
