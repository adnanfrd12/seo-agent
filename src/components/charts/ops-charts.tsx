"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Legend, Panel } from "./ai-charts";

/**
 * Charts for the operational pages (audit, insights, strategy, opportunities, integrations, history).
 * Same rules as ai-charts: one measure per axis, values printed or in a tooltip, a legend for two or more
 * series, status colours only for status. Formats are named strings because server pages can't pass functions.
 */

export type ValueFormat = "int" | "usd" | "pct" | "dec" | "ms";
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const formatValue = (v: number, f: ValueFormat = "int") =>
  f === "usd" ? `$${v.toFixed(2)}` : f === "pct" ? `${v > 0 ? "+" : ""}${nf.format(v)}%` : f === "dec" ? v.toFixed(1)
  : f === "ms" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) : nf.format(v);

/** Lets a panel in a grid row take the row's height and centre its body, so a shorter chart never leaves a blank band under it. */
export function Fill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col [&>section]:flex [&>section]:flex-1 [&>section]:flex-col [&>section>:last-child]:flex [&>section>:last-child]:flex-1 [&>section>:last-child]:flex-col [&>section>:last-child]:justify-center", className)}>{children}</div>;
}

/* ------------------------------------------------------------------ split bar (parts of a whole) */
export interface Segment { label: string; value: number; color: string }

/** One 100% bar split into parts (done vs open, errors vs warnings), with every part's count and share listed. */
export function SplitBar({ title, sub, segments, total, totalLabel, className, empty = "No data yet." }: {
  title: string; sub?: string; segments: Segment[]; total?: string; totalLabel?: string; className?: string; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sum = segments.reduce((a, s) => a + s.value, 0);
  const pct = (v: number) => (sum ? Math.round((v / sum) * 100) : 0);
  return (
    <Panel title={title} sub={sub} className={className} right={total ? <span className="text-right"><span className="block text-xl font-semibold leading-none tabular-nums">{total}</span>{totalLabel && <span className="text-[11px] text-muted">{totalLabel}</span>}</span> : undefined}>
      {sum === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
        <>
          <div className="flex h-4 gap-[2px]" role="img" aria-label={`${title}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
            {segments.map((s, i) => s.value > 0 && (
              <span key={s.label} title={`${s.label}: ${nf.format(s.value)} (${pct(s.value)}%)`} onMouseEnter={() => setHover(i)}
                className={cn("h-full first:rounded-l-[4px] last:rounded-r-[4px] transition-opacity", hover != null && hover !== i && "opacity-50")} style={{ flexGrow: s.value, flexBasis: 0, background: s.color }} />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4 gap-y-2 text-[13px]">
            {segments.map((s, i) => (
              <li key={s.label} className={cn("flex items-center gap-2 rounded px-1", hover === i && "bg-surface-muted")} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-secondary" title={s.label}>{s.label}</span>
                <span className="tabular-nums">{nf.format(s.value)}</span>
                <span className="w-9 text-right tabular-nums text-muted">{pct(s.value)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ diverging bars (change) */
export interface ChangeRow { label: string; value: number | null; detail?: string }

/**
 * Change per row from a zero line: right = up, left = down. `upIsGood` picks which side is green
 * (positions improve when they go down). Every value is printed; the row's detail shows on hover.
 */
export function DivergingBars({ title, sub, rows, format = "int", upIsGood = true, valueLabel, empty = "No changes to show." }: {
  title: string; sub?: string; rows: ChangeRow[]; format?: ValueFormat; upIsGood?: boolean; valueLabel?: string; empty?: string;
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value ?? 0)));
  const tone = (v: number) => (v === 0 ? "var(--cat-other)" : (v > 0) === upIsGood ? "var(--positive)" : "var(--negative)");
  return (
    <Panel title={title} sub={sub} right={valueLabel ? <span className="text-xs text-muted">{valueLabel}</span> : undefined}>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const v = r.value;
            const w = v == null ? 0 : Math.max(1.5, (Math.abs(v) / max) * 50);
            return (
              <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-[13px] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem]" title={`${r.label}: ${v == null ? "no data" : formatValue(v, format)}${r.detail ? ` · ${r.detail}` : ""}`}>
                <span className="truncate" title={r.label}>{r.label}</span>
                <span className="relative h-3" aria-hidden>
                  <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border-strong" />
                  {v != null && v !== 0 && <span className={cn("absolute inset-y-0", v > 0 ? "rounded-r-[4px]" : "rounded-l-[4px]")} style={{ [v > 0 ? "left" : "right"]: "50%", width: `${w}%`, background: tone(v) }} />}
                </span>
                <span className="text-right tabular-nums text-secondary">{v == null ? "—" : format === "pct" || v <= 0 ? formatValue(v, format) : `+${formatValue(v, format)}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ stacked columns (over time) */
export interface ColumnKey { key: string; label: string; color: string }

/** Vertical columns over days or weeks, optionally split into parts; the total is printed on top, the split in a tooltip. */
export function StackedColumns({ title, sub, keys, columns, format = "int", valueLabel, empty = "No data yet.", className }: {
  title: string; sub?: string; keys: ColumnKey[]; columns: { label: string; values: Record<string, number> }[]; format?: ValueFormat; valueLabel?: string; empty?: string; className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = columns.map((c) => keys.reduce((a, k) => a + (c.values[k.key] ?? 0), 0));
  const max = Math.max(1e-9, ...totals);
  return (
    <Panel title={title} sub={sub} className={className} right={valueLabel ? <span className="text-xs text-muted">{valueLabel}</span> : undefined}>
      {columns.length === 0 || totals.every((t) => t === 0) ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
        <>
          {keys.length > 1 && <div className="mb-3"><Legend items={keys} /></div>}
          <div className="relative flex h-36 items-end gap-1.5 sm:gap-2" role="img" aria-label={`${title}: ${columns.map((c, i) => `${c.label} ${formatValue(totals[i], format)}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
            {columns.map((c, i) => (
              <div key={c.label} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(i)}>
                <span className="text-[11px] tabular-nums text-secondary">{totals[i] ? formatValue(totals[i], format) : ""}</span>
                <span className={cn("flex w-full max-w-12 flex-col-reverse gap-[2px] transition-opacity", hover != null && hover !== i && "opacity-60")} style={{ height: `${totals[i] ? Math.max(3, (totals[i] / max) * 100) : 0}%` }}>
                  {keys.map((k) => (c.values[k.key] ?? 0) > 0 && <span key={k.key} className="w-full first:rounded-b-none last:rounded-t-[4px]" style={{ flexGrow: c.values[k.key], flexBasis: 0, background: k.color }} />)}
                </span>
                {hover === i && keys.length > 1 && (
                  <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 min-w-36 -translate-x-1/2 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]">
                    <p className="mb-1 font-medium">{c.label}</p>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
                      {keys.map((k) => <div key={k.key} className="contents"><dt className="inline-flex items-center gap-1.5 text-secondary"><span className="size-2 rounded-[2px]" style={{ background: k.color }} />{k.label}</dt><dd className="text-right">{formatValue(c.values[k.key] ?? 0, format)}</dd></div>)}
                    </dl>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5 border-t border-hairline pt-1.5 sm:gap-2">
            {columns.map((c) => <span key={c.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted" title={c.label}>{c.label}</span>)}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ freshness (age since last update) */
export interface FreshRow { label: string; hours: number | null; detail?: string; failed?: boolean }

/**
 * How long ago each source last updated, on one hour axis: green within a day, amber within three,
 * red beyond that, failed or never. The age is printed; bars are capped at a week so one stale source can't flatten the rest.
 */
export function Freshness({ title, sub, rows, className }: { title: string; sub?: string; rows: FreshRow[]; className?: string }) {
  const CAP = 24 * 7;
  const age = (h: number) => (h < 1 ? "< 1 h" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
  const tone = (r: FreshRow) => (r.hours == null || r.failed ? "var(--negative)" : r.hours <= 26 ? "var(--positive)" : r.hours <= 72 ? "var(--warn)" : "var(--negative)");
  return (
    <Panel title={title} sub={sub} className={className} right={<span className="text-xs text-muted">Time since last update</span>}>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">Nothing connected yet.</p> : (
        <>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-[13px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5rem]" title={r.detail ?? r.label}>
                <span className="truncate">{r.label}</span>
                <span className="relative h-2.5 rounded-full bg-surface-muted" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.hours == null ? 100 : Math.max(2, (Math.min(r.hours, CAP) / CAP) * 100)}%`, background: tone(r), opacity: r.hours == null ? 0.25 : 1 }} />
                  <span className="absolute -inset-y-[3px] w-px bg-border-strong" style={{ left: `${(24 / CAP) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums" style={{ color: tone(r) }}>{r.hours == null ? "never" : r.failed ? `failed · ${age(r.hours)}` : age(r.hours)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Tick = 24 hours · scale ends at 7 days</p>
        </>
      )}
    </Panel>
  );
}
