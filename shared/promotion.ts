export const PROMOTION_STATUS_VALUES = ["ativa", "agendada", "pausada", "encerrada"] as const;
export const PROMOTION_DISCOUNT_TYPE_VALUES = ["fixed", "percent"] as const;
export const PROMOTION_PRODUCT_MODE_VALUES = ["group", "individual"] as const;
export const PROMOTION_AUDIENCE_MODE_VALUES = ["all", "group", "individual", "firstPurchase"] as const;
export const PROMOTION_PAYMENT_MODE_VALUES = ["all", "selected"] as const;
export const PROMOTION_WEEKDAY_VALUES = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export const PROMOTION_PDV_SYNC_STATE_VALUES = ["pending", "published", "cancelled", "error"] as const;

export type PromotionStatus = (typeof PROMOTION_STATUS_VALUES)[number];
export type PromotionDiscountType = (typeof PROMOTION_DISCOUNT_TYPE_VALUES)[number];
export type PromotionProductMode = (typeof PROMOTION_PRODUCT_MODE_VALUES)[number];
export type PromotionAudienceMode = (typeof PROMOTION_AUDIENCE_MODE_VALUES)[number];
export type PromotionPaymentMode = (typeof PROMOTION_PAYMENT_MODE_VALUES)[number];
export type PromotionWeekday = (typeof PROMOTION_WEEKDAY_VALUES)[number];
export type PromotionPdvSyncState = (typeof PROMOTION_PDV_SYNC_STATE_VALUES)[number];

export interface PromotionPdvIntegration {
  state: PromotionPdvSyncState;
  authorizationId: string | null;
  syncedAt: string | null;
  error: string | null;
}

export interface CreatePromotionInput {
  name: string;
  voucherCode: string;
  description: string;
  discountType: PromotionDiscountType;
  discountValue: string;
  productMode: PromotionProductMode;
  selectedProductCodes: string[];
  selectedProductGroupCodes: string[];
  audienceMode: PromotionAudienceMode;
  newCustomerFirstPurchaseOnly: boolean;
  newCustomerDays: string;
  selectedCustomerCodes: string[];
  selectedCustomerGroupCodes: string[];
  selectedBranchIds: string[];
  paymentMode: PromotionPaymentMode;
  selectedPaymentFormCodes: string[];
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  activeWeekdays: PromotionWeekday[];
  birthdayOnly: boolean;
  maxDiscountPerDay: string;
  maxVolumePerDay: string;
  maxQuantityPerItem: string;
  redemptionsPerCustomer: string;
  maxPurchasesPerWeek: string;
  maxPurchasesPerMonth: string;
  couponValidityMinutes: string;
  status: PromotionStatus;
}

export interface Promotion extends CreatePromotionInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  integration: PromotionPdvIntegration | null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPositiveNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const normalized = Number(value.replace(",", "."));
  return Number.isFinite(normalized) ? normalized : Number.NaN;
}

function cleanList(values?: unknown[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => asText(value).trim())
        .filter(Boolean),
    ),
  );
}

export function normalizePromotionInput(input?: Partial<CreatePromotionInput> | null): CreatePromotionInput {
  const status = PROMOTION_STATUS_VALUES.includes(input?.status as PromotionStatus) ? input!.status! : "ativa";
  const discountType = PROMOTION_DISCOUNT_TYPE_VALUES.includes(input?.discountType as PromotionDiscountType)
    ? input!.discountType!
    : "fixed";
  const productMode = PROMOTION_PRODUCT_MODE_VALUES.includes(input?.productMode as PromotionProductMode)
    ? input!.productMode!
    : "individual";
  const audienceMode = PROMOTION_AUDIENCE_MODE_VALUES.includes(input?.audienceMode as PromotionAudienceMode)
    ? input!.audienceMode!
    : "individual";
  const paymentMode = PROMOTION_PAYMENT_MODE_VALUES.includes(input?.paymentMode as PromotionPaymentMode)
    ? input!.paymentMode!
    : "all";

  return {
    name: asText(input?.name).trim(),
    voucherCode: asText(input?.voucherCode).trim().toUpperCase(),
    description: asText(input?.description).trim(),
    discountType,
    discountValue: asText(input?.discountValue).trim(),
    productMode,
    selectedProductCodes: cleanList(input?.selectedProductCodes),
    selectedProductGroupCodes: cleanList(input?.selectedProductGroupCodes),
    audienceMode,
    newCustomerFirstPurchaseOnly: Boolean(input?.newCustomerFirstPurchaseOnly),
    newCustomerDays: asText(input?.newCustomerDays).trim(),
    selectedCustomerCodes: cleanList(input?.selectedCustomerCodes),
    selectedCustomerGroupCodes: cleanList(input?.selectedCustomerGroupCodes),
    selectedBranchIds: cleanList(input?.selectedBranchIds),
    paymentMode,
    selectedPaymentFormCodes: cleanList(input?.selectedPaymentFormCodes),
    startDate: asText(input?.startDate).trim(),
    endDate: asText(input?.endDate).trim(),
    startTime: asText(input?.startTime).trim(),
    endTime: asText(input?.endTime).trim(),
    activeWeekdays: cleanList(input?.activeWeekdays).filter((value): value is PromotionWeekday =>
      PROMOTION_WEEKDAY_VALUES.includes(value as PromotionWeekday),
    ),
    birthdayOnly: Boolean(input?.birthdayOnly),
    maxDiscountPerDay: asText(input?.maxDiscountPerDay).trim(),
    maxVolumePerDay: asText(input?.maxVolumePerDay).trim(),
    maxQuantityPerItem: asText(input?.maxQuantityPerItem).trim(),
    redemptionsPerCustomer: asText(input?.redemptionsPerCustomer).trim(),
    maxPurchasesPerWeek: asText(input?.maxPurchasesPerWeek).trim(),
    maxPurchasesPerMonth: asText(input?.maxPurchasesPerMonth).trim(),
    couponValidityMinutes: asText(input?.couponValidityMinutes).trim(),
    status,
  };
}

export function validatePromotionInput(input?: Partial<CreatePromotionInput> | null): string[] {
  const normalized = normalizePromotionInput(input);
  const issues: string[] = [];

  if (!normalized.name) {
    issues.push("Informe o nome da campanha.");
  }

  if (!normalized.voucherCode) {
    issues.push("Informe ou gere o codigo do voucher.");
  }

  if (!normalized.discountValue) {
    issues.push("Informe o valor do desconto.");
  }

  if (normalized.productMode === "group" && normalized.selectedProductGroupCodes.length === 0) {
    issues.push("Selecione ao menos um grupo de produtos.");
  }

  if (normalized.productMode === "individual" && normalized.selectedProductCodes.length === 0) {
    issues.push("Selecione ao menos um produto alvo.");
  }

  if (normalized.audienceMode === "group" && normalized.selectedCustomerGroupCodes.length === 0) {
    issues.push("Selecione ao menos um grupo de clientes.");
  }

  if (normalized.audienceMode === "individual" && normalized.selectedCustomerCodes.length === 0) {
    issues.push("Selecione ao menos um cliente.");
  }

  if (normalized.audienceMode === "firstPurchase" && !normalized.newCustomerFirstPurchaseOnly) {
    const newCustomerDays = Number(normalized.newCustomerDays);
    if (!Number.isInteger(newCustomerDays) || newCustomerDays <= 0) {
      issues.push("Informe a quantidade de dias em que o cliente sera considerado novo.");
    }
  }

  if (normalized.paymentMode === "selected" && normalized.selectedPaymentFormCodes.length === 0) {
    issues.push("Selecione ao menos uma forma de pagamento.");
  }

  if (normalized.selectedBranchIds.length === 0) {
    issues.push("Selecione ao menos uma filial participante.");
  }

  if (!normalized.startDate) {
    issues.push("Informe a data de início da regra.");
  }

  if (!normalized.endDate) {
    issues.push("Informe a data de término da regra.");
  }

  if (normalized.startDate && normalized.endDate && normalized.startDate > normalized.endDate) {
    issues.push("A data de término deve ser maior ou igual à data de início.");
  }

  if (
    normalized.startDate &&
    normalized.endDate &&
    normalized.startDate === normalized.endDate &&
    normalized.startTime &&
    normalized.endTime &&
    normalized.startTime > normalized.endTime
  ) {
    issues.push("A hora final deve ser maior que a hora inicial.");
  }

  if (!normalized.couponValidityMinutes) {
    issues.push("Informe a validade do código em minutos.");
  }

  if (normalized.activeWeekdays.length === 0) {
    issues.push("Selecione ao menos um dia da semana.");
  }

  const maxDiscountPerDay = asPositiveNumber(normalized.maxDiscountPerDay);
  if (maxDiscountPerDay !== null && (!Number.isFinite(maxDiscountPerDay) || maxDiscountPerDay <= 0)) {
    issues.push("O limite de desconto por dia deve ser maior que zero.");
  }

  const maxVolumePerDay = asPositiveNumber(normalized.maxVolumePerDay);
  if (maxVolumePerDay !== null && (!Number.isFinite(maxVolumePerDay) || maxVolumePerDay <= 0)) {
    issues.push("O limite de volume por dia deve ser maior que zero.");
  }

  const maxQuantityPerItem = asPositiveNumber(normalized.maxQuantityPerItem);
  if (maxQuantityPerItem !== null && (!Number.isFinite(maxQuantityPerItem) || maxQuantityPerItem <= 0)) {
    issues.push("A quantidade maxima por item deve ser maior que zero.");
  }

  const redemptionsPerCustomer = asPositiveNumber(normalized.redemptionsPerCustomer);
  if (
    redemptionsPerCustomer !== null &&
    (!Number.isInteger(redemptionsPerCustomer) || redemptionsPerCustomer <= 0)
  ) {
    issues.push("O limite de resgates por cliente deve ser um numero inteiro maior que zero.");
  }

  const maxPurchasesPerWeek = asPositiveNumber(normalized.maxPurchasesPerWeek);
  if (
    maxPurchasesPerWeek !== null &&
    (!Number.isInteger(maxPurchasesPerWeek) || maxPurchasesPerWeek <= 0)
  ) {
    issues.push("O limite de compras por semana deve ser um numero inteiro maior que zero.");
  }

  const maxPurchasesPerMonth = asPositiveNumber(normalized.maxPurchasesPerMonth);
  if (
    maxPurchasesPerMonth !== null &&
    (!Number.isInteger(maxPurchasesPerMonth) || maxPurchasesPerMonth <= 0)
  ) {
    issues.push("O limite de compras por mes deve ser um numero inteiro maior que zero.");
  }

  if (!PROMOTION_STATUS_VALUES.includes(normalized.status)) {
    issues.push("Informe um status valido.");
  }

  if (!PROMOTION_DISCOUNT_TYPE_VALUES.includes(normalized.discountType)) {
    issues.push("Informe um tipo de desconto valido.");
  }

  if (!PROMOTION_PRODUCT_MODE_VALUES.includes(normalized.productMode)) {
    issues.push("Informe um modo de produto valido.");
  }

  if (!PROMOTION_AUDIENCE_MODE_VALUES.includes(normalized.audienceMode)) {
    issues.push("Informe um público valido.");
  }

  if (!PROMOTION_PAYMENT_MODE_VALUES.includes(normalized.paymentMode)) {
    issues.push("Informe um modo de pagamento valido.");
  }

  return issues;
}
