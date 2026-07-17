import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  CircleDollarSign,
  Globe,
  Megaphone,
  Monitor,
  ShieldCheck,
  Sparkles,
  TicketPercent,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import AppShell from "@/components/saas/AppShell";
import { useSaasStore } from "@/hooks/useSaasStore";
import type {
  PromotionDashboardIntegrationBreakdownItem,
  PromotionDashboardLimitBreakdownItem,
  PromotionDashboardStats,
  PromotionDashboardStatusBreakdownItem,
  PromotionDashboardVoucherStat,
} from "@/types/saas";
import { fetchPromotionDashboardStats } from "@/utils/api";
import { formatDateTime } from "@/utils/format";
import { formatDate, formatMoney, formatPlanLabel, formatStatusLabel } from "@/utils/saas";

type KpiCardProps = {
  label: string;
  value: string;
  supporting: string;
  icon: LucideIcon;
  accentClassName: string;
};

const promotionStatusBadgeStyles: Record<PromotionDashboardVoucherStat["status"], string> = {
  ativa: "bg-emerald-50 text-emerald-700",
  agendada: "bg-sky-50 text-sky-700",
  pausada: "bg-amber-50 text-amber-700",
  encerrada: "bg-slate-100 text-slate-600",
};

const promotionStatusLabels: Record<PromotionDashboardVoucherStat["status"], string> = {
  ativa: "Ativa",
  agendada: "Agendada",
  pausada: "Pausada",
  encerrada: "Encerrada",
};

const integrationBadgeStyles: Record<PromotionDashboardVoucherStat["integrationState"], string> = {
  published: "bg-emerald-50 text-emerald-700",
  pending: "bg-slate-100 text-slate-600",
  cancelled: "bg-amber-50 text-amber-700",
  error: "bg-rose-50 text-rose-700",
  unpublished: "bg-slate-100 text-slate-500",
};

const integrationLabels: Record<PromotionDashboardVoucherStat["integrationState"], string> = {
  published: "Publicado",
  pending: "Pendente",
  cancelled: "Cancelado",
  error: "Erro",
  unpublished: "Sem publicacao",
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatVolume(value: number) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0,
    maximumFractionDigits: 3,
  }).format(value)} L`;
}

function formatBreakdownShare(total: number, grandTotal: number) {
  if (grandTotal === 0) {
    return "0%";
  }

  return `${Math.round((total / grandTotal) * 100)}%`;
}

function formatBreakdownCount(total: number) {
  return `${formatInteger(total)} item(ns)`;
}

function buildVoucherLimitSummary(item: PromotionDashboardVoucherStat): string[] {
  const parts: string[] = [];

  if (item.maxDiscountPerDay !== null) {
    parts.push(`${formatMoney(item.maxDiscountPerDay)}/dia`);
  }
  if (item.redemptionsPerCustomer !== null) {
    parts.push(`${formatInteger(item.redemptionsPerCustomer)} uso(s)/cliente`);
  }
  if (item.maxPurchasesPerWeek !== null) {
    parts.push(`${formatInteger(item.maxPurchasesPerWeek)} compra(s)/sem.`);
  }
  if (item.maxPurchasesPerMonth !== null) {
    parts.push(`${formatInteger(item.maxPurchasesPerMonth)} compra(s)/mes`);
  }
  if (item.maxVolumePerDay !== null) {
    parts.push(`${formatVolume(item.maxVolumePerDay)}/dia`);
  }
  if (item.maxQuantityPerItem !== null) {
    parts.push(`${formatVolume(item.maxQuantityPerItem)}/item`);
  }

  return parts;
}

function KpiCard({ label, value, supporting, icon: Icon, accentClassName }: KpiCardProps) {
  return (
    <article className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-semibold text-slate-950">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{supporting}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${accentClassName}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function BreakdownList({
  title,
  items,
  total,
}: {
  title: string;
  items: Array<PromotionDashboardStatusBreakdownItem | PromotionDashboardIntegrationBreakdownItem | PromotionDashboardLimitBreakdownItem>;
  total: number;
}) {
  return (
    <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
      <p className="text-lg font-semibold text-slate-950">{title}</p>
      <div className="mt-5 space-y-4">
        {items.map((item) => (
          <div key={"status" in item ? item.status : "state" in item ? item.state : item.key}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {formatBreakdownCount(item.total)}
                </span>
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                  {formatBreakdownShare(item.total, total)}
                </span>
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-violet-500 transition-all"
                style={{ width: `${total === 0 ? 0 : Math.max((item.total / total) * 100, item.total > 0 ? 10 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function CompanyDashboard() {
  const session = useSaasStore((state) => state.session);
  const [dashboard, setDashboard] = useState<PromotionDashboardStats | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.role !== "company_admin") {
      setDashboardLoading(false);
      return;
    }

    let active = true;

    async function loadDashboard() {
      setDashboardLoading(true);
      setDashboardError(null);

      try {
        const item = await fetchPromotionDashboardStats();
        if (!active) {
          return;
        }
        setDashboard(item);
      } catch (error) {
        if (!active) {
          return;
        }
        setDashboardError(
          error instanceof Error ? error.message : "Nao foi possivel carregar as estatisticas de vouchers.",
        );
      } finally {
        if (active) {
          setDashboardLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [session]);

  const topVouchers = useMemo(() => dashboard?.vouchers.slice(0, 6) ?? [], [dashboard]);
  const statusBreakdownTotal = useMemo(
    () => dashboard?.statusBreakdown.reduce((total, item) => total + item.total, 0) ?? 0,
    [dashboard],
  );
  const integrationBreakdownTotal = useMemo(
    () => dashboard?.integrationBreakdown.reduce((total, item) => total + item.total, 0) ?? 0,
    [dashboard],
  );
  const limitBreakdownTotal = useMemo(
    () => dashboard?.limitBreakdown.reduce((total, item) => total + item.total, 0) ?? 0,
    [dashboard],
  );

  if (!session || session.role !== "company_admin") {
    return null;
  }

  return (
    <AppShell
      title={`Ola, ${session.companyName}`}
      subtitle="Gerencie as promocoes do seu posto em uma visao dedicada para a empresa."
      actions={
        <>
          <Link
            to="/empresa/pdvs"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
          >
            <Monitor className="h-4 w-4" />
            Ver PDVs
          </Link>
          <Link
            to="/empresa/promocoes"
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
          >
            <Megaphone className="h-4 w-4" />
            Ver promocoes
          </Link>
        </>
      }
    >
      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Status da empresa</p>
              <p className="text-lg font-semibold text-slate-950">{formatStatusLabel(session.companyStatus)}</p>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Plano contratado</p>
              <p className="text-lg font-semibold text-slate-950">{formatPlanLabel(session.companyPlan)}</p>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Dominio do tenant</p>
              <p className="text-sm font-semibold text-slate-950">{session.companyDomain}</p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-slate-950">Radar de vouchers</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Painel provisorio com visao consolidada de publicacao, uso e limites de seguranca dos vouchers vinculados as campanhas.
              </p>
            </div>
            {dashboard?.generatedAt ? (
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
                Atualizado em {formatDateTime(dashboard.generatedAt)}
              </div>
            ) : null}
          </div>

          {dashboardLoading ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-[24px] bg-slate-100" />
              ))}
            </div>
          ) : dashboardError ? (
            <div className="mt-5 rounded-[24px] border border-rose-100 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              {dashboardError}
            </div>
          ) : dashboard ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <KpiCard
                label="Campanhas ativas"
                value={formatInteger(dashboard.totals.activePromotions)}
                supporting={`${formatInteger(dashboard.totals.totalPromotions)} campanha(s) no painel`}
                icon={TicketPercent}
                accentClassName="bg-violet-100 text-violet-700"
              />
              <KpiCard
                label="Publicadas no PDV"
                value={formatInteger(dashboard.totals.publishedPromotions)}
                supporting={`${formatInteger(dashboard.totals.promotionsWithUsage)} voucher(es) com consumo registrado`}
                icon={TrendingUp}
                accentClassName="bg-emerald-100 text-emerald-700"
              />
              <KpiCard
                label="PDVs com uso"
                value={formatInteger(dashboard.totals.pdvsWithUsage)}
                supporting={`${formatInteger(dashboard.totals.branchesWithUsage)} filial(is) com uso do voucher`}
                icon={Monitor}
                accentClassName="bg-fuchsia-100 text-fuchsia-700"
              />
              <KpiCard
                label="Resgates aplicados"
                value={formatInteger(dashboard.totals.appliedUsageCount)}
                supporting={`${formatInteger(dashboard.totals.promotionsWithUsageToday)} voucher(es) com uso hoje`}
                icon={Activity}
                accentClassName="bg-sky-100 text-sky-700"
              />
              <KpiCard
                label="Desconto aplicado"
                value={formatMoney(dashboard.totals.appliedDiscount)}
                supporting={`${formatMoney(dashboard.totals.todayDiscount)} consumidos hoje`}
                icon={CircleDollarSign}
                accentClassName="bg-amber-100 text-amber-700"
              />
              <KpiCard
                label="Filiais alcancadas"
                value={formatInteger(dashboard.totals.branchesWithUsage)}
                supporting={`${formatInteger(dashboard.totals.pdvsWithUsage)} PDV(s) registraram uso`}
                icon={Building2}
                accentClassName="bg-indigo-100 text-indigo-700"
              />
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500">
              Nenhuma estatistica de voucher esta disponivel neste momento.
            </div>
          )}
        </article>

        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-lg font-semibold text-slate-950">Acesso atual</p>
          <div className="mt-5 grid gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Administrador</p>
              <p className="mt-1 font-medium text-slate-900">{session.name}</p>
              <p className="text-sm text-slate-500">{session.email}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Vencimento</p>
              <p className="mt-1 font-medium text-slate-900">{formatDate(session.companyExpiresAt)}</p>
            </div>
            {dashboard ? (
              <div className="rounded-[24px] border border-violet-100 bg-violet-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-violet-500">Limites ativos</p>
                <p className="mt-1 text-lg font-semibold text-violet-950">
                  {formatInteger(dashboard.totals.promotionsWithSecurityLimits)}
                </p>
                <p className="mt-1 text-sm text-violet-700">
                  campanhas com ao menos um limite de seguranca configurado
                </p>
              </div>
            ) : null}
            <Link
              to="/empresa/promocoes"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
            >
              <Megaphone className="h-4 w-4" />
              Abrir modulo de promocoes
            </Link>
          </div>
        </article>
      </section>

      {!dashboardLoading && !dashboardError && dashboard ? (
        <>
          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr_1fr]">
            <BreakdownList
              title="Cobertura de limites"
              items={dashboard.limitBreakdown}
              total={Math.max(limitBreakdownTotal, 1)}
            />

            <BreakdownList
              title="Status das campanhas"
              items={dashboard.statusBreakdown}
              total={Math.max(statusBreakdownTotal, 1)}
            />

            <BreakdownList
              title="Integracao com PDV"
              items={dashboard.integrationBreakdown}
              total={Math.max(integrationBreakdownTotal, 1)}
            />
          </section>

          <section className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">Vouchers com maior consumo</p>
                <p className="mt-2 text-sm text-slate-500">
                  Prioridade por consumo de hoje e, na sequencia, pelo desconto acumulado.
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
                Volume acumulado: {formatVolume(dashboard.totals.totalVolume)}
              </div>
            </div>

            {topVouchers.length === 0 ? (
              <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500">
                Ainda nao existem vouchers com estatisticas consolidadas para exibir.
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 pb-1 font-medium">Voucher</th>
                      <th className="px-3 pb-1 font-medium">Consumo</th>
                      <th className="px-3 pb-1 font-medium">Limites</th>
                      <th className="px-3 pb-1 font-medium">Ultimo uso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topVouchers.map((voucher) => {
                      const limitSummary = buildVoucherLimitSummary(voucher);

                      return (
                        <tr key={voucher.promotionId} className="rounded-[24px] bg-slate-50/80 text-sm text-slate-600">
                          <td className="rounded-l-[24px] px-3 py-4 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold tracking-[0.16em] text-white">
                                {voucher.voucherCode}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${promotionStatusBadgeStyles[voucher.status]}`}
                              >
                                {promotionStatusLabels[voucher.status]}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${integrationBadgeStyles[voucher.integrationState]}`}
                              >
                                {integrationLabels[voucher.integrationState]}
                              </span>
                            </div>
                            <p className="mt-3 font-semibold text-slate-900">{voucher.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              Vigencia: {formatDate(voucher.startDate)} ate {formatDate(voucher.endDate)}
                            </p>
                            {voucher.integrationError ? (
                              <p className="mt-2 text-xs text-rose-600">{voucher.integrationError}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-4 align-top">
                            <p className="font-semibold text-slate-900">{formatMoney(voucher.appliedDiscount)}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatInteger(voucher.appliedUsageCount)} aplicacao(oes) confirmadas
                            </p>
                            <p className="mt-3 text-sm font-medium text-slate-700">
                              Alcance: {formatInteger(voucher.pdvCount)} PDV(s) | {formatInteger(voucher.branchCount)} filial(is)
                            </p>
                            <p className="mt-3 text-sm font-medium text-slate-700">
                              Hoje: {formatMoney(voucher.todayDiscount)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatInteger(voucher.todayUsageCount)} uso(s) hoje | {formatVolume(voucher.todayVolume)}
                            </p>
                            <p className="mt-3 text-xs text-slate-500">
                              Base de limite: {formatMoney(voucher.totalDiscount)} | {formatInteger(voucher.uniqueCustomers)} cliente(s)
                            </p>
                          </td>
                          <td className="px-3 py-4 align-top">
                            <p className="font-medium text-slate-900">
                              {voucher.hasSecurityLimits
                                ? `${formatInteger(voucher.configuredLimitCount)} limite(s) configurado(s)`
                                : "Sem limites configurados"}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              {limitSummary.length > 0 ? limitSummary.slice(0, 3).join(" | ") : "Sem restricoes de seguranca preenchidas"}
                            </p>
                            {voucher.couponValidityMinutes !== null ? (
                              <p className="mt-2 text-xs text-slate-500">
                                Validade do codigo: {formatInteger(voucher.couponValidityMinutes)} min
                              </p>
                            ) : null}
                          </td>
                          <td className="rounded-r-[24px] px-3 py-4 align-top">
                            <p className="font-medium text-slate-900">{formatDateTime(voucher.lastUsageAt)}</p>
                            <p className="mt-2 text-xs text-slate-500">
                              Desconto base: {voucher.discountType === "fixed" ? `${formatMoney(Number(voucher.discountValue || 0))}` : `${voucher.discountValue}%`}
                            </p>
                            {voucher.branchBreakdown.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {voucher.branchBreakdown.slice(0, 3).map((branch) => (
                                  <div key={`${voucher.promotionId}-${branch.branchId}`} className="rounded-2xl bg-white px-3 py-2">
                                    <p className="text-xs font-semibold text-slate-700">{branch.branchName}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {formatInteger(branch.pdvCount)} PDV(s) | {formatInteger(branch.usageCount)} uso(s) | {formatMoney(branch.totalDiscount)}
                                    </p>
                                  </div>
                                ))}
                                {voucher.branchBreakdown.length > 3 ? (
                                  <p className="text-xs text-slate-500">
                                    +{formatInteger(voucher.branchBreakdown.length - 3)} filial(is) com movimentacao
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <p className="mt-3 text-xs text-slate-500">Nenhuma filial com uso registrado ainda.</p>
                            )}
                            <Link
                              to="/empresa/promocoes"
                              className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
                            >
                              <Megaphone className="h-3.5 w-3.5" />
                              Ver campanha
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
