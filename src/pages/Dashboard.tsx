import { Building2, CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import KpiCard from "@/components/saas/KpiCard";
import PlanDonut from "@/components/saas/PlanDonut";
import StatusBars from "@/components/saas/StatusBars";
import { useSaasStore } from "@/hooks/useSaasStore";
import {
  buildPlanSeries,
  buildStatusSeries,
  calculateDashboardMetrics,
  formatDate,
  formatMoney,
  formatStatusLabel,
} from "@/utils/saas";

export default function Dashboard() {
  const companies = useSaasStore((state) => state.companies);
  const companiesLoading = useSaasStore((state) => state.companiesLoading);
  const companiesError = useSaasStore((state) => state.companiesError);
  const metrics = calculateDashboardMetrics(companies);
  const statusSeries = buildStatusSeries(companies);
  const planSeries = buildPlanSeries(companies);
  const recentCompanies = [...companies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return (
    <AppShell
      title="Dashboard"
      subtitle="Visao geral da plataforma com indicadores consolidados do ambiente SaaS."
    >
      <section className="grid gap-4 xl:grid-cols-4">
        <KpiCard label="Total de Empresas" value={String(metrics.totalCompanies)} icon={Building2} accent="violet" />
        <KpiCard label="Empresas Ativas" value={String(metrics.activeCompanies)} icon={ShieldCheck} accent="emerald" />
        <KpiCard label="Receita Mensal (MRR)" value={formatMoney(metrics.monthlyRevenue)} icon={CircleDollarSign} accent="amber" />
        <KpiCard label="Em Trial" value={String(metrics.trialCompanies)} icon={Clock3} accent="rose" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <StatusBars items={statusSeries} />
        <PlanDonut items={planSeries} />
      </section>

      <section className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Empresas Recentes</p>
            <p className="text-sm text-slate-500">Ultimos tenants cadastrados no ambiente administrativo.</p>
          </div>
        </div>

        <div className="grid gap-4">
          {companiesError ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
              {companiesError}
            </div>
          ) : null}

          {companiesLoading ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500">
              Carregando empresas do PostgreSQL local...
            </div>
          ) : null}

          {!companiesLoading && recentCompanies.length === 0 ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500">
              Nenhuma empresa cadastrada no banco local.
            </div>
          ) : null}

          {recentCompanies.map((company) => (
            <article
              key={company.id}
              className="flex flex-col justify-between gap-4 rounded-[24px] border border-slate-100 bg-slate-50/70 px-5 py-4 md:flex-row md:items-center"
            >
              <div>
                <div className="flex items-center gap-3">
                  <p className="text-base font-semibold text-slate-950">{company.tradeName}</p>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    {formatStatusLabel(company.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">Criado em {formatDate(company.createdAt)}</p>
              </div>
              <div className="text-sm text-slate-500">
                <span className="font-medium text-slate-700">{company.adminEmail}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
