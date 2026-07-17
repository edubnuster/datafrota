import { create } from "zustand";
import type {
  Company,
  CreateCompanyInput,
  SaasAdminSession,
  SaasSession,
  UpdateSaasAdminAccountInput,
} from "@/types/saas";
import {
  fetchAdminAccount,
  createCompany as createCompanyRequest,
  deleteCompany as deleteCompanyRequest,
  fetchCompanies,
  updateAdminAccount as updateAdminAccountRequest,
  updateCompany as updateCompanyRequest,
} from "@/utils/api";

const SESSION_KEY = "datafrota-saas-session";

function buildAdminSession(account: { id: string; name: string; email: string }): SaasAdminSession {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: "saas_admin",
  };
}

function getInitialSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SaasSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function persistSession(session: SaasSession | null) {
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
  session: SaasSession | null;
  companies: Company[];
  companiesLoaded: boolean;
  companiesLoading: boolean;
  companiesError: string | null;
  search: string;
  authError: string | null;
  login(email: string, password: string): Promise<boolean>;
  logout(): void;
  clearAuthError(): void;
  setSearch(search: string): void;
  loadCompanies(force?: boolean): Promise<void>;
  createCompany(input: CreateCompanyInput): Promise<Company>;
  updateCompany(companyId: string, input: CreateCompanyInput): Promise<Company | null>;
  deleteCompany(companyId: string): Promise<Company | null>;
  updateAdminAccount(input: UpdateSaasAdminAccountInput): Promise<SaasAdminSession>;
}

export const useSaasStore = create<SaasStoreState>((set, get) => ({
  session: getInitialSession(),
  companies: [],
  companiesLoaded: false,
  companiesLoading: false,
  companiesError: null,
  search: "",
  authError: null,
  async login(email, password) {
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const adminAccount = await fetchAdminAccount();
      const adminSession = buildAdminSession(adminAccount);
      const isAdminLogin =
        normalizedEmail === adminSession.email.trim().toLowerCase() && password === adminAccount.password;

      if (isAdminLogin) {
        persistSession(adminSession);
        set({ session: adminSession, authError: null });
        return true;
      }

      const companies = await fetchCompanies();
      const company = companies.find(
        (item) =>
          item.adminEmail.trim().toLowerCase() === normalizedEmail &&
          item.temporaryPassword === password,
      );

      if (!company) {
        set({
          authError: "Credenciais invalidas. Use o acesso administrativo do SaaS ou o login da empresa.",
        });
        return false;
      }

      const companySession: SaasSession = {
        id: `company-admin-${company.id}`,
        name: company.adminName,
        email: company.adminEmail,
        role: "company_admin",
        companyId: company.id,
        companyName: company.tradeName,
        companyPlan: company.plan,
        companyStatus: company.status,
        companyDomain: company.domain,
        companyExpiresAt: company.expiresAt,
      };

      persistSession(companySession);
      set({
        session: companySession,
        authError: null,
        companies,
        companiesLoaded: true,
        companiesLoading: false,
        companiesError: null,
      });
      return true;
    } catch (error) {
      set({
        authError:
          error instanceof Error ? error.message : "Nao foi possivel validar o acesso da empresa.",
      });
      return false;
    }
  },
  logout() {
    persistSession(null);
    set({
      session: null,
      authError: null,
      companies: [],
      companiesLoaded: false,
      companiesLoading: false,
      companiesError: null,
      search: "",
    });
  },
  clearAuthError() {
    set({ authError: null });
  },
  setSearch(search) {
    set({ search });
  },
  async loadCompanies(force = false) {
    let shouldLoad = true;

    set((state) => {
      shouldLoad = force || (!state.companiesLoaded && !state.companiesLoading);

      if (!shouldLoad) {
        return state;
      }

      return {
        companiesLoading: true,
        companiesError: null,
      };
    });

    if (!shouldLoad) {
      return;
    }

    try {
      const companies = await fetchCompanies();
      set({
        companies,
        companiesLoaded: true,
        companiesLoading: false,
        companiesError: null,
      });
    } catch (error) {
      set({
        companiesLoading: false,
        companiesError:
          error instanceof Error ? error.message : "Nao foi possivel carregar as empresas.",
      });
    }
  },
  async createCompany(input) {
    const company = await createCompanyRequest(input);
    set((state) => ({
      companies: [company, ...state.companies.filter((item) => item.id !== company.id)],
      companiesLoaded: true,
      companiesError: null,
    }));
    return company;
  },
  async updateCompany(companyId, input) {
    const company = await updateCompanyRequest(companyId, input);
    set((state) => ({
      companies: state.companies.map((item) => (item.id === companyId ? company : item)),
      companiesLoaded: true,
      companiesError: null,
    }));
    return company;
  },
  async deleteCompany(companyId) {
    const company = await deleteCompanyRequest(companyId);
    set((state) => ({
      companies: state.companies.filter((item) => item.id !== companyId),
      companiesLoaded: true,
      companiesError: null,
    }));
    return company;
  },
  async updateAdminAccount(input) {
    const currentSession = get().session;
    const nextAccount = await updateAdminAccountRequest(input);
    const nextSession = buildAdminSession(nextAccount);
    persistSession(nextSession);

    set({
      session:
        currentSession?.role === "saas_admin"
          ? nextSession
          : currentSession,
    });

    return nextSession;
  },
}));
