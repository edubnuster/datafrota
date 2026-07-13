import type { StatusSeriesItem } from "@/utils/saas";

interface StatusBarsProps {
  items: StatusSeriesItem[];
}

const barColors: Record<string, string> = {
  ativa: "from-violet-500 to-violet-700",
  trial: "from-sky-400 to-sky-600",
  suspensa: "from-amber-400 to-amber-600",
  vencida: "from-rose-400 to-rose-600",
};

export default function StatusBars({ items }: StatusBarsProps) {
  const max = Math.max(...items.map((item) => item.total), 1);

  return (
    <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
      <div className="mb-6">
        <p className="text-sm font-semibold text-slate-900">Empresas por Status</p>
        <p className="text-sm text-slate-500">Visao geral da distribuicao operacional no ambiente.</p>
      </div>

      <div className="grid min-h-[220px] grid-cols-4 items-end gap-6">
        {items.map((item) => (
          <div key={item.status} className="flex h-full flex-col items-center justify-end gap-4">
            <span className="text-sm font-semibold text-slate-500">{item.total}</span>
            <div className="flex h-40 items-end">
              <div
                className={`w-12 rounded-t-2xl bg-gradient-to-t ${barColors[item.status]}`}
                style={{ height: `${Math.max((item.total / max) * 100, 10)}%` }}
              />
            </div>
            <span className="text-sm text-slate-500">{item.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
