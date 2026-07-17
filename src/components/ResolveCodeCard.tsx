import { Search, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import type { ResolveDiscountCodeResponse } from "../../shared/discount";
import { formatCodeList, formatDateTime, formatDiscountPercent, getScopeLabel } from "@/utils/format";

type ResolveCodeCardProps = {
  submitting: boolean;
  result: ResolveDiscountCodeResponse | null;
  onResolve: (shortCode: string) => Promise<void>;
};

export default function ResolveCodeCard({
  submitting,
  result,
  onResolve,
}: ResolveCodeCardProps) {
  const [shortCode, setShortCode] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onResolve(shortCode);
  }

  return (
    <section className="grid gap-5 rounded-3xl border border-slate-800 bg-slate-950/85 p-6 shadow-2xl shadow-slate-950/30">
      <div>
        <p className="text-sm uppercase tracking-[0.28em] text-violet-300">Simulação do leitor</p>
        <h2 className="text-xl font-semibold text-white">Consultar código no caixa</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 md:flex-row">
        <input
          value={shortCode}
          onChange={(event) => setShortCode(event.target.value.toUpperCase())}
          placeholder="Digite o código curto"
          className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono tracking-[0.24em] text-white outline-none transition focus:border-violet-400"
        />
        <button
          type="submit"
          disabled={submitting || !shortCode.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          <Search className="h-4 w-4" />
          {submitting ? "Consultando..." : "Consultar"}
        </button>
      </form>

      {!result ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          Digite um código gerado para visualizar como o outro app conseguirá identificar os
          parâmetros do desconto.
        </div>
      ) : result.found && result.authorization ? (
        <div className="grid gap-3 rounded-2xl border border-emerald-700/30 bg-emerald-950/20 p-5">
          <div className="flex items-center gap-2 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-semibold">Código válido e resolvido com sucesso</span>
          </div>
          <div className="grid gap-2 text-sm text-slate-200">
            <p>Produtos: {formatCodeList(result.authorization.productCodes, "Todos os produtos")}</p>
            <p>Grupos de produto: {formatCodeList(result.authorization.productGroupCodes)}</p>
            <p>Clientes específicos: {formatCodeList(result.authorization.customerCodes)}</p>
            <p>Grupos de cliente: {formatCodeList(result.authorization.customerGroupCodes)}</p>
            <p>Primeira compra: {result.authorization.firstPurchaseOnly ? "Sim" : "Nao"}</p>
            <p>
              Cliente novo por dias:{" "}
              {result.authorization.newCustomerDays === null ? "Nao configurado" : result.authorization.newCustomerDays}
            </p>
            <p>
              Formas de pagamento:{" "}
              {formatCodeList(result.authorization.paymentFormCodes)}
            </p>
            <p>Percentual de desconto: {formatDiscountPercent(result.authorization.discountPercent)}</p>
            <p>Escopo resolvido: {getScopeLabel(result.authorization)}</p>
            <p>Validade final: {formatDateTime(result.authorization.validUntil)}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 rounded-2xl border border-rose-700/30 bg-rose-950/20 p-5">
          <div className="flex items-center gap-2 text-rose-300">
            <ShieldX className="h-5 w-5" />
            <span className="font-semibold">Código não disponível para uso</span>
          </div>
          <p className="text-sm text-slate-200">
            Motivo: {result.reason === "EXPIRED" ? "expirado" : result.reason === "CANCELLED" ? "cancelado" : "não encontrado"}.
          </p>
        </div>
      )}
    </section>
  );
}
