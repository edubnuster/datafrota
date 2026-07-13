import { create } from "zustand";
import type { AdminSession, Company, CreateCompanyInput } from "@/types/saas";

const SESSION_KEY = "datafrota-saas-session";

const seedCompanies: Company[] = [
  {
    id: "company-1",
    tradeName: "Databrev",
    cnpj: "42.971.554/0001-27",
    phone: "(47) 99154-8827",
    address: "Rua das Flores, 1080 - Centro, Blumenau - SC",
    adminName: "Volnei Girardi",
    adminEmail: "volnei@databrev.com.br",
    temporaryPassword: "Admin@123",
    status: "ativa",
    plan: "enterprise",
    activatedAt: "2026-07-11",
    expiresAt: "2026-08-11",
    createdAt: "2026-07-11",
    domain: "tenant.databrev.com.br",
    monthlyRevenue: 599.9,
  },
];

const defaultSession: AdminSession = {
  id: "saas-admin-1",
  name: "Volnei Girardi",
  email: "adm@databrev.com.br",
  role: "saas_admin",
};

function getInitialSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function persistSession(session: AdminSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

interface SaasStoreState {
  session: AdminSession | null;
  companies: Company[];
  search: string;
  authError: string | null;
  login(email: string, password: string): Promise<boolean>;
  logout(): void;
  clearAuthError(): void;
  setSearch(search: string): void;
  createCompany(input: CreateCompanyInput): Company;
}

export const useSaasStore = create<SaasStoreState>((set) => ({
  session: getInitialSession(),
  companies: seedCompanies,
  search: "",
  authError: null,
  async login(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    const isValid =
      normalizedEmail === defaultSession.email && password === "adm@databrev.com.br";

    if (!isValid) {
      set({ authError: "Credenciais inválidas. Use o acesso administrativo do SaaS." });
      return false;
    }

    persistSession(defaultSession);
    set({ session: defaultSession, authError: null });
    return true;
  },
  logout() {
    persistSession(null);
    set({ session: null, authError: null });
  },
  clearAuthError() {
    set({ authError: null });
  },
  setSearch(search) {
    set({ search });
  },
  createCompany(input) {
    const company: Company = {
      id: `company-${Date.now()}`,
      tradeName: input.tradeName,
      cnpj: input.cnpj,
      phone: input.phone,
      address: input.address,
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      temporaryPassword: input.temporaryPassword,
      status: input.status,
      plan: input.plan,
      activatedAt: input.activatedAt,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString().slice(0, 10),
      domain: `${input.tradeName.toLowerCase().replace(/\s+/g, "")}.tenant.datafrota.app`,
      monthlyRevenue:
        input.plan === "enterprise" ? 599.9 : input.plan === "professional" ? 349.9 : 199.9,
    };

    set((state) => ({
      companies: [company, ...state.companies],
    }));

    return company;
  },
}));
