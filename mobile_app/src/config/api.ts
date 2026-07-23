import { BRAND_API_ORIGIN } from "./brand";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, "");
}

const apiOrigin = trimTrailingSlashes(BRAND_API_ORIGIN);

export const API_ORIGIN = apiOrigin.endsWith("/api") ? apiOrigin.slice(0, -4) : apiOrigin;
export const API_BASE_URL = apiOrigin.endsWith("/api") ? apiOrigin : `${apiOrigin}/api`;
