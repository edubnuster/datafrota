import { describe, expect, it } from "vitest";
import { normalizePromotionInput, validatePromotionInput } from "./promotion";

describe("promotion rules", () => {
  it("retorna erro quando nenhuma filial e selecionada", () => {
    const issues = validatePromotionInput({
      name: "Promo Filial",
      voucherMode: "fixed",
      voucherCode: "PROMO1",
      requireCustomerDocumentAtCashier: false,
      description: "",
      discountType: "percent",
      discountValue: "10",
      productMode: "individual",
      selectedProductCodes: ["1"],
      selectedProductGroupCodes: [],
      audienceMode: "all",
      newCustomerFirstPurchaseOnly: false,
      newCustomerDays: "",
      selectedCustomerCodes: [],
      selectedCustomerGroupCodes: [],
      selectedBranchIds: [],
      paymentMode: "all",
      selectedPaymentFormCodes: [],
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      startTime: "",
      endTime: "",
      activeWeekdays: ["seg"],
      birthdayOnly: false,
      maxDiscountPerDay: "",
      maxVolumePerDay: "",
      maxQuantityPerItem: "",
      redemptionsPerCustomer: "",
      maxPurchasesPerWeek: "",
      maxPurchasesPerMonth: "",
      couponValidityMinutes: "15",
      status: "ativa",
    });

    expect(issues).toContain("Selecione ao menos uma filial participante.");
  });

  it("retorna erro quando nenhum dia da semana e selecionado", () => {
    const issues = validatePromotionInput({
      name: "Promo Dia",
      voucherMode: "fixed",
      voucherCode: "PROMO2",
      requireCustomerDocumentAtCashier: false,
      description: "",
      discountType: "percent",
      discountValue: "10",
      productMode: "individual",
      selectedProductCodes: ["1"],
      selectedProductGroupCodes: [],
      audienceMode: "all",
      newCustomerFirstPurchaseOnly: false,
      newCustomerDays: "",
      selectedCustomerCodes: [],
      selectedCustomerGroupCodes: [],
      selectedBranchIds: ["1"],
      paymentMode: "all",
      selectedPaymentFormCodes: [],
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      startTime: "",
      endTime: "",
      activeWeekdays: [],
      birthdayOnly: false,
      maxDiscountPerDay: "",
      maxVolumePerDay: "",
      maxQuantityPerItem: "",
      redemptionsPerCustomer: "",
      maxPurchasesPerWeek: "",
      maxPurchasesPerMonth: "",
      couponValidityMinutes: "15",
      status: "ativa",
    });

    expect(issues).toContain("Selecione ao menos um dia da semana.");
  });

  it("aceita promocao com desconto fixo", () => {
    const issues = validatePromotionInput({
      name: "Promo Valor Fixo",
      voucherMode: "fixed",
      voucherCode: "PROMO3",
      requireCustomerDocumentAtCashier: false,
      description: "",
      discountType: "fixed",
      discountValue: "0,15",
      productMode: "individual",
      selectedProductCodes: ["1"],
      selectedProductGroupCodes: [],
      audienceMode: "all",
      newCustomerFirstPurchaseOnly: false,
      newCustomerDays: "",
      selectedCustomerCodes: [],
      selectedCustomerGroupCodes: [],
      selectedBranchIds: ["1"],
      paymentMode: "all",
      selectedPaymentFormCodes: [],
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      startTime: "",
      endTime: "",
      activeWeekdays: ["seg"],
      birthdayOnly: false,
      maxDiscountPerDay: "",
      maxVolumePerDay: "",
      maxQuantityPerItem: "",
      redemptionsPerCustomer: "",
      maxPurchasesPerWeek: "",
      maxPurchasesPerMonth: "",
      couponValidityMinutes: "15",
      status: "ativa",
    });

    expect(issues).toEqual([]);
  });

  it("aceita promocao com voucher gerado no mobile sem codigo fixo", () => {
    const issues = validatePromotionInput({
      name: "Promo Mobile",
      voucherMode: "mobile",
      voucherCode: "",
      requireCustomerDocumentAtCashier: false,
      description: "",
      discountType: "percent",
      discountValue: "10",
      productMode: "individual",
      selectedProductCodes: ["1"],
      selectedProductGroupCodes: [],
      audienceMode: "all",
      newCustomerFirstPurchaseOnly: false,
      newCustomerDays: "",
      selectedCustomerCodes: [],
      selectedCustomerGroupCodes: [],
      selectedBranchIds: ["1"],
      paymentMode: "all",
      selectedPaymentFormCodes: [],
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      startTime: "",
      endTime: "",
      activeWeekdays: ["seg"],
      birthdayOnly: false,
      maxDiscountPerDay: "",
      maxVolumePerDay: "",
      maxQuantityPerItem: "",
      redemptionsPerCustomer: "",
      maxPurchasesPerWeek: "",
      maxPurchasesPerMonth: "",
      couponValidityMinutes: "15",
      status: "ativa",
    });

    expect(issues).toEqual([]);
  });

  it("mantem compatibilidade com registros antigos que ja tem voucher", () => {
    const normalized = normalizePromotionInput({
      name: "Promo Legada",
      voucherCode: "promo4",
    });

    expect(normalized.voucherMode).toBe("fixed");
    expect(normalized.voucherCode).toBe("PROMO4");
    expect(normalized.requireCustomerDocumentAtCashier).toBe(false);
  });
});
