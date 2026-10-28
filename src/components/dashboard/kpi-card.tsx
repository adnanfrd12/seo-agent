import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { isFavorable, pctChange, type Num } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

export interface KpiProps {
  label: string;
  source: string;
  hint?: string;
  value: Num;
  previous?: Num;
  mom?: Num;
  yoy?: Num;
  format: (n: Num) => string;
  /** false for metrics where lower is better (e.g. average search position) */
  higherIsBetter?: boolean;
}

function Delta({ label, current, base, higherIsBetter }: {
  label: string; current: Num; base: Num; higherIsBetter: boolean;
}) {
  const change = pctChange(current, base);
  const good = isFavorable(change, higherIsBetter);
  const Icon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        good === true && "bg-positive/10 text-positive",
        good === false && "bg-negative/10 text-negative",
        good === null && "bg-surface-muted text-muted",
      )}
      title={change === null ? `${label}: no comparison data` : `${label}: ${change.toFixed(1)}%`}
    >
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{label}</span>
      {change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
      <span className="ml-0.5 text-[10px] font-normal text-muted" aria-hidden>{label}</span>
    </span>
  );
}

export function KpiCard({ label, source, hint, value, previous, mom, yoy, format, higherIsBetter = true }: KpiProps) {
  return (
    <div className="lift flex min-h-36 flex-col rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-muted" title={hint}>{label}</h3>
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          {source}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{format(value)}</p>
      <p className="mt-0.5 text-xs text-muted">Previous period: {format(previous)}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        <Delta label="vs prev" current={value} base={previous} higherIsBetter={higherIsBetter} />
        <Delta label="MoM" current={value} base={mom} higherIsBetter={higherIsBetter} />
        <Delta label="YoY" current={value} base={yoy} higherIsBetter={higherIsBetter} />
      </div>
    </div>
  );
}
