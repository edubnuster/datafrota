import { Ban, Clock3, PackageSearch } from "lucide-react";
import type { DiscountAuthorization } from "../../shared/discount";
import {
  formatCodeList,
  formatDateTime,
  formatDiscountPercent,
  getScopeLabel,
  getStatusLabel,
} from "@/utils/format";

type DiscountHistoryTableProps = {
  items: DiscountAuthorization[];
  loading: boolean;
  onCancel: (shortCode: string) => Promise<void>;
};

export default function DiscountHistoryTable({
  items,
  loading,
  onCancel,
}: DiscountHistoryTableProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/85 p-6 shadow-2xl shadow-slate-950/30">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Histórico</p>
          <h2 className="text-xl font-semibold text-white">Códigos emitidos</h2>
        </div>
        <div className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
          {items.length} registros
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          Carregando histórico...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-10 text-center text-slate-400">
          <PackageSearch className="h-8 w-8 text-slate-600" />
          <p>Nenhum código gerado ainda.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <div className="grid grid-cols-[1.1fr_1.2fr_0.8fr_1fr_1fr_0.9fr] gap-3 bg-slate-900 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-400">
            <span>Código</span>
            <span>Escopo</span>
            <span>Desconto</span>
            <span>Cliente</span>
            <span>Validade</span>
            <span>Ação</span>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1.1fr_1.2fr_0.8fr_1fr_1fr_0.9fr] gap-3 border-t border-slate-800 bg-slate-950 px-4 py-4 text-sm text-slate-200"
              >
                <div>
                  <div className="font-mono text-lg tracking-[0.24em] text-cyan-300">
                    {item.shortCode}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{getStatusLabel(item.status)}</div>
                </div>

                <div>
                  <div>{getScopeLabel(item)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Criado em {formatDateTime(item.createdAt)}
                  </div>
                </div>

                <div className="font-semibold text-emerald-300">
                  {formatDiscountPercent(item.discountPercent)}
                </div>

                <div>
                  {item.firstPurchaseOnly
                    ? "Clientes novos · primeira compra"
                    : item.newCustomerDays !== null
                    ? `Clientes novos · ${item.newCustomerDays} dia(s)`
                    : item.customerCodes.length > 0
                    ? `Clientes ${formatCodeList(item.customerCodes)}`
                    : item.customerGroupCodes.length > 0
                      ? `Grupos ${formatCodeList(item.customerGroupCodes)}`
                      : "Todos os clientes"}
                  <div className="mt-1 text-xs text-slate-500">
                    {item.paymentFormCodes.length > 0
                      ? `Formas de pagamento ${formatCodeList(item.paymentFormCodes)}`
                      : "Todas as formas de pagamento"}
                  </div>
                </div>

                <div className="text-slate-300">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-slate-500" />
                    <span>{item.validUntil ? formatDateTime(item.validUntil) : "Sem data final"}</span>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    disabled={item.status !== "ACTIVE"}
                    onClick={() => onCancel(item.shortCode)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-700/50 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                  >
                    <Ban className="h-4 w-4" />
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
