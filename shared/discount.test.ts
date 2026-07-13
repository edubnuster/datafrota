import { describe, expect, it } from "vitest";
import {
  buildDiscountScope,
  createShortCode,
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
      paymentFormCodes: [],
      discountPercent: 10,
    });

    expect(issues).toContain("Escolha cliente ou grupo de cliente, nao os dois ao mesmo tempo.");
  });

  it("gera codigo curto com alfabeto amigavel para digitacao", () => {
    const code = createShortCode(8, () => 0);
    expect(code).toBe("AAAAAAAA");
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
      paymentFormCodes: [" 12 ", "12", "34 "],
      discountPercent: 5,
    });

    expect(issues).toEqual([]);
  });
});
