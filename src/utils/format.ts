import type { DiscountAuthorization, DiscountStatus } from "../../shared/discount";

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Nao informado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDiscountPercent(value: number): string {
  return `${value.toFixed(2).replace(".", ",")}%`;
}

export function formatCodeList(values?: string[] | null, emptyLabel = "Nao informado"): string {
  if (!values || values.length === 0) {
    return emptyLabel;
  }

  return values.join(", ");
}

export function getStatusLabel(status: DiscountStatus): string {
  if (status === "ACTIVE") {
    return "Ativo";
  }

  if (status === "EXPIRED") {
    return "Expirado";
  }

  return "Cancelado";
}

export function getScopeLabel(item: DiscountAuthorization): string {
  if (item.scope === "PRODUCT") {
    return `Produtos ${formatCodeList(item.productCodes)}`;
  }

  if (item.scope === "PRODUCT_GROUP") {
    return `Grupos ${formatCodeList(item.productGroupCodes)}`;
  }

  return "Todos os produtos";
}
