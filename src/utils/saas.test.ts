import { describe, expect, it } from "vitest";
import type { Company } from "@/types/saas";
import {
  buildPlanSeries,
  buildStatusSeries,
  calculateDashboardMetrics,
  filterCompanies,
} from "@/utils/saas";

const companies: Company[] = [
  {
    id: "1",
    tradeName: "Databrev",
    cnpj: "00.000.000/0001-00",
    phone: "(00) 90000-0000",
    address: "Rua A",
    adminName: "Volnei",
    adminEmail: "volnei@databrev.com.br",
    temporaryPassword: "Admin@123",
    status: "ativa",
    plan: "enterprise",
    activatedAt: "2026-07-01",
    expiresAt: "2026-08-01",
    createdAt: "2026-07-01",
    domain: "databrev.tenant.datafrota.app",
    monthlyRevenue: 599.9,
  },
  {
    id: "2",
    tradeName: "Posto Central",
    cnpj: "11.111.111/0001-11",
    phone: "(11) 91111-1111",
    address: "Rua B",
    adminName: "Maria",
    adminEmail: "maria@posto.com.br",
    temporaryPassword: "Admin@123",
    status: "trial",
    plan: "starter",
    activatedAt: "2026-07-05",
    expiresAt: "2026-08-05",
    createdAt: "2026-07-05",
    domain: "postocentral.tenant.datafrota.app",
    monthlyRevenue: 199.9,
  },
];

describe("saas utils", () => {
  it("calcula os indicadores principais do dashboard", () => {
    expect(calculateDashboardMetrics(companies)).toEqual({
      totalCompanies: 2,
      activeCompanies: 1,
      monthlyRevenue: 799.8,
      trialCompanies: 1,
    });
  });

  it("filtra empresas por nome, documento e email", () => {
    expect(filterCompanies(companies, "databrev")).toHaveLength(1);
    expect(filterCompanies(companies, "11.111")).toHaveLength(1);
    expect(filterCompanies(companies, "maria@posto.com.br")).toHaveLength(1);
  });

  it("monta as series agregadas por status e plano", () => {
    expect(buildStatusSeries(companies).find((item) => item.status === "ativa")?.total).toBe(1);
    expect(buildPlanSeries(companies).find((item) => item.plan === "enterprise")?.total).toBe(1);
  });
});
