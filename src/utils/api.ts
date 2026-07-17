import type {
  CreateDiscountCodeInput,
  DiscountAuthorization,
  ResolveDiscountCodeResponse,
} from "../../shared/discount";
import type { SaasAdminAccount, UpdateSaasAdminAccountInput } from "../../shared/adminAccount";
import type { CompanyBranch } from "../../shared/companyBranch";
import type { Company, CreateCompanyInput } from "../../shared/company";
import type { CreatePdvPairingTokenInput, PdvAgent, PdvPairingToken } from "../../shared/pdvAgent";
import type { PromotionDashboardStats } from "../../shared/promotionDashboard";
import type { CreatePromotionInput, Promotion } from "../../shared/promotion";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData";

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  details?: string;
  issues?: string[];
  item?: T;
  items?: T[];
};

type StoredSaasSession =
  | {
      role: "saas_admin";
    }
  | {
      role: "company_admin";
      companyId: string;
    };

const SESSION_KEY = "datafrota-saas-session";

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();

  if (!raw.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const contentType = response.headers.get("content-type") || "";
    const looksLikeHtml =
      contentType.includes("text/html") || raw.trimStart().toLowerCase().startsWith("<!doctype html") || raw.trimStart().startsWith("<");

    if (looksLikeHtml) {
      throw new Error(
        "A API retornou HTML em vez de JSON. Verifique se o backend esta ativo e se o proxy do frontend esta apontando para a API correta.",
      );
    }

    throw new Error("A API retornou uma resposta invalida que nao esta em formato JSON.");
  }
}

function buildErrorMessage(payload: { error?: string; details?: string; issues?: string[] }): string {
  if (payload.issues && payload.issues.length > 0) {
    return payload.issues.join(" ");
  }

  return payload.details || payload.error || "Erro inesperado na comunicacao com a API.";
}

function buildSaasHeaders(initialHeaders?: HeadersInit): Headers {
  const headers = new Headers(initialHeaders);

  if (typeof window === "undefined") {
    return headers;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return headers;
  }

  try {
    const session = JSON.parse(raw) as StoredSaasSession;
    headers.set("x-saas-role", session.role);

    if (session.role === "company_admin") {
      headers.set("x-saas-company-id", session.companyId);
    }
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
  }

  return headers;
}

export async function fetchDiscountCodes(): Promise<DiscountAuthorization[]> {
  const response = await fetch("/api/discount-codes");
  const payload = await parseJson<ApiResponse<DiscountAuthorization>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function createDiscountCode(
  input: CreateDiscountCodeInput,
): Promise<DiscountAuthorization> {
  const response = await fetch("/api/discount-codes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<DiscountAuthorization>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function cancelDiscountCode(shortCode: string): Promise<DiscountAuthorization> {
  const response = await fetch(`/api/discount-codes/${shortCode}/cancel`, {
    method: "POST",
  });

  const payload = await parseJson<ApiResponse<DiscountAuthorization>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function resolveDiscountCode(shortCode: string): Promise<ResolveDiscountCodeResponse> {
  const response = await fetch(`/api/discount-codes/${shortCode}`);
  const payload = (await response.json()) as ResolveDiscountCodeResponse & {
    success?: boolean;
    error?: string;
    details?: string;
  };

  if (!response.ok && !payload.reason) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload;
}

export async function fetchReferenceData(
  type: ReferenceDataType,
  search = "",
  selectedCodes: string[] = [],
): Promise<ReferenceOption[]> {
  const params = new URLSearchParams();

  if (search) {
    params.set("q", search);
  }

  if (selectedCodes.length > 0) {
    params.set("selected", selectedCodes.join(","));
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(`/api/reference-data/${type}${query}`, {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<ReferenceOption>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function fetchCompanies(): Promise<Company[]> {
  const response = await fetch("/api/companies");
  const payload = await parseJson<ApiResponse<Company>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const response = await fetch("/api/companies", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<Company>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function updateCompany(companyId: string, input: CreateCompanyInput): Promise<Company> {
  const response = await fetch(`/api/companies/${companyId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<Company>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function deleteCompany(companyId: string): Promise<Company> {
  const response = await fetch(`/api/companies/${companyId}`, {
    method: "DELETE",
  });

  const payload = await parseJson<ApiResponse<Company>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function fetchPromotions(): Promise<Promotion[]> {
  const response = await fetch("/api/promotions", {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<Promotion>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function fetchPromotionDashboardStats(): Promise<PromotionDashboardStats> {
  const response = await fetch("/api/promotions/dashboard/stats", {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<PromotionDashboardStats>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function fetchPdvAgents(): Promise<PdvAgent[]> {
  const response = await fetch("/api/pdv-agents", {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<PdvAgent>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function revokePdvAgent(agentId: string): Promise<PdvAgent> {
  const response = await fetch(`/api/pdv-agents/${agentId}/revoke`, {
    method: "POST",
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<PdvAgent>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function fetchPdvPairingTokens(): Promise<PdvPairingToken[]> {
  const response = await fetch("/api/pdv-agents/pairing-tokens", {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<PdvPairingToken>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function fetchCompanyBranches(): Promise<CompanyBranch[]> {
  const response = await fetch("/api/pdv-agents/company-branches", {
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<CompanyBranch>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function resyncCompanyBranches(): Promise<CompanyBranch[]> {
  const response = await fetch("/api/pdv-agents/company-branches/resync", {
    method: "POST",
    headers: buildSaasHeaders(),
  });
  const payload = await parseJson<ApiResponse<CompanyBranch>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}

export async function createPdvPairingToken(input: CreatePdvPairingTokenInput): Promise<PdvPairingToken> {
  const response = await fetch("/api/pdv-agents/pairing-tokens", {
    method: "POST",
    headers: buildSaasHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  const payload = await parseJson<ApiResponse<PdvPairingToken>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function createPromotion(input: CreatePromotionInput): Promise<Promotion> {
  const response = await fetch("/api/promotions", {
    method: "POST",
    headers: buildSaasHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<Promotion>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function updatePromotion(promotionId: string, input: CreatePromotionInput): Promise<Promotion> {
  const response = await fetch(`/api/promotions/${promotionId}`, {
    method: "PUT",
    headers: buildSaasHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<Promotion>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function deletePromotion(promotionId: string): Promise<Promotion> {
  const response = await fetch(`/api/promotions/${promotionId}`, {
    method: "DELETE",
    headers: buildSaasHeaders(),
  });

  const payload = await parseJson<ApiResponse<Promotion>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function fetchAdminAccount(): Promise<SaasAdminAccount> {
  const response = await fetch("/api/admin-account");
  const payload = await parseJson<ApiResponse<SaasAdminAccount>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function updateAdminAccount(input: UpdateSaasAdminAccountInput): Promise<SaasAdminAccount> {
  const response = await fetch("/api/admin-account", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await parseJson<ApiResponse<SaasAdminAccount>>(response);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}
