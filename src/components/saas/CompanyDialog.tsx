import { useEffect, useMemo, useState } from "react";
import { Building2, CircleAlert, PlugZap, Trash2, X } from "lucide-react";
import type { Company, CreateCompanyInput } from "@/types/saas";
import { formatCnpj, formatPhone, validateCompanyInput } from "../../../shared/company";
import ModernDateInput from "@/components/ModernDateInput";
import CompactComboBox from "./CompactComboBox";

interface CompanyDialogProps {
  open: boolean;
  company?: Company | null;
  onClose(): void;
  onSubmit(input: CreateCompanyInput): Promise<void>;
  onDelete?(company: Company): Promise<void>;
}

const initialForm: CreateCompanyInput = {
  tradeName: "",
  cnpj: "",
  phone: "",
  adminName: "",
  adminEmail: "",
  temporaryPassword: "",
  status: "trial",
  plan: "starter",
  activatedAt: "",
  expiresAt: "",
  selectedBranchIds: [],
};

const planOptions = [
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "enterprise", label: "Enterprise" },
] as const;

const statusOptions = [
  { value: "trial", label: "Trial" },
  { value: "ativa", label: "Ativa" },
  { value: "suspensa", label: "Suspensa" },
  { value: "vencida", label: "Vencida" },
] as const;

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-600">
      <span className="font-medium text-slate-700">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function toFormValues(company: Company): CreateCompanyInput {
  return {
    tradeName: company.tradeName,
    cnpj: company.cnpj,
    phone: company.phone,
    adminName: company.adminName,
    adminEmail: company.adminEmail,
    temporaryPassword: company.temporaryPassword,
    status: company.status,
    plan: company.plan,
    activatedAt: company.activatedAt,
    expiresAt: company.expiresAt,
    selectedBranchIds: company.selectedBranchIds,
  };
}

export default function CompanyDialog({ open, company, onClose, onSubmit, onDelete }: CompanyDialogProps) {
  const [form, setForm] = useState<CreateCompanyInput>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isEditing = Boolean(company);
  const validationErrors = useMemo(() => validateCompanyInput(form), [form]);

  useEffect(() => {
    if (!open) {
      setForm(initialForm);
      setError(null);
      setSubmitting(false);
      setDeleting(false);
      return;
    }

    setForm(company ? toFormValues(company) : initialForm);
    setError(null);
    setSubmitting(false);
    setDeleting(false);
  }, [company, open]);

  const isValid = useMemo(() => {
    return validationErrors.length === 0;
  }, [validationErrors]);

  if (!open) {
    return null;
  }

  function updateForm(updates: Partial<CreateCompanyInput>) {
    setForm((current) => ({ ...current, ...updates }));
  }

  function updateField<K extends keyof CreateCompanyInput>(field: K, value: CreateCompanyInput[K]) {
    updateForm({ [field]: value } as Pick<CreateCompanyInput, K>);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValid) {
      setError(
        isEditing
          ? "Preencha todos os campos obrigatorios antes de salvar a empresa."
          : "Preencha todos os campos obrigatorios antes de cadastrar a empresa.",
      );
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        ...form,
        cnpj: formatCnpj(form.cnpj),
        phone: formatPhone(form.phone),
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nao foi possivel salvar a empresa no banco.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!company || !onDelete) {
      return;
    }

    const shouldDelete = window.confirm(
      `Tem certeza que deseja excluir o cadastro da empresa ${company.tradeName}?`,
    );

    if (!shouldDelete) {
      return;
    }

    try {
      setError(null);
      setDeleting(true);
      await onDelete(company);
      onClose();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Nao foi possivel excluir a empresa no banco.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-4xl rounded-[32px] border border-white/70 bg-white p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                {isEditing ? "Editar Empresa" : "Nova Empresa"}
              </h2>
              <p className="text-sm text-slate-500">
                {isEditing
                  ? "Atualize os dados do tenant, administrador principal e contrato."
                  : "Cadastre um novo tenant com admin principal e dados contratuais."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting || deleting}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            aria-label="Fechar modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field label="Nome do posto" required>
            <input className="saas-input" value={form.tradeName} onChange={(e) => updateField("tradeName", e.target.value)} />
          </Field>

          <Field label="CNPJ" required>
            <input
              className="saas-input"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(e) => updateField("cnpj", formatCnpj(e.target.value))}
            />
          </Field>

          <Field label="Telefone" required>
            <input
              className="saas-input"
              inputMode="tel"
              placeholder="(00) 00000-0000"
              value={form.phone}
              onChange={(e) => updateField("phone", formatPhone(e.target.value))}
            />
          </Field>

          <Field label="Nome do admin" required>
            <input className="saas-input" value={form.adminName} onChange={(e) => updateField("adminName", e.target.value)} />
          </Field>

          <Field label="E-mail do admin" required>
            <input className="saas-input" type="email" value={form.adminEmail} onChange={(e) => updateField("adminEmail", e.target.value)} />
          </Field>

          <Field label="Senha de acesso do admin" required>
            <input
              className="saas-input"
              type="text"
              value={form.temporaryPassword}
              onChange={(e) => updateField("temporaryPassword", e.target.value)}
            />
          </Field>

          <div className="rounded-3xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-sm text-violet-900">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Este admin inicia com acesso total dentro do tenant da empresa cadastrada.</p>
            </div>
          </div>

          <Field label="Plano" required>
            <CompactComboBox
              value={form.plan}
              options={[...planOptions]}
              onChange={(value) => updateField("plan", value as CreateCompanyInput["plan"])}
            />
          </Field>

          <Field label="Status" required>
            <CompactComboBox
              value={form.status}
              options={[...statusOptions]}
              onChange={(value) => updateField("status", value as CreateCompanyInput["status"])}
            />
          </Field>

          <Field label="Data de ativacao" required>
            <ModernDateInput type="date" value={form.activatedAt} onChange={(value) => updateField("activatedAt", value)} />
          </Field>

          <Field label="Data de vencimento" required>
            <ModernDateInput type="date" value={form.expiresAt} onChange={(value) => updateField("expiresAt", value)} />
          </Field>
        </div>

        <div className="mt-6 rounded-[28px] border border-violet-100 bg-violet-50/70 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <PlugZap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-950">Filiais descobertas automaticamente</p>
              <p className="mt-1 text-sm text-slate-600">
                O tenant agora nasce sem exigir filiais manuais. A rede de empresas do cliente e a empresa local do posto
                serao sincronizadas automaticamente quando o primeiro PDV com app Python for ativado.
              </p>
              <p className="mt-3 text-sm text-violet-700">
                {form.selectedBranchIds.length > 0
                  ? `${form.selectedBranchIds.length} filial(is) ativa(s) ja descobertas para esta empresa.`
                  : "Nenhuma filial sincronizada ainda. Gere um codigo bootstrap e ative o primeiro PDV para iniciar a descoberta."}
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          {isEditing && onDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || deleting}
              className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Excluindo..." : "Excluir cadastro"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || deleting}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || deleting}
            className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
          >
            {submitting ? "Salvando..." : isEditing ? "Salvar Alteracoes" : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
