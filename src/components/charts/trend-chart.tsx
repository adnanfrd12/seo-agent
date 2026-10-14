"use client";

import { useId, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface TrendPoint {
  date: string;
  value: number | null;
  previous?: number | null;
}

export type TrendFormat = "int" | "percent" | "decimal";

export function fmtTrend(v: number | null | undefined, f: TrendFormat) {
  if (v == null) return "—";
  if (f === "percent") return `${(v * 100).toFixed(1)}%`;
  if (f === "decimal") return v.toFixed(1);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One measure over time. Current period is a 2px accent line; the optional previous period is a
 * dashed muted line (so identity never relies on color alone). Chart, table and empty states all
 * share one fixed height, so toggling or loading never shifts the layout.
 */
export function TrendChart({
  title, data, format = "int", seriesLabel, previousLabel = "Previous period", reverseY = false, toolbar, source,
}: {
  title: string;
  data: TrendPoint[];
  format?: TrendFormat;
  seriesLabel: string;
  previousLabel?: string;
  reverseY?: boolean;
  /** extra controls rendered in the header, e.g. a metric switcher */
  toolbar?: React.ReactNode;
  /** small source badge, e.g. "GA4" */
  source?: string;
}) {
  const [table, setTable] = useState(false);
  const id = useId();
  const hasPrev = data.some((d) => d.previous != null);
  const bars = format === "int";

  return (
    <figure className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4" aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <figcaption id={`${id}-t`} className="truncate text-sm font-semibold">{title}</figcaption>
          {source && (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">{source}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {toolbar}
          <button
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            className="rounded-md border border-border px-2 py-1 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
          >
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {hasPrev && !table && (
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className={bars ? "inline-block size-2.5 rounded-sm bg-accent" : "inline-block h-0.5 w-4 rounded bg-accent"} aria-hidden /> {seriesLabel}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-muted" aria-hidden /> {previousLabel}
          </li>
        </ul>
      )}

      {data.length === 0 ? (
        <div className="flex h-60 items-center justify-center text-sm text-muted">No data for this period.</div>
      ) : table ? (
        <div className="h-60 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 text-right font-medium">{seriesLabel}</th>
                {hasPrev && <th className="py-1 text-right font-medium">{previousLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1">{d.date}</td>
                  <td className="py-1 text-right tabular-nums">{fmtTrend(d.value, format)}</td>
                  {hasPrev && <td className="py-1 text-right tabular-nums">{fmtTrend(d.previous, format)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label={`${title}: ${seriesLabel} ${bars ? "bar" : "line"} chart. Use the Table button for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date" tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={32}
              />
              <YAxis
                width={48} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => fmtTrend(v, format)} reversed={reverseY}
                domain={reverseY ? ["auto", "auto"] : [0, "auto"]} allowDecimals={format !== "int"}
              />
              <Tooltip
                cursor={bars ? { fill: "var(--surface-muted)" } : { stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)",
                }}
                labelFormatter={(l) => shortDate(String(l))}
                formatter={(v, name) => [fmtTrend(typeof v === "number" ? v : null, format), name === "previous" ? previousLabel : seriesLabel]}
              />
              {hasPrev && (
                <Line
                  type="linear" dataKey="previous" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4"
                  dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              )}
              {bars ? (
                <Bar dataKey="value" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              ) : (
                <Line
                  type="linear" dataKey="value" stroke="var(--accent)" strokeWidth={2}
                  // ratios have gaps on days without data; show a dot so isolated days stay visible
                  dot={{ r: 2.5, fill: "var(--accent)", strokeWidth: 0 }}
                  activeDot={{ r: 4.5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
