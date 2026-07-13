import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  accent: "violet" | "emerald" | "amber" | "rose";
}

const accentStyles = {
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
};

export default function KpiCard({ label, value, icon: Icon, accent }: KpiCardProps) {
  return (
    <article className="rounded-[28px] border border-white/60 bg-white px-5 py-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ${accentStyles[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}
