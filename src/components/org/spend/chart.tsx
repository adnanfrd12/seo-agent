"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { Panel } from "@/components/charts/ai-charts";
import { ChartTypeToggle, type ChartKind } from "@/components/charts/chart-type-toggle";
import { cn } from "@/lib/utils";
import type { SpendSplit } from "@/lib/org/spend";
import { bucketLabel, bucketLong, downloadCsv, raw, usd, usdShort, usdTick } from "./format";
import { CsvButton, Segmented, Swatch } from "./ui";

/**
 * Spend over time: stacked columns (default) or one line per series, on a single dollar axis. The split
 * (feature, model, client, tool…) is picked above the chart; the legend hides or shows a series without repainting
 * the others; hover, touch or the arrow keys read every series of a day; "Table" shows the same numbers.
 */

const H = 236, TOP = 18, BOTTOM = 24, RIGHT = 8;

function niceScale(max: number, ticks = 4) {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const rough = max / ticks, p = 10 ** Math.floor(Math.log10(rough)), f = rough / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  return { top: Math.ceil(max / step - 1e-9) * step, step };
}
/** Column with rounded top corners and a square base. */
const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The element's width: measured when it attaches (so the chart draws at once), then kept up to date on resize. */
function useWidth() {
  const [w, setW] = useState(0);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((es) => setW(Math.round(es[0]?.contentRect.width ?? el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function SpendChart({ title, sub, buckets, bucket, splits, initialSplit, empty, csvName }: {
  title: string; sub?: string; buckets: string[]; bucket: "day" | "month"; splits: SpendSplit[]; initialSplit?: string; empty: string; csvName: string;
}) {
  const id = useId();
  const [splitId, setSplitId] = useState(initialSplit ?? splits[0]?.id ?? "");
  const [kind, setKind] = useState<ChartKind>("bar");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [wrap, width] = useWidth();
  const svgRef = useRef<SVGSVGElement>(null);

  const split = splits.find((s) => s.id === splitId) ?? splits[0];
  const series = useMemo(() => split?.series ?? [], [split]);
  const visible = series.filter((s) => !hidden.has(`${split?.id}:${s.key}`));
  const n = buckets.length;
  const totals = buckets.map((_, i) => visible.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const nothing = series.every((s) => s.values.every((v) => !v));
  const max = kind === "bar" ? Math.max(0, ...totals) : Math.max(0, ...visible.flatMap((s) => s.values));
  const { top, step } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);
  const left = Math.max(...ticks.map((t) => usdTick(t, step).length)) * 6.4 + 12;
  const iw = Math.max(40, width - left - RIGHT), ih = H - TOP - BOTTOM;
  const slot = iw / Math.max(1, n);
  const cx = (i: number) => left + slot * (i + 0.5);
  const y = (v: number) => TOP + ih - (v / top) * ih;
  const bw = Math.min(24, Math.max(2, slot * 0.66));
  // x labels count back from the latest column, so today always has one
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
  const firstLabel = (n - 1) % labelEvery;
  const peak = totals.reduce((b, v, i) => (v > totals[b] ? i : b), 0);
  const capAll = n <= 14;
  const avg = n ? totals.reduce((a, v) => a + v, 0) / n : 0;
  const key = (s: { key: string }) => `${split?.id}:${s.key}`;
  const toggle = (k: string) => setHidden((h) => { const nx = new Set(h); if (nx.has(k)) nx.delete(k); else nx.add(k); return nx; });
  const pick = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.min(n - 1, Math.max(0, Math.floor((clientX - r.left - left) / slot))));
  };

  const exportCsv = () => downloadCsv(csvName, [bucket === "day" ? "Day" : "Month", ...series.map((s) => s.label), "Total (USD)"],
    buckets.map((b, i) => [b, ...series.map((s) => raw(s.values[i] ?? 0)), raw(series.reduce((a, s) => a + (s.values[i] ?? 0), 0))]));

  const h = hover != null && hover < n ? hover : null;
  const tipLeft = h == null ? 0 : cx(h);
  const tipShift = h == null ? "-50%" : h > n * 0.7 ? "-100%" : h < n * 0.3 ? "0%" : "-50%";

  return (
    <Panel title={title} sub={sub} right={(
      <div className="flex flex-wrap items-center gap-2">
        {splits.length > 1 && <Segmented label="Split by" value={split?.id ?? ""} onChange={(v) => { setSplitId(v); setHover(null); }} options={splits.map((s) => ({ id: s.id, label: s.label }))} />}
        <ChartTypeToggle value={kind} onChange={setKind} options={["bar", "line"]} />
      </div>
    )}>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-1 gap-y-1 text-xs" aria-label="Series (select to hide or show)">
          {series.map((s) => {
            const off = hidden.has(key(s));
            return (
              <li key={s.key}>
                <button type="button" aria-pressed={!off} onClick={() => toggle(key(s))} title={`${off ? "Show" : "Hide"} ${s.label}`}
                  className={cn("inline-flex max-w-[16rem] items-center gap-1.5 rounded px-1.5 py-0.5 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent", off ? "text-faint line-through" : "text-secondary")}>
                  <span className={cn(off && "opacity-30")}><Swatch color={s.color} line={kind === "line"} /></span>
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div ref={wrap} className="relative min-w-0" style={{ height: H }}>
        {nothing ? (
          <p className="grid h-full place-items-center rounded-lg border border-dashed border-border text-sm text-muted">{empty}</p>
        ) : width > 0 && (
          <div tabIndex={0} role="group" aria-roledescription="chart"
            aria-label={`${title}. ${split?.label ? `Split by ${split.label.toLowerCase()}. ` : ""}Use the left and right arrow keys to read each ${bucket}.`}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onFocus={() => setHover((v) => v ?? n - 1)} onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              const k = e.key;
              if (k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End") {
                e.preventDefault();
                setHover((v) => { const c = v ?? n - 1; return k === "Home" ? 0 : k === "End" ? n - 1 : Math.min(n - 1, Math.max(0, c + (k === "ArrowLeft" ? -1 : 1))); });
              } else if (k === "Escape") setHover(null);
            }}>
            <svg ref={svgRef} width={width} height={H} className="block select-none" aria-hidden
              onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={left} x2={width - RIGHT} y1={r2(y(t))} y2={r2(y(t))} stroke={t === 0 ? "var(--border-strong)" : "var(--hairline)"} />
                  <text x={left - 6} y={r2(y(t)) + 4} textAnchor="end" className="fill-[var(--muted)] text-[11px] tabular-nums">{usdTick(t, step)}</text>
                </g>
              ))}
              {buckets.map((b, i) => {
                if ((n - 1 - i) % labelEvery !== 0) return null;
                const text = bucketLabel(b, bucket, i === firstLabel), half = text.length * 3.2;
                // keep the outermost labels inside the chart instead of clipping them
                const anchor = cx(i) + half > width - 2 ? "end" : cx(i) - half < 2 ? "start" : "middle";
                return <text key={b} x={r2(anchor === "end" ? width - 2 : anchor === "start" ? 2 : cx(i))} y={H - 7} textAnchor={anchor} className="fill-[var(--muted)] text-[11px]">{text}</text>;
              })}
              {h != null && (kind === "bar"
                ? <rect x={r2(left + slot * h)} y={TOP} width={r2(slot)} height={ih} fill="var(--surface-muted)" rx={3} />
                : <line x1={r2(cx(h))} x2={r2(cx(h))} y1={TOP} y2={TOP + ih} stroke="var(--border-strong)" />)}

              {kind === "bar" ? buckets.map((b, i) => {
                let acc = 0;
                const parts = visible.map((s) => ({ s, v: s.values[i] ?? 0 })).filter((p) => p.v > 0);
                return (
                  <g key={b}>
                    {parts.map((p, k) => {
                      const hh = (p.v / top) * ih, y0 = TOP + ih - acc - hh;
                      acc += hh;
                      const last = k === parts.length - 1;
                      // a 2px surface gap separates stacked parts (dropped when the part is too thin to keep it)
                      const gap = !last && hh > 3 ? 2 : 0;
                      return <path key={p.s.key} d={last ? topRounded(r2(cx(i) - bw / 2), r2(y0), r2(bw), r2(Math.max(hh, 1)), 4) : `M${r2(cx(i) - bw / 2)},${r2(y0 + gap)}h${r2(bw)}v${r2(Math.max(hh - gap, 0.5))}h${r2(-bw)}Z`} fill={p.s.color} />;
                    })}
                    {totals[i] > 0 && (capAll || i === peak) && (() => {
                      const text = usdShort(totals[i]), half = text.length * 3.3;
                      const anchor = cx(i) + half > width - 2 ? "end" : cx(i) - half < left ? "start" : "middle";
                      return <text x={r2(anchor === "end" ? width - 2 : anchor === "start" ? cx(i) - bw / 2 : cx(i))} y={r2(y(totals[i]) - 5)} textAnchor={anchor} className="fill-[var(--secondary)] text-[10.5px] font-semibold tabular-nums">{text}</text>;
                    })()}
                  </g>
                );
              }) : visible.map((s) => {
                const d = s.values.map((v, i) => `${i ? "L" : "M"}${r2(cx(i))} ${r2(y(v ?? 0))}`).join(" ");
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {s.values.map((v, i) => ((n <= 31 || i === n - 1 || i === h) && v > 0 ? <circle key={i} cx={r2(cx(i))} cy={r2(y(v))} r={i === h ? 4.5 : 3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null))}
                  </g>
                );
              })}
            </svg>

            {h != null && (
              <div role="status" aria-live="polite" className="pointer-events-none absolute top-0 z-20 w-max max-w-[16rem] rounded-lg border border-border bg-surface p-2.5 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]"
                style={{ left: tipLeft, transform: `translateX(${tipShift})` }}>
                <p className="font-medium">{bucketLong(buckets[h], bucket)}</p>
                <p className="mb-1.5 text-[15px] font-semibold tabular-nums">{usd(totals[h])}</p>
                {visible.length > 1 && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                    {[...visible].reverse().filter((s) => (s.values[h] ?? 0) > 0).map((s) => (
                      <div key={s.key} className="contents">
                        <dd className="flex items-center gap-1.5 font-medium tabular-nums"><Swatch color={s.color} line />{usd(s.values[h] ?? 0)}</dd>
                        <dt className="truncate text-secondary">{s.label}</dt>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{nothing ? " " : <>Peak {bucketLong(buckets[peak], bucket)}: <b className="font-medium text-secondary">{usd(totals[peak])}</b> · Average <b className="font-medium text-secondary">{usd(avg)}</b> per {bucket}{visible.length < series.length ? " (shown series)" : ""}</>}</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => setTable((v) => !v)} aria-expanded={table} aria-controls={`${id}-t`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 font-medium text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
            {table ? <ChartColumn className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}{table ? "Hide table" : "Table"}
          </button>
          <CsvButton onClick={exportCsv} title={`Download every ${bucket} of this chart as CSV`} />
        </span>
      </div>

      {table && (
        <div id={`${id}-t`} className="mt-3 max-h-80 overflow-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[28rem] text-[13px]">
            <thead className="sticky top-0 bg-surface-sunken text-xs text-muted">
              <tr className="border-b border-hairline text-left">
                <th className="px-3 py-2 font-medium">{bucket === "day" ? "Day" : "Month"}</th>
                {series.map((s) => <th key={s.key} className="whitespace-nowrap px-3 py-2 text-right font-medium"><span className="inline-flex max-w-[11rem] items-center gap-1.5"><Swatch color={s.color} /><span className="truncate" title={s.label}>{s.label}</span></span></th>)}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => ({ b, i })).reverse().map(({ b, i }) => {
                const t = series.reduce((a, s) => a + (s.values[i] ?? 0), 0);
                return (
                  <tr key={b} className="border-t border-hairline first:border-t-0">
                    <td className="whitespace-nowrap px-3 py-1.5">{bucketLong(b, bucket)}</td>
                    {series.map((s) => <td key={s.key} className={cn("px-3 py-1.5 text-right tabular-nums", !(s.values[i] ?? 0) && "text-faint")}>{usd(s.values[i] ?? 0)}</td>)}
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
