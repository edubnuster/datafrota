import {
  buildDiscountScope,
  createShortCode,
  DEFAULT_SHORT_CODE_LENGTH,
  getEffectiveStatus,
  normalizeCreateDiscountInput,
  type CreateDiscountCodeInput,
  type DiscountAuthorization,
  type ResolveDiscountCodeResponse,
  validateCreateDiscountInput,
} from "../../shared/discount.js";
import { ensureDiscountSchema, query } from "../db.js";

export type DiscountCodeTenantScope = {
  companyId: string | null;
  sourceBranchId: string | null;
};

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
    const candidate = createShortCode(DEFAULT_SHORT_CODE_LENGTH);
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  return createShortCode(8);
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
        SELECT COUNT(*) AS total
        FROM unnest($1::text[]) AS selected(code)
        WHERE EXISTS (
          SELECT 1
          FROM produto
          WHERE (codigo = selected.code OR CAST(grid AS TEXT) = selected.code)
            AND flag = 'A'
        )
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
        SELECT COUNT(*) AS total
        FROM unnest($1::text[]) AS selected(code)
        WHERE EXISTS (
          SELECT 1
          FROM pessoa
          WHERE (CAST(codigo AS TEXT) = selected.code OR CAST(grid AS TEXT) = selected.code)
            AND flag = 'A'
        )
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
        SELECT COUNT(*) AS total
        FROM unnest($1::text[]) AS selected(code)
        WHERE EXISTS (
          SELECT 1
          FROM forma_pgto
          WHERE (CAST(codigo AS TEXT) = selected.code OR CAST(grid AS TEXT) = selected.code)
            AND flag = 'A'
        )
      `,
      [input.paymentFormCodes],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.paymentFormCodes.length) {
      issues.push("Uma ou mais formas de pagamento informadas nao existem ou nao estao ativas.");
    }
  }

  if (input.selectedBranchIds && input.selectedBranchIds.length > 0) {
    const result = await query<ActiveCountRow>(
      `
        SELECT COUNT(*) AS total
        FROM unnest($1::text[]) AS selected(code)
        WHERE EXISTS (
          SELECT 1
          FROM empresa
          WHERE (CAST(codigo AS TEXT) = selected.code OR CAST(grid AS TEXT) = selected.code)
            AND flag = 'A'
        )
      `,
      [input.selectedBranchIds],
    );

    if (Number(result.rows[0]?.total ?? 0) !== input.selectedBranchIds.length) {
      issues.push("Uma ou mais filiais informadas nao existem ou nao estao ativas.");
    }
  }

  return issues;
}

type DiscountAuthorizationRow = {
  id: string;
  promotion_id: string | null;
  promotion_name: string | null;
  voucher_origin: DiscountAuthorization["voucherOrigin"] | null;
  issued_to_customer_code: string | null;
  issued_to_customer_group_code: string | null;
  issued_document_type: DiscountAuthorization["issuedDocumentType"] | null;
  issued_document_number: string | null;
  require_customer_document_at_cashier: boolean | null;
  short_code: string;
  scope: DiscountAuthorization["scope"];
  product_codes: string[] | null;
  product_group_codes: string[] | null;
  customer_codes: string[] | null;
  customer_group_codes: string[] | null;
  first_purchase_only: boolean | null;
  new_customer_days: string | number | null;
  branch_ids: string[] | null;
  payment_form_codes: string[] | null;
  active_weekdays: string[] | null;
  start_time: string | null;
  end_time: string | null;
  birthday_only: boolean | null;
  max_discount_per_day: string | number | null;
  max_volume_per_day: string | number | null;
  max_quantity_per_item: string | number | null;
  redemptions_per_customer: string | number | null;
  max_purchases_per_week: string | number | null;
  max_purchases_per_month: string | number | null;
  reusable: boolean | null;
  discount_type: "percent" | "fixed" | null;
  discount_percent: string | number;
  discount_value: string | number | null;
  valid_from: string | null;
  valid_until: string | null;
  status: DiscountAuthorization["status"];
  created_at: string | Date;
  cancelled_at: string | Date | null;
};

function mapRow(row: DiscountAuthorizationRow): DiscountAuthorization {
  const discountType = row.discount_type === "fixed" ? "fixed" : "percent";

  return {
    id: row.id,
    promotionId: row.promotion_id ?? null,
    promotionName: row.promotion_name ?? null,
    voucherOrigin: row.voucher_origin === "promotion_fixed" || row.voucher_origin === "promotion_mobile" ? row.voucher_origin : "manual",
    issuedToCustomerCode: row.issued_to_customer_code ?? null,
    issuedToCustomerGroupCode: row.issued_to_customer_group_code ?? null,
    issuedDocumentType:
      row.issued_document_type === "cnpj" ? "cnpj" : row.issued_document_type === "cpf" ? "cpf" : null,
    issuedDocumentNumber: row.issued_document_number ?? null,
    requireCustomerDocumentAtCashier: Boolean(row.require_customer_document_at_cashier),
    shortCode: row.short_code,
    scope: row.scope,
    productCodes: row.product_codes ?? [],
    productGroupCodes: row.product_group_codes ?? [],
    customerCodes: row.customer_codes ?? [],
    customerGroupCodes: row.customer_group_codes ?? [],
    firstPurchaseOnly: Boolean(row.first_purchase_only),
    newCustomerDays:
      row.new_customer_days === null || row.new_customer_days === undefined
        ? null
        : Number(row.new_customer_days),
    selectedBranchIds: row.branch_ids ?? [],
    paymentFormCodes: row.payment_form_codes ?? [],
    activeWeekdays: (row.active_weekdays ?? []).filter((value): value is DiscountAuthorization["activeWeekdays"][number] =>
      ["dom", "seg", "ter", "qua", "qui", "sex", "sab"].includes(value),
    ),
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    birthdayOnly: Boolean(row.birthday_only),
    maxDiscountPerDay:
      row.max_discount_per_day === null || row.max_discount_per_day === undefined
        ? null
        : Number(row.max_discount_per_day),
    maxVolumePerDay:
      row.max_volume_per_day === null || row.max_volume_per_day === undefined
        ? null
        : Number(row.max_volume_per_day),
    maxQuantityPerItem:
      row.max_quantity_per_item === null || row.max_quantity_per_item === undefined
        ? null
        : Number(row.max_quantity_per_item),
    redemptionsPerCustomer:
      row.redemptions_per_customer === null || row.redemptions_per_customer === undefined
        ? null
        : Number(row.redemptions_per_customer),
    maxPurchasesPerWeek:
      row.max_purchases_per_week === null || row.max_purchases_per_week === undefined
        ? null
        : Number(row.max_purchases_per_week),
    maxPurchasesPerMonth:
      row.max_purchases_per_month === null || row.max_purchases_per_month === undefined
        ? null
        : Number(row.max_purchases_per_month),
    reusable: Boolean(row.reusable),
    discountType,
    discountPercent: discountType === "percent" ? Number(row.discount_percent) : null,
    discountValue:
      discountType === "fixed" && row.discount_value !== null && row.discount_value !== undefined
        ? Number(row.discount_value)
        : null,
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
      SELECT array_agg(COALESCE(prod.display_code, selected.code) ORDER BY selected.ord)
      FROM unnest(${buildLegacyCompatibleArraySql(alias, "product_codes", "product_code")}) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN LATERAL (
        SELECT produto.codigo AS display_code
        FROM produto
        WHERE CAST(produto.grid AS TEXT) = selected.code
           OR produto.codigo = selected.code
        ORDER BY CASE
          WHEN CAST(produto.grid AS TEXT) = selected.code THEN 0
          WHEN produto.codigo = selected.code THEN 1
          ELSE 2
        END,
        produto.grid DESC
        LIMIT 1
      ) prod ON TRUE
    ), ARRAY[]::text[])
  `;
}

function buildCustomerCodesSql(alias: string): string {
  return `
    COALESCE((
      SELECT array_agg(COALESCE(pe.display_code, selected.code) ORDER BY selected.ord)
      FROM unnest(${buildLegacyCompatibleArraySql(alias, "customer_codes", "customer_code")}) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN LATERAL (
        SELECT CAST(pessoa.codigo AS text) AS display_code
        FROM pessoa
        WHERE CAST(pessoa.grid AS TEXT) = selected.code
           OR CAST(pessoa.codigo AS TEXT) = selected.code
        ORDER BY CASE
          WHEN CAST(pessoa.grid AS TEXT) = selected.code THEN 0
          WHEN CAST(pessoa.codigo AS TEXT) = selected.code THEN 1
          ELSE 2
        END,
        pessoa.grid DESC
        LIMIT 1
      ) pe ON TRUE
    ), ARRAY[]::text[])
  `;
}

function buildPaymentFormCodesSql(alias: string): string {
  return `
    COALESCE((
      SELECT array_agg(COALESCE(fp.display_code, selected.code) ORDER BY selected.ord)
      FROM unnest(
        ${buildLegacyCompatibleArraySql(alias, "payment_form_codes", "payment_form_code")}
      ) WITH ORDINALITY AS selected(code, ord)
      LEFT JOIN LATERAL (
        SELECT CAST(forma_pgto.codigo AS text) AS display_code
        FROM forma_pgto
        WHERE CAST(forma_pgto.grid AS TEXT) = selected.code
           OR CAST(forma_pgto.codigo AS TEXT) = selected.code
        ORDER BY CASE
          WHEN CAST(forma_pgto.grid AS TEXT) = selected.code THEN 0
          WHEN CAST(forma_pgto.codigo AS TEXT) = selected.code THEN 1
          ELSE 2
        END,
        forma_pgto.grid DESC
        LIMIT 1
      ) fp ON TRUE
    ), ARRAY[]::text[])
  `;
}

async function resolveProductCodes(
  productCodes: string[],
): Promise<{ displayCodes: string[]; internalCodes: string[] }> {
  if (productCodes.length === 0) {
    return { displayCodes: [], internalCodes: [] };
  }

  const result = await query<{
    requested_code: string;
    display_code: string;
    internal_code: string;
    matched_by: "code" | "grid";
  }>(
    `
      SELECT
        selected.code AS requested_code,
        produto.codigo AS display_code,
        CAST(produto.grid AS TEXT) AS internal_code,
        CASE
          WHEN CAST(produto.grid AS TEXT) = selected.code THEN 'grid'
          ELSE 'code'
        END AS matched_by
      FROM unnest($1::text[]) WITH ORDINALITY AS selected(code, ord)
      INNER JOIN produto
        ON (produto.codigo = selected.code OR CAST(produto.grid AS TEXT) = selected.code)
       AND produto.flag = 'A'
      ORDER BY selected.ord, produto.grid DESC
    `,
    [productCodes],
  );

  const allCode = productCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "code"));
  const allGrid = productCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "grid"));
  const preferCode = allCode && !allGrid;

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const code of productCodes) {
    const candidates = result.rows.filter((row) => row.requested_code === code);
    const picked =
      candidates.find((row) => row.matched_by === (preferCode ? "code" : "grid")) ??
      candidates.find((row) => row.matched_by === (preferCode ? "grid" : "code"));

    if (picked) {
      resolvedByCode.set(code, picked);
    }
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

  const result = await query<{
    requested_code: string;
    display_code: string;
    internal_code: string;
    matched_by: "code" | "grid";
  }>(
    `
      SELECT
        selected.code AS requested_code,
        CAST(pessoa.codigo AS TEXT) AS display_code,
        CAST(pessoa.grid AS TEXT) AS internal_code,
        CASE
          WHEN CAST(pessoa.grid AS TEXT) = selected.code THEN 'grid'
          ELSE 'code'
        END AS matched_by
      FROM unnest($1::text[]) WITH ORDINALITY AS selected(code, ord)
      INNER JOIN pessoa
        ON (CAST(pessoa.codigo AS TEXT) = selected.code OR CAST(pessoa.grid AS TEXT) = selected.code)
       AND pessoa.flag = 'A'
      ORDER BY selected.ord, pessoa.grid DESC
    `,
    [customerCodes],
  );

  const allCode = customerCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "code"));
  const allGrid = customerCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "grid"));
  const preferCode = allCode && !allGrid;

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const code of customerCodes) {
    const candidates = result.rows.filter((row) => row.requested_code === code);
    const picked =
      candidates.find((row) => row.matched_by === (preferCode ? "code" : "grid")) ??
      candidates.find((row) => row.matched_by === (preferCode ? "grid" : "code"));

    if (picked) {
      resolvedByCode.set(code, picked);
    }
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

  const result = await query<{
    requested_code: string;
    display_code: string;
    internal_code: string;
    matched_by: "code" | "grid";
  }>(
    `
      SELECT
        selected.code AS requested_code,
        CAST(forma_pgto.codigo AS TEXT) AS display_code,
        CAST(forma_pgto.grid AS TEXT) AS internal_code,
        CASE
          WHEN CAST(forma_pgto.grid AS TEXT) = selected.code THEN 'grid'
          ELSE 'code'
        END AS matched_by
      FROM unnest($1::text[]) WITH ORDINALITY AS selected(code, ord)
      INNER JOIN forma_pgto
        ON (CAST(forma_pgto.codigo AS TEXT) = selected.code OR CAST(forma_pgto.grid AS TEXT) = selected.code)
       AND forma_pgto.flag = 'A'
      ORDER BY selected.ord, forma_pgto.grid DESC
    `,
    [paymentFormCodes],
  );

  const allCode = paymentFormCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "code"));
  const allGrid = paymentFormCodes.every((code) => result.rows.some((row) => row.requested_code === code && row.matched_by === "grid"));
  const preferCode = allCode && !allGrid;

  const resolvedByCode = new Map<string, { display_code: string; internal_code: string }>();
  for (const code of paymentFormCodes) {
    const candidates = result.rows.filter((row) => row.requested_code === code);
    const picked =
      candidates.find((row) => row.matched_by === (preferCode ? "code" : "grid")) ??
      candidates.find((row) => row.matched_by === (preferCode ? "grid" : "code"));

    if (picked) {
      resolvedByCode.set(code, picked);
    }
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

type ExistingAuthorizationIdentityRow = {
  id: string;
  created_at: string | Date;
};

async function getExistingAuthorizationIdentity(shortCode: string): Promise<ExistingAuthorizationIdentityRow | null> {
  const result = await query<ExistingAuthorizationIdentityRow>(
    `
      SELECT id, created_at
      FROM discount_authorization
      WHERE short_code = $1
      LIMIT 1
    `,
    [shortCode],
  );

  return result.rows[0] ?? null;
}

export async function findPromotionIssuedVoucher(params: {
  companyId: string;
  promotionId: string;
  issuedToCustomerCode?: string | null;
  issuedDocumentNumber?: string | null;
}): Promise<DiscountAuthorization | null> {
  const customerCode = params.issuedToCustomerCode?.trim().toUpperCase() || null;
  const documentNumber = String(params.issuedDocumentNumber ?? "").replace(/\D/g, "") || null;
  if (!customerCode && !documentNumber) {
    return null;
  }

  await ensureDiscountSchema();
  const result = await query<DiscountAuthorizationRow>(
    `
      SELECT
        da.id,
        da.promotion_id,
        da.promotion_name,
        COALESCE(da.voucher_origin, 'manual') AS voucher_origin,
        da.issued_to_customer_code,
        da.issued_to_customer_group_code,
        da.issued_document_type,
        da.issued_document_number,
        COALESCE(da.require_customer_document_at_cashier, FALSE) AS require_customer_document_at_cashier,
        da.short_code,
        da.scope,
        ${buildProductCodesSql("da")} AS product_codes,
        ${buildLegacyCompatibleArraySql("da", "product_group_codes", "product_group_code")} AS product_group_codes,
        ${buildCustomerCodesSql("da")} AS customer_codes,
        ${buildLegacyCompatibleArraySql("da", "customer_group_codes", "customer_group_code")} AS customer_group_codes,
        COALESCE(da.first_purchase_only, FALSE) AS first_purchase_only,
        da.new_customer_days,
        COALESCE(da.branch_ids, ARRAY[]::text[]) AS branch_ids,
        ${buildPaymentFormCodesSql("da")} AS payment_form_codes,
        COALESCE(da.active_weekdays, ARRAY[]::text[]) AS active_weekdays,
        da.start_time,
        da.end_time,
        COALESCE(da.birthday_only, FALSE) AS birthday_only,
        da.max_discount_per_day,
        da.max_volume_per_day,
        da.max_quantity_per_item,
        da.redemptions_per_customer,
        da.max_purchases_per_week,
        da.max_purchases_per_month,
        COALESCE(da.reusable, FALSE) AS reusable,
        COALESCE(da.discount_type, 'percent') AS discount_type,
        da.discount_percent,
        da.discount_value,
        da.valid_from,
        da.valid_until,
        da.status,
        da.created_at,
        da.cancelled_at
      FROM discount_authorization da
      WHERE da.company_id = $1
        AND da.promotion_id = $2
        AND da.voucher_origin = 'promotion_mobile'
        AND (
          ($3::text IS NOT NULL AND da.issued_to_customer_code = $3::text)
          OR ($4::text IS NOT NULL AND da.issued_document_number = $4::text)
        )
      ORDER BY da.created_at DESC
      LIMIT 5
    `,
    [params.companyId, params.promotionId, customerCode, documentNumber],
  );

  for (const row of result.rows) {
    const authorization = withEffectiveStatus(mapRow(row));
    if (authorization.status === "ACTIVE") {
      return authorization;
    }
  }

  return null;
}

async function buildOperationalAuthorization(
  shortCode: string,
  input: CreateDiscountCodeInput,
): Promise<{ normalized: CreateDiscountCodeInput; authorization: DiscountAuthorization }> {
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

  const existing = await getExistingAuthorizationIdentity(shortCode);
  const createdAt = existing?.created_at ? new Date(existing.created_at).toISOString() : new Date().toISOString();
  const normalizedCode = shortCode.trim().toUpperCase();

  return {
    normalized,
    authorization: {
      id: existing?.id ?? createAuthorizationId(),
      promotionId: normalized.promotionId ?? null,
      promotionName: normalized.promotionName ?? null,
      voucherOrigin: normalized.voucherOrigin ?? "manual",
      issuedToCustomerCode: normalized.issuedToCustomerCode ?? null,
      issuedToCustomerGroupCode: normalized.issuedToCustomerGroupCode ?? null,
      issuedDocumentType: normalized.issuedDocumentType ?? null,
      issuedDocumentNumber: normalized.issuedDocumentNumber ?? null,
      requireCustomerDocumentAtCashier: Boolean(normalized.requireCustomerDocumentAtCashier),
      shortCode: normalizedCode,
      scope: buildDiscountScope(normalized),
      productCodes: resolvedProducts.displayCodes,
      productGroupCodes: normalized.productGroupCodes ?? [],
      customerCodes: resolvedCustomers.displayCodes,
      customerGroupCodes: normalized.customerGroupCodes ?? [],
      firstPurchaseOnly: Boolean(normalized.firstPurchaseOnly),
      newCustomerDays:
        normalized.newCustomerDays === null || normalized.newCustomerDays === undefined
          ? null
          : Number(normalized.newCustomerDays),
      selectedBranchIds: normalized.selectedBranchIds ?? [],
      paymentFormCodes: resolvedPaymentForms.displayCodes,
      activeWeekdays: normalized.activeWeekdays ?? [],
      startTime: normalized.startTime ?? null,
      endTime: normalized.endTime ?? null,
      birthdayOnly: Boolean(normalized.birthdayOnly),
      maxDiscountPerDay: normalized.maxDiscountPerDay ?? null,
      maxVolumePerDay: normalized.maxVolumePerDay ?? null,
      maxQuantityPerItem: normalized.maxQuantityPerItem ?? null,
      redemptionsPerCustomer: normalized.redemptionsPerCustomer ?? null,
      maxPurchasesPerWeek: normalized.maxPurchasesPerWeek ?? null,
      maxPurchasesPerMonth: normalized.maxPurchasesPerMonth ?? null,
      reusable: Boolean(normalized.reusable),
      discountType: normalized.discountType === "fixed" ? "fixed" : "percent",
      discountPercent: normalized.discountType === "fixed" ? null : normalized.discountPercent ?? null,
      discountValue: normalized.discountType === "fixed" ? normalized.discountValue ?? null : null,
      validFrom: normalized.validFrom ?? null,
      validUntil: normalized.validUntil ?? null,
      status: "ACTIVE",
      createdAt,
      cancelledAt: null,
    },
  };
}

async function persistOperationalAuthorization(
  authorization: DiscountAuthorization,
  normalized: CreateDiscountCodeInput,
  tenantScope: DiscountCodeTenantScope = { companyId: null, sourceBranchId: null },
): Promise<DiscountAuthorization> {
  await query(
    `
      INSERT INTO discount_authorization (
        id,
        company_id,
        source_branch_id,
        promotion_id,
        promotion_name,
        voucher_origin,
        issued_to_customer_code,
        issued_to_customer_group_code,
        issued_document_type,
        issued_document_number,
        require_customer_document_at_cashier,
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
        first_purchase_only,
        new_customer_days,
        branch_ids,
        payment_form_codes,
        payment_form_code,
        active_weekdays,
        start_time,
        end_time,
        birthday_only,
        max_discount_per_day,
        max_volume_per_day,
        max_quantity_per_item,
        redemptions_per_customer,
        max_purchases_per_week,
        max_purchases_per_month,
        reusable,
        discount_type,
        discount_percent,
        discount_value,
        valid_from,
        valid_until,
        status,
        created_at,
        cancelled_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45
      )
      ON CONFLICT (short_code) DO UPDATE
      SET
        company_id = EXCLUDED.company_id,
        source_branch_id = EXCLUDED.source_branch_id,
        promotion_id = EXCLUDED.promotion_id,
        promotion_name = EXCLUDED.promotion_name,
        voucher_origin = EXCLUDED.voucher_origin,
        issued_to_customer_code = EXCLUDED.issued_to_customer_code,
        issued_to_customer_group_code = EXCLUDED.issued_to_customer_group_code,
        issued_document_type = EXCLUDED.issued_document_type,
        issued_document_number = EXCLUDED.issued_document_number,
        require_customer_document_at_cashier = EXCLUDED.require_customer_document_at_cashier,
        scope = EXCLUDED.scope,
        product_codes = EXCLUDED.product_codes,
        product_code = EXCLUDED.product_code,
        product_group_codes = EXCLUDED.product_group_codes,
        product_group_code = EXCLUDED.product_group_code,
        customer_codes = EXCLUDED.customer_codes,
        customer_code = EXCLUDED.customer_code,
        customer_group_codes = EXCLUDED.customer_group_codes,
        customer_group_code = EXCLUDED.customer_group_code,
        first_purchase_only = EXCLUDED.first_purchase_only,
        new_customer_days = EXCLUDED.new_customer_days,
        branch_ids = EXCLUDED.branch_ids,
        payment_form_codes = EXCLUDED.payment_form_codes,
        payment_form_code = EXCLUDED.payment_form_code,
        active_weekdays = EXCLUDED.active_weekdays,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        birthday_only = EXCLUDED.birthday_only,
        max_discount_per_day = EXCLUDED.max_discount_per_day,
        max_volume_per_day = EXCLUDED.max_volume_per_day,
        max_quantity_per_item = EXCLUDED.max_quantity_per_item,
        redemptions_per_customer = EXCLUDED.redemptions_per_customer,
        max_purchases_per_week = EXCLUDED.max_purchases_per_week,
        max_purchases_per_month = EXCLUDED.max_purchases_per_month,
        reusable = EXCLUDED.reusable,
        discount_type = EXCLUDED.discount_type,
        discount_percent = EXCLUDED.discount_percent,
        discount_value = EXCLUDED.discount_value,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        status = EXCLUDED.status,
        cancelled_at = NULL
    `,
    [
      authorization.id,
      tenantScope.companyId,
      tenantScope.sourceBranchId,
      authorization.promotionId,
      authorization.promotionName,
      authorization.voucherOrigin,
      authorization.issuedToCustomerCode,
      authorization.issuedToCustomerGroupCode,
      authorization.issuedDocumentType,
      authorization.issuedDocumentNumber,
      authorization.requireCustomerDocumentAtCashier,
      authorization.shortCode,
      authorization.scope,
      normalized.productCodes ?? [],
      (normalized.productCodes ?? [])[0] ?? null,
      authorization.productGroupCodes,
      authorization.productGroupCodes[0] ?? null,
      normalized.customerCodes ?? [],
      (normalized.customerCodes ?? [])[0] ?? null,
      authorization.customerGroupCodes,
      authorization.customerGroupCodes[0] ?? null,
      authorization.firstPurchaseOnly,
      authorization.newCustomerDays,
      authorization.selectedBranchIds,
      normalized.paymentFormCodes ?? [],
      (normalized.paymentFormCodes ?? [])[0] ?? null,
      authorization.activeWeekdays,
      authorization.startTime,
      authorization.endTime,
      authorization.birthdayOnly,
      authorization.maxDiscountPerDay,
      authorization.maxVolumePerDay,
      authorization.maxQuantityPerItem,
      authorization.redemptionsPerCustomer,
      authorization.maxPurchasesPerWeek,
      authorization.maxPurchasesPerMonth,
      authorization.reusable,
      authorization.discountType,
      authorization.discountPercent ?? 1,
      authorization.discountValue,
      authorization.validFrom,
      authorization.validUntil,
      authorization.status,
      authorization.createdAt,
      authorization.cancelledAt,
    ],
  );

  return withEffectiveStatus(authorization);
}

export async function listDiscountCodes(): Promise<DiscountAuthorization[]> {
  await ensureDiscountSchema();
  const result = await query<DiscountAuthorizationRow>(`
    SELECT
      da.id,
      da.promotion_id,
      da.promotion_name,
      COALESCE(da.voucher_origin, 'manual') AS voucher_origin,
      da.issued_to_customer_code,
      da.issued_to_customer_group_code,
      da.issued_document_type,
      da.issued_document_number,
      COALESCE(da.require_customer_document_at_cashier, FALSE) AS require_customer_document_at_cashier,
      da.short_code,
      da.scope,
      ${buildProductCodesSql("da")} AS product_codes,
      ${buildLegacyCompatibleArraySql("da", "product_group_codes", "product_group_code")} AS product_group_codes,
      ${buildCustomerCodesSql("da")} AS customer_codes,
      ${buildLegacyCompatibleArraySql("da", "customer_group_codes", "customer_group_code")} AS customer_group_codes,
      COALESCE(da.first_purchase_only, FALSE) AS first_purchase_only,
      da.new_customer_days,
      COALESCE(da.branch_ids, ARRAY[]::text[]) AS branch_ids,
      ${buildPaymentFormCodesSql("da")} AS payment_form_codes,
      COALESCE(da.active_weekdays, ARRAY[]::text[]) AS active_weekdays,
      da.start_time,
      da.end_time,
      COALESCE(da.birthday_only, FALSE) AS birthday_only,
      da.max_discount_per_day,
      da.max_volume_per_day,
      da.max_quantity_per_item,
      da.redemptions_per_customer,
      da.max_purchases_per_week,
      da.max_purchases_per_month,
      COALESCE(da.reusable, FALSE) AS reusable,
      COALESCE(da.discount_type, 'percent') AS discount_type,
      da.discount_percent,
      da.discount_value,
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
  tenantScope: DiscountCodeTenantScope = { companyId: null, sourceBranchId: null },
): Promise<DiscountAuthorization> {
  const shortCode = await generateUniqueShortCode(await getExistingCodes());
  return upsertDiscountCode(shortCode, input, tenantScope);
}

export async function upsertDiscountCode(
  shortCode: string,
  input: CreateDiscountCodeInput,
  tenantScope: DiscountCodeTenantScope = { companyId: null, sourceBranchId: null },
): Promise<DiscountAuthorization> {
  const { normalized, authorization } = await buildOperationalAuthorization(shortCode, input);
  return persistOperationalAuthorization(authorization, normalized, tenantScope);
}

export async function getDiscountCodeTenantScope(shortCode: string): Promise<DiscountCodeTenantScope | null> {
  const code = shortCode.trim().toUpperCase();
  if (!code) {
    return null;
  }

  await ensureDiscountSchema();
  const result = await query<{ company_id: string | null; source_branch_id: string | null }>(
    `
      SELECT company_id, source_branch_id
      FROM discount_authorization
      WHERE short_code = $1
      LIMIT 1
    `,
    [code],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    companyId: row.company_id ?? null,
    sourceBranchId: row.source_branch_id ?? null,
  };
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
        da.promotion_id,
        da.promotion_name,
        COALESCE(da.voucher_origin, 'manual') AS voucher_origin,
        da.issued_to_customer_code,
        da.issued_to_customer_group_code,
        da.issued_document_type,
        da.issued_document_number,
        COALESCE(da.require_customer_document_at_cashier, FALSE) AS require_customer_document_at_cashier,
        da.short_code,
        da.scope,
        ${buildProductCodesSql("da")} AS product_codes,
        ${buildLegacyCompatibleArraySql("da", "product_group_codes", "product_group_code")} AS product_group_codes,
        ${buildCustomerCodesSql("da")} AS customer_codes,
        ${buildLegacyCompatibleArraySql("da", "customer_group_codes", "customer_group_code")} AS customer_group_codes,
        COALESCE(da.first_purchase_only, FALSE) AS first_purchase_only,
        da.new_customer_days,
        COALESCE(da.branch_ids, ARRAY[]::text[]) AS branch_ids,
        ${buildPaymentFormCodesSql("da")} AS payment_form_codes,
        COALESCE(da.active_weekdays, ARRAY[]::text[]) AS active_weekdays,
        da.start_time,
        da.end_time,
        COALESCE(da.birthday_only, FALSE) AS birthday_only,
        da.max_discount_per_day,
        da.max_volume_per_day,
        da.max_quantity_per_item,
        da.redemptions_per_customer,
        da.max_purchases_per_week,
        da.max_purchases_per_month,
        COALESCE(da.reusable, FALSE) AS reusable,
        COALESCE(da.discount_type, 'percent') AS discount_type,
        da.discount_percent,
        da.discount_value,
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
        promotion_id,
        promotion_name,
        COALESCE(voucher_origin, 'manual') AS voucher_origin,
        issued_to_customer_code,
        issued_to_customer_group_code,
        issued_document_type,
        issued_document_number,
        COALESCE(require_customer_document_at_cashier, FALSE) AS require_customer_document_at_cashier,
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
        first_purchase_only,
        new_customer_days,
        branch_ids,
        payment_form_codes,
        active_weekdays,
        start_time,
        end_time,
        birthday_only,
        max_discount_per_day,
        max_volume_per_day,
        max_quantity_per_item,
        redemptions_per_customer,
        max_purchases_per_week,
        max_purchases_per_month,
        reusable,
        COALESCE(discount_type, 'percent') AS discount_type,
        discount_percent,
        discount_value,
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
