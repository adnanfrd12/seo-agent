"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

export interface SnapshotPoint { domain: string; is_self: boolean; snapshot_date: string; keywords: number | null; traffic: number | null; top10: number | null }

const COLORS = ["#2563EB", "#0D9488", "#7C3AED", "#D4970A", "#DB2777", "#0891B2"];
const METRICS = [
  { key: "keywords", label: "Ranking keywords" }, { key: "traffic", label: "Est. traffic" }, { key: "top10", label: "Top-10 keywords" },
  { key: "relative", label: "Relative change" },
] as const;
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The client against each tracked competitor over time. The client is the thick brand-colour line. */
export function CompareTrend({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("keywords");
  const id = useId();
  const { data, domains } = useMemo(() => {
    const dates = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
    const domains = [...new Set(snapshots.map((s) => s.domain))].sort((a, b) => Number(snapshots.find((s) => s.domain === b)?.is_self) - Number(snapshots.find((s) => s.domain === a)?.is_self));
    // "Relative change" indexes ranking keywords to the first stored snapshot (= 100), so a small site and a
    // national brand can be compared by direction of travel instead of by raw size
    const base = new Map(domains.map((d) => [d, snapshots.filter((s) => s.domain === d && s.keywords).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))[0]?.keywords ?? null]));
    const data = dates.map((date) => {
      const row: Record<string, number | string | null> = { date };
      for (const d of domains) {
        const snap = snapshots.find((s) => s.domain === d && s.snapshot_date === date);
        row[d] = metric === "relative" ? (snap?.keywords != null && base.get(d) ? Math.round((snap.keywords / base.get(d)!) * 1000) / 10 : null) : snap?.[metric] ?? null;
      }
      return row;
    });
    return { data, domains };
  }, [snapshots, metric]);

  return (
    <figure className="rounded-[10px] border border-border bg-surface p-4" aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="text-sm font-semibold">Visibility over time <span className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">estimate</span></figcaption>
        <div role="tablist" aria-label="Visibility metric" className="inline-flex rounded-lg border border-border p-0.5">
          {METRICS.map((m) => (
            <button key={m.key} role="tab" aria-selected={m.key === metric} onClick={() => setMetric(m.key)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", m.key === metric ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-surface-muted")}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {data.length < 2 ? (
        <div className="flex h-60 items-center justify-center px-6 text-center text-sm text-muted">
          One daily snapshot is stored so far. The trend lines appear after the next daily analysis; each day adds a point.
        </div>
      ) : (
        <div className="h-64" role="img" aria-label={`${METRICS.find((m) => m.key === metric)?.label} over time for you and your competitors`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={32} />
              <YAxis width={52} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => nf.format(v)} domain={metric === "relative" ? ["auto", "auto"] : [0, "auto"]} />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
                labelFormatter={(l) => shortDate(String(l))} formatter={(v, name) => [typeof v === "number" ? nf.format(v) : "—", String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {domains.map((d, i) => {
                const self = snapshots.find((s) => s.domain === d)?.is_self;
                return <Line key={d} type="monotone" dataKey={d} stroke={self ? "var(--accent)" : COLORS[i % COLORS.length]} strokeWidth={self ? 3 : 2}
                  strokeDasharray={self ? undefined : i % 2 ? "5 4" : undefined} dot={{ r: 2.5 }} activeDot={{ r: 4.5 }} connectNulls isAnimationActive={false} name={self ? `${d} (you)` : d} />;
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {metric === "relative" && data.length >= 2 && <p className="mt-2 text-xs text-muted">Ranking keywords indexed to the first stored snapshot (100). Above 100 means growth since then, whatever the site&apos;s size.</p>}
    </figure>
  );
}
