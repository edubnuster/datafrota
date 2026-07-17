import { useMemo, useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import CompanyDialog from "@/components/saas/CompanyDialog";
import { useSaasStore } from "@/hooks/useSaasStore";
import type { Company, CreateCompanyInput } from "@/types/saas";
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
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const companies = useSaasStore((state) => state.companies);
  const companiesLoading = useSaasStore((state) => state.companiesLoading);
  const companiesError = useSaasStore((state) => state.companiesError);
  const search = useSaasStore((state) => state.search);
  const setSearch = useSaasStore((state) => state.setSearch);
  const createCompany = useSaasStore((state) => state.createCompany);
  const updateCompany = useSaasStore((state) => state.updateCompany);
  const deleteCompany = useSaasStore((state) => state.deleteCompany);

  const filteredCompanies = useMemo(() => filterCompanies(companies, search), [companies, search]);

  function handleOpenCreateDialog() {
    setEditingCompany(null);
    setSubmitError(null);
    setDialogOpen(true);
  }

  function handleOpenEditDialog(company: Company) {
    setEditingCompany(company);
    setSubmitError(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setEditingCompany(null);
  }

  async function handleSubmitCompany(input: CreateCompanyInput) {
    setFeedback(null);
    setSubmitError(null);

    try {
      if (editingCompany) {
        const company = await updateCompany(editingCompany.id, input);

        if (company) {
          setFeedback(`Empresa ${company.tradeName} atualizada com sucesso.`);
        }

        return;
      }

      const company = await createCompany(input);
      setFeedback(`Empresa ${company.tradeName} cadastrada com sucesso.`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Nao foi possivel salvar a empresa no banco.",
      );
      throw error;
    }
  }

  async function handleDeleteCompany(company: Company) {
    setFeedback(null);
    setSubmitError(null);

    try {
      const deletedCompany = await deleteCompany(company.id);

      if (deletedCompany) {
        setFeedback(`Empresa ${deletedCompany.tradeName} excluida com sucesso.`);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Nao foi possivel excluir a empresa no banco.",
      );
      throw error;
    }
  }

  return (
    <AppShell
      title="Empresas"
      subtitle="Gerencie postos, planos, usuarios e relatorios do ambiente SaaS em um so lugar."
      actions={
        <button
          type="button"
          onClick={handleOpenCreateDialog}
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
        <label className="saas-compact-search">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            className="text-sm"
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

        {submitError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        {companiesError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {companiesError}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {companiesLoading ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Carregando empresas do PostgreSQL local...
            </div>
          ) : null}

          {!companiesLoading && filteredCompanies.length === 0 ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Nenhuma empresa encontrada.
            </div>
          ) : null}

          {filteredCompanies.map((company) => (
            <article
              key={company.id}
              className="grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50/70 px-4 py-4 shadow-sm lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.95fr)_minmax(0,1.1fr)_auto] lg:items-center"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-sm font-semibold text-white shadow-lg ${getPlanGradient(
                    company.plan,
                  )}`}
                >
                  {company.tradeName.slice(0, 1)}
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold leading-none text-slate-950">{company.tradeName}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badgeStyles[company.status]}`}>
                      {formatStatusLabel(company.status)}
                    </span>
                    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
                      {company.selectedBranchIds.length} filial(is)
                    </span>
                  </div>
                  <p className="truncate text-sm leading-tight text-slate-500">{company.adminEmail}</p>
                  <p className="text-sm leading-tight text-slate-500">{company.phone}</p>
                </div>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1 lg:gap-1.5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Plano</p>
                  <p className="mt-0.5 font-medium leading-tight text-slate-900">{formatPlanLabel(company.plan)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Vencimento</p>
                  <p className="mt-0.5 font-medium leading-tight text-slate-900">{formatDate(company.expiresAt)}</p>
                </div>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1 lg:gap-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Dominio</p>
                  <p className="mt-0.5 truncate font-medium leading-tight text-slate-900">{company.domain}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">CNPJ</p>
                  <p className="mt-0.5 font-medium leading-tight text-slate-900">{company.cnpj}</p>
                </div>
              </div>

              <div className="flex items-center lg:justify-end">
                <button
                  type="button"
                  onClick={() => handleOpenEditDialog(company)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar empresa
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <CompanyDialog
        open={dialogOpen}
        company={editingCompany}
        onClose={handleCloseDialog}
        onSubmit={handleSubmitCompany}
        onDelete={handleDeleteCompany}
      />
    </AppShell>
  );
}
