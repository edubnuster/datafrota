import { describe, expect, it } from "vitest";
import {
  formatCnpj,
  formatPhone,
  normalizeCompanyInput,
  validateCompanyInput,
  type CreateCompanyInput,
} from "./company";

const validInput: CreateCompanyInput = {
  tradeName: "Posto Exemplo",
  cnpj: "12345678000195",
  phone: "47991548827",
  adminName: "Maria Silva",
  adminEmail: "Maria@Exemplo.com.br",
  temporaryPassword: "Admin@123",
  status: "ativa",
  plan: "enterprise",
  activatedAt: "2026-07-14",
  expiresAt: "2026-08-14",
  selectedBranchIds: ["101", "102"],
};

describe("company helpers", () => {
  it("aplica mascara brasileira em CNPJ e telefone", () => {
    expect(formatCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatPhone("47991548827")).toBe("(47) 99154-8827");
  });

  it("normaliza os campos principais da empresa", () => {
    const normalized = normalizeCompanyInput(validInput);

    expect(normalized.adminEmail).toBe("maria@exemplo.com.br");
    expect(normalized.cnpj).toBe("12.345.678/0001-95");
    expect(normalized.phone).toBe("(47) 99154-8827");
  });

  it("valida documento, telefone e campos obrigatorios", () => {
    const issues = validateCompanyInput({
      ...validInput,
      cnpj: "123",
      phone: "4799",
    });

    expect(issues).toContain("Informe um CNPJ valido com 14 digitos.");
    expect(issues).toContain("Informe um telefone brasileiro valido com DDD.");
  });


  it("nao quebra quando o payload chega com campos ausentes", () => {
    const issues = validateCompanyInput({
      tradeName: "Posto Incompleto",
    } as CreateCompanyInput);

    expect(issues).toContain("Informe o CNPJ.");
    expect(issues).toContain("Informe o telefone.");
    expect(issues).toContain("Informe o nome do administrador.");
  });
});
