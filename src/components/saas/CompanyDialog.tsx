import { useEffect, useMemo, useState } from "react";
import { Building2, CircleAlert, X } from "lucide-react";
import type { CreateCompanyInput } from "@/types/saas";

interface CompanyDialogProps {
  open: boolean;
  onClose(): void;
  onSubmit(input: CreateCompanyInput): void;
}

const initialForm: CreateCompanyInput = {
  tradeName: "",
  cnpj: "",
  phone: "",
  address: "",
  adminName: "",
  adminEmail: "",
  temporaryPassword: "",
  status: "trial",
  plan: "starter",
  activatedAt: "",
  expiresAt: "",
};

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

export default function CompanyDialog({ open, onClose, onSubmit }: CompanyDialogProps) {
  const [form, setForm] = useState<CreateCompanyInput>(initialForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(initialForm);
      setError(null);
    }
  }, [open]);

  const isValid = useMemo(() => {
    return Object.values(form).every((value) => String(value).trim().length > 0);
  }, [form]);

  if (!open) {
    return null;
  }

  function updateField<K extends keyof CreateCompanyInput>(field: K, value: CreateCompanyInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValid) {
      setError("Preencha todos os campos obrigatorios antes de cadastrar a empresa.");
      return;
    }

    onSubmit(form);
    onClose();
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
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">Nova Empresa</h2>
              <p className="text-sm text-slate-500">
                Cadastre um novo tenant com admin principal e dados contratuais.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
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
            <input className="saas-input" value={form.cnpj} onChange={(e) => updateField("cnpj", e.target.value)} />
          </Field>

          <Field label="Telefone" required>
            <input className="saas-input" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
          </Field>

          <Field label="Endereco" required>
            <input className="saas-input" value={form.address} onChange={(e) => updateField("address", e.target.value)} />
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
            <select className="saas-input" value={form.plan} onChange={(e) => updateField("plan", e.target.value as CreateCompanyInput["plan"])}>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </Field>

          <Field label="Status" required>
            <select className="saas-input" value={form.status} onChange={(e) => updateField("status", e.target.value as CreateCompanyInput["status"])}>
              <option value="trial">Trial</option>
              <option value="ativa">Ativa</option>
              <option value="suspensa">Suspensa</option>
              <option value="vencida">Vencida</option>
            </select>
          </Field>

          <Field label="Data de ativacao" required>
            <input className="saas-input" type="date" value={form.activatedAt} onChange={(e) => updateField("activatedAt", e.target.value)} />
          </Field>

          <Field label="Data de vencimento" required>
            <input className="saas-input" type="date" value={form.expiresAt} onChange={(e) => updateField("expiresAt", e.target.value)} />
          </Field>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
          >
            Cadastrar
          </button>
        </div>
      </form>
    </div>
  );
}
