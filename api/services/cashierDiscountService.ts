import { ensureCashierSchema, query, withTransaction } from "../db.js";
import { resolveDiscountCode } from "./discountCodeService.js";
import type {
  CashierContext,
  CashierPendingAuthorization,
  CashierVoucherValidation,
  CreateCashierAuthorizationInput,
} from "../../shared/cashier.js";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const DEFAULT_PENDING_VALIDITY_MINUTES = 5;

// #region debug-point shared:cashier-report
function debugReportCashier(
  hypothesisId: string,
  location: string,
  msg: string,
  data: Record<string, unknown> = {},
  runId = "pre-fix",
): void {
  let debugServerUrl = "http://127.0.0.1:7778/event";
  let debugSessionId = "cashier-preauth-stuck";

  try {
    const envFile = readFileSync(".dbg/cashier-preauth-stuck.env", "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      if (line.startsWith("DEBUG_SERVER_URL=")) {
        debugServerUrl = line.split("=", 2)[1] || debugServerUrl;
      } else if (line.startsWith("DEBUG_SESSION_ID=")) {
        debugSessionId = line.split("=", 2)[1] || debugSessionId;
      }
    }
  } catch {
    // Ignora ausencia do arquivo de configuracao de debug local.
  }

  try {
    const url = new URL(debugServerUrl);
    const body = JSON.stringify({
      sessionId: debugSessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    });
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
      },
    );
    req.on("error", () => undefined);
    req.end(body);
  } catch {
    // Nao interrompe o fluxo principal se o relay de debug estiver indisponivel.
  }
}
// #endregion

type PendingAuthorizationRow = {
  grid: string | number;
  discount_authorization_id: string | null;
  codigo_desconto: string;
  abastecimento: string | number | null;
  conta: string | null;
  estacao: string | null;
  product_codes: string[] | null;
  product_code: string | null;
  product_group_codes: string[] | null;
  product_group_code: string | null;
  customer_codes: string[] | null;
  customer_code: string | null;
  customer_group_codes: string[] | null;
  customer_group_code: string | null;
  payment_form_codes: string[] | null;
  payment_form_code: string | null;
  percentual_desconto: string | number;
  valor_desconto: string | number | null;
  quantidade: string | number | null;
  status: CashierPendingAuthorization["status"];
  validade: string | Date;
  criado_em: string | Date;
  reservado_em: string | Date | null;
  aplicado_em: string | Date | null;
  cancelado_em: string | Date | null;
  lancto_caixa: string | number | null;
  mlid: string | number | null;
  mensagem_doc: string | null;
  mensagem_pdv: string | null;
  erro: string | null;
};

type CashierContextRow = {
  conta: string;
  estacao: string | null;
  data: string | Date | null;
  turno: number | string | null;
  usuario: string | null;
  station_source: CashierContext["stationSource"];
};

export class CashierVoucherError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CashierVoucherError";
  }
}

function normalizeText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function canonicalizeStation(value?: string | null): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const [machineName] = normalized.split(".", 1);
  return machineName || null;
}

function coalesceLegacyList(values?: string[] | null, legacyValue?: string | null): string[] {
  if (values && values.length > 0) {
    return values;
  }

  return legacyValue ? [legacyValue] : [];
}

function buildLegacyCompatibleArraySql(arrayColumn: string, legacyColumn: string): string {
  return `
    COALESCE(
      ${arrayColumn},
      CASE
        WHEN ${legacyColumn} IS NULL THEN ARRAY[]::text[]
        ELSE ARRAY[${legacyColumn}]
      END
    )
  `;
}

function mapPendingRow(row: PendingAuthorizationRow): CashierPendingAuthorization {
  return {
    id: Number(row.grid),
    shortCode: row.codigo_desconto,
    discountAuthorizationId: row.discount_authorization_id,
    abastecimento: row.abastecimento === null ? null : Number(row.abastecimento),
    conta: row.conta,
    estacao: row.estacao,
    productCodes: coalesceLegacyList(row.product_codes, row.product_code),
    productGroupCodes: coalesceLegacyList(row.product_group_codes, row.product_group_code),
    customerCodes: coalesceLegacyList(row.customer_codes, row.customer_code),
    customerGroupCodes: coalesceLegacyList(row.customer_group_codes, row.customer_group_code),
    paymentFormCodes: coalesceLegacyList(row.payment_form_codes, row.payment_form_code),
    discountPercent: Number(row.percentual_desconto),
    discountValue: row.valor_desconto === null ? null : Number(row.valor_desconto),
    quantity: row.quantidade === null ? null : Number(row.quantidade),
    status: row.status,
    validUntil: new Date(row.validade).toISOString(),
    createdAt: new Date(row.criado_em).toISOString(),
    reservedAt: row.reservado_em ? new Date(row.reservado_em).toISOString() : null,
    appliedAt: row.aplicado_em ? new Date(row.aplicado_em).toISOString() : null,
    cancelledAt: row.cancelado_em ? new Date(row.cancelado_em).toISOString() : null,
    lanctoCaixa: row.lancto_caixa === null ? null : Number(row.lancto_caixa),
    mlid: row.mlid === null ? null : Number(row.mlid),
    documentMessage: row.mensagem_doc,
    pdvMessage: row.mensagem_pdv,
    error: row.erro,
  };
}

function buildPendingValidity(validUntil: string | null): Date {
  const now = new Date();
  const pendingLimit = new Date(now.getTime() + DEFAULT_PENDING_VALIDITY_MINUTES * 60 * 1000);

  if (!validUntil) {
    return pendingLimit;
  }

  const voucherLimit = new Date(validUntil);
  return voucherLimit.getTime() < pendingLimit.getTime() ? voucherLimit : pendingLimit;
}

function mapCashierContextRow(row: CashierContextRow): CashierContext {
  return {
    conta: row.conta,
    estacao: row.estacao,
    data: row.data ? new Date(row.data).toISOString() : null,
    turno: row.turno === null ? null : Number(row.turno),
    usuario: row.usuario,
    stationSource: row.station_source,
  };
}

type AuthorizationRestrictionsRow = {
  product_codes: string[];
  product_group_codes: string[];
  customer_codes: string[];
  customer_group_codes: string[];
  payment_form_codes: string[];
};

async function loadAuthorizationRestrictions(
  authorizationId: string,
): Promise<AuthorizationRestrictionsRow> {
  const result = await query<AuthorizationRestrictionsRow>(
    `
      SELECT
        ${buildLegacyCompatibleArraySql("product_codes", "product_code")} AS product_codes,
        ${buildLegacyCompatibleArraySql("product_group_codes", "product_group_code")} AS product_group_codes,
        ${buildLegacyCompatibleArraySql("customer_codes", "customer_code")} AS customer_codes,
        ${buildLegacyCompatibleArraySql("customer_group_codes", "customer_group_code")} AS customer_group_codes,
        ${buildLegacyCompatibleArraySql("payment_form_codes", "payment_form_code")} AS payment_form_codes
      FROM discount_authorization
      WHERE id = $1
      LIMIT 1
    `,
    [authorizationId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new CashierVoucherError("Voucher nao encontrado para criacao da pre-autorizacao.", 404);
  }

  return row;
}

function normalizeStationHint(value?: string | null): string | null {
  return canonicalizeStation(value);
}

export async function resolveCashierContext(stationHint?: string | null): Promise<CashierContext> {
  const normalizedHint = normalizeStationHint(stationHint);
  // #region debug-point B:resolve-context-start
  debugReportCashier(
    "B",
    "cashierDiscountService.ts:resolveCashierContext",
    "[DEBUG] Inicio da resolucao de contexto do caixa",
    { stationHint: normalizedHint },
  );
  // #endregion
  if (!normalizedHint) {
    throw new CashierVoucherError("Nao foi possivel identificar a estacao do terminal.", 400);
  }

  const result = await query<CashierContextRow>(
    `
      WITH station_match AS (
        SELECT
          estacao,
          'CAIXA_VENDA'::text AS station_source,
          ts
        FROM public.caixa_venda
        WHERE UPPER(estacao) LIKE $1 || '%'
        UNION ALL
        SELECT
          estacao,
          'LANCTO_CAIXA'::text AS station_source,
          ts
        FROM public.lancto_caixa
        WHERE UPPER(estacao) LIKE $1 || '%'
      )
      SELECT
        NULL::text AS conta,
        sm.estacao,
        NULL::timestamp AS data,
        NULL::integer AS turno,
        NULL::text AS usuario,
        sm.station_source::text AS station_source
      FROM station_match sm
      ORDER BY sm.ts DESC NULLS LAST
      LIMIT 1
    `,
    [normalizedHint],
  );

  if (result.rows.length === 0) {
    // #region debug-point B:resolve-context-fallback
    debugReportCashier(
      "B",
      "cashierDiscountService.ts:resolveCashierContext",
      "[DEBUG] Nenhuma estacao encontrada, usando fallback pelo hint",
      { stationHint: normalizedHint },
    );
    // #endregion
    return {
      conta: null,
      estacao: normalizedHint,
      data: null,
      turno: null,
      usuario: null,
      stationSource: "HINT",
    };
  }

  const context = mapCashierContextRow(result.rows[0]);
  // #region debug-point B:resolve-context-success
  debugReportCashier(
    "B",
    "cashierDiscountService.ts:resolveCashierContext",
    "[DEBUG] Contexto do caixa resolvido com sucesso",
    context as unknown as Record<string, unknown>,
  );
  // #endregion
  return context;
}

function buildValidationPayload(shortCode: string, result: Awaited<ReturnType<typeof resolveDiscountCode>>): CashierVoucherValidation {
  if (!result.authorization) {
    return {
      shortCode,
      found: result.found,
      reason: result.reason,
    };
  }

  const authorization = result.authorization;
  return {
    shortCode,
    found: result.found,
    reason: result.reason,
    authorization: {
      id: authorization.id,
      discountPercent: authorization.discountPercent,
      scope: authorization.scope,
      productCodes: authorization.productCodes,
      productGroupCodes: authorization.productGroupCodes,
      customerCodes: authorization.customerCodes,
      customerGroupCodes: authorization.customerGroupCodes,
      paymentFormCodes: authorization.paymentFormCodes,
      validFrom: authorization.validFrom,
      validUntil: authorization.validUntil,
      status: authorization.status,
    },
  };
}

function validateAuthorizeInput(input: CreateCashierAuthorizationInput): CreateCashierAuthorizationInput {
  const shortCode = input.shortCode.trim().toUpperCase();
  const abastecimento =
    input.abastecimento === null || input.abastecimento === undefined ? null : Number(input.abastecimento);
  const quantity =
    input.quantidade === null || input.quantidade === undefined ? null : Number(input.quantidade);
  const conta = normalizeText(input.conta);
  const estacao = canonicalizeStation(input.estacao);
  const stationHint = canonicalizeStation(input.stationHint);

  if (!shortCode) {
    throw new CashierVoucherError("Informe o voucher do app frota.", 400);
  }

  if (abastecimento !== null && (!Number.isInteger(abastecimento) || abastecimento <= 0)) {
    throw new CashierVoucherError("Codigo de abastecimento invalido.", 400);
  }

  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
    throw new CashierVoucherError("A quantidade deve ser maior que zero quando informada.", 400);
  }

  return {
    shortCode,
    abastecimento,
    conta,
    estacao,
    stationHint,
    quantidade: quantity,
    mensagemDoc: normalizeText(input.mensagemDoc),
    mensagemPdv: normalizeText(input.mensagemPdv),
  };
}

export async function validateCashierVoucher(shortCode: string): Promise<CashierVoucherValidation> {
  const code = shortCode.trim().toUpperCase();
  const result = await resolveDiscountCode(code);
  return buildValidationPayload(code, result);
}

export async function createCashierAuthorization(
  input: CreateCashierAuthorizationInput,
): Promise<CashierPendingAuthorization> {
  const normalized = validateAuthorizeInput(input);
  // #region debug-point C:create-auth-start
  debugReportCashier(
    "C",
    "cashierDiscountService.ts:createCashierAuthorization",
    "[DEBUG] Inicio da criacao de pre-autorizacao",
    normalized as unknown as Record<string, unknown>,
  );
  // #endregion
  const voucher = await validateCashierVoucher(normalized.shortCode);

  if (!voucher.found || !voucher.authorization) {
    const reasonMap: Record<NonNullable<CashierVoucherValidation["reason"]>, string> = {
      NOT_FOUND: "Voucher nao encontrado.",
      EXPIRED: "Voucher expirado.",
      CANCELLED: "Voucher ja utilizado ou cancelado.",
      INVALID_CONTEXT: "Voucher invalido para o contexto atual.",
    };

    throw new CashierVoucherError(reasonMap[voucher.reason ?? "NOT_FOUND"], 404);
  }

  const authorizationRestrictions = await loadAuthorizationRestrictions(voucher.authorization.id);

  await ensureCashierSchema();
  const cashierContext =
    normalized.estacao
      ? {
          conta: normalized.conta,
          estacao: normalized.estacao,
          data: null,
          turno: null,
          usuario: null,
          stationSource: "HINT" as const,
        }
      : await resolveCashierContext(normalized.stationHint);

  if (!cashierContext.estacao) {
    throw new CashierVoucherError("Nao foi possivel identificar a estacao do terminal.", 409);
  }
  // #region debug-point C:create-auth-context
  debugReportCashier(
    "C",
    "cashierDiscountService.ts:createCashierAuthorization",
    "[DEBUG] Contexto definido para gravar a pre-autorizacao",
    cashierContext as unknown as Record<string, unknown>,
  );
  // #endregion

  const validUntil = buildPendingValidity(voucher.authorization.validUntil).toISOString();
  const result = await withTransaction<{ rows: PendingAuthorizationRow[] }>(async (txQuery) => {
    await txQuery(
      `
        DELETE FROM datafrota_desconto_pendente
         WHERE status IN ('P', 'R')
           AND (
             codigo_desconto = $1
             OR estacao = $2
             OR ($3::text IS NOT NULL AND conta = $3::text AND estacao = $2)
           )
      `,
      [normalized.shortCode, cashierContext.estacao, cashierContext.conta],
    );

    const inserted = await txQuery<PendingAuthorizationRow>(
      `
        INSERT INTO datafrota_desconto_pendente (
          discount_authorization_id,
          codigo_desconto,
          abastecimento,
          conta,
          estacao,
          caixa_data,
          caixa_turno,
          caixa_usuario,
          percentual_desconto,
          valor_desconto,
          quantidade,
          status,
          validade,
          product_codes,
          product_code,
          product_group_codes,
          product_group_code,
          customer_codes,
          customer_code,
          customer_group_codes,
          customer_group_code,
          payment_form_codes,
          payment_form_code,
          mensagem_doc,
          mensagem_pdv
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, 'P', $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING
            grid,
            discount_authorization_id,
            codigo_desconto,
            abastecimento,
            conta,
            estacao,
            product_codes,
            product_code,
            product_group_codes,
            product_group_code,
            customer_codes,
            customer_code,
            customer_group_codes,
            customer_group_code,
            payment_form_codes,
            payment_form_code,
            percentual_desconto,
            valor_desconto,
            quantidade,
            status,
            validade,
            criado_em,
            reservado_em,
            aplicado_em,
            cancelado_em,
            lancto_caixa,
            mlid,
            mensagem_doc,
            mensagem_pdv,
            erro
      `,
      [
        voucher.authorization.id,
        normalized.shortCode,
        normalized.abastecimento,
        cashierContext.conta,
        cashierContext.estacao,
        null,
        null,
        null,
        voucher.authorization.discountPercent,
        normalized.quantidade,
        validUntil,
        authorizationRestrictions.product_codes,
        authorizationRestrictions.product_codes[0] ?? null,
        authorizationRestrictions.product_group_codes,
        authorizationRestrictions.product_group_codes[0] ?? null,
        authorizationRestrictions.customer_codes,
        authorizationRestrictions.customer_codes[0] ?? null,
        authorizationRestrictions.customer_group_codes,
        authorizationRestrictions.customer_group_codes[0] ?? null,
        authorizationRestrictions.payment_form_codes,
        authorizationRestrictions.payment_form_codes[0] ?? null,
        normalized.mensagemDoc ?? "DESCONTO FIDELIDADE DATAFROTA",
        normalized.mensagemPdv ?? `DATAFROTA - CODIGO ${normalized.shortCode}`,
      ],
    );

    return inserted;
  }).catch((error: { code?: string; detail?: string }) => {
    // #region debug-point C:create-auth-insert-error
    debugReportCashier(
      "C",
      "cashierDiscountService.ts:createCashierAuthorization",
      "[DEBUG] Falha ao gravar pre-autorizacao",
      { code: error.code, detail: error.detail ?? null },
    );
    // #endregion
    if (error.code === "23505") {
      throw new CashierVoucherError(
        "Nao foi possivel substituir a pre-autorizacao anterior automaticamente.",
        409,
      );
    }

    throw error;
  });

  // #region debug-point C:create-auth-success
  debugReportCashier(
    "C",
    "cashierDiscountService.ts:createCashierAuthorization",
    "[DEBUG] Pre-autorizacao gravada com sucesso",
    result.rows[0] as unknown as Record<string, unknown>,
  );
  // #endregion
  return mapPendingRow(result.rows[0]);
}

export async function getCashierAuthorizationStatus(
  shortCode: string,
): Promise<CashierPendingAuthorization | null> {
  const code = shortCode.trim().toUpperCase();
  await ensureCashierSchema();

  const result = await query<PendingAuthorizationRow>(
    `
      SELECT
        grid,
        discount_authorization_id,
        codigo_desconto,
        abastecimento,
        conta,
        estacao,
        product_codes,
        product_code,
        product_group_codes,
        product_group_code,
        customer_codes,
        customer_code,
        customer_group_codes,
        customer_group_code,
        payment_form_codes,
        payment_form_code,
        percentual_desconto,
        percentual_desconto,
        percentual_desconto,
        valor_desconto,
        quantidade,
        status,
        validade,
        criado_em,
        reservado_em,
        aplicado_em,
        cancelado_em,
        lancto_caixa,
        mlid,
        mensagem_doc,
        mensagem_pdv,
        erro
      FROM datafrota_desconto_pendente
      WHERE codigo_desconto = $1
      ORDER BY criado_em DESC
      LIMIT 1
    `,
    [code],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapPendingRow(result.rows[0]);
}
