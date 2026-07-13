import type { ReactNode } from "react";
import { Bell, Building2, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSaasStore } from "@/hooks/useSaasStore";

interface AppShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
}

const navigation = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/empresas", label: "Empresas", icon: Building2 },
];

export default function AppShell({ title, subtitle, children, actions }: AppShellProps) {
  const session = useSaasStore((state) => state.session);
  const logout = useSaasStore((state) => state.logout);

  return (
    <div className="min-h-screen bg-[#f4f5fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight text-slate-950">Gestao de Postos</p>
              <p className="text-xs text-slate-500">Painel administrativo SaaS</p>
            </div>
          </div>

          <nav className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1 md:flex">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-violet-600 text-white shadow-lg shadow-violet-500/20"
                      : "text-slate-500 hover:bg-white hover:text-slate-900",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="hidden h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:text-violet-700 md:inline-flex"
              aria-label="Notificacoes"
            >
              <Bell className="h-4 w-4" />
            </button>

            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-slate-900">{session?.name}</p>
              <p className="text-xs text-slate-500">Super Admin</p>
            </div>

            <button
              type="button"
              onClick={logout}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8">
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </section>

        {children}
      </main>
    </div>
  );
}
