import type { CSSProperties } from "react";
import type { PlanSeriesItem } from "@/utils/saas";

interface PlanDonutProps {
  items: PlanSeriesItem[];
}

export default function PlanDonut({ items }: PlanDonutProps) {
  const total = items.reduce((sum, item) => sum + item.total, 0) || 1;
  let cursor = 0;

  const segments = items.map((item) => {
    const start = cursor;
    const percent = (item.total / total) * 100;
    cursor += percent;
    return `${item.color} ${start}% ${cursor}%`;
  });

  const style = {
    backgroundImage: `conic-gradient(${segments.join(", ")})`,
  } satisfies CSSProperties;

  return (
    <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
      <div className="mb-6">
        <p className="text-sm font-semibold text-slate-900">Distribuicao por Plano</p>
        <p className="text-sm text-slate-500">Composicao da base ativa por nivel contratual.</p>
      </div>

      <div className="flex min-h-[220px] flex-col items-center justify-center gap-8 lg:flex-row">
        <div className="relative h-40 w-40 rounded-full" style={style}>
          <div className="absolute inset-[18px] rounded-full bg-white shadow-inner shadow-slate-200" />
        </div>

        <div className="grid gap-4">
          {items.map((item) => (
            <div key={item.plan} className="flex items-center gap-3 text-sm text-slate-600">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="min-w-28 font-medium text-slate-900">{item.label}</span>
              <span>{item.total} empresa(s)</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
