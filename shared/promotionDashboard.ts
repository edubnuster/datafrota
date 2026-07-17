import type { PromotionDiscountType, PromotionPdvSyncState, PromotionStatus } from "./promotion";

export type PromotionDashboardIntegrationState = PromotionPdvSyncState | "unpublished";

export interface PromotionDashboardTotals {
  totalPromotions: number;
  activePromotions: number;
  scheduledPromotions: number;
  pausedPromotions: number;
  endedPromotions: number;
  publishedPromotions: number;
  promotionsWithUsage: number;
  promotionsWithUsageToday: number;
  usageCount: number;
  appliedUsageCount: number;
  totalDiscount: number;
  appliedDiscount: number;
  todayDiscount: number;
  totalVolume: number;
  todayVolume: number;
  pdvsWithUsage: number;
  branchesWithUsage: number;
  promotionsWithSecurityLimits: number;
}

export interface PromotionDashboardStatusBreakdownItem {
  status: PromotionStatus;
  label: string;
  total: number;
}

export interface PromotionDashboardIntegrationBreakdownItem {
  state: PromotionDashboardIntegrationState;
  label: string;
  total: number;
}

export interface PromotionDashboardLimitBreakdownItem {
  key:
    | "maxDiscountPerDay"
    | "maxVolumePerDay"
    | "maxQuantityPerItem"
    | "redemptionsPerCustomer"
    | "maxPurchasesPerWeek"
    | "maxPurchasesPerMonth"
    | "couponValidityMinutes";
  label: string;
  total: number;
}

export interface PromotionDashboardBranchStat {
  branchId: string;
  branchName: string;
  pdvCount: number;
  usageCount: number;
  appliedUsageCount: number;
  totalDiscount: number;
}

export interface PromotionDashboardVoucherStat {
  promotionId: string;
  name: string;
  voucherCode: string;
  status: PromotionStatus;
  discountType: PromotionDiscountType;
  discountValue: string;
  startDate: string;
  endDate: string;
  integrationState: PromotionDashboardIntegrationState;
  integrationError: string | null;
  authorizationId: string | null;
  hasSecurityLimits: boolean;
  configuredLimitCount: number;
  maxDiscountPerDay: number | null;
  maxVolumePerDay: number | null;
  maxQuantityPerItem: number | null;
  redemptionsPerCustomer: number | null;
  maxPurchasesPerWeek: number | null;
  maxPurchasesPerMonth: number | null;
  couponValidityMinutes: number | null;
  usageCount: number;
  appliedUsageCount: number;
  totalDiscount: number;
  appliedDiscount: number;
  todayUsageCount: number;
  todayDiscount: number;
  totalVolume: number;
  todayVolume: number;
  pdvCount: number;
  branchCount: number;
  uniqueCustomers: number;
  lastUsageAt: string | null;
  branchBreakdown: PromotionDashboardBranchStat[];
}

export interface PromotionDashboardStats {
  generatedAt: string;
  totals: PromotionDashboardTotals;
  statusBreakdown: PromotionDashboardStatusBreakdownItem[];
  integrationBreakdown: PromotionDashboardIntegrationBreakdownItem[];
  limitBreakdown: PromotionDashboardLimitBreakdownItem[];
  vouchers: PromotionDashboardVoucherStat[];
}
