"use client";

import { KpiCard, StatCard } from "@/components/dashboard/kpi-card";
import type { SpendKpis as Kpis, SpendPeriod } from "@/lib/org/spend";
import { count, monthLabel, rangeLong, spanLabel, usd } from "./format";

const money = (n: number | null | undefined) => usd(n ?? 0);

/** The six headline tiles: today, this month, last month, the range, its change and the number of runs or calls. */
export function SpendKpis({ kpis: k, period: p, what, countLabel, countSub }: { kpis: Kpis; period: SpendPeriod; what: string; countLabel: string; countSub?: string }) {
  const range = rangeLong(p.range);
  const previous = range.replace("Last", "previous");
  const diff = k.range - k.prevRange;
  const pct = k.prevRange ? diff / k.prevRange : null;
  // a percentage, like the tile beside it (the lists switch to "10×" for very large changes)
  const pctText = pct == null ? "" : `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct) >= 1 ? Math.round(Math.abs(pct * 100)).toLocaleString("en-US") : Math.abs(pct * 100).toFixed(1)}%`;
  return (
    <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @6xl:grid-cols-6">
      <KpiCard label="Today" value={k.today} previous={k.yesterday} format={money} higherIsBetter={false} source={what}
        hint={`Spent today (${p.today}, ${p.timezone}), compared with yesterday.`} />
      <StatCard label="This month" value={usd(k.month)}
        sub={k.projected != null ? `On pace for ${usd(k.projected)} in ${monthLabel(k.monthKey).split(" ")[0]}` : monthLabel(k.monthKey, true)} />
      <StatCard label="Last month" value={usd(k.lastMonth)} sub={monthLabel(k.lastMonthKey, true)} />
      <KpiCard label={range} value={k.range} previous={k.prevRange} format={money} higherIsBetter={false} source={what}
        hint={`${spanLabel(p.start, p.end)}, compared with the ${previous} (${spanLabel(p.prevStart, p.prevEnd)}).`} />
      <StatCard label="Change vs previous period"
        value={!k.prevRange && !k.range ? "–" : pct == null ? "New" : pctText}
        tone={diff > 1e-6 ? "bad" : diff < -1e-6 ? "good" : undefined}
        sub={pct == null && k.range ? `Nothing spent in the ${previous}` : `${diff >= 0 ? "+" : "−"}${usd(Math.abs(diff))} vs ${usd(k.prevRange)} in the ${previous}`} />
      <StatCard label={countLabel} value={count(k.count)}
        sub={countSub ?? `${count(k.prevCount)} in the ${previous}${k.count ? ` · ${usd(k.range / k.count)} each` : ""}`} />
    </div>
  );
}
