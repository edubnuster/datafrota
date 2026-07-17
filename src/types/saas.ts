export type { Company, CompanyPlan, CompanyStatus, CreateCompanyInput } from "../../shared/company";
export type { CompanyBranch } from "../../shared/companyBranch";
export type {
  CreatePromotionInput,
  Promotion,
  PromotionAudienceMode,
  PromotionDiscountType,
  PromotionPdvIntegration,
  PromotionPdvSyncState,
  PromotionPaymentMode,
  PromotionProductMode,
  PromotionStatus,
  PromotionWeekday,
} from "../../shared/promotion";
export type { SaasAdminAccount, UpdateSaasAdminAccountInput } from "../../shared/adminAccount";
export type { PdvPromotionItem, PdvPromotionSyncResponse } from "../../shared/pdvPromotion";
export type {
  ActivatePdvAgentResult,
  CreatePdvPairingTokenInput,
  PdvAgent,
  PdvAgentStatus,
  PdvPairingStatus,
  PdvPairingToken,
} from "../../shared/pdvAgent";
export type {
  PromotionDashboardIntegrationBreakdownItem,
  PromotionDashboardIntegrationState,
  PromotionDashboardLimitBreakdownItem,
  PromotionDashboardStats,
  PromotionDashboardStatusBreakdownItem,
  PromotionDashboardTotals,
  PromotionDashboardVoucherStat,
} from "../../shared/promotionDashboard";

export interface SaasAdminSession {
  id: string;
  name: string;
  email: string;
  role: "saas_admin";
}

export interface CompanySession {
  id: string;
  name: string;
  email: string;
  role: "company_admin";
  companyId: string;
  companyName: string;
  companyPlan: import("../../shared/company").CompanyPlan;
  companyStatus: import("../../shared/company").CompanyStatus;
  companyDomain: string;
  companyExpiresAt: string;
}

export type SaasSession = SaasAdminSession | CompanySession;
