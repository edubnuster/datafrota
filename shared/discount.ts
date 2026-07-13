export const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type DiscountScope = "ALL_PRODUCTS" | "PRODUCT" | "PRODUCT_GROUP";
export type DiscountStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";

export type CreateDiscountCodeInput = {
  productCodes?: string[] | null;
  productGroupCodes?: string[] | null;
  customerCodes?: string[] | null;
  customerGroupCodes?: string[] | null;
  paymentFormCodes?: string[] | null;
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
  paymentFormCodes: string[];
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
  return {
    productCodes: cleanOptionalList(input.productCodes),
    productGroupCodes: cleanOptionalList(input.productGroupCodes),
    customerCodes: cleanOptionalList(input.customerCodes),
    customerGroupCodes: cleanOptionalList(input.customerGroupCodes),
    paymentFormCodes: cleanOptionalList(input.paymentFormCodes),
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
