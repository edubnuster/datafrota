import { Bell, Building2, Globe, LockKeyhole, Mail, MonitorSmartphone, MoveRight, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import AppShell from "@/components/saas/AppShell";
import { useSaasStore } from "@/hooks/useSaasStore";
import { formatDate } from "@/utils/saas";

export default function CompanySettings() {
  const session = useSaasStore((state) => state.session);

  if (!session || session.role !== "company_admin") {
    return null;
  }

  return (
    <AppShell
      title="Configurações"
      subtitle="Ajustes do ambiente da empresa, dados do administrador e preferencias operacionais."
    >
      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-950">{session.companyName}</p>
              <p className="text-sm text-slate-500">Ambiente ativo da empresa</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Administrador</p>
              <div className="mt-3 flex items-start gap-3">
                <UserRound className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">{session.name}</p>
                  <p className="text-sm text-slate-500">{session.email}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Tenant</p>
              <div className="mt-3 flex items-start gap-3">
                <Globe className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">{session.companyDomain}</p>
                  <p className="text-sm text-slate-500">Vencimento em {formatDate(session.companyExpiresAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-lg font-semibold text-slate-950">Preferencias</p>
          <div className="mt-5 grid gap-3">
            <div className="flex items-start gap-3 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <Bell className="mt-0.5 h-4 w-4 text-slate-400" />
              <div>
                <p className="font-medium text-slate-900">Notificações</p>
                <p className="text-sm text-slate-500">Resumo das campanhas e alertas do ambiente da empresa.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <Mail className="mt-0.5 h-4 w-4 text-slate-400" />
              <div>
                <p className="font-medium text-slate-900">Contato operacional</p>
                <p className="text-sm text-slate-500">Usa o usuario cadastrado na guia Empresa para autenticação.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 text-slate-400" />
              <div>
                <p className="font-medium text-slate-900">Segurança</p>
                <p className="text-sm text-slate-500">A senha inicial continua vindo do cadastro da empresa no painel SaaS.</p>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <MonitorSmartphone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950">Configuração de PDVs</p>
                <p className="mt-1 text-sm text-slate-500">
                  Cadastre, ative e acompanhe os caixas integrados com o app Python dentro do menu de configurações.
                </p>
              </div>
            </div>

            <Link
              to="/empresa/pdvs"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
            >
              Abrir configuração de PDVs
              <MoveRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Bootstrap inicial</p>
              <p className="mt-2 text-sm text-slate-500">
                Gere o primeiro codigo para conectar o app Python sem depender de filiais preexistentes.
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Rede sincronizada</p>
              <p className="mt-2 text-sm text-slate-500">
                Veja as empresas descobertas no banco local do cliente e acompanhe status ativo ou inativo.
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Gestão de terminais</p>
              <p className="mt-2 text-sm text-slate-500">
                Revogue caixas, gere novos codigos e acompanhe o ultimo `last seen` de cada PDV.
              </p>
            </div>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
