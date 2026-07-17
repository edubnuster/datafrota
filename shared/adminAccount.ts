export interface SaasAdminAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  updatedAt: string;
}

export interface UpdateSaasAdminAccountInput {
  name: string;
  email: string;
  currentPassword?: string;
  password?: string;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeAdminAccountInput(
  input?: Partial<UpdateSaasAdminAccountInput> | null,
): UpdateSaasAdminAccountInput {
  return {
    name: asText(input?.name).trim(),
    email: asText(input?.email).trim().toLowerCase(),
    currentPassword: asText(input?.currentPassword).trim() || undefined,
    password: asText(input?.password).trim() || undefined,
  };
}

export function validateAdminAccountInput(
  input?: Partial<UpdateSaasAdminAccountInput> | null,
): string[] {
  const normalized = normalizeAdminAccountInput(input);
  const issues: string[] = [];

  if (!normalized.name) {
    issues.push("Informe o nome do super admin.");
  }

  if (!normalized.email) {
    issues.push("Informe o e-mail de acesso.");
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    issues.push("Informe um e-mail valido para o super admin.");
  }

  if (normalized.password && normalized.password.length < 6) {
    issues.push("A nova senha precisa ter pelo menos 6 caracteres.");
  }

  if (normalized.password && !normalized.currentPassword) {
    issues.push("Informe a senha atual para alterar a senha de acesso.");
  }

  return issues;
}
