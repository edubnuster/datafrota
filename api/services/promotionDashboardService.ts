import type { Promotion, PromotionStatus } from "../../shared/promotion.js";
import type {
  PromotionDashboardBranchStat,
  PromotionDashboardIntegrationBreakdownItem,
  PromotionDashboardIntegrationState,
  PromotionDashboardLimitBreakdownItem,
  PromotionDashboardStats,
  PromotionDashboardStatusBreakdownItem,
  PromotionDashboardVoucherStat,
} from "../../shared/promotionDashboard.js";
import { query } from "../db.js";
import { listPromotions } from "./promotionService.js";

type PromotionDashboardOptions = {
  companyId?: string | null;
};

type VoucherUsageRow = {
  short_code: string;
  authorization_id: string;
  usage_count: string | number;
  applied_usage_count: string | number;
  total_discount: string | number | null;
  applied_discount: string | number | null;
  today_usage_count: string | number;
  today_discount: string | number | null;
  total_volume: string | number | null;
  today_volume: string | number | null;
  unique_customers: string | number;
  pdv_count: string | number;
  branch_count: string | number;
  last_usage_at: string | Date | null;
};

type VoucherBranchRow = {
  short_code: string;
  branch_id: string | null;
  branch_name_hex: string | null;
  pdv_count: string | number;
  usage_count: string | number;
  applied_usage_count: string | number;
  total_discount: string | number | null;
};

type DashboardReachRow = {
  pdv_count: string | number;
  branch_count: string | number;
};

const STATUS_LABELS: Record<PromotionStatus, string> = {
  ativa: "Ativas",
  agendada: "Agendadas",
  pausada: "Pausadas",
  encerrada: "Encerradas",
};

const INTEGRATION_LABELS: Record<PromotionDashboardIntegrationState, string> = {
  published: "Publicadas no PDV",
  pending: "Pendentes",
  cancelled: "Canceladas no PDV",
  error: "Com erro no PDV",
  unpublished: "Sem publicacao",
};

const LIMIT_LABELS: PromotionDashboardLimitBreakdownItem[] = [
  { key: "maxDiscountPerDay", label: "Desconto max./dia", total: 0 },
  { key: "maxVolumePerDay", label: "Volume max./dia", total: 0 },
  { key: "maxQuantityPerItem", label: "Qtd. max. por item", total: 0 },
  { key: "redemptionsPerCustomer", label: "Resgates por cliente", total: 0 },
  { key: "maxPurchasesPerWeek", label: "Compras por semana", total: 0 },
  { key: "maxPurchasesPerMonth", label: "Compras por mes", total: 0 },
  { key: "couponValidityMinutes", label: "Validade do codigo", total: 0 },
];

function asNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function decodeLegacyText(hexValue: string | null | undefined): string {
  if (!hexValue) {
    return "";
  }

  return Buffer.from(hexValue, "hex").toString("latin1").trim();
}

function parseOptionalMetric(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const normalized = Number(value.replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
}

function countConfiguredLimits(promotion: Promotion): number {
  const candidates = [
    promotion.maxDiscountPerDay,
    promotion.maxVolumePerDay,
    promotion.maxQuantityPerItem,
    promotion.redemptionsPerCustomer,
    promotion.maxPurchasesPerWeek,
    promotion.maxPurchasesPerMonth,
    promotion.couponValidityMinutes,
  ];

  return candidates.filter((value) => value.trim().length > 0).length;
}

async function loadVoucherUsage(voucherCodes: string[]): Promise<Map<string, VoucherUsageRow>> {
  if (voucherCodes.length === 0) {
    return new Map();
  }

  const result = await query<VoucherUsageRow>(
    `
      SELECT
        da.short_code,
        da.id AS authorization_id,
        COUNT(*) FILTER (WHERE dp.status IN ('R', 'A')) AS usage_count,
        COUNT(*) FILTER (WHERE dp.status = 'A') AS applied_usage_count,
        COALESCE(SUM(COALESCE(dp.valor_desconto, 0)) FILTER (WHERE dp.status IN ('R', 'A')), 0) AS total_discount,
        COALESCE(SUM(COALESCE(dp.valor_desconto, 0)) FILTER (WHERE dp.status = 'A'), 0) AS applied_discount,
        COUNT(*) FILTER (WHERE dp.status IN ('R', 'A') AND dp.caixa_data = CURRENT_DATE) AS today_usage_count,
        COALESCE(
          SUM(COALESCE(dp.valor_desconto, 0)) FILTER (WHERE dp.status IN ('R', 'A') AND dp.caixa_data = CURRENT_DATE),
          0
        ) AS today_discount,
        COALESCE(SUM(COALESCE(dp.quantidade, 0)) FILTER (WHERE dp.status IN ('R', 'A')), 0) AS total_volume,
        COALESCE(
          SUM(COALESCE(dp.quantidade, 0)) FILTER (WHERE dp.status IN ('R', 'A') AND dp.caixa_data = CURRENT_DATE),
          0
        ) AS today_volume,
        COUNT(DISTINCT dp.estacao)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.estacao IS NOT NULL) AS pdv_count,
        COUNT(DISTINCT dp.resolved_branch_id)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.resolved_branch_id IS NOT NULL) AS branch_count,
        COUNT(DISTINCT dp.resolved_customer_code)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.resolved_customer_code IS NOT NULL) AS unique_customers,
        MAX(COALESCE(dp.aplicado_em, dp.reservado_em, dp.criado_em)) AS last_usage_at
      FROM discount_authorization da
      LEFT JOIN datafrota_desconto_pendente dp
        ON dp.discount_authorization_id = da.id
      WHERE da.short_code = ANY($1::text[])
      GROUP BY da.id, da.short_code
    `,
    [voucherCodes],
  );

  return new Map(result.rows.map((row) => [row.short_code, row]));
}

async function loadVoucherBranchBreakdown(
  voucherCodes: string[],
): Promise<Map<string, PromotionDashboardBranchStat[]>> {
  if (voucherCodes.length === 0) {
    return new Map();
  }

  const result = await query<VoucherBranchRow>(
    `
      SELECT
        da.short_code,
        dp.resolved_branch_id AS branch_id,
        ENCODE(CONVERT_TO(COALESCE(e.nome, 'Sem nome'), 'LATIN1'), 'hex') AS branch_name_hex,
        COUNT(DISTINCT dp.estacao)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.estacao IS NOT NULL) AS pdv_count,
        COUNT(*) FILTER (WHERE dp.status IN ('R', 'A')) AS usage_count,
        COUNT(*) FILTER (WHERE dp.status = 'A') AS applied_usage_count,
        COALESCE(SUM(COALESCE(dp.valor_desconto, 0)) FILTER (WHERE dp.status IN ('R', 'A')), 0) AS total_discount
      FROM discount_authorization da
      JOIN datafrota_desconto_pendente dp
        ON dp.discount_authorization_id = da.id
      LEFT JOIN empresa e
        ON CAST(e.grid AS TEXT) = dp.resolved_branch_id
      WHERE da.short_code = ANY($1::text[])
        AND dp.status IN ('R', 'A')
        AND dp.resolved_branch_id IS NOT NULL
      GROUP BY da.short_code, dp.resolved_branch_id, e.nome
      ORDER BY da.short_code ASC, total_discount DESC, usage_count DESC
    `,
    [voucherCodes],
  );

  const grouped = new Map<string, PromotionDashboardBranchStat[]>();

  for (const row of result.rows) {
    const branchName = decodeLegacyText(row.branch_name_hex) || `Filial ${row.branch_id ?? "-"}`;
    const stats: PromotionDashboardBranchStat = {
      branchId: row.branch_id ?? "",
      branchName,
      pdvCount: asNumber(row.pdv_count),
      usageCount: asNumber(row.usage_count),
      appliedUsageCount: asNumber(row.applied_usage_count),
      totalDiscount: asNumber(row.total_discount),
    };

    const current = grouped.get(row.short_code) ?? [];
    current.push(stats);
    grouped.set(row.short_code, current);
  }

  return grouped;
}

async function loadDashboardReach(voucherCodes: string[]): Promise<DashboardReachRow> {
  if (voucherCodes.length === 0) {
    return {
      pdv_count: 0,
      branch_count: 0,
    };
  }

  const result = await query<DashboardReachRow>(
    `
      SELECT
        COUNT(DISTINCT dp.estacao)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.estacao IS NOT NULL) AS pdv_count,
        COUNT(DISTINCT dp.resolved_branch_id)
          FILTER (WHERE dp.status IN ('R', 'A') AND dp.resolved_branch_id IS NOT NULL) AS branch_count
      FROM discount_authorization da
      LEFT JOIN datafrota_desconto_pendente dp
        ON dp.discount_authorization_id = da.id
      WHERE da.short_code = ANY($1::text[])
    `,
    [voucherCodes],
  );

  return result.rows[0] ?? { pdv_count: 0, branch_count: 0 };
}

function buildStatusBreakdown(promotions: Promotion[]): PromotionDashboardStatusBreakdownItem[] {
  const totals = promotions.reduce<Record<PromotionStatus, number>>(
    (acc, promotion) => {
      acc[promotion.status] += 1;
      return acc;
    },
    {
      ativa: 0,
      agendada: 0,
      pausada: 0,
      encerrada: 0,
    },
  );

  return (Object.keys(totals) as PromotionStatus[]).map((status) => ({
    status,
    label: STATUS_LABELS[status],
    total: totals[status],
  }));
}

function buildIntegrationBreakdown(promotions: Promotion[]): PromotionDashboardIntegrationBreakdownItem[] {
  const totals = promotions.reduce<Record<PromotionDashboardIntegrationState, number>>(
    (acc, promotion) => {
      const state = promotion.integration?.state ?? "unpublished";
      acc[state] += 1;
      return acc;
    },
    {
      published: 0,
      pending: 0,
      cancelled: 0,
      error: 0,
      unpublished: 0,
    },
  );

  return (Object.keys(totals) as PromotionDashboardIntegrationState[]).map((state) => ({
    state,
    label: INTEGRATION_LABELS[state],
    total: totals[state],
  }));
}

function buildLimitBreakdown(promotions: Promotion[]): PromotionDashboardLimitBreakdownItem[] {
  const counters = new Map(LIMIT_LABELS.map((item) => [item.key, { ...item }]));

  for (const promotion of promotions) {
    if (promotion.maxDiscountPerDay.trim()) {
      counters.get("maxDiscountPerDay")!.total += 1;
    }
    if (promotion.maxVolumePerDay.trim()) {
      counters.get("maxVolumePerDay")!.total += 1;
    }
    if (promotion.maxQuantityPerItem.trim()) {
      counters.get("maxQuantityPerItem")!.total += 1;
    }
    if (promotion.redemptionsPerCustomer.trim()) {
      counters.get("redemptionsPerCustomer")!.total += 1;
    }
    if (promotion.maxPurchasesPerWeek.trim()) {
      counters.get("maxPurchasesPerWeek")!.total += 1;
    }
    if (promotion.maxPurchasesPerMonth.trim()) {
      counters.get("maxPurchasesPerMonth")!.total += 1;
    }
    if (promotion.couponValidityMinutes.trim()) {
      counters.get("couponValidityMinutes")!.total += 1;
    }
  }

  return LIMIT_LABELS.map((item) => counters.get(item.key)!);
}

function buildVoucherStat(
  promotion: Promotion,
  usage: VoucherUsageRow | undefined,
  branchBreakdown: PromotionDashboardBranchStat[],
): PromotionDashboardVoucherStat {
  const configuredLimitCount = countConfiguredLimits(promotion);

  return {
    promotionId: promotion.id,
    name: promotion.name,
    voucherMode: promotion.voucherMode,
    voucherCode: promotion.voucherCode,
    status: promotion.status,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
    startDate: promotion.startDate,
    endDate: promotion.endDate,
    integrationState: promotion.integration?.state ?? "unpublished",
    integrationError: promotion.integration?.error ?? null,
    authorizationId: promotion.integration?.authorizationId ?? usage?.authorization_id ?? null,
    hasSecurityLimits: configuredLimitCount > 0,
    configuredLimitCount,
    maxDiscountPerDay: parseOptionalMetric(promotion.maxDiscountPerDay),
    maxVolumePerDay: parseOptionalMetric(promotion.maxVolumePerDay),
    maxQuantityPerItem: parseOptionalMetric(promotion.maxQuantityPerItem),
    redemptionsPerCustomer: parseOptionalMetric(promotion.redemptionsPerCustomer),
    maxPurchasesPerWeek: parseOptionalMetric(promotion.maxPurchasesPerWeek),
    maxPurchasesPerMonth: parseOptionalMetric(promotion.maxPurchasesPerMonth),
    couponValidityMinutes: parseOptionalMetric(promotion.couponValidityMinutes),
    usageCount: asNumber(usage?.usage_count),
    appliedUsageCount: asNumber(usage?.applied_usage_count),
    totalDiscount: asNumber(usage?.total_discount),
    appliedDiscount: asNumber(usage?.applied_discount),
    todayUsageCount: asNumber(usage?.today_usage_count),
    todayDiscount: asNumber(usage?.today_discount),
    totalVolume: asNumber(usage?.total_volume),
    todayVolume: asNumber(usage?.today_volume),
    pdvCount: asNumber(usage?.pdv_count),
    branchCount: asNumber(usage?.branch_count),
    uniqueCustomers: asNumber(usage?.unique_customers),
    lastUsageAt: usage?.last_usage_at ? new Date(usage.last_usage_at).toISOString() : null,
    branchBreakdown,
  };
}

export async function getPromotionDashboardStats(
  options: PromotionDashboardOptions = {},
): Promise<PromotionDashboardStats> {
  const promotions = await listPromotions({
    companyId: options.companyId,
  });
  const voucherCodes = Array.from(new Set(promotions.map((promotion) => promotion.voucherCode).filter(Boolean)));
  const usageByVoucherCode = await loadVoucherUsage(voucherCodes);
  const branchBreakdownByVoucherCode = await loadVoucherBranchBreakdown(voucherCodes);
  const dashboardReach = await loadDashboardReach(voucherCodes);
  const vouchers = promotions
    .map((promotion) =>
      buildVoucherStat(
        promotion,
        usageByVoucherCode.get(promotion.voucherCode),
        branchBreakdownByVoucherCode.get(promotion.voucherCode) ?? [],
      ),
    )
    .sort((first, second) => {
      if (second.todayDiscount !== first.todayDiscount) {
        return second.todayDiscount - first.todayDiscount;
      }
      if (second.totalDiscount !== first.totalDiscount) {
        return second.totalDiscount - first.totalDiscount;
      }
      return second.startDate.localeCompare(first.startDate);
    });

  const statusBreakdown = buildStatusBreakdown(promotions);
  const integrationBreakdown = buildIntegrationBreakdown(promotions);
  const limitBreakdown = buildLimitBreakdown(promotions);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      totalPromotions: promotions.length,
      activePromotions: statusBreakdown.find((item) => item.status === "ativa")?.total ?? 0,
      scheduledPromotions: statusBreakdown.find((item) => item.status === "agendada")?.total ?? 0,
      pausedPromotions: statusBreakdown.find((item) => item.status === "pausada")?.total ?? 0,
      endedPromotions: statusBreakdown.find((item) => item.status === "encerrada")?.total ?? 0,
      publishedPromotions: integrationBreakdown.find((item) => item.state === "published")?.total ?? 0,
      promotionsWithUsage: vouchers.filter((item) => item.usageCount > 0).length,
      promotionsWithUsageToday: vouchers.filter((item) => item.todayUsageCount > 0).length,
      usageCount: vouchers.reduce((total, item) => total + item.usageCount, 0),
      appliedUsageCount: vouchers.reduce((total, item) => total + item.appliedUsageCount, 0),
      totalDiscount: vouchers.reduce((total, item) => total + item.totalDiscount, 0),
      appliedDiscount: vouchers.reduce((total, item) => total + item.appliedDiscount, 0),
      todayDiscount: vouchers.reduce((total, item) => total + item.todayDiscount, 0),
      totalVolume: vouchers.reduce((total, item) => total + item.totalVolume, 0),
      todayVolume: vouchers.reduce((total, item) => total + item.todayVolume, 0),
      pdvsWithUsage: asNumber(dashboardReach.pdv_count),
      branchesWithUsage: asNumber(dashboardReach.branch_count),
      promotionsWithSecurityLimits: vouchers.filter((item) => item.hasSecurityLimits).length,
    },
    statusBreakdown,
    integrationBreakdown,
    limitBreakdown,
    vouchers,
  };
}
