import { describe, expect, it } from "vitest";
import { validatePromotionInput } from "./promotion";

describe("promotion rules", () => {
  it("retorna erro quando nenhuma filial e selecionada", () => {
    const issues = validatePromotionInput({
      name: "Promo Filial",
      voucherCode: "PROMO1",
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
      voucherCode: "PROMO2",
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
});
