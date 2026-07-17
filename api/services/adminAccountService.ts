import {
  normalizeAdminAccountInput,
  validateAdminAccountInput,
  type SaasAdminAccount,
  type UpdateSaasAdminAccountInput,
} from "../../shared/adminAccount.js";
import { ensureSaasAdminSchema, querySaas } from "../db.js";

type AdminAccountRow = {
  id: string;
  name: string;
  email: string;
  password: string;
  updated_at: string | Date;
};

function mapAdminAccountRow(row: AdminAccountRow): SaasAdminAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class AdminAccountValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "Erro de validacao");
    this.name = "AdminAccountValidationError";
  }
}

export async function getAdminAccount(): Promise<SaasAdminAccount> {
  await ensureSaasAdminSchema();

  const result = await querySaas<AdminAccountRow>(
    `
      SELECT id, name, email, password, updated_at
      FROM saas_admin_account
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  );

  return mapAdminAccountRow(result.rows[0]);
}

export async function updateAdminAccount(
  input: UpdateSaasAdminAccountInput,
): Promise<SaasAdminAccount> {
  const issues = validateAdminAccountInput(input);
  if (issues.length > 0) {
    throw new AdminAccountValidationError(issues);
  }

  await ensureSaasAdminSchema();
  const normalized = normalizeAdminAccountInput(input);
  const currentAccount = await getAdminAccount();

  if (normalized.password && normalized.currentPassword !== currentAccount.password) {
    throw new AdminAccountValidationError(["A senha atual informada nao confere."]);
  }

  const nextPassword = normalized.password || currentAccount.password;
  const result = await querySaas<AdminAccountRow>(
    `
      UPDATE saas_admin_account
      SET
        name = $2,
        email = $3,
        password = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, email, password, updated_at
    `,
    [currentAccount.id, normalized.name, normalized.email, nextPassword],
  );

  return mapAdminAccountRow(result.rows[0]);
}
