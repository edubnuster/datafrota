import type { Company, CompanyPlan, CompanyStatus } from "@/types/saas";

export interface DashboardMetrics {
  totalCompanies: number;
  activeCompanies: number;
  monthlyRevenue: number;
  trialCompanies: number;
}

export interface StatusSeriesItem {
  status: CompanyStatus;
  label: string;
  total: number;
}

export interface PlanSeriesItem {
  plan: CompanyPlan;
  label: string;
  total: number;
  color: string;
}

const STATUS_LABELS: Record<CompanyStatus, string> = {
  ativa: "Ativa",
  trial: "Trial",
  suspensa: "Suspensa",
  vencida: "Vencida",
};

const PLAN_LABELS: Record<CompanyPlan, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

const PLAN_COLORS: Record<CompanyPlan, string> = {
  starter: "#8b5cf6",
  professional: "#6d28d9",
  enterprise: "#c4b5fd",
};

export function filterCompanies(companies: Company[], query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return companies;
  }

  return companies.filter((company) =>
    [company.tradeName, company.cnpj, company.adminName, company.adminEmail, company.domain]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function calculateDashboardMetrics(companies: Company[]): DashboardMetrics {
  return {
    totalCompanies: companies.length,
    activeCompanies: companies.filter((company) => company.status === "ativa").length,
    monthlyRevenue: companies.reduce((total, company) => total + company.monthlyRevenue, 0),
    trialCompanies: companies.filter((company) => company.status === "trial").length,
  };
}

export function buildStatusSeries(companies: Company[]): StatusSeriesItem[] {
  const totals = companies.reduce<Record<CompanyStatus, number>>(
    (acc, company) => {
      acc[company.status] += 1;
      return acc;
    },
    {
      ativa: 0,
      trial: 0,
      suspensa: 0,
      vencida: 0,
    },
  );

  return (Object.keys(totals) as CompanyStatus[]).map((status) => ({
    status,
    label: STATUS_LABELS[status],
    total: totals[status],
  }));
}

export function buildPlanSeries(companies: Company[]): PlanSeriesItem[] {
  const totals = companies.reduce<Record<CompanyPlan, number>>(
    (acc, company) => {
      acc[company.plan] += 1;
      return acc;
    },
    {
      starter: 0,
      professional: 0,
      enterprise: 0,
    },
  );

  return (Object.keys(totals) as CompanyPlan[]).map((plan) => ({
    plan,
    label: PLAN_LABELS[plan],
    total: totals[plan],
    color: PLAN_COLORS[plan],
  }));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T00:00:00`));
}

export function formatStatusLabel(status: CompanyStatus) {
  return STATUS_LABELS[status];
}

export function formatPlanLabel(plan: CompanyPlan) {
  return PLAN_LABELS[plan];
}

export function getPlanGradient(plan: CompanyPlan) {
  if (plan === "enterprise") {
    return "from-violet-950 via-violet-700 to-fuchsia-500";
  }

  if (plan === "professional") {
    return "from-violet-950 via-violet-800 to-violet-500";
  }

  return "from-violet-900 via-purple-700 to-violet-400";
}
