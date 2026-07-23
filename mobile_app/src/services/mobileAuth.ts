import { API_BASE_URL } from "../config/api";
import type {
  LoginPayload,
  MobileCustomerAccount,
  MobileCustomerBootstrap,
  MobileCustomerPromotion,
  MobileCustomerPromotionVoucher,
  MobileCustomerSession,
  RegisterPayload,
  UpdateProfilePayload,
} from "../types/mobileAuth";

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  details?: string;
  issues?: string[];
  item?: T;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ response: Response; payload: T }> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    const details = error instanceof Error ? error.message : "Falha de rede desconhecida.";
    throw new Error(
      `Falha de rede ao acessar ${url}. Verifique se a API local esta acessivel pela rede e pela porta configurada. Detalhes: ${details}`,
    );
  }

  const payload = await parseJson<T>(response);
  return { response, payload };
}

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();

  if (!raw.trim()) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function buildErrorMessage(payload: { error?: string; details?: string; issues?: string[] }): string {
  if (payload.issues?.length) {
    return payload.issues.join(" ");
  }

  return payload.details || payload.error || "Falha inesperada na comunicacao com a API.";
}

export async function fetchBootstrap(companyId?: string): Promise<MobileCustomerBootstrap> {
  const searchParams = new URLSearchParams();
  if (companyId) {
    searchParams.set("companyId", companyId);
  }

  const url = `${API_BASE_URL}/mobile-customers/bootstrap${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const { response, payload } = await requestJson<ApiResponse<MobileCustomerBootstrap>>(url);

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function registerCustomer(input: RegisterPayload): Promise<MobileCustomerSession> {
  const url = `${API_BASE_URL}/mobile-customers/register`;
  const { response, payload } = await requestJson<ApiResponse<MobileCustomerSession>>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function loginCustomer(input: LoginPayload): Promise<MobileCustomerSession> {
  const url = `${API_BASE_URL}/mobile-customers/login`;
  const { response, payload } = await requestJson<ApiResponse<MobileCustomerSession>>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function fetchEligiblePromotions(accessToken: string): Promise<MobileCustomerPromotion[]> {
  const url = `${API_BASE_URL}/mobile-customers/me/promotions`;
  const { response, payload } = await requestJson<ApiResponse<never> & { items?: MobileCustomerPromotion[] }>(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok || !Array.isArray(payload.items)) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items;
}

export async function generatePromotionVoucher(
  accessToken: string,
  promotionId: string,
): Promise<MobileCustomerPromotionVoucher> {
  const url = `${API_BASE_URL}/mobile-customers/me/promotions/${encodeURIComponent(promotionId)}/voucher`;
  const { response, payload } = await requestJson<ApiResponse<MobileCustomerPromotionVoucher>>(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}

export async function updateMobileCustomerProfile(
  accessToken: string,
  input: UpdateProfilePayload,
): Promise<MobileCustomerAccount> {
  const url = `${API_BASE_URL}/mobile-customers/me`;
  const requestInit = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  } satisfies RequestInit;

  let response: Response;
  let payload: ApiResponse<MobileCustomerAccount>;

  ({ response, payload } = await requestJson<ApiResponse<MobileCustomerAccount>>(url, {
    ...requestInit,
    method: "PATCH",
  }));

  const notFound =
    response.status === 404 &&
    typeof payload.error === "string" &&
    /API not found/i.test(payload.error);

  if (notFound) {
    ({ response, payload } = await requestJson<ApiResponse<MobileCustomerAccount>>(url, {
      ...requestInit,
      method: "POST",
    }));
  }

  if (!response.ok || !payload.item) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.item;
}
