export type DocumentType = "cpf" | "cnpj";

export interface MobileCustomerAccount {
  id: string;
  companyId: string;
  companyName: string;
  documentType: DocumentType;
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

export type MobilePromotionEligibilityKind = "all" | "individual" | "group";

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

export interface RegisterPayload {
  companyId?: string;
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  password: string;
}

export interface LoginPayload {
  companyId?: string;
  identifier: string;
  password: string;
}

export interface UpdateProfilePayload {
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
}
