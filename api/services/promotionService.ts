import {
  normalizePromotionInput,
  validatePromotionInput,
  type CreatePromotionInput,
  type Promotion,
} from "../../shared/promotion.js";
import { ensurePromotionsSchema, query, querySaas } from "../db.js";
import { cancelPromotionPublication, mapPromotionWithIntegration, syncPromotionPublication } from "./pdvPromotionService.js";
import { bumpCompanyPromotionCursor, canonicalizeTenantReferenceValues } from "./referenceSyncService.js";

type PromotionRow = {
  id: string;
  company_id: string | null;
  name: string;
  voucher_code: string | null;
  status: Promotion["status"];
  payload: CreatePromotionInput | string;
  created_at: string | Date;
  updated_at: string | Date;
  authorization_id: string | null;
  sync_state: Promotion["integration"] extends infer T
    ? T extends { state: infer U }
      ? U | null
      : null
    : null;
  sync_error: string | null;
  sync_synced_at: string | Date | null;
};

type PromotionConflictRow = {
  id: string;
  voucher_code: string | null;
};

type PromotionCompanyBootstrapRow = {
  id: string;
};

type PromotionCompanyCountRow = {
  total: string | number;
};

type PromotionCompanyBranchRow = {
  id: string;
  branch_ids: string[] | null;
};

type OrphanPromotionRow = {
  id: string;
  payload: CreatePromotionInput | string;
};

type PromotionAccessOptions = {
  companyId?: string | null;
  allowedBranchIds?: string[] | null;
};

function createPromotionId(): string {
  return `promo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type CanonicalGridRow = {
  grid_id: string;
};

type CanonicalMatchMetadata = {
  rawValue: string;
  codeMatches: string[];
  gridMatches: string[];
};

function detectReferenceMode(matches: CanonicalMatchMetadata[]): "code" | "grid" | "mixed" {
  if (matches.length === 0) {
    return "mixed";
  }

  if (matches.every((item) => item.gridMatches.length > 0)) {
    return "grid";
  }

  if (matches.every((item) => item.codeMatches.length > 0)) {
    return "code";
  }

  return "mixed";
}

function pickCanonicalMatches(
  mode: "code" | "grid" | "mixed",
  match: CanonicalMatchMetadata,
  allowMultipleCodeMatches: boolean,
): string[] {
  const codeMatches = Array.from(new Set(match.codeMatches));
  const gridMatches = Array.from(new Set(match.gridMatches));

  if (mode === "code") {
    if (codeMatches.length > 0) {
      return allowMultipleCodeMatches ? codeMatches : [codeMatches[0]];
    }
    if (gridMatches.length > 0) {
      return [gridMatches[0]];
    }
    return [match.rawValue];
  }

  if (mode === "grid") {
    if (gridMatches.length > 0) {
      return [gridMatches[0]];
    }
    if (codeMatches.length > 0) {
      return allowMultipleCodeMatches ? codeMatches : [codeMatches[0]];
    }
    return [match.rawValue];
  }

  if (codeMatches.length > 0 && gridMatches.length === 0) {
    return allowMultipleCodeMatches ? codeMatches : [codeMatches[0]];
  }

  if (gridMatches.length > 0 && codeMatches.length === 0) {
    return [gridMatches[0]];
  }

  if (codeMatches.length > 0) {
    return allowMultipleCodeMatches ? codeMatches : [codeMatches[0]];
  }

  if (gridMatches.length > 0) {
    return [gridMatches[0]];
  }

  return [match.rawValue];
}

async function canonicalizeSingleGridReference(
  rawValues: string[],
  options: {
    tableName: string;
    codeColumn: string;
    gridColumn?: string;
    activeClause: string;
  },
): Promise<string[]> {
  if (rawValues.length === 0) {
    return [];
  }

  const gridColumn = options.gridColumn ?? "grid";
  const matches: CanonicalMatchMetadata[] = [];

  for (const rawValue of rawValues) {
    const codeMatches = await query<CanonicalGridRow>(
      `
        SELECT CAST(${gridColumn} AS TEXT) AS grid_id
        FROM ${options.tableName}
        WHERE CAST(${options.codeColumn} AS TEXT) = $1
          AND ${options.activeClause}
        ORDER BY ${gridColumn} DESC
      `,
      [rawValue],
    );

    const gridMatches = await query<CanonicalGridRow>(
      `
        SELECT CAST(${gridColumn} AS TEXT) AS grid_id
        FROM ${options.tableName}
        WHERE CAST(${gridColumn} AS TEXT) = $1
          AND ${options.activeClause}
        ORDER BY ${gridColumn} DESC
      `,
      [rawValue],
    );

    matches.push({
      rawValue,
      codeMatches: codeMatches.rows.map((row) => row.grid_id),
      gridMatches: gridMatches.rows.map((row) => row.grid_id),
    });
  }

  const mode = detectReferenceMode(matches);
  const resolved = matches.flatMap((match) => pickCanonicalMatches(mode, match, false));
  return Array.from(new Set(resolved));
}

async function canonicalizeBranchIds(rawValues: string[]): Promise<string[]> {
  if (rawValues.length === 0) {
    return [];
  }

  const matches: CanonicalMatchMetadata[] = [];

  for (const rawValue of rawValues) {
    const codeMatches = await query<CanonicalGridRow>(
      `
        SELECT CAST(grid AS TEXT) AS grid_id
        FROM empresa
        WHERE CAST(codigo AS TEXT) = $1
          AND flag = 'A'
        ORDER BY grid DESC
      `,
      [rawValue],
    );

    const gridMatches = await query<CanonicalGridRow>(
      `
        SELECT CAST(grid AS TEXT) AS grid_id
        FROM empresa
        WHERE CAST(grid AS TEXT) = $1
          AND flag = 'A'
        ORDER BY grid DESC
      `,
      [rawValue],
    );

    matches.push({
      rawValue,
      codeMatches: codeMatches.rows.map((row) => row.grid_id),
      gridMatches: gridMatches.rows.map((row) => row.grid_id),
    });
  }

  const mode = detectReferenceMode(matches);
  const resolved = matches.flatMap((match) => pickCanonicalMatches(mode, match, true));
  return Array.from(new Set(resolved));
}

async function canonicalizePromotionReferences(
  companyId: string,
  normalized: CreatePromotionInput,
): Promise<CreatePromotionInput> {
  return {
    ...normalized,
    selectedProductCodes: await canonicalizeTenantReferenceValues(companyId, "products", normalized.selectedProductCodes),
    selectedCustomerCodes: await canonicalizeTenantReferenceValues(companyId, "customers", normalized.selectedCustomerCodes),
    selectedBranchIds: await canonicalizeBranchIds(normalized.selectedBranchIds),
    selectedPaymentFormCodes: await canonicalizeTenantReferenceValues(
      companyId,
      "payment-forms",
      normalized.selectedPaymentFormCodes,
    ),
  };
}

async function assertPromotionVoucherConflict(
  normalized: CreatePromotionInput,
  currentPromotionId?: string,
): Promise<void> {
  if (normalized.voucherMode !== "fixed" || !normalized.voucherCode.trim()) {
    return;
  }

  const result = await querySaas<PromotionConflictRow>(
    `
      SELECT id, voucher_code
      FROM saas_promotion
      WHERE voucher_code = $1
    `,
    [normalized.voucherCode],
  );

  for (const row of result.rows) {
    if (currentPromotionId && row.id === currentPromotionId) {
      continue;
    }

    if ((row.voucher_code ?? "") === normalized.voucherCode) {
      throw new PromotionValidationError(["Ja existe uma campanha cadastrada com este voucher."]);
    }
  }
}

function buildPromotionScopeSql(companyId?: string | null) {
  if (!companyId) {
    return {
      clause: "",
      values: [] as unknown[],
    };
  }

  return {
    clause: "WHERE sp.company_id = $1",
    values: [companyId] as unknown[],
  };
}

function assertAllowedBranches(
  normalized: CreatePromotionInput,
  allowedBranchIds?: string[] | null,
): void {
  if (!allowedBranchIds) {
    return;
  }

  const allowed = new Set(allowedBranchIds.map((value) => value.trim()).filter(Boolean));
  const unauthorizedBranchIds = normalized.selectedBranchIds.filter((value) => !allowed.has(value));

  if (unauthorizedBranchIds.length > 0) {
    throw new PromotionValidationError([
      "A campanha contem filiais que nao pertencem a rede da empresa logada.",
    ]);
  }
}

async function backfillSingleCompanyPromotionOwnership(): Promise<void> {
  const companyCount = await querySaas<PromotionCompanyCountRow>(`
    SELECT COUNT(*) AS total
    FROM saas_company
  `);

  if (Number(companyCount.rows[0]?.total ?? 0) !== 1) {
    return;
  }

  const companyResult = await querySaas<PromotionCompanyBootstrapRow>(`
    SELECT id
    FROM saas_company
    LIMIT 1
  `);

  if (companyResult.rows.length === 0) {
    return;
  }

  await querySaas(
    `
      UPDATE saas_promotion
      SET company_id = $1
      WHERE company_id IS NULL
    `,
    [companyResult.rows[0].id],
  );
}

function parsePromotionPayload(payload: CreatePromotionInput | string): CreatePromotionInput {
  if (typeof payload === "string") {
    try {
      return normalizePromotionInput(JSON.parse(payload));
    } catch {
      return normalizePromotionInput(null);
    }
  }

  return normalizePromotionInput(payload);
}

async function backfillOrphanPromotionOwnershipByBranches(): Promise<void> {
  const orphanPromotions = await querySaas<OrphanPromotionRow>(
    `
      SELECT id, payload
      FROM saas_promotion
      WHERE company_id IS NULL
      ORDER BY created_at ASC
    `,
  );

  if (orphanPromotions.rows.length === 0) {
    return;
  }

  const companies = await querySaas<PromotionCompanyBranchRow>(
    `
      SELECT id, COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
      FROM saas_company
      ORDER BY created_at ASC
    `,
  );

  if (companies.rows.length === 0) {
    return;
  }

  for (const promotion of orphanPromotions.rows) {
    const normalizedPayload = parsePromotionPayload(promotion.payload);
    const canonicalBranchIds = await canonicalizeBranchIds(normalizedPayload.selectedBranchIds);
    const effectiveBranchIds = canonicalBranchIds.length > 0 ? canonicalBranchIds : normalizedPayload.selectedBranchIds;
    const matchingCompanies = companies.rows.filter((company) => {
      const companyBranchIds = new Set((company.branch_ids ?? []).map((value) => value.trim()).filter(Boolean));
      if (companyBranchIds.size === 0) {
        return false;
      }

      return effectiveBranchIds.every((branchId) => companyBranchIds.has(branchId));
    });

    if (matchingCompanies.length !== 1) {
      continue;
    }

    await querySaas(
      `
        UPDATE saas_promotion
        SET company_id = $2,
            payload = $3::jsonb,
            updated_at = NOW()
        WHERE id = $1
          AND company_id IS NULL
      `,
      [
        promotion.id,
        matchingCompanies[0].id,
        JSON.stringify({
          ...normalizedPayload,
          selectedBranchIds: effectiveBranchIds,
        }),
      ],
    );
  }
}

export class PromotionValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "Erro de validacao");
    this.name = "PromotionValidationError";
  }
}

export async function listPromotions(options: PromotionAccessOptions = {}): Promise<Promotion[]> {
  await ensurePromotionsSchema();
  await backfillOrphanPromotionOwnershipByBranches();
  await backfillSingleCompanyPromotionOwnership();
  const scope = buildPromotionScopeSql(options.companyId);

  const result = await querySaas<PromotionRow>(
    `
      SELECT
        sp.id,
        sp.company_id,
        sp.name,
        sp.voucher_code,
        sp.status,
        sp.payload,
        sp.created_at,
        sp.updated_at,
        spps.authorization_id,
        spps.state AS sync_state,
        spps.error AS sync_error,
        spps.synced_at AS sync_synced_at
      FROM saas_promotion sp
      LEFT JOIN saas_promotion_pdv_sync spps
        ON spps.promotion_id = sp.id
      ${scope.clause}
      ORDER BY sp.updated_at DESC, sp.created_at DESC
    `,
    scope.values,
  );

  return result.rows.map(mapPromotionWithIntegration);
}

export async function createPromotion(input: CreatePromotionInput, options: PromotionAccessOptions): Promise<Promotion> {
  const issues = validatePromotionInput(input);
  if (issues.length > 0) {
    throw new PromotionValidationError(issues);
  }

  if (!options.companyId) {
    throw new PromotionValidationError(["Nao foi possivel identificar a empresa dona da campanha."]);
  }

  await ensurePromotionsSchema();
  await backfillOrphanPromotionOwnershipByBranches();
  await backfillSingleCompanyPromotionOwnership();
  const normalized = await canonicalizePromotionReferences(options.companyId, normalizePromotionInput(input));
  const storedVoucherCode = normalized.voucherMode === "fixed" ? normalized.voucherCode : null;
  const normalizedIssues = validatePromotionInput(normalized);
  if (normalizedIssues.length > 0) {
    throw new PromotionValidationError(normalizedIssues);
  }
  assertAllowedBranches(normalized, options.allowedBranchIds);
  await assertPromotionVoucherConflict(normalized);

  const result = await querySaas<PromotionRow>(
    `
      INSERT INTO saas_promotion (
        id,
        company_id,
        name,
        voucher_code,
        status,
        payload,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
      RETURNING
        id,
        company_id,
        name,
        voucher_code,
        status,
        payload,
        created_at,
        updated_at,
        NULL::text AS authorization_id,
        NULL::text AS sync_state,
        NULL::text AS sync_error,
        NULL::timestamptz AS sync_synced_at
    `,
    [
      createPromotionId(),
      options.companyId,
      normalized.name,
      storedVoucherCode,
      normalized.status,
      JSON.stringify(normalized),
    ],
  );

  const created = mapPromotionWithIntegration(result.rows[0]);
  created.integration = await syncPromotionPublication(created);
  await bumpCompanyPromotionCursor(options.companyId);
  return created;
}

export async function updatePromotion(
  promotionId: string,
  input: CreatePromotionInput,
  options: PromotionAccessOptions,
): Promise<Promotion | null> {
  const issues = validatePromotionInput(input);
  if (issues.length > 0) {
    throw new PromotionValidationError(issues);
  }

  await ensurePromotionsSchema();
  await backfillOrphanPromotionOwnershipByBranches();
  await backfillSingleCompanyPromotionOwnership();
  if (!options.companyId) {
    throw new PromotionValidationError(["Nao foi possivel identificar a empresa dona da campanha."]);
  }

  const companyFilterSql = options.companyId ? "AND sp.company_id = $2" : "";
  const currentFilterValues = options.companyId ? [promotionId, options.companyId] : [promotionId];
  const current = await querySaas<PromotionRow>(
    `
      SELECT
        sp.id,
        sp.company_id,
        sp.name,
        sp.voucher_code,
        sp.status,
        sp.payload,
        sp.created_at,
        sp.updated_at,
        spps.authorization_id,
        spps.state AS sync_state,
        spps.error AS sync_error,
        spps.synced_at AS sync_synced_at
      FROM saas_promotion sp
      LEFT JOIN saas_promotion_pdv_sync spps
        ON spps.promotion_id = sp.id
      WHERE sp.id = $1
        ${companyFilterSql}
      LIMIT 1
    `,
    currentFilterValues,
  );

  if (current.rows.length === 0) {
    return null;
  }

  const normalized = await canonicalizePromotionReferences(options.companyId, normalizePromotionInput(input));
  const storedVoucherCode = normalized.voucherMode === "fixed" ? normalized.voucherCode : null;
  const normalizedIssues = validatePromotionInput(normalized);
  if (normalizedIssues.length > 0) {
    throw new PromotionValidationError(normalizedIssues);
  }
  assertAllowedBranches(normalized, options.allowedBranchIds);
  await assertPromotionVoucherConflict(normalized, promotionId);

  const currentPromotion = mapPromotionWithIntegration(current.rows[0]);
  if (
    currentPromotion.voucherCode.trim() &&
    (normalized.voucherMode !== "fixed" || currentPromotion.voucherCode !== normalized.voucherCode)
  ) {
    await cancelPromotionPublication(currentPromotion);
  }

  const companyUpdateFilterSql = options.companyId ? "AND sp.company_id = $6" : "";
  const values: unknown[] = [
    promotionId,
    normalized.name,
    storedVoucherCode,
    normalized.status,
    JSON.stringify(normalized),
  ];

  if (options.companyId) {
    values.push(options.companyId);
  }

  const result = await querySaas<PromotionRow>(
    `
      UPDATE saas_promotion sp
      SET
        name = $2,
        voucher_code = $3,
        status = $4,
        payload = $5::jsonb,
        updated_at = NOW()
      WHERE id = $1
        ${companyUpdateFilterSql}
      RETURNING
        sp.id,
        sp.company_id,
        sp.name,
        sp.voucher_code,
        sp.status,
        sp.payload,
        sp.created_at,
        sp.updated_at,
        (
          SELECT authorization_id
          FROM saas_promotion_pdv_sync
          WHERE promotion_id = sp.id
        ) AS authorization_id,
        (
          SELECT state
          FROM saas_promotion_pdv_sync
          WHERE promotion_id = sp.id
        ) AS sync_state,
        (
          SELECT error
          FROM saas_promotion_pdv_sync
          WHERE promotion_id = sp.id
        ) AS sync_error,
        (
          SELECT synced_at
          FROM saas_promotion_pdv_sync
          WHERE promotion_id = sp.id
        ) AS sync_synced_at
    `,
    values,
  );

  const updated = mapPromotionWithIntegration(result.rows[0]);
  updated.integration = await syncPromotionPublication(updated);
  await bumpCompanyPromotionCursor(options.companyId);
  return updated;
}

export async function deletePromotion(promotionId: string, options: PromotionAccessOptions = {}): Promise<Promotion | null> {
  await ensurePromotionsSchema();
  await backfillOrphanPromotionOwnershipByBranches();
  await backfillSingleCompanyPromotionOwnership();

  const companyFilterSql = options.companyId ? "AND sp.company_id = $2" : "";
  const companyFilterDeleteSql = options.companyId ? "AND company_id = $2" : "";
  const filterValues = options.companyId ? [promotionId, options.companyId] : [promotionId];

  const current = await querySaas<PromotionRow>(
    `
      SELECT
        sp.id,
        sp.company_id,
        sp.name,
        sp.voucher_code,
        sp.status,
        sp.payload,
        sp.created_at,
        sp.updated_at,
        spps.authorization_id,
        spps.state AS sync_state,
        spps.error AS sync_error,
        spps.synced_at AS sync_synced_at
      FROM saas_promotion sp
      LEFT JOIN saas_promotion_pdv_sync spps
        ON spps.promotion_id = sp.id
      WHERE sp.id = $1
        ${companyFilterSql}
      LIMIT 1
    `,
    filterValues,
  );

  if (current.rows.length === 0) {
    return null;
  }

  await cancelPromotionPublication(mapPromotionWithIntegration(current.rows[0]));

  const result = await querySaas<PromotionRow>(
    `
      DELETE FROM saas_promotion
      WHERE id = $1
        ${companyFilterDeleteSql}
      RETURNING
        id,
        company_id,
        name,
        voucher_code,
        status,
        payload,
        created_at,
        updated_at,
        NULL::text AS authorization_id,
        NULL::text AS sync_state,
        NULL::text AS sync_error,
        NULL::timestamptz AS sync_synced_at
    `,
    filterValues,
  );

  if (result.rows.length === 0) {
    return null;
  }

  const deleted = mapPromotionWithIntegration(result.rows[0]);
  const companyId = current.rows[0]?.company_id ?? options.companyId ?? null;
  if (companyId) {
    await bumpCompanyPromotionCursor(companyId);
  }

  return deleted;
}
