import type {
  CreateDiscountCodeInput,
  DiscountAuthorization,
  ResolveDiscountCodeResponse,
} from "../../shared/discount";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData";

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  details?: string;
  issues?: string[];
  item?: T;
  items?: T[];
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;
  return data;
}

function buildErrorMessage(payload: { error?: string; details?: string; issues?: string[] }): string {
  if (payload.issues && payload.issues.length > 0) {
    return payload.issues.join(" ");
  }

  return payload.details || payload.error || "Erro inesperado na comunicacao com a API.";
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
): Promise<ReferenceOption[]> {
  const query = search ? `?q=${encodeURIComponent(search)}` : "";
  const response = await fetch(`/api/reference-data/${type}${query}`);
  const payload = await parseJson<ApiResponse<ReferenceOption>>(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(payload));
  }

  return payload.items || [];
}
