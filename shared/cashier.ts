export type CashierVoucherValidation = {
  shortCode: string;
  found: boolean;
  reason?: "NOT_FOUND" | "EXPIRED" | "CANCELLED" | "INVALID_CONTEXT";
  authorization?: {
    id: string;
    discountPercent: number;
    scope: "ALL_PRODUCTS" | "PRODUCT" | "PRODUCT_GROUP";
    productCodes: string[];
    productGroupCodes: string[];
    customerCodes: string[];
    customerGroupCodes: string[];
    firstPurchaseOnly: boolean;
    newCustomerDays: number | null;
    selectedBranchIds: string[];
    paymentFormCodes: string[];
    activeWeekdays: ("dom" | "seg" | "ter" | "qua" | "qui" | "sex" | "sab")[];
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
    validFrom: string | null;
    validUntil: string | null;
    status: "ACTIVE" | "EXPIRED" | "CANCELLED";
  };
};

export type CashierContext = {
  conta: string | null;
  estacao: string | null;
  data: string | null;
  turno: number | null;
  usuario: string | null;
  stationSource: "CAIXA_VENDA" | "LANCTO_CAIXA" | "HINT";
};

export type CreateCashierAuthorizationInput = {
  shortCode: string;
  abastecimento?: number | null;
  conta?: string | null;
  estacao?: string | null;
  stationHint?: string | null;
  quantidade?: number | null;
  mensagemDoc?: string | null;
  mensagemPdv?: string | null;
};

export type CashierPendingAuthorization = {
  id: number;
  shortCode: string;
  discountAuthorizationId: string | null;
  abastecimento: number | null;
  conta: string | null;
  estacao: string | null;
  productCodes: string[];
  productGroupCodes: string[];
  customerCodes: string[];
  customerGroupCodes: string[];
  firstPurchaseOnly: boolean;
  newCustomerDays: number | null;
  paymentFormCodes: string[];
  discountPercent: number;
  discountValue: number | null;
  quantity: number | null;
  status: "P" | "R" | "A" | "C" | "X" | "E";
  validUntil: string;
  createdAt: string;
  reservedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
  lanctoCaixa: number | null;
  mlid: number | null;
  documentMessage: string | null;
  pdvMessage: string | null;
  error: string | null;
};
