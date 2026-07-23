import { describe, expect, it } from "vitest";
import {
  buildDiscountScope,
  createShortCode,
  DEFAULT_SHORT_CODE_LENGTH,
  getEffectiveStatus,
  validateCreateDiscountInput,
} from "./discount";

describe("discount rules", () => {
  it("define escopo de produto quando o codigo do produto e informado", () => {
    expect(
      buildDiscountScope({
        productCodes: ["123"],
        productGroupCodes: null,
        customerCodes: null,
        customerGroupCodes: null,
        firstPurchaseOnly: false,
        paymentFormCodes: [],
        discountPercent: 10,
      }),
    ).toBe("PRODUCT");
  });

  it("define escopo para todos os produtos quando nada e informado", () => {
    expect(
      buildDiscountScope({
        productCodes: null,
        productGroupCodes: null,
        customerCodes: null,
        customerGroupCodes: null,
        firstPurchaseOnly: false,
        paymentFormCodes: [],
        discountPercent: 10,
      }),
    ).toBe("ALL_PRODUCTS");
  });

  it("retorna erro quando produto e grupo de produto sao informados juntos", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: ["ABC"],
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain("Escolha produto ou grupo de produto, nao os dois ao mesmo tempo.");
  });

  it("retorna erro quando cliente e grupo de cliente sao informados juntos", () => {
    const issues = validateCreateDiscountInput({
      productCodes: null,
      productGroupCodes: null,
      customerCodes: ["9"],
      customerGroupCodes: ["7"],
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain("Escolha cliente ou grupo de cliente, nao os dois ao mesmo tempo.");
  });

  it("gera codigo curto com alfabeto amigavel para digitacao", () => {
    const code = createShortCode(undefined, () => 0);
    expect(code).toBe("A".repeat(DEFAULT_SHORT_CODE_LENGTH));
  });

  it("marca como expirado quando a validade final ja passou", () => {
    expect(
      getEffectiveStatus(
        {
          status: "ACTIVE",
          validUntil: "2025-01-01T00:00:00.000Z",
        },
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe("EXPIRED");
  });

  it("normaliza e remove duplicidade nas listas informadas", () => {
    const issues = validateCreateDiscountInput({
      productCodes: [" 123 ", "123", " 456 "],
      productGroupCodes: null,
      customerCodes: [" 9 ", "9"],
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [" 12 ", "12", "34 "],
      discountPercent: 5,
    });

    expect(issues).toEqual([]);
  });

  it("retorna erro quando primeira compra e combinada com clientes especificos", () => {
    const issues = validateCreateDiscountInput({
      productCodes: null,
      productGroupCodes: null,
      customerCodes: ["9"],
      customerGroupCodes: null,
      firstPurchaseOnly: true,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain("A regra de primeira compra nao pode ser combinada com clientes ou grupos especificos.");
  });

  it("aceita regra de clientes novos por dias quando o valor e inteiro positivo", () => {
    const issues = validateCreateDiscountInput({
      productCodes: null,
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      newCustomerDays: 30,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toEqual([]);
  });

  it("retorna erro quando a regra de clientes novos por dias nao e inteira e positiva", () => {
    const issues = validateCreateDiscountInput({
      productCodes: null,
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      newCustomerDays: 0,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain("A regra de clientes novos em dias precisa ser um numero inteiro maior que zero.");
  });

  it("retorna erro quando clientes novos por dias e combinado com clientes especificos", () => {
    const issues = validateCreateDiscountInput({
      productCodes: null,
      productGroupCodes: null,
      customerCodes: ["9"],
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      newCustomerDays: 15,
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain(
      "A regra de clientes novos por dias nao pode ser combinada com clientes ou grupos especificos.",
    );
  });

  it("aceita restricoes operacionais de filial, dia e reutilizacao", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      selectedBranchIds: ["1", "2"],
      paymentFormCodes: [],
      activeWeekdays: ["seg", "ter"],
      maxDiscountPerDay: 50,
      maxVolumePerDay: 100,
      maxQuantityPerItem: 20,
      redemptionsPerCustomer: 2,
      maxPurchasesPerWeek: 3,
      maxPurchasesPerMonth: 8,
      reusable: true,
      discountPercent: 10,
    });

    expect(issues).toEqual([]);
  });

  it("retorna erro quando um limite operacional invalido e informado", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      redemptionsPerCustomer: 0,
      discountPercent: 10,
    });

    expect(issues).toContain("O limite de resgates por cliente deve ser um numero inteiro maior que zero.");
  });

  it("aceita horario e aniversario quando o intervalo e valido", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      startTime: "08:00",
      endTime: "18:00",
      birthdayOnly: true,
      discountPercent: 10,
    });

    expect(issues).toEqual([]);
  });

  it("retorna erro quando o intervalo de horario e invalido", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      startTime: "18:00",
      endTime: "08:00",
      discountPercent: 10,
    });

    expect(issues).toContain("O horario final nao pode ser menor que o horario inicial.");
  });

  it("aceita desconto fixo quando o valor e positivo", () => {
    const issues = validateCreateDiscountInput({
      productCodes: ["123"],
      productGroupCodes: null,
      customerCodes: null,
      customerGroupCodes: null,
      firstPurchaseOnly: false,
      paymentFormCodes: [],
      discountType: "fixed",
      discountValue: 0.15,
    });

    expect(issues).toEqual([]);
  });
});
