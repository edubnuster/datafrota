import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import CompanyDialog from "@/components/saas/CompanyDialog";
import { useSaasStore } from "@/hooks/useSaasStore";
import type { CreateCompanyInput } from "@/types/saas";
import {
  filterCompanies,
  formatDate,
  formatPlanLabel,
  formatStatusLabel,
  getPlanGradient,
} from "@/utils/saas";

const badgeStyles = {
  ativa: "bg-emerald-50 text-emerald-700",
  trial: "bg-sky-50 text-sky-700",
  suspensa: "bg-amber-50 text-amber-700",
  vencida: "bg-rose-50 text-rose-700",
};

export default function Companies() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const companies = useSaasStore((state) => state.companies);
  const search = useSaasStore((state) => state.search);
  const setSearch = useSaasStore((state) => state.setSearch);
  const createCompany = useSaasStore((state) => state.createCompany);

  const filteredCompanies = useMemo(() => filterCompanies(companies, search), [companies, search]);

  function handleCreateCompany(input: CreateCompanyInput) {
    const company = createCompany(input);
    setFeedback(`Empresa ${company.tradeName} cadastrada com sucesso.`);
  }

  return (
    <AppShell
      title="Empresas"
      subtitle="Gerencie postos, planos, usuarios e relatorios do ambiente SaaS em um so lugar."
      actions={
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          Nova Empresa
        </button>
      }
    >
      <section className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white">Empresas</span>
        <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">Planos</span>
        <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">Usuarios</span>
        <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">Relatorios</span>
      </section>

      <section className="rounded-[28px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <Search className="h-4 w-4" />
          <input
            className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="Buscar por nome, CNPJ ou e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {feedback ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {feedback}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {filteredCompanies.map((company) => (
            <article
              key={company.id}
              className="grid gap-4 rounded-[24px] border border-slate-100 bg-slate-50/70 px-5 py-5 shadow-sm lg:grid-cols-[1.5fr_0.7fr_0.5fr]"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${getPlanGradient(
                    company.plan,
                  )}`}
                >
                  {company.tradeName.slice(0, 1)}
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-base font-semibold text-slate-950">{company.tradeName}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${badgeStyles[company.status]}`}>
                      {formatStatusLabel(company.status)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">{company.adminEmail}</p>
                  <p className="text-sm text-slate-500">
                    {company.phone} • {company.address}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Plano</p>
                  <p className="mt-1 font-medium text-slate-900">{formatPlanLabel(company.plan)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Vencimento</p>
                  <p className="mt-1 font-medium text-slate-900">{formatDate(company.expiresAt)}</p>
                </div>
              </div>

              <div className="grid gap-2 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Dominio</p>
                  <p className="mt-1 break-all font-medium text-slate-900">{company.domain}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">CNPJ</p>
                  <p className="mt-1 font-medium text-slate-900">{company.cnpj}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <CompanyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={handleCreateCompany} />
    </AppShell>
  );
}
