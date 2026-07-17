export const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DISCOUNT_WEEKDAY_VALUES = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export type DiscountScope = "ALL_PRODUCTS" | "PRODUCT" | "PRODUCT_GROUP";
export type DiscountStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";
export type DiscountWeekday = (typeof DISCOUNT_WEEKDAY_VALUES)[number];

export type CreateDiscountCodeInput = {
  productCodes?: string[] | null;
  productGroupCodes?: string[] | null;
  customerCodes?: string[] | null;
  customerGroupCodes?: string[] | null;
  firstPurchaseOnly?: boolean | null;
  newCustomerDays?: number | null;
  selectedBranchIds?: string[] | null;
  paymentFormCodes?: string[] | null;
  activeWeekdays?: DiscountWeekday[] | null;
  startTime?: string | null;
  endTime?: string | null;
  birthdayOnly?: boolean | null;
  maxDiscountPerDay?: number | null;
  maxVolumePerDay?: number | null;
  maxQuantityPerItem?: number | null;
  redemptionsPerCustomer?: number | null;
  maxPurchasesPerWeek?: number | null;
  maxPurchasesPerMonth?: number | null;
  reusable?: boolean | null;
  discountPercent: number;
  validFrom?: string | null;
  validUntil?: string | null;
};

export type DiscountAuthorization = {
  id: string;
  shortCode: string;
  scope: DiscountScope;
  productCodes: string[];
  productGroupCodes: string[];
  customerCodes: string[];
  customerGroupCodes: string[];
  firstPurchaseOnly: boolean;
  newCustomerDays: number | null;
  selectedBranchIds: string[];
  paymentFormCodes: string[];
  activeWeekdays: DiscountWeekday[];
  startTime: string | null;
  endTime: string | null;
  birthdayOnly: boolean;
  maxDiscountPerDay: number | null;
  maxVolumePerDay: number | null;
  maxQuantityPerItem: number | null;
  redemptionsPerCustomer: number | null;
  maxPurchasesPerWeek: number | null;
  maxPurchasesPerMonth: number | null;
  reusable: boolean;
  discountPercent: number;
  validFrom: string | null;
  validUntil: string | null;
  status: DiscountStatus;
  createdAt: string;
  cancelledAt: string | null;
};

export type ResolveDiscountCodeResponse = {
  found: boolean;
  authorization?: DiscountAuthorization;
  reason?: "NOT_FOUND" | "EXPIRED" | "CANCELLED" | "INVALID_CONTEXT";
};

export function cleanOptional(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

export function cleanOptionalList(values?: string[] | null): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => cleanOptional(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function cleanWeekdayList(values?: string[] | null): DiscountWeekday[] {
  if (!values || values.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is DiscountWeekday => DISCOUNT_WEEKDAY_VALUES.includes(value as DiscountWeekday)),
    ),
  );
}

function normalizeOptionalNumber(value?: number | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  return Number.NaN;
}

function normalizeOptionalTime(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildDiscountScope(input: CreateDiscountCodeInput): DiscountScope {
  if (cleanOptionalList(input.productCodes).length > 0) {
    return "PRODUCT";
  }

  if (cleanOptionalList(input.productGroupCodes).length > 0) {
    return "PRODUCT_GROUP";
  }

  return "ALL_PRODUCTS";
}

export function normalizeCreateDiscountInput(input: CreateDiscountCodeInput): CreateDiscountCodeInput {
  const firstPurchaseOnly = Boolean(input.firstPurchaseOnly);
  const rawNewCustomerDays =
    input.newCustomerDays === undefined || input.newCustomerDays === null
      ? null
      : Number(input.newCustomerDays);

  return {
    productCodes: cleanOptionalList(input.productCodes),
    productGroupCodes: cleanOptionalList(input.productGroupCodes),
    customerCodes: cleanOptionalList(input.customerCodes),
    customerGroupCodes: cleanOptionalList(input.customerGroupCodes),
    firstPurchaseOnly,
    newCustomerDays: firstPurchaseOnly ? null : rawNewCustomerDays,
    selectedBranchIds: cleanOptionalList(input.selectedBranchIds),
    paymentFormCodes: cleanOptionalList(input.paymentFormCodes),
    activeWeekdays: cleanWeekdayList(input.activeWeekdays),
    startTime: normalizeOptionalTime(input.startTime),
    endTime: normalizeOptionalTime(input.endTime),
    birthdayOnly: Boolean(input.birthdayOnly),
    maxDiscountPerDay: normalizeOptionalNumber(input.maxDiscountPerDay),
    maxVolumePerDay: normalizeOptionalNumber(input.maxVolumePerDay),
    maxQuantityPerItem: normalizeOptionalNumber(input.maxQuantityPerItem),
    redemptionsPerCustomer: normalizeOptionalNumber(input.redemptionsPerCustomer),
    maxPurchasesPerWeek: normalizeOptionalNumber(input.maxPurchasesPerWeek),
    maxPurchasesPerMonth: normalizeOptionalNumber(input.maxPurchasesPerMonth),
    reusable: Boolean(input.reusable),
    discountPercent: Number(input.discountPercent),
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
  };
}

export function validateCreateDiscountInput(input: CreateDiscountCodeInput): string[] {
  const errors: string[] = [];
  const normalized = normalizeCreateDiscountInput(input);

  if (!Number.isFinite(normalized.discountPercent) || normalized.discountPercent <= 0) {
    errors.push("Informe um percentual de desconto maior que zero.");
  }

  if (normalized.discountPercent > 100) {
    errors.push("O percentual de desconto nao pode ser maior que 100.");
  }

  if (
    (normalized.productCodes?.length ?? 0) > 0 &&
    (normalized.productGroupCodes?.length ?? 0) > 0
  ) {
    errors.push("Escolha produto ou grupo de produto, nao os dois ao mesmo tempo.");
  }

  if (
    (normalized.customerCodes?.length ?? 0) > 0 &&
    (normalized.customerGroupCodes?.length ?? 0) > 0
  ) {
    errors.push("Escolha cliente ou grupo de cliente, nao os dois ao mesmo tempo.");
  }

  if (
    normalized.firstPurchaseOnly &&
    ((normalized.customerCodes?.length ?? 0) > 0 || (normalized.customerGroupCodes?.length ?? 0) > 0)
  ) {
    errors.push("A regra de primeira compra nao pode ser combinada com clientes ou grupos especificos.");
  }

  if (
    normalized.newCustomerDays !== null &&
    (!Number.isInteger(normalized.newCustomerDays) || normalized.newCustomerDays <= 0)
  ) {
    errors.push("A regra de clientes novos em dias precisa ser um numero inteiro maior que zero.");
  }

  if (
    normalized.newCustomerDays !== null &&
    ((normalized.customerCodes?.length ?? 0) > 0 || (normalized.customerGroupCodes?.length ?? 0) > 0)
  ) {
    errors.push("A regra de clientes novos por dias nao pode ser combinada com clientes ou grupos especificos.");
  }

  if (normalized.maxDiscountPerDay !== null && (!Number.isFinite(normalized.maxDiscountPerDay) || normalized.maxDiscountPerDay <= 0)) {
    errors.push("O limite de desconto por dia deve ser maior que zero.");
  }

  if (normalized.startTime && !/^\d{2}:\d{2}$/.test(normalized.startTime)) {
    errors.push("O horario inicial informado e invalido.");
  }

  if (normalized.endTime && !/^\d{2}:\d{2}$/.test(normalized.endTime)) {
    errors.push("O horario final informado e invalido.");
  }

  if (normalized.startTime && normalized.endTime && normalized.startTime > normalized.endTime) {
    errors.push("O horario final nao pode ser menor que o horario inicial.");
  }

  if (normalized.maxVolumePerDay !== null && (!Number.isFinite(normalized.maxVolumePerDay) || normalized.maxVolumePerDay <= 0)) {
    errors.push("O limite de volume por dia deve ser maior que zero.");
  }

  if (
    normalized.maxQuantityPerItem !== null &&
    (!Number.isFinite(normalized.maxQuantityPerItem) || normalized.maxQuantityPerItem <= 0)
  ) {
    errors.push("A quantidade maxima por item deve ser maior que zero.");
  }

  if (
    normalized.redemptionsPerCustomer !== null &&
    (!Number.isInteger(normalized.redemptionsPerCustomer) || normalized.redemptionsPerCustomer <= 0)
  ) {
    errors.push("O limite de resgates por cliente deve ser um numero inteiro maior que zero.");
  }

  if (
    normalized.maxPurchasesPerWeek !== null &&
    (!Number.isInteger(normalized.maxPurchasesPerWeek) || normalized.maxPurchasesPerWeek <= 0)
  ) {
    errors.push("O limite de compras por semana deve ser um numero inteiro maior que zero.");
  }

  if (
    normalized.maxPurchasesPerMonth !== null &&
    (!Number.isInteger(normalized.maxPurchasesPerMonth) || normalized.maxPurchasesPerMonth <= 0)
  ) {
    errors.push("O limite de compras por mes deve ser um numero inteiro maior que zero.");
  }

  if (normalized.validFrom && Number.isNaN(new Date(normalized.validFrom).getTime())) {
    errors.push("A data inicial informada e invalida.");
  }

  if (normalized.validUntil && Number.isNaN(new Date(normalized.validUntil).getTime())) {
    errors.push("A data final informada e invalida.");
  }

  if (
    normalized.validFrom &&
    normalized.validUntil &&
    new Date(normalized.validUntil).getTime() < new Date(normalized.validFrom).getTime()
  ) {
    errors.push("A data final nao pode ser menor que a data inicial.");
  }

  return errors;
}

export function createShortCode(length = 8, random = Math.random): string {
  return Array.from({ length }, () => {
    const index = Math.floor(random() * SHORT_CODE_ALPHABET.length);
    return SHORT_CODE_ALPHABET[index];
  }).join("");
}

export function getEffectiveStatus(
  authorization: Pick<DiscountAuthorization, "status" | "validUntil">,
  now = new Date(),
): DiscountStatus {
  if (authorization.status === "CANCELLED") {
    return "CANCELLED";
  }

  if (authorization.validUntil && new Date(authorization.validUntil).getTime() < now.getTime()) {
    return "EXPIRED";
  }

  return "ACTIVE";
}
