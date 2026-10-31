"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Charts for multi-entity data (brands, assistants, domains). Identity uses the categorical tokens
 * --cat-1..8 in a fixed order (the caller assigns a slot per entity, so a filter never repaints the
 * survivors; see lib/charts/colors); anything past eight folds into "Other". Values are always printed or in a tooltip, and
 * every chart has a legend, so identity never depends on colour alone.
 */

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Panel({ title, sub, right, children, className }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-[10px] border border-border bg-surface", className)} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {right}
      </header>
      <div className="flex flex-1 flex-col px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
      {items.map((i) => (
        <li key={i.label} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          <span className="truncate">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ stacked horizontal bars */
export interface StackKey { key: string; label: string; color: string }
export interface StackRow { label: string; values: Record<string, number>; note?: string }

/**
 * Ranked rows, each a horizontal bar split into segments (e.g. a domain's citations by assistant).
 * `percent` draws every row at full width (composition); otherwise bar length is the row total.
 */
export function StackedBars({ title, sub, keys, rows, valueLabel, percent = false, empty = "No data yet." }: {
  title: string; sub?: string; keys: StackKey[]; rows: StackRow[]; valueLabel: string; percent?: boolean; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = rows.map((r) => keys.reduce((a, k) => a + (r.values[k.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">{valueLabel}</span>}>
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">{empty}</p> : (
        <>
          <Legend items={keys} />
          <ul className="mt-4 space-y-2" onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => {
              const total = totals[i];
              const width = percent ? 100 : (total / max) * 100;
              return (
                <li key={r.label} className="relative grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
                  <span className="truncate" title={r.label}>{r.label}</span>
                  <span className="flex h-3.5 min-w-0 gap-[2px]" style={{ width: `${Math.max(width, 1.5)}%` }} aria-hidden>
                    {keys.map((k) => {
                      const v = r.values[k.key] ?? 0;
                      return v > 0 ? <span key={k.key} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: v, flexBasis: 0, background: k.color }} /> : null;
                    })}
                  </span>
                  <span className="shrink-0 text-right tabular-nums text-secondary">{percent ? (r.note ?? "") : nf.format(total)}</span>
                  {hover === i && (
                    <div role="tooltip" className="pointer-events-none absolute left-[9.5rem] top-full z-20 mt-1 min-w-44 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)] sm:left-[14.5rem]">
                      <p className="mb-1.5 font-medium">{r.label}</p>
                      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                        {keys.filter((k) => (r.values[k.key] ?? 0) > 0).map((k) => (
                          <div key={k.key} className="contents">
                            <dt className="inline-flex items-center gap-1.5 text-secondary"><span className="size-2 rounded-[2px]" style={{ background: k.color }} />{k.label}</dt>
                            <dd className="text-right">{nf.format(r.values[k.key])}{percent && total ? ` · ${Math.round((r.values[k.key] / total) * 100)}%` : ""}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ donut */
/** Parts of a whole (share of voice). Five slices at most plus "Other"; the centre holds the headline. */
export function Donut({ title, sub, items, center, centerLabel }: {
  title: string; sub?: string; items: { label: string; value: number; color: string }[]; center: string; centerLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((a, i) => a + i.value, 0);
  const R = 52, C = 2 * Math.PI * R, gap = items.length > 1 ? 2 : 0;
  const starts = items.map((_, k) => items.slice(0, k).reduce((a, x) => a + (total ? (x.value / total) * C : 0), 0));
  return (
    <Panel title={title} sub={sub}>
      {total === 0 ? <p className="py-8 text-center text-sm text-muted">No data yet.</p> : (
        <div className="my-auto flex flex-wrap items-center gap-5">
          <div className="relative size-36 shrink-0">
            <svg viewBox="0 0 128 128" className="size-full -rotate-90" role="img" aria-label={`${title}: ${items.map((i) => `${i.label} ${Math.round((i.value / total) * 100)}%`).join(", ")}`}>
              <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface-muted)" strokeWidth="14" />
              {items.map((i, k) => {
                const len = (i.value / total) * C;
                return (
                  <circle key={i.label} cx="64" cy="64" r={R} fill="none" stroke={i.color} strokeWidth={hover === k ? 17 : 14}
                    strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-starts[k]} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
              <span className="text-xl font-semibold tabular-nums">{hover == null ? center : `${Math.round((items[hover].value / total) * 100)}%`}</span>
              <span className="max-w-24 truncate text-[11px] text-muted">{hover == null ? centerLabel : items[hover].label}</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-[13px]">
            {items.map((i, k) => (
              <li key={i.label} className={cn("flex items-center gap-2 rounded px-1", hover === k && "bg-surface-muted")} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={i.label}>{i.label}</span>
                <span className="tabular-nums text-secondary">{Math.round((i.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ gauge */
/** A 0-100 score on a half ring: red below 40, grey 40-60, green above 60 (labelled, not colour alone). */
export function Gauge({ value, label, sub, empty = "No data" }: { value: number | null; label: string; sub?: string; empty?: string }) {
  const R = 54, C = Math.PI * R;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? "var(--faint)" : v >= 60 ? "var(--positive)" : v >= 40 ? "var(--muted)" : "var(--negative)";
  const word = value == null ? empty : v >= 60 ? "Positive" : v >= 40 ? "Neutral" : "Negative";
  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 128 72" className="w-40" role="img" aria-label={`${label}: ${value == null ? "no data" : `${Math.round(v)} of 100, ${word}`}`}>
        <path d="M10 66 A54 54 0 0 1 118 66" fill="none" stroke="var(--surface-muted)" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 66 A54 54 0 0 1 118 66" fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} />
      </svg>
      <p className="-mt-8 text-[26px] font-semibold leading-none tabular-nums">{value == null ? "—" : Math.round(v)}</p>
      <p className="mt-1.5 text-xs font-medium" style={{ color: tone }}>{word}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
      {sub && <p className="text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ heatmap */
/**
 * Rows × columns of values. "seq" shades by magnitude in the series hue; "div" is for 0-100 sentiment:
 * red below 50, green above, neutral grey at 50. Every cell prints its value.
 */
export function Heatmap({ title, sub, rows, cols, cells, scale = "seq", unit = "", max }: {
  title: string; sub?: string; rows: string[]; cols: string[]; cells: (number | null)[][]; scale?: "seq" | "div"; unit?: string; max?: number;
}) {
  const format = (v: number) => `${Math.round(v)}${unit}`;
  const top = max ?? Math.max(1, ...cells.flat().filter((v): v is number => v != null));
  const bg = (v: number | null) => {
    if (v == null) return "transparent";
    if (scale === "seq") return `color-mix(in oklab, var(--series) ${Math.round(8 + (v / top) * 72)}%, var(--surface))`;
    const d = (v - 50) / 50;
    return d >= 0 ? `color-mix(in oklab, var(--positive) ${Math.round(6 + d * 64)}%, var(--surface))` : `color-mix(in oklab, var(--negative) ${Math.round(6 - d * 64)}%, var(--surface))`;
  };
  const strong = (v: number | null) => v != null && (scale === "seq" ? v / top > 0.55 : Math.abs(v - 50) > 28);
  return (
    <Panel title={title} sub={sub}>
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">No data yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-[2px] text-[13px]">
            <thead>
              <tr>
                <th className="sr-only">Row</th>
                {cols.map((c) => <th key={c} scope="col" className="px-2 pb-1 text-center text-xs font-medium text-muted">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r}>
                  <th scope="row" className="max-w-[11rem] truncate pr-3 text-left font-normal" title={r}>{r}</th>
                  {cols.map((c, j) => {
                    const v = cells[i]?.[j] ?? null;
                    return (
                      <td key={c} title={`${r} · ${c}: ${v == null ? "no data" : format(v)}`} className={cn("h-9 min-w-16 rounded-[4px] text-center tabular-nums", v == null ? "text-faint" : strong(v) ? "font-medium text-white" : "text-foreground")}
                        style={{ background: v == null ? "var(--surface-sunken)" : bg(v) }}>
                        {v == null ? "—" : format(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ columns (distribution) */
export function Columns({ title, sub, bins, valueLabel }: { title: string; sub?: string; bins: { label: string; value: number; highlight?: boolean }[]; valueLabel: string }) {
  const max = Math.max(1, ...bins.map((b) => b.value));
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">{valueLabel}</span>}>
      <div className="flex h-40 items-end gap-2" role="img" aria-label={`${title}: ${bins.map((b) => `${b.label} ${b.value}`).join(", ")}`}>
        {bins.map((b) => (
          <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${b.label}: ${b.value}`}>
            <span className="text-xs tabular-nums text-secondary">{b.value}</span>
            <span className="w-full max-w-12 rounded-t-[4px]" style={{ height: `${Math.max(2, (b.value / max) * 100)}%`, background: b.highlight ? "var(--series)" : "color-mix(in oklab, var(--series) 45%, var(--surface))" }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 border-t border-hairline pt-1.5">
        {bins.map((b) => <span key={b.label} className="min-w-0 flex-1 truncate text-center text-xs text-muted">{b.label}</span>)}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ multi-series lines */
export interface LineSeries { key: string; label: string; color: string; data: { date: string; value: number | null }[] }
export interface LineMetric { key: string; label: string; unit?: string; reverse?: boolean; series: LineSeries[] }

/**
 * Several entities over time on one axis, with a metric picker and a checkbox per entity (the list
 * doubles as the legend). Only one measure is ever on the axis, so scales never mix.
 */
export function MultiLine({ title, sub, metrics, initialHidden = [] }: { title: string; sub?: string; metrics: LineMetric[]; initialHidden?: string[] }) {
  const id = useId();
  const [mk, setMk] = useState(metrics[0]?.key);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialHidden));
  const m = metrics.find((x) => x.key === mk) ?? metrics[0];
  const data = useMemo(() => {
    if (!m) return [];
    const dates = [...new Set(m.series.flatMap((s) => s.data.map((d) => d.date)))].sort();
    return dates.map((date) => Object.fromEntries([["date", date], ...m.series.map((s) => [s.key, s.data.find((d) => d.date === date)?.value ?? null])]));
  }, [m]);
  if (!m) return null;
  const fmt = (v: unknown) => (typeof v === "number" ? `${m.reverse ? "#" : ""}${nf.format(v)}${m.unit ?? ""}` : "—");
  const points = data.length;
  return (
    <Panel title={title} sub={sub} right={metrics.length > 1 ? (
      <label className="inline-flex items-center gap-2 text-xs text-muted" htmlFor={`${id}-m`}>Metric
        <select id={`${id}-m`} value={m.key} onChange={(e) => setMk(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-foreground">
          {metrics.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </label>
    ) : undefined}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="h-72 min-w-0">
          {points < 2 ? <p className="grid h-full place-items-center rounded-lg border border-dashed border-border text-sm text-muted">The trend appears after the second check.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke="var(--hairline)" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
                <YAxis reversed={m.reverse} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(v) => fmt(v)} />
                <Tooltip labelFormatter={(d) => shortDate(String(d))} formatter={(v, name) => [fmt(v), m.series.find((s) => s.key === name)?.label ?? String(name)]}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} cursor={{ stroke: "var(--border-strong)" }} />
                {m.series.filter((s) => !hidden.has(s.key)).map((s) => (
                  <Line key={s.key} dataKey={s.key} name={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-medium text-muted">Show</legend>
          <ul className="space-y-1">
            {m.series.map((s) => {
              const last = [...s.data].reverse().find((d) => d.value != null)?.value ?? null;
              return (
                <li key={s.key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-surface-muted">
                    <input type="checkbox" checked={!hidden.has(s.key)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(s.key); else n.add(s.key); return n; })} className="sr-only" />
                    <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-[3px] border", hidden.has(s.key) && "opacity-40")} style={{ background: hidden.has(s.key) ? "transparent" : s.color, borderColor: s.color }} aria-hidden />
                    <span className={cn("min-w-0 flex-1 truncate", hidden.has(s.key) && "text-muted")} title={s.label}>{s.label}</span>
                    <span className="tabular-nums text-xs text-secondary">{fmt(last)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ themes (praised / criticised) */
export function Themes({ title, sub, praised, criticised }: { title: string; sub?: string; praised: { label: string; count: number }[]; criticised: { label: string; count: number }[] }) {
  const max = Math.max(1, ...praised.map((p) => p.count), ...criticised.map((p) => p.count));
  const col = (list: { label: string; count: number }[], tone: "positive" | "negative", head: string) => (
    <div className="min-w-0">
      <p className={cn("mb-2 text-xs font-medium", tone === "positive" ? "text-positive" : "text-negative")}>{tone === "positive" ? "▲" : "▼"} {head}</p>
      {list.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
        <ul className="space-y-1.5">
          {list.map((t) => (
            <li key={t.label} className="grid grid-cols-[minmax(0,1fr)_5rem_1.5rem] items-center gap-2 text-[13px]">
              <span className="truncate" title={t.label}>{t.label}</span>
              <span className="h-2 rounded-full bg-surface-muted"><span className="block h-full rounded-full" style={{ width: `${(t.count / max) * 100}%`, background: `var(--${tone})` }} /></span>
              <span className="text-right tabular-nums text-secondary">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Panel title={title} sub={sub}>
      <div className="grid gap-6 sm:grid-cols-2">{col(praised, "positive", "Praised")}{col(criticised, "negative", "Criticised")}</div>
    </Panel>
  );
}
