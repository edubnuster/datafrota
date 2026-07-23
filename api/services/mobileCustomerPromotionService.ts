import type {
  MobileCustomerPromotion,
  MobileCustomerPromotionVoucher,
  MobilePromotionEligibilityKind,
} from "../../shared/mobileCustomer.js";
import type { CreatePromotionInput, Promotion } from "../../shared/promotion.js";
import { ensurePromotionsSchema, querySaas } from "../db.js";
import { createDiscountCode, findPromotionIssuedVoucher } from "./discountCodeService.js";
import { buildDiscountInputFromPromotion, mapPromotionWithIntegration } from "./pdvPromotionService.js";
import { listTenantReferenceData, resolveTenantCustomerByDocument } from "./referenceSyncService.js";

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

type PromotionEligibilityMatch = {
  kind: MobilePromotionEligibilityKind;
  matchedCustomerCode: string | null;
  matchedCustomerGroupCode: string | null;
};

type PromotionReferenceMaps = {
  productNames: Record<string, string>;
  productGroupNames: Record<string, string>;
  paymentFormNames: Record<string, string>;
};

const MOBILE_PROMOTION_VOUCHER_TTL_MINUTES = 15;

function emptyPromotionReferenceMaps(): PromotionReferenceMaps {
  return {
    productNames: {},
    productGroupNames: {},
    paymentFormNames: {},
  };
}

function isBirthdayToday(birthDate?: string | null): boolean {
  const raw = String(birthDate ?? "").trim();
  if (!raw) {
    return false;
  }

  const [, monthPart, dayPart] = raw.split("-", 3);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const now = new Date();
  return now.getMonth() + 1 === month && now.getDate() === day;
}

function buildReferenceNameMap(items: Array<{ code: string; name: string; value?: string }>): Record<string, string> {
  return items.reduce<Record<string, string>>((accumulator, item) => {
    const name = String(item.name || "").trim();
    if (!name) {
      return accumulator;
    }

    accumulator[item.code] = name;
    if (item.value?.trim()) {
      accumulator[item.value.trim()] = name;
    }
    return accumulator;
  }, {});
}

async function loadPromotionReferenceMaps(companyId: string, promotions: Promotion[]): Promise<PromotionReferenceMaps> {
  const productCodes = Array.from(
    new Set(promotions.flatMap((promotion) => promotion.selectedProductCodes.map((code) => code.trim())).filter(Boolean)),
  );
  const productGroupCodes = Array.from(
    new Set(promotions.flatMap((promotion) => promotion.selectedProductGroupCodes.map((code) => code.trim())).filter(Boolean)),
  );
  const paymentFormCodes = Array.from(
    new Set(promotions.flatMap((promotion) => promotion.selectedPaymentFormCodes.map((code) => code.trim())).filter(Boolean)),
  );

  if (productCodes.length === 0 && productGroupCodes.length === 0 && paymentFormCodes.length === 0) {
    return emptyPromotionReferenceMaps();
  }

  try {
    const [products, productGroups, paymentForms] = await Promise.all([
      productCodes.length > 0 ? listTenantReferenceData(companyId, "products", "", productCodes) : Promise.resolve([]),
      productGroupCodes.length > 0
        ? listTenantReferenceData(companyId, "product-groups", "", productGroupCodes)
        : Promise.resolve([]),
      paymentFormCodes.length > 0
        ? listTenantReferenceData(companyId, "payment-forms", "", paymentFormCodes)
        : Promise.resolve([]),
    ]);

    return {
      productNames: buildReferenceNameMap(products),
      productGroupNames: buildReferenceNameMap(productGroups),
      paymentFormNames: buildReferenceNameMap(paymentForms),
    };
  } catch {
    // Mantem a listagem funcional mesmo se o snapshot de referencia ainda nao estiver acessivel.
    return emptyPromotionReferenceMaps();
  }
}

function resolvePromotionEligibility(
  promotion: Promotion,
  customerMatch: Awaited<ReturnType<typeof resolveTenantCustomerByDocument>>,
  customerBirthDate?: string | null,
): PromotionEligibilityMatch | null {
  if (promotion.birthdayOnly && !isBirthdayToday(customerBirthDate)) {
    return null;
  }

  if (promotion.audienceMode === "all") {
    return {
      kind: "all",
      matchedCustomerCode: customerMatch?.customerCode ?? null,
      matchedCustomerGroupCode: customerMatch?.customerGroupCode ?? null,
    };
  }

  if (promotion.audienceMode === "individual") {
    const customerGrid = customerMatch?.customerGrid ?? null;
    if (customerGrid && promotion.selectedCustomerCodes.includes(customerGrid)) {
      return {
        kind: "individual",
        matchedCustomerCode: customerMatch?.customerCode ?? null,
        matchedCustomerGroupCode: customerMatch?.customerGroupCode ?? null,
      };
    }

    return null;
  }

  if (promotion.audienceMode === "group") {
    const groupCandidates = Array.from(
      new Set([customerMatch?.customerGroupCode ?? null, customerMatch?.customerGroupValue ?? null].filter(Boolean)),
    );
    if (groupCandidates.some((groupCode) => promotion.selectedCustomerGroupCodes.includes(groupCode))) {
      return {
        kind: "group",
        matchedCustomerCode: customerMatch?.customerCode ?? null,
        matchedCustomerGroupCode: customerMatch?.customerGroupCode ?? null,
      };
    }

    return null;
  }

  return null;
}

function buildPromotionEndAt(promotion: Promotion): Date | null {
  const endDate = String(promotion.endDate ?? "").trim();
  if (!endDate) {
    return null;
  }

  const endTime = String(promotion.endTime ?? "").trim() || "23:59";
  const parsed = new Date(`${endDate}T${endTime.length === 5 ? `${endTime}:00` : endTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveMobileVoucherValidUntil(promotion: Promotion, issuedAt = new Date()): string {
  const validUntil = new Date(issuedAt.getTime() + MOBILE_PROMOTION_VOUCHER_TTL_MINUTES * 60 * 1000);
  const promotionEndAt = buildPromotionEndAt(promotion);

  if (promotionEndAt && promotionEndAt.getTime() < validUntil.getTime()) {
    return promotionEndAt.toISOString();
  }

  return validUntil.toISOString();
}

function mapPromotionForMobile(
  promotion: Promotion,
  eligibility: PromotionEligibilityMatch,
  voucherCode: string,
  voucherIssued: boolean,
  validUntil: string | null,
  referenceMaps: PromotionReferenceMaps,
): MobileCustomerPromotion {
  return {
    id: promotion.id,
    voucherMode: promotion.voucherMode,
    voucherCode,
    voucherIssued,
    validUntil,
    name: promotion.name,
    description: promotion.description,
    status: promotion.status === "agendada" ? "agendada" : "ativa",
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
    productMode: promotion.productMode,
    productCodes: promotion.selectedProductCodes,
    productNames: promotion.selectedProductCodes.map((code) => referenceMaps.productNames[code] || `Produto ${code}`),
    productGroupCodes: promotion.selectedProductGroupCodes,
    productGroupNames: promotion.selectedProductGroupCodes.map(
      (code) => referenceMaps.productGroupNames[code] || `Grupo ${code}`,
    ),
    paymentMode: promotion.paymentMode,
    paymentFormCodes: promotion.selectedPaymentFormCodes,
    paymentFormNames: promotion.selectedPaymentFormCodes.map(
      (code) => referenceMaps.paymentFormNames[code] || `Forma ${code}`,
    ),
    selectedBranchIds: promotion.selectedBranchIds,
    startDate: promotion.startDate,
    endDate: promotion.endDate,
    startTime: promotion.startTime,
    endTime: promotion.endTime,
    activeWeekdays: promotion.activeWeekdays,
    birthdayOnly: promotion.birthdayOnly,
    requireCustomerDocumentAtCashier: promotion.requireCustomerDocumentAtCashier,
    eligibilityKind: eligibility.kind,
    matchedCustomerCode: eligibility.matchedCustomerCode,
    matchedCustomerGroupCode: eligibility.matchedCustomerGroupCode,
    updatedAt: promotion.updatedAt,
  };
}

async function loadCompanyPromotions(companyId: string, promotionId?: string): Promise<Promotion[]> {
  await ensurePromotionsSchema();
  const params: unknown[] = [companyId];
  const promotionFilter = promotionId?.trim();
  const whereClause = promotionFilter ? "AND sp.id = $2" : "";
  if (promotionFilter) {
    params.push(promotionFilter);
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
        ${whereClause}
      ORDER BY sp.updated_at DESC, sp.created_at DESC
    `,
    params,
  );

  return result.rows.map((row) => mapPromotionWithIntegration(row));
}

async function resolveIssuedPromotionVoucher(params: {
  companyId: string;
  promotion: Promotion;
  eligibility: PromotionEligibilityMatch;
  documentNumber: string;
}): Promise<{ voucherCode: string; voucherIssued: boolean; validUntil: string | null }> {
  if (params.promotion.voucherMode === "fixed" && params.promotion.voucherCode.trim()) {
    return {
      voucherCode: params.promotion.voucherCode.trim().toUpperCase(),
      voucherIssued: true,
      validUntil: null,
    };
  }

  const existingVoucher = await findPromotionIssuedVoucher({
    companyId: params.companyId,
    promotionId: params.promotion.id,
    issuedToCustomerCode: params.eligibility.matchedCustomerCode,
    issuedDocumentNumber: params.documentNumber,
  });

  return {
    voucherCode: existingVoucher?.shortCode ?? "",
    voucherIssued: Boolean(existingVoucher),
    validUntil: existingVoucher?.validUntil ?? null,
  };
}

export async function listEligibleMobilePromotions(params: {
  companyId: string;
  documentNumber: string;
  customerBirthDate?: string | null;
}): Promise<MobileCustomerPromotion[]> {
  const customerMatch = await resolveTenantCustomerByDocument(params.companyId, params.documentNumber);
  const promotions = await loadCompanyPromotions(params.companyId);
  const referenceMaps = await loadPromotionReferenceMaps(params.companyId, promotions);

  const resolved = await Promise.all(
    promotions.map(async (promotion) => {
      const eligibility = resolvePromotionEligibility(promotion, customerMatch, params.customerBirthDate);
      if (!eligibility) {
        return null;
      }

      const voucherState = await resolveIssuedPromotionVoucher({
        companyId: params.companyId,
        promotion,
        eligibility,
        documentNumber: params.documentNumber,
      });

      return mapPromotionForMobile(
        promotion,
        eligibility,
        voucherState.voucherCode,
        voucherState.voucherIssued,
        voucherState.validUntil,
        referenceMaps,
      );
    }),
  );

  return resolved.filter((item): item is MobileCustomerPromotion => Boolean(item));
}

export class MobileCustomerPromotionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "MobileCustomerPromotionError";
  }
}

export async function issueMobilePromotionVoucher(params: {
  companyId: string;
  promotionId: string;
  documentNumber: string;
  documentType: "cpf" | "cnpj";
  customerBirthDate?: string | null;
}): Promise<MobileCustomerPromotionVoucher> {
  const promotions = await loadCompanyPromotions(params.companyId, params.promotionId);
  const promotion = promotions[0];
  if (!promotion) {
    throw new MobileCustomerPromotionError("Promocao nao encontrada para este cliente mobile.", 404);
  }

  const customerMatch = await resolveTenantCustomerByDocument(params.companyId, params.documentNumber);
  if (promotion.birthdayOnly && !isBirthdayToday(params.customerBirthDate)) {
    throw new MobileCustomerPromotionError("Promocao disponivel apenas no seu aniversario.", 403);
  }

  const eligibility = resolvePromotionEligibility(promotion, customerMatch, params.customerBirthDate);
  if (!eligibility) {
    throw new MobileCustomerPromotionError("Esta promocao nao esta liberada para o cliente autenticado.", 403);
  }

  if (promotion.voucherMode !== "mobile") {
    return {
      promotionId: promotion.id,
      voucherCode: promotion.voucherCode.trim().toUpperCase(),
      voucherOrigin: "promotion_fixed",
      issuedAt: new Date().toISOString(),
      validUntil: null,
    };
  }

  const existingVoucher = await findPromotionIssuedVoucher({
    companyId: params.companyId,
    promotionId: promotion.id,
    issuedToCustomerCode: eligibility.matchedCustomerCode,
    issuedDocumentNumber: params.documentNumber,
  });
  if (existingVoucher) {
    return {
      promotionId: promotion.id,
      voucherCode: existingVoucher.shortCode,
      voucherOrigin: "promotion_mobile",
      issuedAt: existingVoucher.createdAt,
      validUntil: existingVoucher.validUntil,
    };
  }

  const input = buildDiscountInputFromPromotion(promotion);
  const validUntil = resolveMobileVoucherValidUntil(promotion);
  const matchedCustomerCode = eligibility.matchedCustomerCode?.trim();
  const scopedInput = matchedCustomerCode
    ? {
        ...input,
        customerCodes: [matchedCustomerCode],
        customerGroupCodes: [],
        validUntil,
      }
    : {
        ...input,
        validUntil,
      };

  const createdVoucher = await createDiscountCode(
    {
      ...scopedInput,
      promotionId: promotion.id,
      promotionName: promotion.name,
      voucherOrigin: "promotion_mobile",
      issuedToCustomerCode: matchedCustomerCode ?? null,
      issuedToCustomerGroupCode: eligibility.matchedCustomerGroupCode ?? null,
      issuedDocumentType: params.documentType,
      issuedDocumentNumber: params.documentNumber,
      requireCustomerDocumentAtCashier: promotion.requireCustomerDocumentAtCashier,
    },
    {
      companyId: params.companyId,
      sourceBranchId: promotion.selectedBranchIds[0] ?? null,
    },
  );

  return {
    promotionId: promotion.id,
    voucherCode: createdVoucher.shortCode,
    voucherOrigin: "promotion_mobile",
    issuedAt: createdVoucher.createdAt,
    validUntil: createdVoucher.validUntil,
  };
}
