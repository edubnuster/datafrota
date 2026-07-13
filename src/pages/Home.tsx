import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Database, Shield, TicketPercent } from "lucide-react";
import DiscountForm from "@/components/DiscountForm";
import DiscountHistoryTable from "@/components/DiscountHistoryTable";
import ResolveCodeCard from "@/components/ResolveCodeCard";
import { useDiscountStore } from "@/hooks/useDiscountStore";
import { formatDateTime, formatDiscountPercent, getScopeLabel } from "@/utils/format";

export default function Home() {
  const {
    items,
    loading,
    submitting,
    message,
    error,
    lastCreated,
    lastResolved,
    loadCodes,
    createCode,
    cancelCode,
    resolveCode,
  } = useDiscountStore();

  useEffect(() => {
    void loadCodes();
  }, [loadCodes]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#020617_55%)] px-6 py-10 text-white">
      <div className="mx-auto grid max-w-7xl gap-8">
        <section className="grid gap-6 rounded-[2rem] border border-slate-800 bg-slate-950/75 p-8 shadow-2xl shadow-slate-950/40 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-5">
            <p className="text-sm uppercase tracking-[0.34em] text-cyan-300">
              DataFrota x Frente de Caixa
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white">
              Gerador provisório de código curto para liberar desconto no caixa.
            </h1>
            <p className="max-w-2xl text-base text-slate-300">
              O código digitado no caixa permanece curto, enquanto os dados reais do desconto
              ficam protegidos no PostgreSQL local e são resolvidos pela API no momento da leitura.
            </p>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
                <TicketPercent className="mb-3 h-5 w-5 text-emerald-300" />
                <p className="text-sm font-medium text-white">Percentual obrigatório</p>
                <p className="mt-1 text-sm text-slate-400">Produto, grupo, cliente e validade são opcionais.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
                <Shield className="mb-3 h-5 w-5 text-cyan-300" />
                <p className="text-sm font-medium text-white">Código curto e seguro</p>
                <p className="mt-1 text-sm text-slate-400">O token referencia a autorização sem expor os dados digitados.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
                <Database className="mb-3 h-5 w-5 text-violet-300" />
                <p className="text-sm font-medium text-white">Base local PostgreSQL</p>
                <p className="mt-1 text-sm text-slate-400">Banco `frota`, porta `5432`, pronto para evoluir ao módulo web.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-3xl border border-cyan-500/20 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Último código</p>
                <h2 className="text-xl font-semibold text-white">Resumo operacional</h2>
              </div>
              <Link
                to="/historico"
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
              >
                Ver histórico
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {lastCreated ? (
              <div className="grid gap-3 rounded-2xl border border-emerald-700/30 bg-emerald-950/20 p-5">
                <div className="font-mono text-3xl tracking-[0.28em] text-emerald-300">
                  {lastCreated.shortCode}
                </div>
                <p className="text-sm text-slate-200">{getScopeLabel(lastCreated)}</p>
                <p className="text-sm text-slate-300">
                  Desconto {formatDiscountPercent(lastCreated.discountPercent)} até{" "}
                  {formatDateTime(lastCreated.validUntil)}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
                Gere o primeiro código para visualizar aqui o resumo pronto para compartilhar com o caixa.
              </div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              Estrutura pensada para o provisório: código curto opaco + resolução segura das informações no backend.
            </div>
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-emerald-700/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-700/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <DiscountForm submitting={submitting} onSubmit={createCode} />
          <ResolveCodeCard submitting={submitting} result={lastResolved} onResolve={resolveCode} />
        </section>

        <DiscountHistoryTable items={items.slice(0, 6)} loading={loading} onCancel={cancelCode} />
      </div>
    </main>
  );
}
