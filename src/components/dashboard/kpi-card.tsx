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

const pct = (c: number) => `${c > 0 ? "+" : ""}${c.toFixed(1)}%`;

/** One change against a base, in the better / worse colours: "▲ 14.2%". */
function Change({ current, base, higherIsBetter }: { current: Num; base: Num; higherIsBetter: boolean }) {
  const change = pctChange(current, base);
  const good = isFavorable(change, higherIsBetter);
  if (change === null) return <span className="text-muted">—</span>;
  return (
    <span className={cn("font-medium tabular-nums", good === true && "text-positive", good === false && "text-negative", good === null && "text-muted")}>
      {change === 0 ? "No change" : `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`}
    </span>
  );
}

/**
 * A metric: label, value and one change line ("▲ 14.2% vs 937"). Month-on-month and year-on-year, the
 * source and the explanation sit in a detail that opens on hover or keyboard focus, so nothing is lost.
 */
export function KpiCard({ label, source, hint, value, previous, mom, yoy, format, higherIsBetter = true }: KpiProps) {
  const compared = [previous, mom, yoy].some((v) => v !== null && v !== undefined);
  const extra = [
    mom !== undefined && { k: "Month on month", v: mom, c: pctChange(value, mom) },
    yoy !== undefined && { k: "Year on year", v: yoy, c: pctChange(value, yoy) },
  ].filter(Boolean) as { k: string; v: Num; c: number | null }[];
  const hasDetail = Boolean(hint || extra.length || source);
  return (
    <div tabIndex={hasDetail ? 0 : undefined}
      className="group relative flex min-h-[104px] flex-col rounded-[10px] border border-border bg-surface px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <h3 className="text-xs font-medium text-muted">{label}</h3>
      <p className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">{format(value)}</p>
      {compared && (
        <p className="mt-auto pt-1.5 text-xs text-secondary">
          {previous !== undefined
            ? <><Change current={value} base={previous} higherIsBetter={higherIsBetter} /> <span className="text-muted">vs {format(previous)}</span></>
            : <span className="text-muted">See detail</span>}
          {extra.some((e) => e.c !== null) && (
            <span className="ml-2 hidden text-faint sm:inline">
              {extra.filter((e) => e.c !== null).map((e) => `${e.k === "Month on month" ? "MoM" : "YoY"} ${pct(e.c!)}`).join(" · ")}
            </span>
          )}
        </p>
      )}
      {hasDetail && (
        <div role="tooltip"
          className="pointer-events-none invisible absolute left-3 right-3 top-full z-30 mt-1.5 rounded-lg border border-border bg-surface p-3 text-xs opacity-0 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)] transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">
          {hint && <p className="leading-relaxed text-secondary">{hint}</p>}
          {(previous !== undefined || extra.length > 0) && (
            <dl className={cn("grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 tabular-nums", hint && "mt-2 border-t border-hairline pt-2")}>
              {previous !== undefined && <><dt className="text-muted">Previous period</dt><dd className="text-right">{format(previous)}</dd><dd className="text-right"><Change current={value} base={previous} higherIsBetter={higherIsBetter} /></dd></>}
              {extra.map((e) => <div key={e.k} className="contents"><dt className="text-muted">{e.k}</dt><dd className="text-right">{format(e.v)}</dd><dd className="text-right"><Change current={value} base={e.v} higherIsBetter={higherIsBetter} /></dd></div>)}
            </dl>
          )}
          {source && <p className="mt-2 text-faint">Source: {source}</p>}
        </div>
      )}
    </div>
  );
}

/** A plain number tile: label, value, one short line. */
export function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="flex min-h-[104px] flex-col rounded-[10px] border border-border bg-surface px-4 py-3.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums", tone === "good" && "text-positive", tone === "bad" && "text-negative", tone === "warn" && "text-warn")}>{value}</p>
      {sub && <p className="mt-auto pt-1.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
