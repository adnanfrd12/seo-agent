"use client";

import { useId, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface TrendPoint {
  date: string;
  value: number | null;
  previous?: number | null;
}

type Format = "int" | "percent" | "decimal";

function fmt(v: number | null | undefined, f: Format) {
  if (v == null) return "—";
  if (f === "percent") return `${(v * 100).toFixed(1)}%`;
  if (f === "decimal") return v.toFixed(1);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One measure over time. Current period is a 2px accent line; the optional previous period is a
 * dashed muted line (so identity never relies on color alone). A table view is always available.
 */
export function TrendChart({
  title, data, format = "int", seriesLabel, previousLabel = "Previous period", reverseY = false,
}: {
  title: string;
  data: TrendPoint[];
  format?: Format;
  seriesLabel: string;
  previousLabel?: string;
  reverseY?: boolean;
}) {
  const [table, setTable] = useState(false);
  const id = useId();
  const hasPrev = data.some((d) => d.previous != null);

  return (
    <figure className="rounded-xl border border-border bg-surface p-4" aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="text-sm font-semibold">{title}</figcaption>
        <div className="flex items-center gap-3 text-xs text-muted">
          {hasPrev && (
            <ul className="flex items-center gap-3" aria-label="Legend">
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded bg-accent" aria-hidden /> {seriesLabel}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="inline-block w-4 border-t-2 border-dashed border-muted" aria-hidden /> {previousLabel}
              </li>
            </ul>
          )}
          <button
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            className="rounded-md border border-border px-2 py-1 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
          >
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No data for this period.</p>
      ) : table ? (
        <div className="max-h-64 overflow-auto">
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
                  <td className="py-1 text-right tabular-nums">{fmt(d.value, format)}</td>
                  {hasPrev && <td className="py-1 text-right tabular-nums">{fmt(d.previous, format)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label={`${title} line chart. Use the Table button for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date" tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={32}
              />
              <YAxis
                width={48} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => fmt(v, format)} reversed={reverseY} domain={reverseY ? ["auto", "auto"] : [0, "auto"]}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)",
                }}
                labelFormatter={(l) => shortDate(String(l))}
                formatter={(v, name) => [fmt(typeof v === "number" ? v : null, format), name === "previous" ? previousLabel : seriesLabel]}
              />
              {hasPrev && (
                <Line
                  type="monotone" dataKey="previous" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4"
                  dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false}
                />
              )}
              <Line
                type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
