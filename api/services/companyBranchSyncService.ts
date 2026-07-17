import type { Request } from "express";
import type { CompanyBranch } from "../../shared/companyBranch.js";
import { ensureCompaniesSchema, query, querySaas } from "../db.js";
import { resolveSaasAccessContext } from "./saasAccessService.js";

type SyncedCompanyBranchRow = {
  id: string;
  company_id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  is_active: boolean;
  is_local_branch: boolean;
  first_discovered_at: string | Date;
  last_seen_at: string | Date;
  deactivated_at: string | Date | null;
  source_agent_id: string | null;
  updated_at: string | Date;
};

type OperationalCompanyRow = {
  branch_id: string | number | null;
  branch_code: string | number | null;
  branch_name: string | null;
  flag: string | null;
};

type LocalOperationalCompanyRow = {
  branch_id: string | number | null;
  branch_code: string | number | null;
  branch_name: string | null;
};

export type CompanyBranchDiscoveryResult = {
  localBranchId: string | null;
  activeBranchIds: string[];
};

function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function mapCompanyBranchRow(row: SyncedCompanyBranchRow): CompanyBranch {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    isActive: row.is_active,
    isLocalBranch: row.is_local_branch,
    firstDiscoveredAt: new Date(row.first_discovered_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    deactivatedAt: toIsoString(row.deactivated_at),
    sourceAgentId: row.source_agent_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function createCompanyBranchId(companyId: string, branchId: string): string {
  return `companybranch_${companyId}_${branchId}`;
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

async function loadOperationalCompanies(): Promise<OperationalCompanyRow[]> {
  const result = await query<OperationalCompanyRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS branch_id,
        CAST(codigo AS TEXT) AS branch_code,
        nome AS branch_name,
        flag
      FROM empresa
      WHERE grid IS NOT NULL
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows;
}

async function loadLocalOperationalCompany(): Promise<LocalOperationalCompanyRow | null> {
  const result = await query<LocalOperationalCompanyRow>(
    `
      SELECT
        CAST(e.grid AS TEXT) AS branch_id,
        CAST(e.codigo AS TEXT) AS branch_code,
        e.nome AS branch_name
      FROM empresa e
      WHERE e.grid IN (SELECT grid FROM empresa_local)
      ORDER BY e.grid DESC
      LIMIT 1
    `,
  );

  return result.rows[0] ?? null;
}

export async function listActiveSyncedCompanyBranchIds(companyId: string): Promise<string[]> {
  await ensureCompaniesSchema();

  const result = await querySaas<SyncedCompanyBranchRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        branch_code,
        branch_name,
        is_active,
        is_local_branch,
        first_discovered_at,
        last_seen_at,
        deactivated_at,
        source_agent_id,
        updated_at
      FROM saas_company_branch
      WHERE company_id = $1
        AND is_active = TRUE
      ORDER BY branch_name ASC, branch_id ASC
    `,
    [companyId],
  );

  return result.rows.map((row) => row.branch_id);
}

export async function canonicalizeSyncedBranchIds(companyId: string, rawValues: string[]): Promise<string[]> {
  const normalized = Array.from(new Set(rawValues.map((value) => value.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    return [];
  }

  await ensureCompaniesSchema();
  const result = await querySaas<SyncedCompanyBranchRow>(
    `
      SELECT DISTINCT
        id,
        company_id,
        branch_id,
        branch_code,
        branch_name,
        is_active,
        is_local_branch,
        first_discovered_at,
        last_seen_at,
        deactivated_at,
        source_agent_id,
        updated_at
      FROM saas_company_branch
      WHERE company_id = $1
        AND is_active = TRUE
        AND (
          branch_id = ANY($2::text[])
          OR branch_code = ANY($2::text[])
        )
      ORDER BY branch_id ASC
    `,
    [companyId, normalized],
  );

  return result.rows.map((row) => row.branch_id);
}

export async function listCompanyBranches(req: Request): Promise<CompanyBranch[]> {
  await ensureCompaniesSchema();
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new Error("Somente a empresa logada pode listar as filiais sincronizadas.");
  }

  const result = await querySaas<SyncedCompanyBranchRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        branch_code,
        branch_name,
        is_active,
        is_local_branch,
        first_discovered_at,
        last_seen_at,
        deactivated_at,
        source_agent_id,
        updated_at
      FROM saas_company_branch
      WHERE company_id = $1
      ORDER BY is_local_branch DESC, is_active DESC, branch_name ASC, branch_id ASC
    `,
    [access.companyId],
  );

  return result.rows.map(mapCompanyBranchRow);
}

export async function resyncCompanyBranches(req: Request): Promise<CompanyBranch[]> {
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new Error("Somente a empresa logada pode ressincronizar as filiais da rede.");
  }

  await syncCompanyBranchesFromOperationalDb({
    companyId: access.companyId,
    agentId: null,
  });

  return listCompanyBranches(req);
}

export async function syncCompanyBranchesFromOperationalDb(params: {
  companyId: string;
  agentId?: string | null;
}): Promise<CompanyBranchDiscoveryResult> {
  await ensureCompaniesSchema();

  const [operationalCompanies, localCompany] = await Promise.all([
    loadOperationalCompanies(),
    loadLocalOperationalCompany(),
  ]);

  const localBranchId = normalizeText(localCompany?.branch_id);
  const activeBranchIds = Array.from(
    new Set(
      operationalCompanies
        .filter((row) => String(row.flag ?? "").trim().toUpperCase() === "A")
        .map((row) => normalizeText(row.branch_id))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const discoveredBranchIds = Array.from(
    new Set(
      operationalCompanies
        .map((row) => normalizeText(row.branch_id))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  for (const row of operationalCompanies) {
    const branchId = normalizeText(row.branch_id);
    const branchCode = normalizeText(row.branch_code);
    const branchName = normalizeText(row.branch_name);
    if (!branchId || !branchCode || !branchName) {
      continue;
    }

    const isActive = String(row.flag ?? "").trim().toUpperCase() === "A";
    const isLocalBranch = localBranchId === branchId;

    await querySaas(
      `
        INSERT INTO saas_company_branch (
          id,
          company_id,
          branch_id,
          branch_code,
          branch_name,
          is_active,
          is_local_branch,
          first_discovered_at,
          last_seen_at,
          deactivated_at,
          source_agent_id,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW(),
          NOW(),
          CASE WHEN $6 THEN NULL ELSE NOW() END,
          $8,
          NOW()
        )
        ON CONFLICT (company_id, branch_id) DO UPDATE
        SET
          branch_code = EXCLUDED.branch_code,
          branch_name = EXCLUDED.branch_name,
          is_active = EXCLUDED.is_active,
          is_local_branch = EXCLUDED.is_local_branch,
          last_seen_at = NOW(),
          deactivated_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE NOW() END,
          source_agent_id = EXCLUDED.source_agent_id,
          updated_at = NOW()
      `,
      [
        createCompanyBranchId(params.companyId, branchId),
        params.companyId,
        branchId,
        branchCode,
        branchName,
        isActive,
        isLocalBranch,
        normalizeText(params.agentId),
      ],
    );
  }

  await querySaas(
    `
      UPDATE saas_company_branch
      SET
        is_active = FALSE,
        is_local_branch = FALSE,
        deactivated_at = COALESCE(deactivated_at, NOW()),
        updated_at = NOW()
      WHERE company_id = $1
        AND (
          COALESCE(array_length($2::text[], 1), 0) = 0
          OR branch_id <> ALL($2::text[])
        )
    `,
    [params.companyId, discoveredBranchIds],
  );

  await querySaas(
    `
      UPDATE saas_company
      SET branch_ids = $2::text[]
      WHERE id = $1
    `,
    [params.companyId, activeBranchIds],
  );

  if (params.agentId) {
    await querySaas(
      `
        UPDATE pdv_agent
        SET
          branch_id = $2,
          updated_at = NOW()
        WHERE id = $1
      `,
      [params.agentId, localBranchId],
    );
  }

  return {
    localBranchId,
    activeBranchIds,
  };
}
