import { useState } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import DatabrevLogo from "@/components/saas/DatabrevLogo";
import { useSaasStore } from "@/hooks/useSaasStore";

export default function Login() {
  const navigate = useNavigate();
  const session = useSaasStore((state) => state.session);
  const login = useSaasStore((state) => state.login);
  const authError = useSaasStore((state) => state.authError);
  const clearAuthError = useSaasStore((state) => state.clearAuthError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const defaultRoute = session?.role === "company_admin" ? "/empresa/dashboard" : "/dashboard";

  if (session) {
    return <Navigate to={defaultRoute} replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    clearAuthError();

    const ok = await login(email, password);

    setSubmitting(false);

    if (ok) {
      navigate("/", { replace: true });
    }
  }

  return (
    <main className="login-scene">
      <div className="login-backdrop" />
      <div className="login-panel">
        <div className="login-card">
          <div className="flex justify-center">
            <DatabrevLogo />
          </div>

          <div className="mt-6 text-center">
            <h1 className="whitespace-nowrap text-[1.75rem] font-semibold tracking-tight text-slate-950">Seja bem-vindo!</h1>
            <p className="mt-2 max-w-[18rem] text-[13px] leading-6 text-slate-500 mx-auto">
              Digite seus dados de acesso para continuar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-7 grid gap-3.5">
            <label className="login-field login-field-light">
              <Mail className="h-4 w-4 text-slate-400" />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="Entre com seu e-mail"
              />
            </label>

            <label className="login-field login-field-light">
              <Lock className="h-4 w-4 text-slate-400" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Senha"
              />
              <button
                type="button"
                className="text-slate-400 transition hover:text-slate-700"
                onClick={() => setShowPassword((current) => !current)}
                aria-label="Mostrar ou ocultar senha"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>

            {authError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {authError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-15px_rgba(124,58,237,0.75)] transition hover:bg-violet-500 disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <p className="mt-5 whitespace-nowrap text-center text-[11px] text-white/80 drop-shadow-[0_1px_2px_rgba(15,23,42,0.45)]">
          © 2026 Databrev Tecnologia. Acesso restrito. Contate o administrador.
        </p>
      </div>
    </main>
  );
}
