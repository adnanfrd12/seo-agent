"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cat } from "@/lib/charts/colors";
import { cn } from "@/lib/utils";
import { Donut, Legend, Panel } from "./ai-charts";

/**
 * Charts for the analytics tabs (GA4, Search Console, Business Profile, Bing, Clarity, Overview).
 * Every prop is plain data so server pages can pass it straight through; identity colours are the
 * categorical tokens in a fixed order, and every chart prints its values or shows them on hover.
 */

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

/* ------------------------------------------------------------------ share donut */
/**
 * Parts of a whole from a ranked list: the first `top` slices take slots in rank order, the rest fold
 * into "Other". `keepOrder` is for fixed entities (website / calls / directions): each keeps the slot
 * of its position in `items`, so its colour matches the other charts on the page.
 */
export function ShareDonut({ title, sub, items, top = 5, centerLabel, keepOrder = false }: {
  title: string; sub?: string; items: { label: string; value: number }[]; top?: number; centerLabel: string; keepOrder?: boolean;
}) {
  const slotted = items.map((i, k) => ({ ...i, slot: k }));
  const sorted = (keepOrder ? slotted : [...slotted].sort((a, b) => b.value - a.value)).filter((i) => i.value > 0);
  const head = sorted.slice(0, top).map((i, k) => ({ label: i.label || "(unknown)", value: i.value, color: cat(keepOrder ? i.slot : k) }));
  const rest = sorted.slice(top).reduce((a, i) => a + i.value, 0);
  const slices = rest > 0 ? [...head, { label: "Other", value: rest, color: "var(--cat-other)" }] : head;
  const total = sorted.reduce((a, i) => a + i.value, 0);
  return <Donut title={title} sub={sub} items={slices} center={nf.format(total)} centerLabel={centerLabel} />;
}

/* ------------------------------------------------------------------ stacked columns over time */
export interface TimeKey { key: string; label: string }

/**
 * Several counts that add up, per day or per week (e.g. calls + directions + website clicks). Weekly
 * buckets start on the first day of the data so a 90-day range stays readable.
 */
export function StackedTimeBars({ title, sub, keys, data, valueLabel, bucket = "day" }: {
  title: string; sub?: string; keys: TimeKey[]; data: ({ date: string } & Record<string, number | string | null>)[]; valueLabel: string; bucket?: "day" | "week";
}) {
  const rows = bucket === "day" ? data : data.reduce<typeof data>((out, d, i) => {
    if (i % 7 === 0) out.push({ date: d.date });
    const w = out[out.length - 1];
    for (const k of keys) w[k.key] = (Number(w[k.key]) || 0) + (Number(d[k.key]) || 0);
    return out;
  }, []);
  const colored = keys.map((k, i) => ({ ...k, color: cat(i) }));
  const total = rows.reduce((a, r) => a + keys.reduce((s, k) => s + (Number(r[k.key]) || 0), 0), 0);
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">{valueLabel}{bucket === "week" ? " · weekly" : ""}</span>}>
      {total === 0 ? <p className="grid h-56 place-items-center text-sm text-muted">Nothing recorded in this period.</p> : (
        <>
          <Legend items={colored} />
          <div className="mt-3 h-56 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--hairline)" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--surface-muted)" }} contentStyle={tipStyle}
                  labelFormatter={(d) => (bucket === "week" ? `Week of ${shortDate(String(d))}` : shortDate(String(d)))}
                  formatter={(v, name) => [nf.format(Number(v) || 0), colored.find((k) => k.key === name)?.label ?? String(name)]} />
                {colored.map((k, i) => (
                  <Bar key={k.key} dataKey={k.key} stackId="s" fill={k.color} isAnimationActive={false} maxBarSize={28}
                    radius={i === colored.length - 1 ? [3, 3, 0, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ this period vs previous */
/**
 * Ranked rows, the current period as a solid bar and the previous period as a thin grey bar under
 * it, so growth and decline per row read without a second colour. The change is printed per row.
 */
export function CompareBars({ title, sub, rows, valueLabel, empty = "No data for this period.", fill = false }: {
  title: string; sub?: string; rows: { label: string; current: number; previous: number | null }[]; valueLabel: string; empty?: string;
  /** grow to the height of the grid row and spread the rows over it (beside a taller neighbour) */
  fill?: boolean;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.previous ?? 0]));
  const hasPrev = rows.some((r) => r.previous != null);
  return (
    <section className={cn("min-w-0 rounded-[10px] border border-border bg-surface", fill && "flex flex-1 flex-col")} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        <span className="text-xs text-muted">{valueLabel}</span>
      </header>
      <div className={cn("px-4 py-4 sm:px-5", fill && "flex flex-1 flex-col")}>
        {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">{empty}</p> : (
          <>
            {hasPrev && <Legend items={[{ label: "This period", color: "var(--series)" }, { label: "Previous period", color: "var(--series-prev)" }]} />}
            <ul className={cn(fill ? "flex flex-1 flex-col justify-between gap-3" : "space-y-3", hasPrev && "mt-3")}>
              {rows.map((r) => {
                const change = r.previous ? ((r.current - r.previous) / r.previous) * 100 : null;
                return (
                  <li key={r.label} className="text-[13px]" title={`${r.label}: ${nf.format(r.current)}${r.previous != null ? ` (previous ${nf.format(r.previous)})` : ""}`}>
                    <div className="flex justify-between gap-3">
                      <span className="truncate">{r.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {nf.format(r.current)}
                        {change != null && (
                          <span className={cn("ml-2 inline-block min-w-12 text-right text-xs", Math.abs(change) < 0.5 ? "text-muted" : change > 0 ? "text-positive" : "text-negative")}>
                            {Math.abs(change) < 0.5 ? "±0%" : `${change > 0 ? "▲" : "▼"} ${nf.format(Math.abs(change))}%`}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                      <div className="h-full rounded-full bg-series" style={{ width: `${r.current > 0 ? Math.max(1.5, (r.current / max) * 100) : 0}%` }} />
                    </div>
                    {r.previous != null && (
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full" aria-hidden>
                        <div className="h-full rounded-full bg-series-prev" style={{ width: `${r.previous > 0 ? Math.max(1.5, (r.previous / max) * 100) : 0}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ CTR vs position */
export interface ScatterPoint { label: string; position: number; ctr: number; impressions: number; clicks: number }

/**
 * Search terms placed by average position (x, 1 on the left) and click-through rate (y); bubble area
 * is impressions. Terms high on the left are healthy; terms low on the left rank well but don't get
 * clicked (rewrite the title). The five biggest are labelled, every bubble has a hover card.
 */
export function PositionScatter({ title, sub, points, empty = "No search terms with impressions yet." }: {
  title: string; sub?: string; points: ScatterPoint[]; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640, h = 280, pl = 44, pr = 16, pt = 12, pb = 34;
  const maxX = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.position), 1) / 10) * 10);
  const maxY = Math.max(5, Math.ceil(Math.max(...points.map((p) => p.ctr * 100), 0) / 5) * 5);
  const maxS = Math.max(1, ...points.map((p) => p.impressions));
  // log scale: positions 1-10 (page one) get as much room as 10-100
  // rounded: Math.log can differ in the last digit between server and browser, which breaks hydration
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const x = (v: number) => r2(pl + (Math.log(Math.max(1, v)) / Math.log(maxX)) * (w - pl - pr));
  const y = (v: number) => r2(h - pb - (v / maxY) * (h - pt - pb));
  const r = (s: number) => 4 + Math.sqrt(s / maxS) * 14;
  const ticksX = [...[1, 3, 10, 20, 50].filter((t) => t < maxX * 0.8), maxX];
  const ticksY = [0, maxY / 2, maxY];
  // label the biggest bubbles, skipping any label that would overlap one already placed
  const placed: { x1: number; x2: number; y: number }[] = [];
  const labels = [...points.keys()].sort((a, b) => points[b].impressions - points[a].impressions).slice(0, 6).flatMap((i) => {
    const p = points[i];
    const cx = x(Math.min(p.position, maxX)), cy = y(p.ctr * 100), rr = r(p.impressions), left = cx > w - 170;
    const text = p.label.length > 24 ? `${p.label.slice(0, 23)}…` : p.label;
    const tw = text.length * 6;
    const box = left ? { x1: cx - rr - 3 - tw, x2: cx - rr - 3, y: cy } : { x1: cx + rr + 3, x2: cx + rr + 3 + tw, y: cy };
    if (placed.some((b) => Math.abs(b.y - box.y) < 13 && b.x1 < box.x2 && box.x1 < b.x2)) return [];
    placed.push(box);
    return [{ i, text, tx: left ? box.x2 : box.x1, ty: cy + 4, left }];
  });
  const hp = hover == null ? null : points[hover];
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">Bubble size = impressions</span>}>
      {points.length === 0 ? <p className="py-8 text-center text-sm text-muted">{empty}</p> : (
        <div className="relative">
          <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" onMouseLeave={() => setHover(null)}
            aria-label={`${title}: ${points.map((p) => `${p.label} position ${nf1.format(p.position)}, CTR ${nf1.format(p.ctr * 100)}%`).join("; ")}`}>
            {maxX > 10 && <rect x={x(1)} y={pt} width={x(10.5) - x(1)} height={h - pt - pb} fill="var(--surface-sunken)"><title>Page one: positions 1-10</title></rect>}
            {ticksX.map((t) => <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={pt} y2={h - pb} stroke="var(--hairline)" /><text x={x(t)} y={h - pb + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text></g>)}
            {ticksY.map((t) => <g key={`y${t}`}><line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--hairline)" /><text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{nf1.format(t)}%</text></g>)}
            {maxX > 10 && <text x={(x(1) + x(10.5)) / 2} y={h - pb - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">Page one</text>}
            <text x={(w + pl) / 2} y={h - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">Average position (lower is better)</text>
            <text x={12} y={(h - pb + pt) / 2} textAnchor="middle" fontSize="11" fill="var(--muted)" transform={`rotate(-90 12 ${(h - pb + pt) / 2})`}>CTR</text>
            {[...points.keys()].sort((a, b) => points[b].impressions - points[a].impressions).map((i) => {
              const p = points[i];
              return (
                <circle key={i} cx={x(Math.min(p.position, maxX))} cy={y(p.ctr * 100)} r={r(p.impressions)} fill="var(--series)" fillOpacity={hover === i ? 0.75 : 0.3}
                  stroke="var(--series)" strokeWidth={hover === i ? 2 : 1} onMouseEnter={() => setHover(i)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              );
            })}
            {labels.map((l) => <text key={`l${l.i}`} pointerEvents="none" x={l.tx} y={l.ty} textAnchor={l.left ? "end" : "start"} fontSize="11" fill="var(--foreground)">{l.text}</text>)}
          </svg>
          {hp && (
            <div role="tooltip" className="pointer-events-none absolute right-2 top-2 z-20 max-w-64 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]">
              <p className="mb-1 break-words font-medium">{hp.label}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                <dt className="text-secondary">Avg position</dt><dd className="text-right">{nf1.format(hp.position)}</dd>
                <dt className="text-secondary">CTR</dt><dd className="text-right">{nf1.format(hp.ctr * 100)}%</dd>
                <dt className="text-secondary">Clicks</dt><dd className="text-right">{nf.format(hp.clicks)}</dd>
                <dt className="text-secondary">Impressions</dt><dd className="text-right">{nf.format(hp.impressions)}</dd>
              </dl>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
