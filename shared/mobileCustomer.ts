export const MOBILE_CUSTOMER_DOCUMENT_TYPES = ["cpf", "cnpj"] as const;

export type MobileCustomerDocumentType = (typeof MOBILE_CUSTOMER_DOCUMENT_TYPES)[number];
export type MobilePromotionEligibilityKind = "all" | "individual" | "group";

export interface MobileCustomerAccount {
  id: string;
  companyId: string;
  companyName: string;
  documentType: MobileCustomerDocumentType;
  documentNumber: string;
  fullName: string;
  phone: string;
  email: string;
  birthDate: string | null;
  status: "active" | "blocked";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateMobileCustomerInput {
  companyId?: string;
  documentType: MobileCustomerDocumentType;
  documentNumber: string;
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  password: string;
}

export interface MobileCustomerLoginInput {
  companyId?: string;
  identifier: string;
  password: string;
}

export interface MobileCustomerSession {
  customer: MobileCustomerAccount;
  accessToken: string;
  expiresAt: string;
}

export interface MobileCustomerBootstrap {
  mode: "development" | "production";
  apiBasePath: string;
  defaultCompanyId: string | null;
  defaultCompanyName: string | null;
  databaseName: string;
}

export interface MobileCustomerPromotion {
  id: string;
  voucherMode: "mobile" | "fixed";
  voucherCode: string;
  voucherIssued: boolean;
  validUntil: string | null;
  name: string;
  description: string;
  status: "ativa" | "agendada";
  discountType: "fixed" | "percent";
  discountValue: string;
  productMode: "group" | "individual";
  productCodes: string[];
  productNames: string[];
  productGroupCodes: string[];
  productGroupNames: string[];
  paymentMode: "all" | "selected";
  paymentFormCodes: string[];
  paymentFormNames: string[];
  selectedBranchIds: string[];
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  activeWeekdays: string[];
  birthdayOnly: boolean;
  requireCustomerDocumentAtCashier: boolean;
  eligibilityKind: MobilePromotionEligibilityKind;
  matchedCustomerCode: string | null;
  matchedCustomerGroupCode: string | null;
  updatedAt: string;
}

export interface MobileCustomerPromotionVoucher {
  promotionId: string;
  voucherCode: string;
  voucherOrigin: "promotion_mobile" | "promotion_fixed";
  issuedAt: string;
  validUntil: string | null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function padDatePart(value: number, size: number): string {
  const raw = String(value);
  return raw.length >= size ? raw : `${"0".repeat(size - raw.length)}${raw}`;
}

export function normalizeMobileCustomerBirthDate(value?: string | null): string {
  const raw = asText(value).trim();
  if (!raw) {
    return "";
  }

  const parts = raw.includes("/") ? raw.split("/") : raw.includes("-") ? raw.split("-") : [];
  if (parts.length !== 3) {
    return "";
  }

  const [first, second, third] = parts.map((part) => part.trim());
  const isIso = raw.includes("-");
  const day = Number(isIso ? third : first);
  const month = Number(second);
  const year = Number(isIso ? first : third);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return "";
  }

  if (year < 1900 || year > 2100) {
    return "";
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return "";
  }

  return `${padDatePart(year, 4)}-${padDatePart(month, 2)}-${padDatePart(day, 2)}`;
}

export function onlyDigits(value?: string | null): string {
  return asText(value).replace(/\D/g, "");
}

export function formatMobileCustomerDocument(
  value?: string | null,
  documentType: MobileCustomerDocumentType = "cpf",
): string {
  const digits = onlyDigits(value).slice(0, documentType === "cpf" ? 11 : 14);

  if (!digits) {
    return "";
  }

  if (documentType === "cpf") {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatMobileCustomerPhone(value?: string | null): string {
  const digits = onlyDigits(value).slice(0, 11);

  if (!digits) {
    return "";
  }

  if (digits.length <= 2) {
    return `(${digits}`;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function normalizeMobileCustomerCreateInput(
  input?: Partial<CreateMobileCustomerInput> | null,
): CreateMobileCustomerInput {
  const documentType = input?.documentType === "cnpj" ? "cnpj" : "cpf";

  return {
    companyId: asText(input?.companyId).trim() || undefined,
    documentType,
    documentNumber: formatMobileCustomerDocument(input?.documentNumber, documentType),
    fullName: asText(input?.fullName).trim(),
    phone: formatMobileCustomerPhone(input?.phone),
    email: asText(input?.email).trim().toLowerCase(),
    birthDate: normalizeMobileCustomerBirthDate(input?.birthDate),
    password: asText(input?.password),
  };
}

export function normalizeMobileCustomerLoginInput(
  input?: Partial<MobileCustomerLoginInput> | null,
): MobileCustomerLoginInput {
  return {
    companyId: asText(input?.companyId).trim() || undefined,
    identifier: asText(input?.identifier).trim().toLowerCase(),
    password: asText(input?.password),
  };
}

export function validateMobileCustomerCreateInput(
  input?: Partial<CreateMobileCustomerInput> | null,
): string[] {
  const normalized = normalizeMobileCustomerCreateInput(input);
  const issues: string[] = [];
  const documentDigits = onlyDigits(normalized.documentNumber);
  const phoneDigits = onlyDigits(normalized.phone);

  if (!MOBILE_CUSTOMER_DOCUMENT_TYPES.includes(normalized.documentType)) {
    issues.push("Informe um tipo de documento valido.");
  }

  if (!normalized.documentNumber) {
    issues.push("Informe o documento do cliente.");
  }

  if (!normalized.fullName) {
    issues.push("Informe o nome completo do cliente.");
  }

  if (!normalized.phone) {
    issues.push("Informe o telefone ou WhatsApp.");
  }

  if (!normalized.email) {
    issues.push("Informe o e-mail do cliente.");
  }

  if (!normalized.birthDate) {
    issues.push("Informe a data de nascimento.");
  }

  if (!normalized.password) {
    issues.push("Informe a senha de acesso.");
  }

  if (normalized.documentType === "cpf" && documentDigits.length !== 11) {
    issues.push("Informe um CPF valido com 11 digitos.");
  }

  if (normalized.documentType === "cnpj" && documentDigits.length !== 14) {
    issues.push("Informe um CNPJ valido com 14 digitos.");
  }

  if (normalized.phone && (phoneDigits.length < 10 || phoneDigits.length > 11)) {
    issues.push("Informe um telefone valido com DDD.");
  }

  if (normalized.birthDate) {
    const parsed = new Date(`${normalized.birthDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      issues.push("Informe uma data de nascimento valida.");
    } else if (parsed.getTime() > Date.now()) {
      issues.push("A data de nascimento nao pode ser futura.");
    }
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    issues.push("Informe um e-mail valido.");
  }

  if (normalized.password && normalized.password.trim().length < 4) {
    issues.push("A senha deve ter no minimo 4 caracteres.");
  }

  return issues;
}

export function validateMobileCustomerLoginInput(
  input?: Partial<MobileCustomerLoginInput> | null,
): string[] {
  const normalized = normalizeMobileCustomerLoginInput(input);
  const issues: string[] = [];

  if (!normalized.identifier) {
    issues.push("Informe o documento ou e-mail.");
  }

  if (!normalized.password) {
    issues.push("Informe a senha.");
  }

  return issues;
}
