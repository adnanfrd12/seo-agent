"use client";

import { useId, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface TrendPoint {
  date: string;
  value: number | null;
  previous?: number | null;
}

export type TrendFormat = "int" | "percent" | "decimal";
/** How the current period is drawn. Each tab of a metric switcher uses a different one. */
export type TrendVariant = "bar" | "area" | "line" | "step";

export function fmtTrend(v: number | null | undefined, f: TrendFormat) {
  if (v == null) return "—";
  if (f === "percent") return `${(v * 100).toFixed(1)}%`;
  if (f === "decimal") return v.toFixed(1);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One measure over time, drawn as bars, a filled area, a line or a stepped line. The optional
 * previous period is always a dashed muted line (so identity never relies on colour alone).
 * Chart, table and empty states share one fixed height, so toggling never shifts the layout.
 */
export function TrendChart({
  title, data, format = "int", seriesLabel, previousLabel = "Previous period", reverseY = false, toolbar, source,
  variant, color = "var(--series)", compact = false,
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
  /** chart style; defaults to bars for counts and a line for ratios */
  variant?: TrendVariant;
  /** series colour (any CSS colour) */
  color?: string;
  /** static rendering for print/PDF: no Table toggle, shorter plot */
  compact?: boolean;
}) {
  const [table, setTable] = useState(false);
  const id = useId();
  const hasPrev = data.some((d) => d.previous != null);
  const kind: TrendVariant = variant ?? (format === "int" ? "bar" : "line");
  const gradient = `${id.replace(/[^a-zA-Z0-9]/g, "")}-fill`;

  return (
    <figure className="report-avoid-break flex min-w-0 flex-col rounded-[10px] border border-border bg-surface px-4 pb-3 pt-3.5 sm:px-5" aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <figcaption id={`${id}-t`} className="truncate text-[15px] font-semibold">{title}</figcaption>
          {source && <span className="shrink-0 text-xs text-muted">{source}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {toolbar}
          {!compact && <button
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            className="h-7 rounded-md border border-border-strong px-2.5 font-medium text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
          >
            {table ? "Chart" : "Table"}
          </button>}
        </div>
      </div>

      {hasPrev && !table && (
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className={kind === "bar" ? "inline-block size-2.5 rounded-sm" : "inline-block h-0.5 w-4 rounded"} style={{ background: color }} aria-hidden />
            {seriesLabel}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-series-prev" aria-hidden /> {previousLabel}
          </li>
        </ul>
      )}

      {data.length === 0 ? (
        <div className={`flex ${compact ? "h-44" : "h-60"} items-center justify-center text-sm text-muted`}>No data for this period.</div>
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
                <tr key={d.date} className="border-t border-hairline">
                  <td className="py-1">{d.date}</td>
                  <td className="py-1 text-right tabular-nums">{fmtTrend(d.value, format)}</td>
                  {hasPrev && <td className="py-1 text-right tabular-nums">{fmtTrend(d.previous, format)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={compact ? "h-44" : "h-60"} role="img" aria-label={`${title}: ${seriesLabel} ${kind === "bar" ? "bar" : kind === "area" ? "area" : "line"} chart. Use the Table button for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="date" tickFormatter={shortDate} tick={{ fill: "var(--faint)", fontSize: 11 }}
                tickLine={false} axisLine={false} minTickGap={40} tickMargin={8}
              />
              <YAxis
                width={44} tick={{ fill: "var(--faint)", fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => fmtTrend(v, format)} reversed={reverseY}
                domain={reverseY ? ["auto", "auto"] : [0, "auto"]} allowDecimals={format !== "int"}
              />
              <Tooltip
                cursor={kind === "bar" ? { fill: "var(--surface-muted)" } : { stroke: "var(--border-strong)" }}
                contentStyle={{
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)",
                  boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.25)", padding: "8px 10px",
                }}
                labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                labelFormatter={(l) => shortDate(String(l))}
                formatter={(v, name) => [fmtTrend(typeof v === "number" ? v : null, format), name === "previous" ? previousLabel : seriesLabel]}
              />
              {hasPrev && (
                <Line
                  type="linear" dataKey="previous" stroke="var(--series-prev)" strokeWidth={1.75} strokeDasharray="5 4"
                  dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              )}
              {kind === "bar" && (
                <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              )}
              {kind === "area" && (
                <Area
                  type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradient})`}
                  dot={false} activeDot={{ r: 4.5, stroke: "var(--surface)", strokeWidth: 2, fill: color }} isAnimationActive={false}
                />
              )}
              {(kind === "line" || kind === "step") && (
                <Line
                  type={kind === "step" ? "stepAfter" : "linear"} dataKey="value" stroke={color} strokeWidth={2}
                  // gaps on days without data; dots keep isolated days visible
                  dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
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
