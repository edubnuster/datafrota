import type {
  PromotionDiscountType,
  PromotionPdvIntegration,
  PromotionStatus,
  PromotionWeekday,
} from "./promotion.js";

export interface PdvPromotionItem {
  promotionId: string;
  name: string;
  voucherMode: "mobile" | "fixed";
  voucherCode: string;
  status: PromotionStatus;
  description: string;
  discountType: PromotionDiscountType;
  discountValue: string;
  productMode: "group" | "individual";
  productCodes: string[];
  productGroupCodes: string[];
  audienceMode: "all" | "group" | "individual" | "firstPurchase";
  customerCodes: string[];
  customerGroupCodes: string[];
  firstPurchaseOnly: boolean;
  newCustomerDays: string;
  selectedBranchIds: string[];
  paymentMode: "all" | "selected";
  paymentFormCodes: string[];
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
  updatedAt: string;
  integration: PromotionPdvIntegration | null;
}

export interface PdvPromotionSyncResponse {
  serverTime: string;
  promotionCursor: number;
  unchanged?: boolean;
  itemCount: number;
  items: PdvPromotionItem[];
}
