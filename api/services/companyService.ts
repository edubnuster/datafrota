import {
  buildCompanyDomain,
  calculateMonthlyRevenue,
  normalizeCompanyInput,
  validateCompanyInput,
  type Company,
  type CreateCompanyInput,
} from "../../shared/company.js";
import { ensureCompaniesSchema, query, querySaas } from "../db.js";

type CompanyRow = {
  id: string;
  trade_name: string;
  cnpj: string;
  phone: string;
  admin_name: string;
  admin_email: string;
  temporary_password: string;
  status: Company["status"];
  plan: Company["plan"];
  activated_at: string | Date;
  expires_at: string | Date;
  created_at: string | Date;
  domain: string;
  monthly_revenue: string | number;
  branch_ids: string[] | null;
};

type ExistingCompanyConflictRow = {
  id: string;
  cnpj: string;
  admin_email: string;
  domain: string;
};

function createCompanyId(): string {
  return `company_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toDateString(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    tradeName: row.trade_name,
    cnpj: row.cnpj,
    phone: row.phone,
    adminName: row.admin_name,
    adminEmail: row.admin_email,
    temporaryPassword: row.temporary_password,
    status: row.status,
    plan: row.plan,
    activatedAt: toDateString(row.activated_at),
    expiresAt: toDateString(row.expires_at),
    createdAt: toDateString(row.created_at),
    domain: row.domain,
    monthlyRevenue: Number(row.monthly_revenue),
    selectedBranchIds: Array.from(new Set((row.branch_ids ?? []).map((value) => String(value).trim()).filter(Boolean))),
  };
}

type CanonicalBranchRow = {
  branch_id: string;
};

type CompanyCountRow = {
  total: string | number;
};

export async function canonicalizeBranchIds(rawValues: string[]): Promise<string[]> {
  if (rawValues.length === 0) {
    return [];
  }

  const normalized = Array.from(new Set(rawValues.map((value) => value.trim()).filter(Boolean)));
  const resolved = new Set<string>();

  for (const rawValue of normalized) {
    const byCode = await query<CanonicalBranchRow>(
      `
        SELECT CAST(grid AS TEXT) AS branch_id
        FROM empresa
        WHERE CAST(codigo AS TEXT) = $1
          AND flag = 'A'
        ORDER BY grid DESC
      `,
      [rawValue],
    );

    const byGrid = await query<CanonicalBranchRow>(
      `
        SELECT CAST(grid AS TEXT) AS branch_id
        FROM empresa
        WHERE CAST(grid AS TEXT) = $1
          AND flag = 'A'
        ORDER BY grid DESC
      `,
      [rawValue],
    );

    if (byGrid.rows.length > 0) {
      resolved.add(byGrid.rows[0].branch_id);
      continue;
    }

    if (byCode.rows.length > 0) {
      for (const row of byCode.rows) {
        resolved.add(row.branch_id);
      }
    }
  }

  return Array.from(resolved);
}

async function listAllActiveBranchIds(): Promise<string[]> {
  const result = await query<CanonicalBranchRow>(
    `
      SELECT DISTINCT CAST(grid AS TEXT) AS branch_id
      FROM empresa
      WHERE flag = 'A'
      ORDER BY CAST(grid AS TEXT) ASC
    `,
  );

  return result.rows.map((row) => row.branch_id);
}

async function backfillSingleCompanyBranchAssignment(): Promise<void> {
  const countResult = await querySaas<CompanyCountRow>(`
    SELECT COUNT(*) AS total
    FROM saas_company
  `);

  if (Number(countResult.rows[0]?.total ?? 0) !== 1) {
    return;
  }

  const emptyResult = await querySaas<CompanyRow>(
    `
      SELECT
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
      FROM saas_company
      WHERE COALESCE(array_length(branch_ids, 1), 0) = 0
      LIMIT 1
    `,
  );

  if (emptyResult.rows.length === 0) {
    return;
  }

  const branchIds = await listAllActiveBranchIds();
  if (branchIds.length === 0) {
    return;
  }

  await querySaas(
    `
      UPDATE saas_company
      SET branch_ids = $2::text[]
      WHERE id = $1
        AND COALESCE(array_length(branch_ids, 1), 0) = 0
    `,
    [emptyResult.rows[0].id, branchIds],
  );
}

async function backfillLegacyDatabrevBranchAssignment(): Promise<void> {
  const branchIds = await listAllActiveBranchIds();
  if (branchIds.length === 0) {
    return;
  }

  await querySaas(
    `
      UPDATE saas_company
      SET branch_ids = $2::text[]
      WHERE id = $1
        AND COALESCE(array_length(branch_ids, 1), 0) = 0
    `,
    ["company-1", branchIds],
  );
}

async function assertCompanyConflicts(
  normalized: CreateCompanyInput,
  currentCompanyId?: string,
): Promise<void> {
  const domain = buildCompanyDomain(normalized.tradeName);
  const result = await querySaas<ExistingCompanyConflictRow>(
    `
      SELECT id, cnpj, admin_email, domain
      FROM saas_company
      WHERE cnpj = $1 OR admin_email = $2 OR domain = $3
    `,
    [normalized.cnpj, normalized.adminEmail, domain],
  );

  for (const row of result.rows) {
    if (currentCompanyId && row.id === currentCompanyId) {
      continue;
    }

    if (row.cnpj === normalized.cnpj) {
      throw new CompanyValidationError(["Ja existe uma empresa cadastrada com este CNPJ."]);
    }

    if (row.admin_email === normalized.adminEmail) {
      throw new CompanyValidationError(["Ja existe uma empresa cadastrada com este e-mail de admin."]);
    }

    if (row.domain === domain) {
      throw new CompanyValidationError(["O dominio gerado para esta empresa ja esta em uso."]);
    }
  }
}

export class CompanyValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "Erro de validacao");
    this.name = "CompanyValidationError";
  }
}

export async function listCompanies(): Promise<Company[]> {
  await ensureCompaniesSchema();
  const result = await querySaas<CompanyRow>(
    `
      SELECT
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
      FROM saas_company
      ORDER BY created_at DESC, trade_name ASC
    `,
  );

  return result.rows.map(mapCompanyRow);
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const issues = validateCompanyInput(input);
  if (issues.length > 0) {
    throw new CompanyValidationError(issues);
  }

  await ensureCompaniesSchema();
  const normalized = normalizeCompanyInput(input);
  const canonicalBranchIds = await canonicalizeBranchIds(normalized.selectedBranchIds);
  const normalizedWithBranches: CreateCompanyInput = {
    ...normalized,
    selectedBranchIds: canonicalBranchIds,
  };
  const normalizedIssues = validateCompanyInput(normalizedWithBranches);
  if (normalizedIssues.length > 0) {
    throw new CompanyValidationError(normalizedIssues);
  }
  await assertCompanyConflicts(normalizedWithBranches);

  const company: Company = {
    id: createCompanyId(),
    ...normalizedWithBranches,
    createdAt: new Date().toISOString().slice(0, 10),
    domain: buildCompanyDomain(normalizedWithBranches.tradeName),
    monthlyRevenue: calculateMonthlyRevenue(normalizedWithBranches.plan),
  };

  const result = await querySaas<CompanyRow>(
    `
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
        monthly_revenue,
        branch_ids
      )
      VALUES (
        $1, $2, $3, $4, '', '', '', '', '', '', '', '', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text[]
      )
      RETURNING
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
    `,
    [
      company.id,
      company.tradeName,
      company.cnpj,
      company.phone,
      company.adminName,
      company.adminEmail,
      company.temporaryPassword,
      company.status,
      company.plan,
      company.activatedAt,
      company.expiresAt,
      company.createdAt,
      company.domain,
      company.monthlyRevenue,
      company.selectedBranchIds,
    ],
  );

  return mapCompanyRow(result.rows[0]);
}

export async function updateCompany(companyId: string, input: CreateCompanyInput): Promise<Company | null> {
  const issues = validateCompanyInput(input);
  if (issues.length > 0) {
    throw new CompanyValidationError(issues);
  }

  await ensureCompaniesSchema();
  const normalized = normalizeCompanyInput(input);
  const canonicalBranchIds = await canonicalizeBranchIds(normalized.selectedBranchIds);
  const normalizedWithBranches: CreateCompanyInput = {
    ...normalized,
    selectedBranchIds: canonicalBranchIds,
  };
  const normalizedIssues = validateCompanyInput(normalizedWithBranches);
  if (normalizedIssues.length > 0) {
    throw new CompanyValidationError(normalizedIssues);
  }
  await assertCompanyConflicts(normalizedWithBranches, companyId);

  const result = await querySaas<CompanyRow>(
    `
      UPDATE saas_company
      SET
        trade_name = $2,
        cnpj = $3,
        phone = $4,
        zip_code = '',
        street = '',
        district = '',
        city = '',
        state = '',
        address_number = '',
        address_complement = '',
        address = '',
        admin_name = $5,
        admin_email = $6,
        temporary_password = $7,
        status = $8,
        plan = $9,
        activated_at = $10,
        expires_at = $11,
        domain = $12,
        monthly_revenue = $13,
        branch_ids = $14::text[]
      WHERE id = $1
      RETURNING
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
    `,
    [
      companyId,
      normalizedWithBranches.tradeName,
      normalizedWithBranches.cnpj,
      normalizedWithBranches.phone,
      normalizedWithBranches.adminName,
      normalizedWithBranches.adminEmail,
      normalizedWithBranches.temporaryPassword,
      normalizedWithBranches.status,
      normalizedWithBranches.plan,
      normalizedWithBranches.activatedAt,
      normalizedWithBranches.expiresAt,
      buildCompanyDomain(normalizedWithBranches.tradeName),
      calculateMonthlyRevenue(normalizedWithBranches.plan),
      normalizedWithBranches.selectedBranchIds,
    ],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapCompanyRow(result.rows[0]);
}

export async function deleteCompany(companyId: string): Promise<Company | null> {
  await ensureCompaniesSchema();

  const result = await querySaas<CompanyRow>(
    `
      DELETE FROM saas_company
      WHERE id = $1
      RETURNING
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
    `,
    [companyId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapCompanyRow(result.rows[0]);
}

export async function getCompanyById(companyId: string): Promise<Company | null> {
  await ensureCompaniesSchema();

  const result = await querySaas<CompanyRow>(
    `
      SELECT
        id,
        trade_name,
        cnpj,
        phone,
        admin_name,
        admin_email,
        temporary_password,
        status,
        plan,
        activated_at,
        expires_at,
        created_at,
        domain,
        monthly_revenue,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids
      FROM saas_company
      WHERE id = $1
      LIMIT 1
    `,
    [companyId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapCompanyRow(result.rows[0]);
}
