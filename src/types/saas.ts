export type CompanyStatus = "ativa" | "trial" | "suspensa" | "vencida";

export type CompanyPlan = "starter" | "professional" | "enterprise";

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: "saas_admin";
}

export interface Company {
  id: string;
  tradeName: string;
  cnpj: string;
  phone: string;
  address: string;
  adminName: string;
  adminEmail: string;
  temporaryPassword: string;
  status: CompanyStatus;
  plan: CompanyPlan;
  activatedAt: string;
  expiresAt: string;
  createdAt: string;
  domain: string;
  monthlyRevenue: number;
}

export interface CreateCompanyInput {
  tradeName: string;
  cnpj: string;
  phone: string;
  address: string;
  adminName: string;
  adminEmail: string;
  temporaryPassword: string;
  status: CompanyStatus;
  plan: CompanyPlan;
  activatedAt: string;
  expiresAt: string;
}
