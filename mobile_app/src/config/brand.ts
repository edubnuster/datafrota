const DEFAULT_TENANT_ID = "company-1";
const DEFAULT_APP_NAME = "Databrev Cliente Teste";
const DEFAULT_BRAND_NAME = "Databrev";
const DEFAULT_APP_SLUG = "databrev-cliente-teste";
const DEFAULT_API_ORIGIN = "http://192.168.1.3:3001";

export const TENANT_ID = process.env.EXPO_PUBLIC_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME?.trim() || DEFAULT_APP_NAME;
export const BRAND_NAME = process.env.EXPO_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME;
export const APP_SLUG = process.env.EXPO_PUBLIC_APP_SLUG?.trim() || DEFAULT_APP_SLUG;
export const BRAND_API_ORIGIN = process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_ORIGIN;
