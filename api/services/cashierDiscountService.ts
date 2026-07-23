import { ensureCashierSchema, query, withTransaction } from "../db.js";
import { getDiscountCodeTenantScope, resolveDiscountCode } from "./discountCodeService.js";
import { assertAgentVoucherAccess, type PdvAgentSession } from "./pdvAgentService.js";
import type {
  CashierContext,
  CashierPendingAuthorization,
  CashierVoucherValidation,
  CreateCashierAuthorizationInput,
} from "../../shared/cashier.js";

const DEFAULT_PENDING_VALIDITY_MINUTES = 5;

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
  first_purchase_only: boolean | null;
  new_customer_days: string | number | null;
  payment_form_codes: string[] | null;
  payment_form_code: string | null;
  tipo_desconto: "percent" | "fixed" | null;
  percentual_desconto: string | number;
  valor_fixo_configurado: string | number | null;
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

type CashierOperationalContext = {
  saleDate: string | null;
  turno: number | null;
  usuario: string | null;
  branchId: string | null;
};

type CashierOperationalContextRow = {
  data: string | Date | null;
  turno: number | string | null;
  usuario: string | null;
  empresa: string | number | null;
};

type LocalBranchRow = {
  grid: string | number | null;
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
  const discountType = row.tipo_desconto === "fixed" ? "fixed" : "percent";

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
    firstPurchaseOnly: Boolean(row.first_purchase_only),
    newCustomerDays:
      row.new_customer_days === null || row.new_customer_days === undefined
        ? null
        : Number(row.new_customer_days),
    paymentFormCodes: coalesceLegacyList(row.payment_form_codes, row.payment_form_code),
    discountType,
    discountPercent: discountType === "percent" ? Number(row.percentual_desconto) : null,
    discountValue:
      discountType === "fixed"
        ? row.valor_fixo_configurado === null || row.valor_fixo_configurado === undefined
          ? null
          : Number(row.valor_fixo_configurado)
        : row.valor_desconto === null || row.valor_desconto === undefined
          ? null
          : Number(row.valor_desconto),
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
  promotion_id: string | null;
  promotion_name: string | null;
  voucher_origin: "manual" | "promotion_fixed" | "promotion_mobile";
  issued_to_customer_code: string | null;
  issued_to_customer_group_code: string | null;
  issued_document_type: "cpf" | "cnpj" | null;
  issued_document_number: string | null;
  require_customer_document_at_cashier: boolean;
  product_codes: string[];
  product_group_codes: string[];
  customer_codes: string[];
  customer_group_codes: string[];
  first_purchase_only: boolean;
  new_customer_days: number | null;
  branch_ids: string[];
  payment_form_codes: string[];
  active_weekdays: string[];
  start_time: string | null;
  end_time: string | null;
  birthday_only: boolean;
  max_discount_per_day: number | null;
  max_volume_per_day: number | null;
  max_quantity_per_item: number | null;
  redemptions_per_customer: number | null;
  max_purchases_per_week: number | null;
  max_purchases_per_month: number | null;
  reusable: boolean;
};

async function loadAuthorizationRestrictions(
  authorizationId: string,
): Promise<AuthorizationRestrictionsRow> {
  const result = await query<AuthorizationRestrictionsRow>(
    `
      SELECT
        promotion_id,
        promotion_name,
        COALESCE(voucher_origin, 'manual') AS voucher_origin,
        issued_to_customer_code,
        issued_to_customer_group_code,
        issued_document_type,
        issued_document_number,
        COALESCE(require_customer_document_at_cashier, FALSE) AS require_customer_document_at_cashier,
        ${buildLegacyCompatibleArraySql("product_codes", "product_code")} AS product_codes,
        ${buildLegacyCompatibleArraySql("product_group_codes", "product_group_code")} AS product_group_codes,
        ${buildLegacyCompatibleArraySql("customer_codes", "customer_code")} AS customer_codes,
        ${buildLegacyCompatibleArraySql("customer_group_codes", "customer_group_code")} AS customer_group_codes,
        COALESCE(first_purchase_only, FALSE) AS first_purchase_only,
        new_customer_days,
        COALESCE(branch_ids, ARRAY[]::text[]) AS branch_ids,
        ${buildLegacyCompatibleArraySql("payment_form_codes", "payment_form_code")} AS payment_form_codes,
        COALESCE(active_weekdays, ARRAY[]::text[]) AS active_weekdays,
        start_time,
        end_time,
        COALESCE(birthday_only, FALSE) AS birthday_only,
        max_discount_per_day,
        max_volume_per_day,
        max_quantity_per_item,
        redemptions_per_customer,
        max_purchases_per_week,
        max_purchases_per_month,
        COALESCE(reusable, FALSE) AS reusable
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

async function loadLocalBranchId(): Promise<string | null> {
  const result = await query<LocalBranchRow>(
    `
      SELECT grid
      FROM public.empresa_local
      WHERE grid IS NOT NULL
      ORDER BY sid ASC, grid DESC
      LIMIT 1
    `,
  );

  const grid = result.rows[0]?.grid;
  return grid === null || grid === undefined ? null : String(grid);
}

async function mapCashierOperationalContextRow(
  row?: CashierOperationalContextRow | null,
): Promise<CashierOperationalContext> {
  const localBranchId = await loadLocalBranchId();
  return {
    saleDate: row?.data ? new Date(row.data).toISOString() : null,
    turno: row?.turno === null || row?.turno === undefined ? null : Number(row.turno),
    usuario: row?.usuario ?? null,
    branchId: localBranchId ?? (row?.empresa === null || row?.empresa === undefined ? null : String(row.empresa)),
  };
}

async function loadCashierOperationalContext(conta?: string | null): Promise<CashierOperationalContext> {
  const normalizedConta = normalizeText(conta);
  if (!normalizedConta) {
    return mapCashierOperationalContextRow(null);
  }

  const result = await query<CashierOperationalContextRow>(
    `
      SELECT data, turno, usuario, empresa
      FROM public.caixa
      WHERE conta = $1
        AND fechamento IS NULL
      ORDER BY data DESC NULLS LAST, abertura DESC NULLS LAST
      LIMIT 1
    `,
    [normalizedConta],
  );

  return mapCashierOperationalContextRow(result.rows[0] ?? null);
}

function resolveWeekday(date: string): string {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(date).getDay()] ?? "dom";
}

function validateVoucherOperationalContext(
  restrictions: AuthorizationRestrictionsRow,
  operationalContext: CashierOperationalContext,
): string | null {
  if (restrictions.branch_ids.length > 0) {
    if (!operationalContext.branchId) {
      return "Nao foi possivel identificar a filial do caixa para validar o voucher.";
    }

    if (!restrictions.branch_ids.includes(operationalContext.branchId)) {
      return "Voucher nao liberado para a filial deste caixa.";
    }
  }

  if (restrictions.active_weekdays.length > 0) {
    const baseDate = operationalContext.saleDate ?? new Date().toISOString();
    const weekday = resolveWeekday(baseDate);
    if (!restrictions.active_weekdays.includes(weekday)) {
      return "Voucher nao liberado para o dia atual.";
    }
  }

  return null;
}

export async function resolveCashierContext(stationHint?: string | null): Promise<CashierContext> {
  const normalizedHint = normalizeStationHint(stationHint);
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
    return {
      conta: null,
      estacao: normalizedHint,
      data: null,
      turno: null,
      usuario: null,
      stationSource: "HINT",
    };
  }

  return mapCashierContextRow(result.rows[0]);
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
  const issuedDocumentDigits = String(authorization.issuedDocumentNumber ?? "").replace(/\D/g, "");
  const issuedDocumentHint =
    issuedDocumentDigits.length <= 4
      ? issuedDocumentDigits || null
      : `${"*".repeat(Math.max(issuedDocumentDigits.length - 4, 0))}${issuedDocumentDigits.slice(-4)}`;
  return {
    shortCode,
    found: result.found,
    reason: result.reason,
    authorization: {
      id: authorization.id,
      discountType: authorization.discountType,
      discountPercent: authorization.discountPercent,
      discountValue: authorization.discountValue,
      scope: authorization.scope,
      productCodes: authorization.productCodes,
      productGroupCodes: authorization.productGroupCodes,
      customerCodes: authorization.customerCodes,
      customerGroupCodes: authorization.customerGroupCodes,
      firstPurchaseOnly: authorization.firstPurchaseOnly,
      newCustomerDays: authorization.newCustomerDays,
      selectedBranchIds: authorization.selectedBranchIds,
      paymentFormCodes: authorization.paymentFormCodes,
      activeWeekdays: authorization.activeWeekdays,
      startTime: authorization.startTime,
      endTime: authorization.endTime,
      birthdayOnly: authorization.birthdayOnly,
      maxDiscountPerDay: authorization.maxDiscountPerDay,
      maxVolumePerDay: authorization.maxVolumePerDay,
      maxQuantityPerItem: authorization.maxQuantityPerItem,
      redemptionsPerCustomer: authorization.redemptionsPerCustomer,
      maxPurchasesPerWeek: authorization.maxPurchasesPerWeek,
      maxPurchasesPerMonth: authorization.maxPurchasesPerMonth,
      reusable: authorization.reusable,
      validFrom: authorization.validFrom,
      validUntil: authorization.validUntil,
      promotionId: authorization.promotionId,
      promotionName: authorization.promotionName,
      voucherOrigin: authorization.voucherOrigin,
      issuedToCustomerCode: authorization.issuedToCustomerCode,
      issuedToCustomerGroupCode: authorization.issuedToCustomerGroupCode,
      issuedDocumentType: authorization.issuedDocumentType,
      issuedDocumentHint,
      requireCustomerDocumentAtCashier: authorization.requireCustomerDocumentAtCashier,
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
  const documentNumber = String(input.documentNumber ?? "").replace(/\D/g, "") || null;

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
    documentNumber,
    mensagemDoc: normalizeText(input.mensagemDoc),
    mensagemPdv: normalizeText(input.mensagemPdv),
  };
}

export async function validateCashierVoucher(
  shortCode: string,
  session?: PdvAgentSession,
): Promise<CashierVoucherValidation> {
  const code = shortCode.trim().toUpperCase();
  if (session) {
    await assertAgentVoucherAccess(session, code);

    const tenantScope = await getDiscountCodeTenantScope(code);
    if (tenantScope?.companyId && tenantScope.companyId !== session.companyId) {
      throw new CashierVoucherError("Este voucher nao pertence a empresa vinculada a este PDV.", 403);
    }
  }

  const result = await resolveDiscountCode(code);
  return buildValidationPayload(code, result);
}

export async function createCashierAuthorization(
  input: CreateCashierAuthorizationInput,
  session?: PdvAgentSession,
): Promise<CashierPendingAuthorization> {
  const normalized = validateAuthorizeInput(input);
  const voucher = await validateCashierVoucher(normalized.shortCode, session);

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

  const operationalContext = await loadCashierOperationalContext(cashierContext.conta);
  const contextIssue = validateVoucherOperationalContext(authorizationRestrictions, operationalContext);
  if (contextIssue) {
    throw new CashierVoucherError(contextIssue, 409);
  }

  if (authorizationRestrictions.require_customer_document_at_cashier) {
    if (!normalized.documentNumber) {
      throw new CashierVoucherError("Informe o CPF/CNPJ do cliente para confirmar este voucher.", 400);
    }

    const expectedDocument = String(authorizationRestrictions.issued_document_number ?? "").replace(/\D/g, "");
    if (!expectedDocument || normalized.documentNumber !== expectedDocument) {
      throw new CashierVoucherError("CPF/CNPJ divergente do cliente autorizado para esta promocao.", 403);
    }
  }

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
          company_id,
          source_branch_id,
          pdv_agent_id,
          codigo_desconto,
          abastecimento,
          conta,
          estacao,
          caixa_data,
          caixa_turno,
          caixa_usuario,
          tipo_desconto,
          percentual_desconto,
          valor_fixo_configurado,
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
          first_purchase_only,
          new_customer_days,
          branch_ids,
          payment_form_codes,
          payment_form_code,
          active_weekdays,
          start_time,
          end_time,
          birthday_only,
          max_discount_per_day,
          max_volume_per_day,
          max_quantity_per_item,
          redemptions_per_customer,
          max_purchases_per_week,
          max_purchases_per_month,
          reusable,
          mensagem_doc,
          mensagem_pdv
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, NULL, $15, 'P', $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
          $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42
        )
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
            first_purchase_only,
            new_customer_days,
            branch_ids,
            payment_form_codes,
            payment_form_code,
            active_weekdays,
            start_time,
            end_time,
            birthday_only,
            max_discount_per_day,
            max_volume_per_day,
            max_quantity_per_item,
            redemptions_per_customer,
            max_purchases_per_week,
            max_purchases_per_month,
            reusable,
            tipo_desconto,
            percentual_desconto,
            valor_fixo_configurado,
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
        session?.companyId ?? null,
        session?.branchId ?? null,
        session?.agentId ?? null,
        normalized.shortCode,
        normalized.abastecimento,
        cashierContext.conta,
        cashierContext.estacao,
        operationalContext.saleDate ? operationalContext.saleDate.slice(0, 10) : null,
        operationalContext.turno,
        operationalContext.usuario,
        voucher.authorization.discountType,
        voucher.authorization.discountPercent ?? 1,
        voucher.authorization.discountType === "fixed" ? voucher.authorization.discountValue : null,
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
        authorizationRestrictions.first_purchase_only,
        authorizationRestrictions.new_customer_days,
        authorizationRestrictions.branch_ids,
        authorizationRestrictions.payment_form_codes,
        authorizationRestrictions.payment_form_codes[0] ?? null,
        authorizationRestrictions.active_weekdays,
        authorizationRestrictions.start_time,
        authorizationRestrictions.end_time,
        authorizationRestrictions.birthday_only,
        authorizationRestrictions.max_discount_per_day,
        authorizationRestrictions.max_volume_per_day,
        authorizationRestrictions.max_quantity_per_item,
        authorizationRestrictions.redemptions_per_customer,
        authorizationRestrictions.max_purchases_per_week,
        authorizationRestrictions.max_purchases_per_month,
        authorizationRestrictions.reusable,
        normalized.mensagemDoc ?? "DESCONTO FIDELIDADE DATAFROTA",
        normalized.mensagemPdv ?? `DATAFROTA - CODIGO ${normalized.shortCode}`,
      ],
    );

    return inserted;
  }).catch((error: { code?: string; detail?: string }) => {
    if (error.code === "23505") {
      throw new CashierVoucherError(
        "Nao foi possivel substituir a pre-autorizacao anterior automaticamente.",
        409,
      );
    }

    throw error;
  });

  return mapPendingRow(result.rows[0]);
}

export async function getCashierAuthorizationStatus(
  shortCode: string,
  session?: PdvAgentSession,
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
        first_purchase_only,
        new_customer_days,
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
        AND ($2::text IS NULL OR company_id = $2::text)
      ORDER BY criado_em DESC
      LIMIT 1
    `,
    [code, session?.companyId ?? null],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapPendingRow(result.rows[0]);
}
