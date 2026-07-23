import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData.js";
import { ensureReferenceSyncSchema, query, querySaas, withSaasTransaction } from "../db.js";
import { syncCompanyBranchesFromOperationalDb } from "./companyBranchSyncService.js";

const REFERENCE_SYNC_LOCK_NAME = "reference-sync";
const REFERENCE_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const REFERENCE_SYNC_LEASE_MS = 45 * 1000;
const REFERENCE_SNAPSHOT_RETENTION = 2;
const OPERATIONAL_PESSOA_DOCUMENT_COLUMN_CANDIDATES = [
  "cnpj_cpf",
  "cpf_cnpj",
  "cpfcnpj",
  "nr_cpf_cnpj",
  "documento",
  "doc",
  "cpf",
  "cnpj",
] as const;

let operationalPessoaDocumentColumnsPromise: Promise<string[]> | null = null;
let operationalPessoaColumnsPromise: Promise<string[]> | null = null;

// #region debug-point shared:reference-sync-report
function debugReportReferenceSync(
  hypothesisId: string,
  location: string,
  msg: string,
  data: Record<string, unknown> = {},
  runId = "pre-fix",
): void {
  let debugServerUrl = "http://127.0.0.1:7777/event";
  let debugSessionId = "pdv-snapshot-sync";

  try {
    const envFile = readFileSync(".dbg/pdv-snapshot-sync.env", "utf8");
    debugServerUrl = envFile.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugServerUrl;
    debugSessionId = envFile.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || debugSessionId;
  } catch {
    // Ignora indisponibilidade do servidor de debug.
  }

  void fetch(debugServerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => undefined);
}
// #endregion

type SnapshotRow = {
  code: string;
  name: string;
  value: string | null;
};

type SnapshotCanonicalRow = {
  code: string;
  value: string | null;
};

type SnapshotPayloadRow = {
  code: string;
  name: string;
  value: string | null;
  payload: Record<string, unknown> | null;
};

type SnapshotStateRow = {
  published_version: string | number;
  sync_status: "idle" | "running" | "error";
  last_finished_at: string | Date | null;
};

type RuntimeCursorRow = {
  promotion_cursor: string | number;
};

type LockRow = {
  company_id: string;
  lease_token: string;
};

type SnapshotItem = {
  itemKey: string;
  code: string;
  name: string;
  value: string | null;
  payload: Record<string, unknown>;
};

type LegacyLabelRow = {
  grid_id: string | null;
  code: string | number | null;
  name_hex: string | null;
  document_digits?: string | null;
  data_nasc?: string | Date | null;
  grupo?: string | number | null;
  subgrupo?: string | number | null;
};

export type TenantCustomerMatch = {
  customerCode: string;
  customerGrid: string | null;
  customerName: string;
  customerGroupValue: string | null;
  customerGroupCode: string | null;
  customerSubgroupValue: string | null;
  documentNumber: string;
};

function decodeLegacyText(hexValue: string | null | undefined): string {
  if (!hexValue) {
    return "";
  }

  return Buffer.from(String(hexValue), "hex").toString("latin1").trim();
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function createLeaseToken(): string {
  return randomBytes(16).toString("hex");
}

function isSnapshotItem(item: SnapshotItem | null): item is SnapshotItem {
  return Boolean(item);
}

function getPayloadText(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  return normalizeText(payload?.[key]);
}

async function loadOperationalPessoaDocumentColumns(): Promise<string[]> {
  const columns = await loadOperationalPessoaColumns();
  if (!operationalPessoaDocumentColumnsPromise) {
    operationalPessoaDocumentColumnsPromise = Promise.resolve(
      columns.filter((column) => OPERATIONAL_PESSOA_DOCUMENT_COLUMN_CANDIDATES.includes(column as never)),
    );
  }

  return operationalPessoaDocumentColumnsPromise;
}

async function loadOperationalPessoaColumns(): Promise<string[]> {
  if (!operationalPessoaColumnsPromise) {
    operationalPessoaColumnsPromise = query<{ column_name: string }>(
      `
        SELECT LOWER(column_name) AS column_name
        FROM information_schema.columns
        WHERE table_name = 'pessoa'
        ORDER BY ordinal_position ASC
      `,
      [],
    )
      .then((result) => result.rows.map((row) => row.column_name))
      .catch((error) => {
        operationalPessoaColumnsPromise = null;
        throw error;
      });
  }

  return operationalPessoaColumnsPromise;
}

function buildOperationalCustomerDocumentExpression(columns: string[]): string {
  const available = Array.from(
    new Set(
      OPERATIONAL_PESSOA_DOCUMENT_COLUMN_CANDIDATES.filter((column) => columns.includes(column)).map((column) =>
        `CAST(${quoteIdentifier(column)} AS TEXT)`,
      ),
    ),
  );

  if (available.length === 0) {
    return "NULL::text";
  }

  return `NULLIF(REGEXP_REPLACE(COALESCE(${available.join(", ")}, ''), '[^0-9]', '', 'g'), '')`;
}

async function ensureRuntimeRow(companyId: string): Promise<void> {
  await querySaas(
    `
      INSERT INTO saas_company_runtime (company_id)
      VALUES ($1)
      ON CONFLICT (company_id) DO NOTHING
    `,
    [companyId],
  );
}

async function loadSnapshotState(companyId: string): Promise<SnapshotStateRow | null> {
  const result = await querySaas<SnapshotStateRow>(
    `
      SELECT published_version, sync_status, last_finished_at
      FROM tenant_reference_snapshot_state
      WHERE company_id = $1
      LIMIT 1
    `,
    [companyId],
  );

  return result.rows[0] ?? null;
}

async function acquireReferenceSyncLock(companyId: string, agentId: string): Promise<string | null> {
  const leaseToken = createLeaseToken();
  const result = await querySaas<LockRow>(
    `
      INSERT INTO tenant_reference_sync_lock (
        company_id,
        lock_name,
        holder_agent_id,
        lease_token,
        lease_expires_at,
        heartbeat_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        NOW() + ($5::text || ' milliseconds')::interval,
        NOW(),
        NOW()
      )
      ON CONFLICT (company_id) DO UPDATE
      SET
        lock_name = EXCLUDED.lock_name,
        holder_agent_id = EXCLUDED.holder_agent_id,
        lease_token = EXCLUDED.lease_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE tenant_reference_sync_lock.holder_agent_id = EXCLUDED.holder_agent_id
        OR tenant_reference_sync_lock.lease_expires_at < NOW()
      RETURNING company_id, lease_token
    `,
    [companyId, REFERENCE_SYNC_LOCK_NAME, agentId, leaseToken, String(REFERENCE_SYNC_LEASE_MS)],
  );

  return result.rows[0]?.lease_token ?? null;
}

async function releaseReferenceSyncLock(companyId: string, leaseToken: string): Promise<void> {
  await querySaas(
    `
      UPDATE tenant_reference_sync_lock
      SET
        holder_agent_id = NULL,
        lease_expires_at = NOW(),
        heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE company_id = $1
        AND lease_token = $2
    `,
    [companyId, leaseToken],
  );
}

async function markSnapshotRunning(companyId: string, agentId: string): Promise<void> {
  await querySaas(
    `
      INSERT INTO tenant_reference_snapshot_state (
        company_id,
        published_version,
        sync_status,
        last_started_at,
        last_finished_at,
        last_agent_id,
        last_error,
        updated_at
      )
      VALUES ($1, 0, 'running', NOW(), NULL, $2, NULL, NOW())
      ON CONFLICT (company_id) DO UPDATE
      SET
        sync_status = 'running',
        last_started_at = NOW(),
        last_agent_id = $2,
        last_error = NULL,
        updated_at = NOW()
    `,
    [companyId, agentId],
  );
}

async function markSnapshotError(companyId: string, agentId: string, errorMessage: string): Promise<void> {
  await querySaas(
    `
      INSERT INTO tenant_reference_snapshot_state (
        company_id,
        published_version,
        sync_status,
        last_started_at,
        last_finished_at,
        last_agent_id,
        last_error,
        updated_at
      )
      VALUES ($1, 0, 'error', NOW(), NOW(), $2, $3, NOW())
      ON CONFLICT (company_id) DO UPDATE
      SET
        sync_status = 'error',
        last_finished_at = NOW(),
        last_agent_id = $2,
        last_error = $3,
        updated_at = NOW()
    `,
    [companyId, agentId, errorMessage],
  );
}

async function insertSnapshotChunk(
  queryFn: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>,
  companyId: string,
  referenceType: Exclude<ReferenceDataType, "branches">,
  snapshotVersion: number,
  items: SnapshotItem[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const rowsSql: string[] = [];

  items.forEach((item, index) => {
    const base = index * 8;
    rowsSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`,
    );
    values.push(
      companyId,
      referenceType,
      snapshotVersion,
      item.itemKey,
      item.code,
      item.name,
      item.value,
      JSON.stringify({
        ...item.payload,
        code: item.code,
        name: item.name,
        value: item.value,
      }),
    );
  });

  await queryFn(
    `
      INSERT INTO tenant_reference_snapshot_item (
        company_id,
        reference_type,
        snapshot_version,
        item_key,
        code,
        name,
        value,
        payload
      )
      VALUES ${rowsSql.join(", ")}
      ON CONFLICT (company_id, reference_type, snapshot_version, item_key) DO UPDATE
      SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        value = EXCLUDED.value,
        payload = EXCLUDED.payload
    `,
    values,
  );
}

async function publishSnapshot(
  companyId: string,
  agentId: string,
  datasets: Record<Exclude<ReferenceDataType, "branches">, SnapshotItem[]>,
): Promise<number> {
  return withSaasTransaction<number>(async (queryFn) => {
    const stateResult = await queryFn<SnapshotStateRow>(
      `
        SELECT published_version, sync_status, last_finished_at
        FROM tenant_reference_snapshot_state
        WHERE company_id = $1
        FOR UPDATE
      `,
      [companyId],
    );

    const currentVersion = toNumber(stateResult.rows[0]?.published_version ?? 0);
    const nextVersion = currentVersion + 1;

    await queryFn(
      `
        DELETE FROM tenant_reference_snapshot_item
        WHERE company_id = $1
          AND snapshot_version = $2
      `,
      [companyId, nextVersion],
    );

    const datasetEntries = Object.entries(datasets) as Array<[Exclude<ReferenceDataType, "branches">, SnapshotItem[]]>;
    for (const [referenceType, items] of datasetEntries) {
      for (let offset = 0; offset < items.length; offset += 200) {
        await insertSnapshotChunk(queryFn, companyId, referenceType, nextVersion, items.slice(offset, offset + 200));
      }
    }

    await queryFn(
      `
        UPDATE tenant_reference_snapshot_state
        SET
          published_version = $2,
          sync_status = 'idle',
          last_finished_at = NOW(),
          last_agent_id = $3,
          last_error = NULL,
          updated_at = NOW()
        WHERE company_id = $1
      `,
      [companyId, nextVersion, agentId],
    );

    await queryFn(
      `
        DELETE FROM tenant_reference_snapshot_item
        WHERE company_id = $1
          AND snapshot_version < $2
      `,
      [companyId, Math.max(1, nextVersion - (REFERENCE_SNAPSHOT_RETENTION - 1))],
    );

    return nextVersion;
  });
}

async function loadProducts(): Promise<SnapshotItem[]> {
  const result = await query<LegacyLabelRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS grid_id,
        CAST(codigo AS TEXT) AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS name_hex
      FROM produto
      WHERE flag = 'A'
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows
    .map((row) => {
      const value = normalizeText(row.grid_id);
      const code = normalizeText(row.code);
      const name = decodeLegacyText(row.name_hex);
      if (!value || !code || !name) {
        return null;
      }

      return {
        itemKey: value,
        code,
        name,
        value,
        payload: {
          grid: value,
          codigo: code,
        },
      };
    })
    .filter(isSnapshotItem);
}

async function loadProductGroups(): Promise<SnapshotItem[]> {
  const result = await query<LegacyLabelRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS grid_id,
        CAST(codigo AS TEXT) AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS name_hex
      FROM grupo_produto
      WHERE flag = 'A'
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows
    .map((row) => {
      const grid = normalizeText(row.grid_id);
      const code = normalizeText(row.code);
      const name = decodeLegacyText(row.name_hex);
      if (!code || !name) {
        return null;
      }

      return {
        itemKey: grid ?? code,
        code,
        name,
        value: grid,
        payload: {
          grid,
          codigo: code,
        },
      };
    })
    .filter(isSnapshotItem);
}

async function loadCustomers(): Promise<SnapshotItem[]> {
  const pessoaColumns = await loadOperationalPessoaColumns();
  const documentExpression = buildOperationalCustomerDocumentExpression(await loadOperationalPessoaDocumentColumns());
  const dataNascExpression = pessoaColumns.includes("data_nasc") ? "data_nasc" : "NULL::timestamptz";
  const grupoExpression = pessoaColumns.includes("grupo") ? "CAST(grupo AS TEXT)" : "NULL::text";
  const subgrupoExpression = pessoaColumns.includes("subgrupo") ? "CAST(subgrupo AS TEXT)" : "NULL::text";
  const result = await query<LegacyLabelRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS grid_id,
        CAST(codigo AS TEXT) AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS name_hex,
        ${documentExpression} AS document_digits,
        ${dataNascExpression} AS data_nasc,
        ${grupoExpression} AS grupo,
        ${subgrupoExpression} AS subgrupo
      FROM pessoa
      WHERE flag = 'A'
        AND nome IS NOT NULL
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows
    .map((row) => {
      const value = normalizeText(row.grid_id);
      const code = normalizeText(row.code);
      const name = decodeLegacyText(row.name_hex);
      if (!value || !code || !name) {
        return null;
      }

      return {
        itemKey: value,
        code,
        name,
        value,
        payload: {
          grid: value,
          codigo: code,
          documentNumber: normalizeText(row.document_digits),
          dataNasc: row.data_nasc ? new Date(row.data_nasc).toISOString() : null,
          grupo: normalizeText(row.grupo),
          subgrupo: normalizeText(row.subgrupo),
        },
      };
    })
    .filter(isSnapshotItem);
}

async function loadPaymentForms(): Promise<SnapshotItem[]> {
  const result = await query<LegacyLabelRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS grid_id,
        CAST(codigo AS TEXT) AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS name_hex
      FROM forma_pgto
      WHERE flag = 'A'
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows
    .map((row) => {
      const value = normalizeText(row.grid_id);
      const code = normalizeText(row.code);
      const name = decodeLegacyText(row.name_hex);
      if (!value || !code || !name) {
        return null;
      }

      return {
        itemKey: value,
        code,
        name,
        value,
        payload: {
          grid: value,
          codigo: code,
        },
      };
    })
    .filter(isSnapshotItem);
}

async function loadCustomerGroups(): Promise<SnapshotItem[]> {
  const result = await query<LegacyLabelRow>(
    `
      SELECT
        CAST(grid AS TEXT) AS grid_id,
        CAST(codigo AS TEXT) AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS name_hex
      FROM grupo_pessoa
      WHERE flag = 'A'
      ORDER BY nome ASC, grid ASC
    `,
  );

  return result.rows
    .map((row) => {
      const grid = normalizeText(row.grid_id);
      const code = normalizeText(row.code);
      const name = decodeLegacyText(row.name_hex);
      if (!code || !name) {
        return null;
      }

      return {
        itemKey: grid ?? code,
        code,
        name,
        value: grid,
        payload: {
          grid,
          codigo: code,
        },
      };
    })
    .filter(isSnapshotItem);
}

async function loadReferenceDatasets(): Promise<Record<Exclude<ReferenceDataType, "branches">, SnapshotItem[]>> {
  const [products, productGroups, customers, paymentForms, customerGroups] = await Promise.all([
    loadProducts(),
    loadProductGroups(),
    loadCustomers(),
    loadPaymentForms(),
    loadCustomerGroups(),
  ]);

  return {
    products,
    "product-groups": productGroups,
    customers,
    "payment-forms": paymentForms,
    "customer-groups": customerGroups,
  };
}

export async function bumpCompanyPromotionCursor(companyId: string): Promise<number> {
  await ensureReferenceSyncSchema();
  await ensureRuntimeRow(companyId);

  const result = await querySaas<RuntimeCursorRow>(
    `
      UPDATE saas_company_runtime
      SET
        promotion_cursor = promotion_cursor + 1,
        promotion_cursor_updated_at = NOW()
      WHERE company_id = $1
      RETURNING promotion_cursor
    `,
    [companyId],
  );

  return toNumber(result.rows[0]?.promotion_cursor ?? 1);
}

async function bumpCompanyReferenceCursor(companyId: string): Promise<void> {
  await ensureRuntimeRow(companyId);
  await querySaas(
    `
      UPDATE saas_company_runtime
      SET
        reference_cursor = reference_cursor + 1,
        reference_cursor_updated_at = NOW()
      WHERE company_id = $1
    `,
    [companyId],
  );
}

export async function getCompanyPromotionCursor(companyId: string): Promise<number> {
  await ensureReferenceSyncSchema();
  await ensureRuntimeRow(companyId);

  const result = await querySaas<RuntimeCursorRow>(
    `
      SELECT promotion_cursor
      FROM saas_company_runtime
      WHERE company_id = $1
      LIMIT 1
    `,
    [companyId],
  );

  return toNumber(result.rows[0]?.promotion_cursor ?? 1);
}

export async function syncTenantReferenceSnapshot(params: {
  companyId: string;
  agentId: string;
}): Promise<void> {
  await ensureReferenceSyncSchema();

  const currentState = await loadSnapshotState(params.companyId);
  const publishedVersion = toNumber(currentState?.published_version ?? 0);
  const lastFinishedAt = currentState?.last_finished_at ? new Date(currentState.last_finished_at).getTime() : 0;
  // #region debug-point C:snapshot-state
  debugReportReferenceSync("C", "referenceSyncService.ts:675", "[DEBUG] Estado atual do snapshot antes da sincronizacao", {
    companyId: params.companyId,
    agentId: params.agentId,
    publishedVersion,
    syncStatus: currentState?.sync_status ?? null,
    lastFinishedAt: currentState?.last_finished_at ? new Date(currentState.last_finished_at).toISOString() : null,
  });
  // #endregion
  if (publishedVersion > 0 && Date.now() - lastFinishedAt < REFERENCE_SYNC_INTERVAL_MS) {
    // #region debug-point C:snapshot-skip-interval
    debugReportReferenceSync("C", "referenceSyncService.ts:677", "[DEBUG] Sincronizacao do snapshot ignorada pela janela minima", {
      companyId: params.companyId,
      agentId: params.agentId,
      elapsedMs: Date.now() - lastFinishedAt,
      minIntervalMs: REFERENCE_SYNC_INTERVAL_MS,
    });
    // #endregion
    return;
  }

  const leaseToken = await acquireReferenceSyncLock(params.companyId, params.agentId);
  if (!leaseToken) {
    // #region debug-point C:snapshot-lock-miss
    debugReportReferenceSync("C", "referenceSyncService.ts:682", "[DEBUG] Sincronizacao do snapshot ignorada por lock ocupado", {
      companyId: params.companyId,
      agentId: params.agentId,
    });
    // #endregion
    return;
  }

  try {
    // #region debug-point D:snapshot-start
    debugReportReferenceSync("D", "referenceSyncService.ts:686", "[DEBUG] Inicio da publicacao do snapshot do tenant", {
      companyId: params.companyId,
      agentId: params.agentId,
    });
    // #endregion
    await markSnapshotRunning(params.companyId, params.agentId);
    await syncCompanyBranchesFromOperationalDb({
      companyId: params.companyId,
      agentId: params.agentId,
    });

    const datasets = await loadReferenceDatasets();
    // #region debug-point D:snapshot-datasets
    debugReportReferenceSync("D", "referenceSyncService.ts:693", "[DEBUG] Cadastros carregados para publicar snapshot", {
      companyId: params.companyId,
      agentId: params.agentId,
      products: datasets.products.length,
      productGroups: datasets["product-groups"].length,
      customers: datasets.customers.length,
      paymentForms: datasets["payment-forms"].length,
      customerGroups: datasets["customer-groups"].length,
    });
    // #endregion
    await publishSnapshot(params.companyId, params.agentId, datasets);
    await bumpCompanyReferenceCursor(params.companyId);
    // #region debug-point D:snapshot-success
    debugReportReferenceSync("D", "referenceSyncService.ts:695", "[DEBUG] Snapshot do tenant publicado com sucesso", {
      companyId: params.companyId,
      agentId: params.agentId,
    });
    // #endregion
  } catch (error) {
    // #region debug-point E:snapshot-error
    debugReportReferenceSync("E", "referenceSyncService.ts:697", "[DEBUG] Falha na sincronizacao do snapshot do tenant", {
      companyId: params.companyId,
      agentId: params.agentId,
      message: error instanceof Error ? error.message : "Erro desconhecido",
    });
    // #endregion
    await markSnapshotError(
      params.companyId,
      params.agentId,
      error instanceof Error ? error.message : "Falha desconhecida ao sincronizar os cadastros do tenant.",
    );
    throw error;
  } finally {
    await releaseReferenceSyncLock(params.companyId, leaseToken);
  }
}

export async function listTenantReferenceData(
  companyId: string,
  type: Exclude<ReferenceDataType, "branches">,
  search = "",
  selectedCodes: string[] = [],
): Promise<ReferenceOption[]> {
  await ensureReferenceSyncSchema();

  const normalizedSearch = search.trim();
  const normalizedSelectedCodes = Array.from(new Set(selectedCodes.map((value) => value.trim()).filter(Boolean)));
  const limit = normalizedSearch ? 50 : 100;

  const result = await querySaas<SnapshotRow>(
    `
      SELECT
        item.code,
        item.name,
        item.value
      FROM tenant_reference_snapshot_item item
      INNER JOIN tenant_reference_snapshot_state state
        ON state.company_id = item.company_id
       AND state.published_version = item.snapshot_version
      WHERE item.company_id = $1
        AND item.reference_type = $2
        AND (
          $3 = ''
          OR item.code ILIKE '%' || $3 || '%'
          OR COALESCE(item.value, '') ILIKE '%' || $3 || '%'
          OR item.name ILIKE '%' || $3 || '%'
          OR item.code = ANY($4::text[])
          OR COALESCE(item.value, '') = ANY($4::text[])
        )
      ORDER BY
        CASE
          WHEN item.code = ANY($4::text[]) OR COALESCE(item.value, '') = ANY($4::text[]) THEN 0
          ELSE 1
        END,
        item.name ASC,
        item.code ASC
      LIMIT ($5 + COALESCE(array_length($4::text[], 1), 0))
    `,
    [companyId, type, normalizedSearch, normalizedSelectedCodes, limit],
  );

  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    value: row.value ?? undefined,
  }));
}

export async function canonicalizeTenantReferenceValues(
  companyId: string,
  type: Exclude<ReferenceDataType, "branches" | "product-groups" | "customer-groups">,
  rawValues: string[],
): Promise<string[]> {
  await ensureReferenceSyncSchema();

  const normalizedValues = Array.from(new Set(rawValues.map((value) => value.trim()).filter(Boolean)));
  if (normalizedValues.length === 0) {
    return [];
  }

  const result = await querySaas<SnapshotCanonicalRow>(
    `
      SELECT
        item.code,
        item.value
      FROM tenant_reference_snapshot_item item
      INNER JOIN tenant_reference_snapshot_state state
        ON state.company_id = item.company_id
       AND state.published_version = item.snapshot_version
      WHERE item.company_id = $1
        AND item.reference_type = $2
        AND (
          item.code = ANY($3::text[])
          OR COALESCE(item.value, '') = ANY($3::text[])
        )
    `,
    [companyId, type, normalizedValues],
  );

  const rows = result.rows;
  return normalizedValues.map((rawValue) => {
    const directValueMatch = rows.find((row) => normalizeText(row.value) === rawValue);
    if (directValueMatch) {
      return rawValue;
    }

    const codeMatch = rows.find((row) => row.code === rawValue);
    return normalizeText(codeMatch?.value) ?? rawValue;
  });
}

export async function resolveTenantCustomerByDocument(
  companyId: string,
  documentNumber: string,
): Promise<TenantCustomerMatch | null> {
  await ensureReferenceSyncSchema();

  const normalizedDocument = normalizeText(documentNumber);
  if (!normalizedDocument) {
    return null;
  }

  const customerResult = await querySaas<SnapshotPayloadRow>(
    `
      SELECT
        item.code,
        item.name,
        item.value,
        item.payload
      FROM tenant_reference_snapshot_item item
      INNER JOIN tenant_reference_snapshot_state state
        ON state.company_id = item.company_id
       AND state.published_version = item.snapshot_version
      WHERE item.company_id = $1
        AND item.reference_type = 'customers'
        AND item.payload ->> 'documentNumber' = $2
      ORDER BY item.created_at DESC
      LIMIT 1
    `,
    [companyId, normalizedDocument],
  );

  const customer = customerResult.rows[0];
  if (!customer) {
    return null;
  }

  const rawGroupValue = getPayloadText(customer.payload, "grupo");
  let customerGroupCode: string | null = null;
  let customerGroupValue = rawGroupValue;

  if (rawGroupValue) {
    const groupResult = await querySaas<SnapshotPayloadRow>(
      `
        SELECT
          item.code,
          item.name,
          item.value,
          item.payload
        FROM tenant_reference_snapshot_item item
        INNER JOIN tenant_reference_snapshot_state state
          ON state.company_id = item.company_id
         AND state.published_version = item.snapshot_version
        WHERE item.company_id = $1
          AND item.reference_type = 'customer-groups'
          AND (
            item.code = $2
            OR COALESCE(item.value, '') = $2
          )
        ORDER BY item.created_at DESC
        LIMIT 1
      `,
      [companyId, rawGroupValue],
    );

    const group = groupResult.rows[0];
    customerGroupCode = group?.code ?? rawGroupValue;
    customerGroupValue = normalizeText(group?.value) ?? rawGroupValue;
  }

  return {
    customerCode: customer.code,
    customerGrid: normalizeText(customer.value),
    customerName: customer.name,
    customerGroupValue,
    customerGroupCode,
    customerSubgroupValue: getPayloadText(customer.payload, "subgrupo"),
    documentNumber: normalizedDocument,
  };
}
