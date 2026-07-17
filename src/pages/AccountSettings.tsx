import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, KeyRound, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import { useSaasStore } from "@/hooks/useSaasStore";

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function AccountSettings() {
  const session = useSaasStore((state) => state.session);
  const companies = useSaasStore((state) => state.companies);
  const updateAdminAccount = useSaasStore((state) => state.updateAdminAccount);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "saas_admin") {
      return;
    }

    setName(session.name);
    setEmail(session.email);
  }, [session]);

  const userInitials = useMemo(() => getInitials(name || session?.name || "Super Admin"), [name, session?.name]);

  if (!session || session.role !== "saas_admin") {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setFeedback(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedNextPassword = nextPassword.trim();

    if (!trimmedName) {
      setSubmitError("Informe o nome do super admin.");
      return;
    }

    if (!trimmedEmail) {
      setSubmitError("Informe o e-mail de acesso.");
      return;
    }

    if (trimmedNextPassword && trimmedNextPassword.length < 6) {
      setSubmitError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (trimmedNextPassword && !currentPassword) {
      setSubmitError("Informe a senha atual para alterar a senha de acesso.");
      return;
    }

    if (trimmedNextPassword !== confirmPassword.trim()) {
      setSubmitError("A confirmacao da nova senha nao confere.");
      return;
    }

    setSaving(true);

    try {
      await updateAdminAccount({
        name: trimmedName,
        email: trimmedEmail,
        currentPassword: currentPassword.trim() || undefined,
        password: trimmedNextPassword || undefined,
      });

      setFeedback("Conta atualizada com sucesso.");
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Nao foi possivel atualizar a conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Minha conta"
      subtitle="Atualize os dados do super admin, credenciais de acesso e informacoes principais do ambiente SaaS."
    >
      <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-gradient-to-br from-violet-600 to-fuchsia-500 text-lg font-semibold text-white shadow-lg shadow-violet-500/20">
              {userInitials}
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-950">{session.name}</p>
              <p className="text-sm text-slate-500">{session.email}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Perfil</p>
              <div className="mt-3 flex items-start gap-3">
                <UserRound className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">Super Admin do SaaS</p>
                  <p className="text-sm text-slate-500">Usuario principal com acesso total ao ambiente Databrev.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Escopo</p>
              <div className="mt-3 flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">{companies.length} empresas gerenciadas</p>
                  <p className="text-sm text-slate-500">Controle total de tenants, acessos e configuracoes do SaaS.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</p>
              <div className="mt-3 flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                <div>
                  <p className="font-medium text-slate-900">Conta principal ativa</p>
                  <p className="text-sm text-slate-500">As alteracoes salvas passam a valer imediatamente no proximo login.</p>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-slate-950">Editar dados da conta</p>
              <p className="mt-1 text-sm text-slate-500">Mantenha o nome exibido no menu e as credenciais administrativas atualizados.</p>
            </div>
            <div className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
              Super Admin
            </div>
          </div>

          <form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <label htmlFor="admin-name" className="text-sm font-medium text-slate-700">
                Nome completo
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <UserRound className="h-4 w-4 text-slate-400" />
                <input
                  id="admin-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="Nome do administrador principal"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label htmlFor="admin-email" className="text-sm font-medium text-slate-700">
                E-mail de acesso
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Mail className="h-4 w-4 text-slate-400" />
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="admin@databrev.com.br"
                />
              </div>
            </div>

            <div className="grid gap-4 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Seguranca</p>
                <p className="mt-1 text-sm text-slate-500">Preencha os campos abaixo apenas se quiser alterar a senha administrativa.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="current-password" className="text-sm font-medium text-slate-700">
                    Senha atual
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    <input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="Informe a senha atual"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="next-password" className="text-sm font-medium text-slate-700">
                    Nova senha
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    <input
                      id="next-password"
                      type="password"
                      value={nextPassword}
                      onChange={(event) => setNextPassword(event.target.value)}
                      className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="Minimo de 6 caracteres"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">
                  Confirmar nova senha
                </label>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <KeyRound className="h-4 w-4 text-slate-400" />
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    placeholder="Repita a nova senha"
                  />
                </div>
              </div>
            </div>

            {feedback ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {feedback}
              </div>
            ) : null}

            {submitError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Save className="h-4 w-4" />
                {saving ? "Salvando..." : "Salvar alteracoes"}
              </button>
            </div>
          </form>
        </article>
      </section>
    </AppShell>
  );
}
