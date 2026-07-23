import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import type { Request } from "express";
import type {
  ActivatePdvAgentInput,
  ActivatePdvAgentResult,
  CreatePdvPairingTokenInput,
  PdvAgent,
  PdvPairingToken,
} from "../../shared/pdvAgent.js";
import type { CreatePromotionInput } from "../../shared/promotion.js";
import type { PdvPromotionItem, PdvPromotionSyncResponse } from "../../shared/pdvPromotion.js";
import { ensurePdvAgentSchema, querySaas } from "../db.js";
import { canonicalizeSyncedBranchIds, syncCompanyBranchesFromOperationalDb } from "./companyBranchSyncService.js";
import { getDiscountCodeTenantScope, resolveDiscountCode } from "./discountCodeService.js";
import { mapPromotionWithIntegration } from "./pdvPromotionService.js";
import { getCompanyPromotionCursor, syncTenantReferenceSnapshot } from "./referenceSyncService.js";
import { resolveSaasAccessContext } from "./saasAccessService.js";

const DEFAULT_PAIRING_EXPIRATION_MINUTES = 60;

// #region debug-point shared:pdv-snapshot-report
function debugReportPdvSnapshot(
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

type PdvAgentRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  station_code: string | null;
  device_name: string | null;
  device_fingerprint: string | null;
  installed_version: string | null;
  status: PdvAgent["status"];
  paired_at: string | Date;
  last_seen_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  revoked_at: string | Date | null;
};

type PdvPairingTokenRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  station_code: string | null;
  description: string | null;
  token_code: string;
  status: PdvPairingToken["status"];
  expires_at: string | Date;
  used_at: string | Date | null;
  used_by_agent_id: string | null;
  created_at: string | Date;
};

type PdvAgentAuthRow = PdvAgentRow & {
  auth_token_hash: string;
};

type PromotionWithSyncRow = {
  id: string;
  name: string;
  voucher_code: string | null;
  status: "ativa" | "agendada" | "pausada" | "encerrada";
  payload: CreatePromotionInput | string;
  created_at: string | Date;
  updated_at: string | Date;
  authorization_id: string | null;
  sync_state: "pending" | "published" | "cancelled" | "error" | null;
  sync_error: string | null;
  sync_synced_at: string | Date | null;
};

export type PdvAgentSession = {
  agentId: string;
  companyId: string;
  branchId: string | null;
  stationCode: string | null;
};

export class PdvAgentError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
  ) {
    super(message);
    this.name = "PdvAgentError";
  }
}

function normalizeText(value?: string | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function canonicalizeStationCode(value?: string | null): string | null {
  const normalized = normalizeText(value)?.toUpperCase();
  if (!normalized) {
    return null;
  }

  const [machineName] = normalized.split(".", 1);
  return machineName || null;
}

function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function mapAgentRow(row: PdvAgentRow): PdvAgent {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    stationCode: row.station_code,
    deviceName: row.device_name,
    deviceFingerprint: row.device_fingerprint,
    installedVersion: row.installed_version,
    status: row.status,
    pairedAt: new Date(row.paired_at).toISOString(),
    lastSeenAt: toIsoString(row.last_seen_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    revokedAt: toIsoString(row.revoked_at),
  };
}

function mapPairingRow(row: PdvPairingTokenRow): PdvPairingToken {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    stationCode: row.station_code,
    description: row.description,
    tokenCode: row.token_code,
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    usedAt: toIsoString(row.used_at),
    usedByAgentId: row.used_by_agent_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function createEntityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";

  for (let index = 0; index < bytes.length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

function createApiToken(): string {
  return randomBytes(32).toString("hex");
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getRequestIp(req: Request): string | null {
  const forwarded = normalizeText(req.header("x-forwarded-for"));
  if (forwarded) {
    const [firstIp] = forwarded.split(",", 1);
    return normalizeText(firstIp);
  }

  return normalizeText(req.ip);
}

function getBearerToken(req: Request): string | null {
  const rawHeader = normalizeText(req.header("authorization"));
  if (!rawHeader) {
    return null;
  }

  const [scheme, token] = rawHeader.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

async function loadAgentRow(agentId: string): Promise<PdvAgentRow | null> {
  const result = await querySaas<PdvAgentRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        status,
        paired_at,
        last_seen_at,
        created_at,
        updated_at,
        revoked_at
      FROM pdv_agent
      WHERE id = $1
      LIMIT 1
    `,
    [agentId],
  );

  return result.rows[0] ?? null;
}

async function refreshAgentBranchDiscovery(session: PdvAgentSession): Promise<PdvAgentSession> {
  const discovery = await syncCompanyBranchesFromOperationalDb({
    companyId: session.companyId,
    agentId: session.agentId,
  });

  return {
    ...session,
    branchId: discovery.localBranchId,
  };
}

async function resolveScopedCompanyAndBranch(
  branchId: string | null | undefined,
  req: Request,
): Promise<{ companyId: string; branchId: string | null }> {
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new PdvAgentError("Somente a empresa logada pode gerar codigos de ativacao para os PDVs.", 403);
  }

  const normalizedBranchId = normalizeText(branchId);
  if (!normalizedBranchId) {
    return {
      companyId: access.companyId,
      branchId: null,
    };
  }

  const resolvedBranchIds = await canonicalizeSyncedBranchIds(access.companyId, [normalizedBranchId]);
  const resolvedBranchId = resolvedBranchIds[0] ?? null;
  if (!resolvedBranchId) {
    throw new PdvAgentError("A filial informada ainda nao foi descoberta a partir do banco do cliente.", 400);
  }

  if (!access.allowedBranchIds.includes(resolvedBranchId)) {
    throw new PdvAgentError("A filial informada nao pertence a empresa logada.", 403);
  }

  return {
    companyId: access.companyId,
    branchId: resolvedBranchId,
  };
}

export async function createPdvPairingToken(
  req: Request,
  input: CreatePdvPairingTokenInput,
): Promise<PdvPairingToken> {
  await ensurePdvAgentSchema();

  const scoped = await resolveScopedCompanyAndBranch(input.branchId, req);
  const expiresInMinutes =
    input.expiresInMinutes && Number.isFinite(Number(input.expiresInMinutes))
      ? Math.max(5, Math.min(24 * 60, Number(input.expiresInMinutes)))
      : DEFAULT_PAIRING_EXPIRATION_MINUTES;
  const stationCode = canonicalizeStationCode(input.stationCode);

  const result = await querySaas<PdvPairingTokenRow>(
    `
      INSERT INTO pdv_pairing_token (
        id,
        company_id,
        branch_id,
        station_code,
        description,
        token_code,
        status,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'pending',
        NOW() + ($7::text || ' minutes')::interval
      )
      RETURNING
        id,
        company_id,
        branch_id,
        station_code,
        description,
        token_code,
        status,
        expires_at,
        used_at,
        used_by_agent_id,
        created_at
    `,
    [
      createEntityId("pdvpair"),
      scoped.companyId,
      scoped.branchId,
      stationCode,
      normalizeText(input.description),
      createPairingCode(),
      String(expiresInMinutes),
    ],
  );

  return mapPairingRow(result.rows[0]);
}

export async function listPdvAgents(req: Request): Promise<PdvAgent[]> {
  await ensurePdvAgentSchema();
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new PdvAgentError("Somente a empresa logada pode listar os PDVs vinculados.", 403);
  }

  const result = await querySaas<PdvAgentRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        status,
        paired_at,
        last_seen_at,
        created_at,
        updated_at,
        revoked_at
      FROM pdv_agent
      WHERE company_id = $1
      ORDER BY created_at DESC
    `,
    [access.companyId],
  );

  return result.rows.map(mapAgentRow);
}

export async function revokePdvAgent(req: Request, agentId: string): Promise<PdvAgent> {
  await ensurePdvAgentSchema();
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new PdvAgentError("Somente a empresa logada pode revogar PDVs vinculados.", 403);
  }

  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) {
    throw new PdvAgentError("Nao foi possivel identificar o PDV a ser revogado.", 400);
  }

  const result = await querySaas<PdvAgentRow>(
    `
      UPDATE pdv_agent
      SET
        status = 'revoked',
        revoked_at = COALESCE(revoked_at, NOW()),
        updated_at = NOW()
      WHERE id = $1
        AND company_id = $2
      RETURNING
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        status,
        paired_at,
        last_seen_at,
        created_at,
        updated_at,
        revoked_at
    `,
    [normalizedAgentId, access.companyId],
  );

  if (!result.rows[0]) {
    throw new PdvAgentError("O PDV informado nao foi encontrado para a empresa logada.", 404);
  }

  return mapAgentRow(result.rows[0]);
}

export async function listPdvPairingTokens(req: Request): Promise<PdvPairingToken[]> {
  await ensurePdvAgentSchema();
  const access = await resolveSaasAccessContext(req);
  if (access.role !== "company_admin") {
    throw new PdvAgentError("Somente a empresa logada pode listar os codigos de ativacao.", 403);
  }

  await querySaas(
    `
      UPDATE pdv_pairing_token
      SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at < NOW()
    `,
  );

  const result = await querySaas<PdvPairingTokenRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        station_code,
        description,
        token_code,
        status,
        expires_at,
        used_at,
        used_by_agent_id,
        created_at
      FROM pdv_pairing_token
      WHERE company_id = $1
      ORDER BY created_at DESC
    `,
    [access.companyId],
  );

  return result.rows.map(mapPairingRow);
}

export async function activatePdvAgent(req: Request, input: ActivatePdvAgentInput): Promise<ActivatePdvAgentResult> {
  await ensurePdvAgentSchema();

  const pairingCode = normalizeText(input.pairingCode)?.toUpperCase();
  if (!pairingCode) {
    throw new PdvAgentError("Informe o codigo de ativacao do PDV.", 400);
  }

  await querySaas(
    `
      UPDATE pdv_pairing_token
      SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at < NOW()
    `,
  );

  const pairingResult = await querySaas<PdvPairingTokenRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        station_code,
        description,
        token_code,
        status,
        expires_at,
        used_at,
        used_by_agent_id,
        created_at
      FROM pdv_pairing_token
      WHERE token_code = $1
      LIMIT 1
    `,
    [pairingCode],
  );

  const pairing = pairingResult.rows[0];
  if (!pairing) {
    throw new PdvAgentError("Codigo de ativacao invalido ou expirado.", 404);
  }

  if (pairing.status !== "pending") {
    throw new PdvAgentError("Este codigo de ativacao nao pode mais ser utilizado.", 409);
  }

  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    await querySaas(
      `
        UPDATE pdv_pairing_token
        SET status = 'expired'
        WHERE id = $1
      `,
      [pairing.id],
    );
    throw new PdvAgentError("Este codigo de ativacao expirou. Gere um novo no painel da filial.", 409);
  }

  const plainToken = createApiToken();
  const tokenHash = hashSecret(plainToken);
  const stationCode = pairing.station_code ?? canonicalizeStationCode(input.stationCode);

  const insertedAgent = await querySaas<PdvAgentRow>(
    `
      INSERT INTO pdv_agent (
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        auth_token_hash,
        status,
        paired_at,
        last_seen_at,
        last_seen_ip,
        last_seen_user_agent,
        created_at,
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
        $8,
        'active',
        NOW(),
        NOW(),
        $9,
        $10,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        status,
        paired_at,
        last_seen_at,
        created_at,
        updated_at,
        revoked_at
    `,
    [
      createEntityId("pdvagt"),
      pairing.company_id,
      pairing.branch_id,
      stationCode,
      normalizeText(input.deviceName),
      normalizeText(input.deviceFingerprint),
      normalizeText(input.installedVersion),
      tokenHash,
      getRequestIp(req),
      normalizeText(req.header("user-agent")),
    ],
  );

  await querySaas(
    `
      UPDATE pdv_pairing_token
      SET
        status = 'used',
        used_at = NOW(),
        used_by_agent_id = $2
      WHERE id = $1
    `,
    [pairing.id, insertedAgent.rows[0].id],
  );

  await syncCompanyBranchesFromOperationalDb({
    companyId: pairing.company_id,
    agentId: insertedAgent.rows[0].id,
  });

  const refreshedAgent = await loadAgentRow(insertedAgent.rows[0].id);
  if (!refreshedAgent) {
    throw new PdvAgentError("O PDV foi ativado, mas nao foi possivel recarregar o vinculo local.", 500);
  }

  return {
    agent: mapAgentRow(refreshedAgent),
    apiToken: plainToken,
  };
}

export async function requirePdvAgentSession(req: Request): Promise<PdvAgentSession> {
  await ensurePdvAgentSchema();

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    throw new PdvAgentError("O PDV nao foi autenticado. Ative este terminal antes de continuar.", 401);
  }

  const tokenHash = hashSecret(bearerToken);
  const result = await querySaas<PdvAgentAuthRow>(
    `
      SELECT
        id,
        company_id,
        branch_id,
        station_code,
        device_name,
        device_fingerprint,
        installed_version,
        auth_token_hash,
        status,
        paired_at,
        last_seen_at,
        created_at,
        updated_at,
        revoked_at
      FROM pdv_agent
      WHERE auth_token_hash = $1
        AND status = 'active'
      LIMIT 1
    `,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) {
    throw new PdvAgentError("A credencial deste PDV nao e valida ou foi revogada.", 401);
  }

  await querySaas(
    `
      UPDATE pdv_agent
      SET
        last_seen_at = NOW(),
        last_seen_ip = $2,
        last_seen_user_agent = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [row.id, getRequestIp(req), normalizeText(req.header("user-agent"))],
  );

  return {
    agentId: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    stationCode: row.station_code,
  };
}

export async function getPdvAgentBySession(session: PdvAgentSession): Promise<PdvAgent | null> {
  await ensurePdvAgentSchema();
  const refreshedSession = await refreshAgentBranchDiscovery(session);
  const row = await loadAgentRow(refreshedSession.agentId);
  return row ? mapAgentRow(row) : null;
}

function isPromotionVisibleForBranch(payload: CreatePromotionInput, branchId: string | null): boolean {
  if (!branchId) {
    return false;
  }

  if (payload.selectedBranchIds.length === 0) {
    return true;
  }

  return payload.selectedBranchIds.includes(branchId);
}

export async function listPdvPromotionsForAgent(
  session: PdvAgentSession,
  currentCursor?: number | null,
): Promise<PdvPromotionSyncResponse> {
  await ensurePdvAgentSchema();
  // #region debug-point B:list-pdv-promotions-entry
  debugReportPdvSnapshot("B", "pdvAgentService.ts:681", "[DEBUG] Entrada em listPdvPromotionsForAgent", {
    agentId: session.agentId,
    companyId: session.companyId,
    branchId: session.branchId,
    currentCursor: currentCursor ?? null,
  });
  // #endregion
  const refreshedSession = await refreshAgentBranchDiscovery(session);
  // #region debug-point B:list-pdv-promotions-session
  debugReportPdvSnapshot("B", "pdvAgentService.ts:683", "[DEBUG] Sessao do agente apos refresh", {
    agentId: refreshedSession.agentId,
    companyId: refreshedSession.companyId,
    branchId: refreshedSession.branchId,
    stationCode: refreshedSession.stationCode,
  });
  // #endregion
  await syncTenantReferenceSnapshot({
    companyId: refreshedSession.companyId,
    agentId: refreshedSession.agentId,
  });
  const promotionCursor = await getCompanyPromotionCursor(refreshedSession.companyId);
  // #region debug-point B:list-pdv-promotions-after-sync
  debugReportPdvSnapshot("B", "pdvAgentService.ts:688", "[DEBUG] Cursor de promocao lido apos sync do tenant", {
    companyId: refreshedSession.companyId,
    promotionCursor,
    currentCursor: currentCursor ?? null,
  });
  // #endregion

  if (currentCursor && currentCursor === promotionCursor) {
    return {
      serverTime: new Date().toISOString(),
      promotionCursor,
      unchanged: true,
      itemCount: 0,
      items: [],
    };
  }

  const result = await querySaas<PromotionWithSyncRow>(
    `
      SELECT
        sp.id,
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
      WHERE sp.company_id = $1
        AND sp.status IN ('ativa', 'agendada')
      ORDER BY sp.updated_at DESC, sp.created_at DESC
    `,
    [refreshedSession.companyId],
  );

  const items: PdvPromotionItem[] = result.rows
    .map((row) => mapPromotionWithIntegration(row))
    .filter((promotion) => isPromotionVisibleForBranch(promotion, refreshedSession.branchId))
    .map((promotion) => ({
      promotionId: promotion.id,
      name: promotion.name,
      voucherMode: promotion.voucherMode,
      voucherCode: promotion.voucherCode,
      status: promotion.status,
      description: promotion.description,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      productMode: promotion.productMode,
      productCodes: promotion.selectedProductCodes,
      productGroupCodes: promotion.selectedProductGroupCodes,
      audienceMode: promotion.audienceMode,
      customerCodes: promotion.selectedCustomerCodes,
      customerGroupCodes: promotion.selectedCustomerGroupCodes,
      firstPurchaseOnly: promotion.newCustomerFirstPurchaseOnly,
      newCustomerDays: promotion.newCustomerDays,
      selectedBranchIds: promotion.selectedBranchIds,
      paymentMode: promotion.paymentMode,
      paymentFormCodes: promotion.selectedPaymentFormCodes,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      startTime: promotion.startTime,
      endTime: promotion.endTime,
      activeWeekdays: promotion.activeWeekdays,
      birthdayOnly: promotion.birthdayOnly,
      maxDiscountPerDay: promotion.maxDiscountPerDay,
      maxVolumePerDay: promotion.maxVolumePerDay,
      maxQuantityPerItem: promotion.maxQuantityPerItem,
      redemptionsPerCustomer: promotion.redemptionsPerCustomer,
      maxPurchasesPerWeek: promotion.maxPurchasesPerWeek,
      maxPurchasesPerMonth: promotion.maxPurchasesPerMonth,
      couponValidityMinutes: promotion.couponValidityMinutes,
      updatedAt: promotion.updatedAt,
      integration: promotion.integration,
    }));

  return {
    serverTime: new Date().toISOString(),
    promotionCursor,
    itemCount: items.length,
    items,
  };
}

export async function assertAgentVoucherAccess(session: PdvAgentSession, shortCode: string): Promise<void> {
  await ensurePdvAgentSchema();
  const refreshedSession = await refreshAgentBranchDiscovery(session);

  const code = normalizeText(shortCode)?.toUpperCase();
  if (!code) {
    throw new PdvAgentError("Informe o voucher do app frota.", 400);
  }

  if (!refreshedSession.branchId) {
    throw new PdvAgentError(
      "Este PDV ainda nao identificou a filial local no banco do cliente. Conclua a descoberta inicial antes de usar vouchers.",
      409,
    );
  }

  const result = await querySaas<{ company_id: string; payload: CreatePromotionInput | string }>(
    `
      SELECT company_id, payload
      FROM saas_promotion
      WHERE voucher_code = $1
      LIMIT 1
    `,
    [code],
  );

  const row = result.rows[0];
  if (row) {
    if (row.company_id !== refreshedSession.companyId) {
      throw new PdvAgentError("Este voucher nao pertence a empresa vinculada a este PDV.", 403);
    }

    const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as CreatePromotionInput) : row.payload;
    if (!isPromotionVisibleForBranch(payload, refreshedSession.branchId)) {
      throw new PdvAgentError("Este voucher nao esta liberado para a filial vinculada a este PDV.", 403);
    }
    return;
  }

  const tenantScope = await getDiscountCodeTenantScope(code);
  if (!tenantScope) {
    throw new PdvAgentError("Voucher nao encontrado para a empresa deste PDV.", 404);
  }

  if (tenantScope.companyId && tenantScope.companyId !== refreshedSession.companyId) {
    throw new PdvAgentError("Este voucher nao pertence a empresa vinculada a este PDV.", 403);
  }

  const resolved = await resolveDiscountCode(code);
  const branchIds = resolved.authorization?.selectedBranchIds ?? [];
  if (branchIds.length > 0 && !branchIds.includes(refreshedSession.branchId)) {
    throw new PdvAgentError("Este voucher nao esta liberado para a filial vinculada a este PDV.", 403);
  }
}
