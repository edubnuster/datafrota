import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  ChevronDown,
  Fuel,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Settings2,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSaasStore } from "@/hooks/useSaasStore";

interface AppShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
}

export default function AppShell({ title, subtitle, children, actions }: AppShellProps) {
  const session = useSaasStore((state) => state.session);
  const logout = useSaasStore((state) => state.logout);
  const navigate = useNavigate();
  const isCompanyView = session?.role === "company_admin";
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const navigation = isCompanyView
    ? [
        { to: "/empresa/dashboard", label: "Painel", icon: LayoutDashboard },
        { to: "/empresa/promocoes", label: "Promo", icon: Megaphone },
        { to: "/empresa/configuracoes", label: "Configurações", icon: Settings2 },
      ]
    : [
        { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { to: "/empresas", label: "Empresas", icon: Building2 },
      ];
  const productLabel = "Gestao de Postos";
  const productSubtitle = isCompanyView ? session.companyName : "Painel administrativo SaaS";
  const roleLabel = isCompanyView ? "Administrador da empresa" : "Super Admin";
  const companyName = isCompanyView ? session.companyName : "Databrev";
  const userInitial = session?.name?.trim()?.[0]?.toUpperCase() ?? "U";

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!userMenuOpen) {
        return;
      }

      const target = event.target as Node | null;
      if (!target || !userMenuRef.current) {
        return;
      }

      if (!userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  return (
    <div className="min-h-screen bg-[#f4f5fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight text-slate-950">{productLabel}</p>
              <p className="text-xs text-slate-500">{productSubtitle}</p>
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
            <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 md:flex">
              <Building2 className="h-4 w-4 text-slate-500" />
              <div className="leading-tight">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Empresa</p>
                <p className="text-sm font-semibold text-slate-900">{companyName}</p>
              </div>
            </div>

            <button
              type="button"
              className="hidden h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:text-violet-700 md:inline-flex"
              aria-label="Notificacoes"
            >
              <Bell className="h-4 w-4" />
            </button>

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                className={cn(
                  "inline-flex h-10 items-center gap-3 rounded-full border bg-white px-3 text-left transition",
                  userMenuOpen
                    ? "border-violet-200 text-slate-900 shadow-lg shadow-violet-500/10"
                    : "border-slate-200 text-slate-700 hover:border-violet-200",
                )}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {userInitial}
                </div>
                <div className="hidden leading-tight md:block">
                  <p className="text-sm font-semibold text-slate-900">{session?.name}</p>
                  <p className="text-xs text-slate-500">{roleLabel}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </button>

              {userMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
                >
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{session?.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{session?.email}</p>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate(isCompanyView ? "/empresa/configuracoes" : "/minha-conta");
                    }}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Minha conta
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    Sair
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
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
