import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import {
  formatMobileCustomerDocument,
  formatMobileCustomerPhone,
  normalizeMobileCustomerCreateInput,
  normalizeMobileCustomerBirthDate,
  normalizeMobileCustomerLoginInput,
  onlyDigits,
  validateMobileCustomerCreateInput,
  validateMobileCustomerLoginInput,
  type CreateMobileCustomerInput,
  type MobileCustomerAccount,
  type MobileCustomerBootstrap,
  type MobileCustomerLoginInput,
  type MobileCustomerSession,
} from "../../shared/mobileCustomer.js";
import { ensureCompaniesSchema, ensureMobileCustomerSchema, querySaas } from "../db.js";

type CompanyScopeRow = {
  id: string;
  trade_name: string;
};

type MobileCustomerAccountRow = {
  id: string;
  company_id: string;
  company_name: string;
  document_type: "cpf" | "cnpj";
  document_number: string;
  full_name: string;
  phone: string;
  email: string;
  birth_date: string | Date | null;
  birth_date_updated_at: string | Date | null;
  password_hash: string;
  status: "active" | "blocked";
  created_at: string | Date;
  updated_at: string | Date;
  last_login_at: string | Date | null;
};

type MobileCustomerTokenPayload = {
  sub?: string;
  email?: string;
  companyId?: string;
  exp?: number;
};

export type MobileCustomerSessionContext = {
  accountId: string;
  companyId: string;
  customer: MobileCustomerAccount;
  documentNumberDigits: string;
};

export class MobileCustomerAuthValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "Erro de validacao");
    this.name = "MobileCustomerAuthValidationError";
  }
}

function getAuthSecret(): string {
  return process.env.MOBILE_AUTH_SECRET?.trim() || "datafrota-mobile-dev-secret";
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, 64);
  const storedKey = Buffer.from(storedHash, "hex");

  if (storedKey.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedKey, derivedKey);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(paddingLength)}`, "base64").toString("utf8");
}

function buildAccessToken(customer: MobileCustomerAccount, expiresAt: string): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: customer.id,
      email: customer.email,
      companyId: customer.companyId,
      exp: Math.floor(new Date(expiresAt).getTime() / 1000),
    }),
  );
  const signature = createHmac("sha256", getAuthSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function parseBearerToken(req: Request): string | null {
  const authorization = String(req.header("authorization") || "").trim();
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

function verifyAccessToken(token: string): MobileCustomerTokenPayload | null {
  const [header, payload, signature] = token.split(".", 3);
  if (!header || !payload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getAuthSecret()).update(`${header}.${payload}`).digest("base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as MobileCustomerTokenPayload;
    if (!parsed.sub || !parsed.companyId || !parsed.exp) {
      return null;
    }

    if (parsed.exp * 1000 <= Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function mapMobileCustomerRow(row: MobileCustomerAccountRow): MobileCustomerAccount {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    documentType: row.document_type,
    documentNumber: formatMobileCustomerDocument(row.document_number, row.document_type),
    fullName: row.full_name,
    phone: formatMobileCustomerPhone(row.phone),
    email: row.email,
    birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

async function resolveCompanyScope(companyId?: string): Promise<CompanyScopeRow> {
  await ensureCompaniesSchema();

  const params: unknown[] = [];
  const whereParts = ["status IN ('ativa', 'trial')"];

  if (companyId) {
    params.push(companyId);
    whereParts.push(`id = $${params.length}`);
  }

  const result = await querySaas<CompanyScopeRow>(
    `
      SELECT id, trade_name
      FROM saas_company
      WHERE ${whereParts.join(" AND ")}
      ORDER BY
        CASE status
          WHEN 'ativa' THEN 0
          ELSE 1
        END,
        created_at ASC,
        trade_name ASC
      LIMIT 1
    `,
    params,
  );

  const company = result.rows[0];

  if (!company) {
    throw new MobileCustomerAuthValidationError([
      companyId
        ? "A empresa informada nao foi encontrada ou nao esta apta para receber cadastros mobile."
        : "Nenhuma empresa disponivel para receber cadastros mobile.",
    ]);
  }

  return company;
}

async function loadMobileCustomerAccountById(accountId: string): Promise<MobileCustomerAccountRow | null> {
  await ensureMobileCustomerSchema();

  const result = await querySaas<MobileCustomerAccountRow>(
    `
      SELECT
        account.id,
        account.company_id,
        company.trade_name AS company_name,
        account.document_type,
        account.document_number,
        account.full_name,
        account.phone,
        account.email,
        account.birth_date,
        account.birth_date_updated_at,
        account.password_hash,
        account.status,
        account.created_at,
        account.updated_at,
        account.last_login_at
      FROM mobile_customer_account account
      INNER JOIN saas_company company
        ON company.id = account.company_id
      WHERE account.id = $1
      LIMIT 1
    `,
    [accountId],
  );

  return result.rows[0] ?? null;
}

function buildSession(customer: MobileCustomerAccount): MobileCustomerSession {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  return {
    customer,
    accessToken: buildAccessToken(customer, expiresAt),
    expiresAt,
  };
}

export async function getMobileCustomerBootstrap(companyId?: string): Promise<MobileCustomerBootstrap> {
  await ensureMobileCustomerSchema();

  const company = await resolveCompanyScope(companyId);

  return {
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    apiBasePath: "/api/mobile-customers",
    defaultCompanyId: company.id,
    defaultCompanyName: company.trade_name,
    databaseName: process.env.SAAS_PGDATABASE || "datafrota",
  };
}

export async function registerMobileCustomer(
  input: CreateMobileCustomerInput,
): Promise<MobileCustomerSession> {
  const issues = validateMobileCustomerCreateInput(input);
  if (issues.length > 0) {
    throw new MobileCustomerAuthValidationError(issues);
  }

  await ensureMobileCustomerSchema();

  const normalized = normalizeMobileCustomerCreateInput(input);
  const company = await resolveCompanyScope(normalized.companyId);
  const normalizedDocument = onlyDigits(normalized.documentNumber);
  const normalizedPhone = onlyDigits(normalized.phone);

  const duplicateResult = await querySaas<{ id: string }>(
    `
      SELECT id
      FROM mobile_customer_account
      WHERE company_id = $1
        AND (
          email = $2
          OR (
            document_type = $3
            AND document_number = $4
          )
        )
      LIMIT 1
    `,
    [company.id, normalized.email, normalized.documentType, normalizedDocument],
  );

  if (duplicateResult.rows[0]) {
    throw new MobileCustomerAuthValidationError([
      "Ja existe um cliente cadastrado com este e-mail ou documento nesta empresa.",
    ]);
  }

  const customerId = `mobile-customer-${randomUUID()}`;
  const passwordHash = hashPassword(normalized.password);

  const insertResult = await querySaas<MobileCustomerAccountRow>(
    `
      INSERT INTO mobile_customer_account (
        id,
        company_id,
        document_type,
        document_number,
        full_name,
        phone,
        email,
        birth_date,
        birth_date_updated_at,
        password_hash,
        status,
        created_at,
        updated_at,
        last_login_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, NULL, $9, 'active', NOW(), NOW(), NOW())
      RETURNING
        id,
        company_id,
        $10::text AS company_name,
        document_type,
        document_number,
        full_name,
        phone,
        email,
        birth_date,
        birth_date_updated_at,
        password_hash,
        status,
        created_at,
        updated_at,
        last_login_at
    `,
    [
      customerId,
      company.id,
      normalized.documentType,
      normalizedDocument,
      normalized.fullName,
      normalizedPhone,
      normalized.email,
      normalized.birthDate,
      passwordHash,
      company.trade_name,
    ],
  );

  return buildSession(mapMobileCustomerRow(insertResult.rows[0]));
}

export async function loginMobileCustomer(
  input: MobileCustomerLoginInput,
): Promise<MobileCustomerSession> {
  const issues = validateMobileCustomerLoginInput(input);
  if (issues.length > 0) {
    throw new MobileCustomerAuthValidationError(issues);
  }

  await ensureMobileCustomerSchema();

  const normalized = normalizeMobileCustomerLoginInput(input);
  const company = await resolveCompanyScope(normalized.companyId);
  const documentDigits = onlyDigits(normalized.identifier);

  const result = await querySaas<MobileCustomerAccountRow>(
    `
      SELECT
        account.id,
        account.company_id,
        company.trade_name AS company_name,
        account.document_type,
        account.document_number,
        account.full_name,
        account.phone,
        account.email,
        account.birth_date,
        account.birth_date_updated_at,
        account.password_hash,
        account.status,
        account.created_at,
        account.updated_at,
        account.last_login_at
      FROM mobile_customer_account account
      INNER JOIN saas_company company
        ON company.id = account.company_id
      WHERE account.company_id = $1
        AND (
          account.email = $2
          OR account.document_number = $3
        )
      LIMIT 1
    `,
    [company.id, normalized.identifier, documentDigits],
  );

  const row = result.rows[0];

  if (!row || !verifyPassword(normalized.password, row.password_hash)) {
    throw new MobileCustomerAuthValidationError(["Credenciais invalidas para o aplicativo mobile."]);
  }

  if (row.status !== "active") {
    throw new MobileCustomerAuthValidationError(["O cadastro do cliente esta bloqueado."]);
  }

  const loginUpdate = await querySaas<MobileCustomerAccountRow>(
    `
      UPDATE mobile_customer_account
      SET
        updated_at = NOW(),
        last_login_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        company_id,
        $2::text AS company_name,
        document_type,
        document_number,
        full_name,
        phone,
        email,
        birth_date,
        birth_date_updated_at,
        password_hash,
        status,
        created_at,
        updated_at,
        last_login_at
    `,
    [row.id, row.company_name],
  );

  return buildSession(mapMobileCustomerRow(loginUpdate.rows[0]));
}

type UpdateMobileCustomerProfileInput = {
  fullName?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
};

function validateUpdateProfileInput(input?: Partial<UpdateMobileCustomerProfileInput> | null): string[] {
  const issues: string[] = [];

  const fullName = String(input?.fullName ?? "").trim();
  if (fullName && fullName.length < 3) {
    issues.push("Informe um nome completo valido.");
  }

  const phoneRaw = String(input?.phone ?? "").trim();
  if (phoneRaw) {
    const formatted = formatMobileCustomerPhone(phoneRaw);
    const digits = onlyDigits(formatted);
    if (digits.length < 10 || digits.length > 11) {
      issues.push("Informe um telefone valido com DDD.");
    }
  }

  const email = String(input?.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push("Informe um e-mail valido.");
  }

  const birthDateRaw = String(input?.birthDate ?? "").trim();
  if (birthDateRaw) {
    const normalized = normalizeMobileCustomerBirthDate(birthDateRaw);
    if (!normalized) {
      issues.push("Informe uma data de nascimento valida.");
    }
  }

  return issues;
}

function canUpdateBirthDateOncePerYear(lastUpdatedAt: string | Date | null | undefined): boolean {
  if (!lastUpdatedAt) {
    return true;
  }

  const updated = new Date(lastUpdatedAt);
  if (Number.isNaN(updated.getTime())) {
    return true;
  }

  return updated.getUTCFullYear() !== new Date().getUTCFullYear();
}

export async function updateMobileCustomerProfile(params: {
  accountId: string;
  companyId: string;
  input: UpdateMobileCustomerProfileInput;
}): Promise<MobileCustomerAccount> {
  const issues = validateUpdateProfileInput(params.input);
  if (issues.length > 0) {
    throw new MobileCustomerAuthValidationError(issues);
  }

  await ensureMobileCustomerSchema();
  const existing = await loadMobileCustomerAccountById(params.accountId);
  if (!existing || existing.company_id !== params.companyId) {
    throw new MobileCustomerAuthValidationError(["A conta mobile informada nao foi encontrada para este tenant."]);
  }

  const nextFullName = String(params.input.fullName ?? "").trim();
  const nextEmail = String(params.input.email ?? "").trim().toLowerCase();
  const nextPhoneFormatted = params.input.phone ? formatMobileCustomerPhone(params.input.phone) : "";
  const nextPhoneDigits = nextPhoneFormatted ? onlyDigits(nextPhoneFormatted) : "";
  const normalizedBirthDate = params.input.birthDate ? normalizeMobileCustomerBirthDate(params.input.birthDate) : "";

  const wantsBirthDateUpdate = Boolean(normalizedBirthDate) && normalizedBirthDate !== (existing.birth_date ? new Date(existing.birth_date).toISOString().slice(0, 10) : "");
  if (wantsBirthDateUpdate && !canUpdateBirthDateOncePerYear(existing.birth_date_updated_at)) {
    throw new MobileCustomerAuthValidationError(["A data de nascimento pode ser ajustada apenas uma vez por ano."]);
  }

  if (nextEmail && nextEmail !== existing.email) {
    const duplicate = await querySaas<{ id: string }>(
      `
        SELECT id
        FROM mobile_customer_account
        WHERE company_id = $1
          AND email = $2
          AND id <> $3
        LIMIT 1
      `,
      [params.companyId, nextEmail, params.accountId],
    );

    if (duplicate.rows[0]) {
      throw new MobileCustomerAuthValidationError(["Ja existe um cliente cadastrado com este e-mail nesta empresa."]);
    }
  }

  const result = await querySaas<MobileCustomerAccountRow>(
    `
      UPDATE mobile_customer_account
      SET
        full_name = COALESCE(NULLIF($3::text, ''), full_name),
        phone = COALESCE(NULLIF($4::text, ''), phone),
        email = COALESCE(NULLIF($5::text, ''), email),
        birth_date = COALESCE($6::date, birth_date),
        birth_date_updated_at = CASE
          WHEN $6::date IS NOT NULL AND $6::date IS DISTINCT FROM birth_date THEN NOW()
          ELSE birth_date_updated_at
        END,
        updated_at = NOW()
      WHERE id = $1
        AND company_id = $2
      RETURNING
        id,
        company_id,
        $7::text AS company_name,
        document_type,
        document_number,
        full_name,
        phone,
        email,
        birth_date,
        birth_date_updated_at,
        password_hash,
        status,
        created_at,
        updated_at,
        last_login_at
    `,
    [
      params.accountId,
      params.companyId,
      nextFullName,
      nextPhoneDigits,
      nextEmail,
      normalizedBirthDate || null,
      existing.company_name,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new MobileCustomerAuthValidationError(["Nao foi possivel atualizar os dados do perfil."]);
  }

  return mapMobileCustomerRow(row);
}

export async function requireMobileCustomerSession(req: Request): Promise<MobileCustomerSessionContext> {
  const token = parseBearerToken(req);
  if (!token) {
    throw new MobileCustomerAuthValidationError(["A sessao do app mobile nao foi autenticada."]);
  }

  const payload = verifyAccessToken(token);
  if (!payload?.sub || !payload.companyId) {
    throw new MobileCustomerAuthValidationError(["A sessao do app mobile expirou ou e invalida."]);
  }

  const row = await loadMobileCustomerAccountById(payload.sub);
  if (!row || row.company_id !== payload.companyId) {
    throw new MobileCustomerAuthValidationError(["A conta mobile informada nao foi encontrada para este tenant."]);
  }

  if (row.status !== "active") {
    throw new MobileCustomerAuthValidationError(["O cadastro do cliente mobile esta bloqueado."]);
  }

  return {
    accountId: row.id,
    companyId: row.company_id,
    customer: mapMobileCustomerRow(row),
    documentNumberDigits: onlyDigits(row.document_number),
  };
}
