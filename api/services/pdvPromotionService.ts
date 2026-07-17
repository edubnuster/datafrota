import type { CreateDiscountCodeInput } from "../../shared/discount.js";
import type { PdvPromotionItem, PdvPromotionSyncResponse } from "../../shared/pdvPromotion.js";
import {
  PROMOTION_WEEKDAY_VALUES,
  type CreatePromotionInput,
  type Promotion,
  type PromotionPdvIntegration,
  type PromotionPdvSyncState,
} from "../../shared/promotion.js";
import { ensurePromotionsSchema, querySaas } from "../db.js";
import { cancelDiscountCode, upsertDiscountCode } from "./discountCodeService.js";

type PromotionSyncRow = {
  promotion_id: string;
  authorization_id: string | null;
  state: PromotionPdvSyncState;
  error: string | null;
  synced_at: string | Date | null;
};

type PromotionCompanyScopeRow = {
  company_id: string;
};

type PromotionSyncUpdate = {
  authorizationId?: string | null;
  state: PromotionPdvSyncState;
  error?: string | null;
};

type PromotionWithSyncRow = {
  id: string;
  name: string;
  voucher_code: string;
  status: Promotion["status"];
  payload: CreatePromotionInput | string;
  created_at: string | Date;
  updated_at: string | Date;
  authorization_id: string | null;
  sync_state: PromotionPdvSyncState | null;
  sync_error: string | null;
  sync_synced_at: string | Date | null;
};

function asObjectPayload(value: PromotionWithSyncRow["payload"]): CreatePromotionInput {
  if (typeof value === "string") {
    return JSON.parse(value) as CreatePromotionInput;
  }

  return value;
}

function asIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

export function buildPromotionIntegration(row?: {
  authorization_id?: string | null;
  sync_state?: PromotionPdvSyncState | null;
  sync_error?: string | null;
  sync_synced_at?: string | Date | null;
} | null): PromotionPdvIntegration | null {
  if (!row?.sync_state) {
    return null;
  }

  return {
    state: row.sync_state,
    authorizationId: row.authorization_id ?? null,
    error: row.sync_error ?? null,
    syncedAt: asIsoString(row.sync_synced_at),
  };
}

export function mapPromotionWithIntegration(row: PromotionWithSyncRow): Promotion {
  const payload = asObjectPayload(row.payload);

  return {
    id: row.id,
    ...payload,
    name: row.name,
    voucherCode: row.voucher_code,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    integration: buildPromotionIntegration(row),
  };
}

function buildPromotionSyncIssues(promotion: Promotion): string[] {
  const issues: string[] = [];

  if (promotion.discountType !== "percent") {
    issues.push("O fluxo operacional atual do PDV aceita apenas desconto percentual.");
  }

  return issues;
}

function buildPromotionValidity(date: string, time: string, defaultTime: string): string | null {
  if (!date) {
    return null;
  }

  const resolvedTime = time || defaultTime;
  return `${date}T${resolvedTime}:00`;
}

function buildDiscountInputFromPromotion(promotion: Promotion): CreateDiscountCodeInput {
  const discountPercent = Number(promotion.discountValue);
  const parseOptionalNumber = (value: string): number | null => {
    if (!value.trim()) {
      return null;
    }

    const normalized = Number(value.replace(",", "."));
    return Number.isFinite(normalized) ? normalized : null;
  };

  return {
    productCodes: promotion.productMode === "individual" ? promotion.selectedProductCodes : [],
    productGroupCodes: promotion.productMode === "group" ? promotion.selectedProductGroupCodes : [],
    customerCodes: promotion.audienceMode === "individual" ? promotion.selectedCustomerCodes : [],
    customerGroupCodes: promotion.audienceMode === "group" ? promotion.selectedCustomerGroupCodes : [],
    firstPurchaseOnly: promotion.audienceMode === "firstPurchase" ? promotion.newCustomerFirstPurchaseOnly : false,
    newCustomerDays:
      promotion.audienceMode === "firstPurchase" && !promotion.newCustomerFirstPurchaseOnly && promotion.newCustomerDays
        ? Number(promotion.newCustomerDays)
        : null,
    selectedBranchIds: promotion.selectedBranchIds,
    paymentFormCodes: promotion.paymentMode === "selected" ? promotion.selectedPaymentFormCodes : [],
    activeWeekdays:
      promotion.activeWeekdays.length === PROMOTION_WEEKDAY_VALUES.length ? [] : promotion.activeWeekdays,
    startTime: promotion.startTime || null,
    endTime: promotion.endTime || null,
    birthdayOnly: promotion.birthdayOnly,
    maxDiscountPerDay: parseOptionalNumber(promotion.maxDiscountPerDay),
    maxVolumePerDay: parseOptionalNumber(promotion.maxVolumePerDay),
    maxQuantityPerItem: parseOptionalNumber(promotion.maxQuantityPerItem),
    redemptionsPerCustomer: parseOptionalNumber(promotion.redemptionsPerCustomer),
    maxPurchasesPerWeek: parseOptionalNumber(promotion.maxPurchasesPerWeek),
    maxPurchasesPerMonth: parseOptionalNumber(promotion.maxPurchasesPerMonth),
    reusable: true,
    discountPercent,
    validFrom: buildPromotionValidity(promotion.startDate, promotion.startTime, "00:00"),
    validUntil: buildPromotionValidity(promotion.endDate, promotion.endTime, "23:59"),
  };
}

async function savePromotionSyncState(promotionId: string, update: PromotionSyncUpdate): Promise<PromotionPdvIntegration> {
  await ensurePromotionsSchema();
  const result = await querySaas<PromotionSyncRow>(
    `
      INSERT INTO saas_promotion_pdv_sync (
        promotion_id,
        authorization_id,
        state,
        error,
        synced_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (promotion_id) DO UPDATE
      SET
        authorization_id = EXCLUDED.authorization_id,
        state = EXCLUDED.state,
        error = EXCLUDED.error,
        synced_at = EXCLUDED.synced_at,
        updated_at = NOW()
      RETURNING promotion_id, authorization_id, state, error, synced_at
    `,
    [promotionId, update.authorizationId ?? null, update.state, update.error ?? null],
  );

  return {
    state: result.rows[0].state,
    authorizationId: result.rows[0].authorization_id,
    error: result.rows[0].error,
    syncedAt: asIsoString(result.rows[0].synced_at),
  };
}

async function cancelPublishedVoucher(shortCode: string): Promise<string | null> {
  const cancelled = await cancelDiscountCode(shortCode);
  return cancelled?.id ?? null;
}

export async function syncPromotionPublication(promotion: Promotion): Promise<PromotionPdvIntegration> {
  if (promotion.status === "pausada" || promotion.status === "encerrada") {
    const authorizationId = await cancelPublishedVoucher(promotion.voucherCode);
    return savePromotionSyncState(promotion.id, {
      authorizationId,
      state: "cancelled",
      error: null,
    });
  }

  const issues = buildPromotionSyncIssues(promotion);
  if (issues.length > 0) {
    return savePromotionSyncState(promotion.id, {
      state: "error",
      error: issues.join(" "),
    });
  }

  try {
    const companyScopeResult = await querySaas<PromotionCompanyScopeRow>(
      `
        SELECT company_id
        FROM saas_promotion
        WHERE id = $1
        LIMIT 1
      `,
      [promotion.id],
    );
    const companyId = companyScopeResult.rows[0]?.company_id ?? null;
    const authorization = await upsertDiscountCode(
      promotion.voucherCode,
      buildDiscountInputFromPromotion(promotion),
      {
        companyId,
        sourceBranchId: promotion.selectedBranchIds[0] ?? null,
      },
    );
    return savePromotionSyncState(promotion.id, {
      authorizationId: authorization.id,
      state: "published",
      error: null,
    });
  } catch (error) {
    return savePromotionSyncState(promotion.id, {
      state: "error",
      error: error instanceof Error ? error.message : "Falha desconhecida ao publicar no PDV.",
    });
  }
}

export async function cancelPromotionPublication(promotion: Promotion): Promise<void> {
  await cancelPublishedVoucher(promotion.voucherCode);
}

export async function listPdvPromotionsForSync(): Promise<PdvPromotionSyncResponse> {
  await ensurePromotionsSchema();
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
      WHERE sp.status IN ('ativa', 'agendada')
      ORDER BY sp.updated_at DESC, sp.created_at DESC
    `,
  );

  const items: PdvPromotionItem[] = result.rows.map((row) => {
    const promotion = mapPromotionWithIntegration(row);

    return {
      promotionId: promotion.id,
      name: promotion.name,
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
    };
  });

  return {
    serverTime: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}
