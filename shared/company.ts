export const COMPANY_STATUS_VALUES = ["ativa", "trial", "suspensa", "vencida"] as const;
export const COMPANY_PLAN_VALUES = ["starter", "professional", "enterprise"] as const;

export type CompanyStatus = (typeof COMPANY_STATUS_VALUES)[number];
export type CompanyPlan = (typeof COMPANY_PLAN_VALUES)[number];

export interface Company {
  id: string;
  tradeName: string;
  cnpj: string;
  phone: string;
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
  selectedBranchIds: string[];
}

export interface CreateCompanyInput {
  tradeName: string;
  cnpj: string;
  phone: string;
  adminName: string;
  adminEmail: string;
  temporaryPassword: string;
  status: CompanyStatus;
  plan: CompanyPlan;
  activatedAt: string;
  expiresAt: string;
  selectedBranchIds: string[];
}

export function calculateMonthlyRevenue(plan: CompanyPlan): number {
  if (plan === "enterprise") {
    return 599.9;
  }

  if (plan === "professional") {
    return 349.9;
  }

  return 199.9;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanList(values?: unknown[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => asText(value).trim())
        .filter(Boolean),
    ),
  );
}

export function buildCompanyDomain(tradeName?: string | null): string {
  return `${asText(tradeName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim()}.tenant.datafrota.app`;
}

export function onlyDigits(value?: string | null): string {
  return asText(value).replace(/\D/g, "");
}

export function formatCnpj(value?: string | null): string {
  const digits = onlyDigits(value).slice(0, 14);

  if (!digits) {
    return "";
  }

  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatPhone(value?: string | null): string {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 2) {
    return digits ? `(${digits}` : "";
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function normalizeCompanyInput(
  input?: Partial<CreateCompanyInput> | null,
): CreateCompanyInput {
  const cnpj = formatCnpj(input?.cnpj);
  const phone = formatPhone(input?.phone);

  return {
    tradeName: asText(input?.tradeName).trim(),
    cnpj,
    phone,
    adminName: asText(input?.adminName).trim(),
    adminEmail: asText(input?.adminEmail).trim().toLowerCase(),
    temporaryPassword: asText(input?.temporaryPassword).trim(),
    status: input?.status ?? "trial",
    plan: input?.plan ?? "starter",
    activatedAt: asText(input?.activatedAt).trim(),
    expiresAt: asText(input?.expiresAt).trim(),
    selectedBranchIds: cleanList(input?.selectedBranchIds),
  };
}

export function validateCompanyInput(input?: Partial<CreateCompanyInput> | null): string[] {
  const normalized = normalizeCompanyInput(input);
  const issues: string[] = [];
  const cnpjDigits = onlyDigits(normalized.cnpj);
  const phoneDigits = onlyDigits(normalized.phone);

  if (!normalized.tradeName) issues.push("Informe o nome do posto.");
  if (!normalized.cnpj) issues.push("Informe o CNPJ.");
  if (!normalized.phone) issues.push("Informe o telefone.");
  if (!normalized.adminName) issues.push("Informe o nome do administrador.");
  if (!normalized.adminEmail) issues.push("Informe o e-mail do administrador.");
  if (!normalized.temporaryPassword) issues.push("Informe a senha inicial do administrador.");
  if (!normalized.activatedAt) issues.push("Informe a data de ativacao.");
  if (!normalized.expiresAt) issues.push("Informe a data de vencimento.");
  if (normalized.cnpj && cnpjDigits.length !== 14) {
    issues.push("Informe um CNPJ valido com 14 digitos.");
  }

  if (normalized.phone && (phoneDigits.length < 10 || phoneDigits.length > 11)) {
    issues.push("Informe um telefone brasileiro valido com DDD.");
  }

  if (normalized.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.adminEmail)) {
    issues.push("Informe um e-mail valido para o administrador.");
  }

  if (!COMPANY_STATUS_VALUES.includes(normalized.status)) {
    issues.push("Informe um status valido.");
  }

  if (!COMPANY_PLAN_VALUES.includes(normalized.plan)) {
    issues.push("Informe um plano valido.");
  }

  if (
    normalized.activatedAt &&
    normalized.expiresAt &&
    normalized.expiresAt < normalized.activatedAt
  ) {
    issues.push("A data de vencimento nao pode ser menor que a data de ativacao.");
  }

  return issues;
}
