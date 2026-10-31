"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Charts for the research pages (backlinks, competitors, organic keywords, rank tracking, local SEO).
 * Same panel chrome as ai-charts' Panel, but the card is a column flex box so the plot can grow to the
 * height of a taller neighbour in the same grid row instead of leaving a blank strip under it.
 */

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function Card({ title, sub, right, children, className }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
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

const Empty = ({ text }: { text: string }) => <p className="m-auto py-8 text-center text-sm text-muted">{text}</p>;

/* ------------------------------------------------------------------ columns that fill the card */
export interface Bin { label: string; value: number; color?: string; detail?: string }

/**
 * A distribution as vertical columns. The plot stretches to the card height (minimum 7rem), so in a
 * grid row it matches its neighbours. Values are printed above each column; hover adds the detail.
 */
export function FillColumns({ title, sub, bins, valueLabel, empty = "No data yet." }: { title: string; sub?: string; bins: Bin[]; valueLabel: string; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bins.map((b) => b.value));
  const total = bins.reduce((a, b) => a + b.value, 0);
  return (
    <Card title={title} sub={sub}>
      {total === 0 ? <Empty text={empty} /> : (
        <>
          <div className="relative min-h-28 flex-1" role="img" aria-label={`${title}: ${bins.map((b) => `${b.label} ${nf.format(b.value)}`).join(", ")}`}>
            <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2" onMouseLeave={() => setHover(null)}>
              {bins.map((b, i) => (
                <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(i)}
                  title={`${b.label}: ${nf.format(b.value)}${b.detail ? ` · ${b.detail}` : ""}${total ? ` · ${Math.round((b.value / total) * 100)}%` : ""}`}>
                  <span className={cn("text-xs tabular-nums", hover === i ? "font-semibold text-foreground" : "text-secondary")}>{compact.format(b.value)}</span>
                  <span className="w-full max-w-14 rounded-t-[4px] transition-opacity" style={{
                    height: `calc(${(b.value / max) * 100}% - 1.25rem)`, minHeight: 2,
                    background: b.color ?? "var(--series)", opacity: hover == null || hover === i ? 1 : 0.45,
                  }} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex gap-1.5 border-t border-hairline pt-1.5 sm:gap-2">
            {bins.map((b) => <span key={b.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted" title={b.label}>{b.label}</span>)}
          </div>
          <p className="mt-2 truncate text-xs text-muted tabular-nums" aria-live="polite">
            {hover != null && bins[hover] ? `${bins[hover].label}: ${nf.format(bins[hover].value)}${bins[hover].detail ? ` · ${bins[hover].detail}` : ""} · ${Math.round((bins[hover].value / total) * 100)}% of ${nf.format(total)}` : `${valueLabel}: ${nf.format(total)} in total · hover a column for details`}
          </p>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ several short ranked lists */
export interface BreakdownGroup { key: string; label: string; items: { label: string; value: number; detail?: string }[] }

/**
 * Several ranked lists side by side in one card (e.g. the parts of a backlink profile), the top few of
 * each, with one toggle to show every item. Bars are scaled within their own list.
 */
export function Breakdown({ title, sub, groups, valueLabel, limit = 3, empty = "Not reported." }: {
  title: string; sub?: string; groups: BreakdownGroup[]; valueLabel: string; limit?: number; empty?: string;
}) {
  const [all, setAll] = useState(false);
  const id = useId();
  const more = groups.some((g) => g.items.length > limit);
  return (
    <Card title={title} sub={sub} right={<span className="text-xs text-muted">{valueLabel}</span>}>
      <div id={`${id}-l`} className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => {
          const max = Math.max(1, ...g.items.map((i) => i.value));
          return (
            <div key={g.key} className="min-w-0">
              <h4 className="mb-1.5 text-xs font-medium text-muted">{g.label}{g.items.length > limit && !all && <span className="font-normal text-faint"> · top {limit} of {g.items.length}</span>}</h4>
              {g.items.length === 0 ? <p className="text-[13px] text-faint">{empty}</p> : (
                <ul className="space-y-2">
                  {(all ? g.items : g.items.slice(0, limit)).map((i) => (
                    <li key={i.label} className="text-[13px]">
                      <div className="flex justify-between gap-3">
                        <span className="truncate" title={i.label}>{i.label}</span>
                        <span className="shrink-0 tabular-nums">{nf.format(i.value)}{i.detail && <span className="ml-2 inline-block min-w-9 text-right text-muted">{i.detail}</span>}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                        <div className="h-full rounded-full bg-series" style={{ width: `${i.value > 0 ? Math.max(1.5, (i.value / max) * 100) : 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {more && (
        <button type="button" aria-expanded={all} aria-controls={`${id}-l`} onClick={() => setAll((v) => !v)}
          className="mt-4 self-start rounded-md text-xs font-medium text-secondary underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-accent">
          {all ? "Show the top items only" : "Show every item"}
        </button>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ scatter (log y) */
export interface Dot { label: string; x: number; y: number; highlight?: boolean; detail?: string }

/**
 * Keywords as dots: x is linear (position or difficulty), y is search volume on a log scale so a
 * 50-search and a 50,000-search keyword both stay readable. An optional band marks the target zone.
 */
export function Scatter({ title, sub, dots, xLabel, yLabel, xMax, reverseX = false, band, legend }: {
  title: string; sub?: string; dots: Dot[]; xLabel: string; yLabel: string; xMax: number; reverseX?: boolean;
  band?: { from: number; to: number; label: string }; legend?: [string, string];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640, h = 280, pl = 46, pr = 14, pt = 12, pb = 36;
  const ys = dots.map((d) => Math.max(1, d.y));
  const lo = Math.floor(Math.log10(Math.max(1, Math.min(...ys, 10)))), hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...ys, 10))));
  // rounded: server and browser Math.log10 can differ in the last digit, which would break hydration
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const x = (v: number) => { const t = Math.min(1, Math.max(0, v / xMax)); return r1(pl + (reverseX ? 1 - t : t) * (w - pl - pr)); };
  const y = (v: number) => r1(pt + (1 - (Math.log10(Math.max(1, v)) - lo) / (hi - lo)) * (h - pt - pb));
  const yTicks = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * xMax));
  const cur = hover == null ? null : dots[hover];
  return (
    <Card title={title} sub={sub} right={legend && (
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
        <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-series" aria-hidden />{legend[0]}</li>
        <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "var(--series-prev)" }} aria-hidden />{legend[1]}</li>
      </ul>
    )}>
      {dots.length === 0 ? <Empty text="No keywords yet." /> : (
        <>
          <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`${title}: ${dots.length} keywords plotted by ${xLabel.toLowerCase()} and ${yLabel.toLowerCase()}`} onMouseLeave={() => setHover(null)}>
            {band && (() => { const a = x(band.from), b = x(band.to); return (
              <g><rect x={Math.min(a, b)} y={pt} width={Math.abs(b - a)} height={h - pt - pb} fill="var(--series-soft)" /><text x={(a + b) / 2} y={pt + 12} textAnchor="middle" fontSize="11" fill="var(--secondary)">{band.label}</text></g>
            ); })()}
            {yTicks.map((t) => <g key={`y${t}`}><line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="3 3" /><text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{compact.format(t)}</text></g>)}
            {xTicks.map((t) => <text key={`x${t}`} x={x(t)} y={h - pb + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>)}
            <line x1={pl} x2={w - pr} y1={h - pb} y2={h - pb} stroke="var(--border)" />
            <text x={(w + pl) / 2} y={h - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel}</text>
            <text x={11} y={(h - pb + pt) / 2} textAnchor="middle" fontSize="11" fill="var(--muted)" transform={`rotate(-90 11 ${(h - pb + pt) / 2})`}>{yLabel}</text>
            {dots.map((d, i) => (
              <circle key={`${d.label}-${i}`} cx={x(d.x)} cy={y(d.y)} r={hover === i ? 6 : 4} fill={d.highlight ? "var(--series)" : "var(--series-prev)"} fillOpacity={hover == null || hover === i ? 0.85 : 0.35}
                stroke="var(--surface)" strokeWidth="1" onMouseEnter={() => setHover(i)}>
                <title>{`${d.label}: ${xLabel.toLowerCase()} ${nf.format(d.x)}, ${nf.format(d.y)} ${yLabel.toLowerCase()}${d.detail ? ` · ${d.detail}` : ""}`}</title>
              </circle>
            ))}
          </svg>
          <p className="mt-1 min-h-4 truncate text-xs text-muted tabular-nums" aria-live="polite">
            {cur ? <><span className="font-medium text-foreground">{cur.label}</span> · {xLabel.toLowerCase()} {nf.format(cur.x)} · {nf.format(cur.y)} {yLabel.toLowerCase()}{cur.detail ? ` · ${cur.detail}` : ""}</> : `${dots.length} keywords · hover a dot for details`}
          </p>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ rating comparison */
export interface RatingRow { label: string; rating: number | null; reviews: number | null; you?: boolean }

/** Google rating (0-5 bar) and review count per business, the client first and in the series colour. */
export function RatingCompare({ title, sub, rows }: { title: string; sub?: string; rows: RatingRow[] }) {
  const maxReviews = Math.max(1, ...rows.map((r) => r.reviews ?? 0));
  return (
    <Card title={title} sub={sub} right={<span className="text-xs text-muted">Rating · reviews</span>}>
      {rows.length === 0 ? <Empty text="No businesses to compare yet." /> : (
        <ul className="flex flex-1 flex-col justify-between gap-3">
          {rows.map((r) => (
            <li key={r.label} className="text-[13px]">
              <div className="flex justify-between gap-3">
                <span className={cn("truncate", r.you && "font-medium")} title={r.label}>{r.label}</span>
                <span className="shrink-0 tabular-nums">{r.rating == null ? "—" : `${r.rating.toFixed(1)} ★`}<span className="ml-2 inline-block min-w-14 text-right text-muted">{r.reviews == null ? "—" : `${nf.format(r.reviews)} rev.`}</span></span>
              </div>
              <div className="mt-1 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2" aria-hidden>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${((r.rating ?? 0) / 5) * 100}%`, background: r.you ? "var(--series)" : "var(--series-prev)" }} /></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${((r.reviews ?? 0) / maxReviews) * 100}%`, background: r.you ? "var(--series)" : "var(--series-prev)" }} /></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Left bar: rating out of 5 · right bar: review count against the most-reviewed business.</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ gains vs losses */
/** One diverging bar: what moved the right way against what moved the wrong way, both printed. */
export function GainLoss({ gain, loss, gainLabel, lossLabel }: { gain: number; loss: number; gainLabel: string; lossLabel: string }) {
  const total = gain + loss;
  const net = gain - loss;
  return (
    <div className="text-xs">
      <div className="mb-1 flex justify-between gap-2 tabular-nums">
        <span className="text-secondary">{gainLabel} <span className="font-medium text-foreground">{nf.format(gain)}</span></span>
        <span className="text-secondary">Net <span className={cn("font-semibold", net > 0 ? "text-positive" : net < 0 ? "text-negative" : "text-foreground")}>{net > 0 ? "+" : ""}{nf.format(net)}</span></span>
        <span className="text-secondary">{lossLabel} <span className="font-medium text-foreground">{nf.format(loss)}</span></span>
      </div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${gainLabel} ${gain}, ${lossLabel} ${loss}, net ${net}`}>
        {total > 0 && <span className="h-full" style={{ flexGrow: gain, flexBasis: 0, background: "var(--positive)" }} />}
        {total > 0 && <span className="h-full" style={{ flexGrow: loss, flexBasis: 0, background: "var(--negative)" }} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ keyword research results */
const DIFF_BANDS = [[0, 14, "0–14"], [15, 29, "15–29"], [30, 49, "30–49"], [50, 69, "50–69"], [70, 84, "70–84"], [85, 100, "85–100"]] as const;

/** Opportunity map and difficulty spread for one keyword-research result set (rows as returned by the search). */
export function KeywordCharts({ rows }: { rows: Record<string, unknown>[] }) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const dots = rows.flatMap((r) => {
    const d = num(r.difficulty), v = num(r.volume);
    return d == null || v == null || v <= 0 ? [] : [{ label: String(r.keyword ?? ""), x: d, y: v, highlight: d <= 30 && v >= 100, detail: num(r.cpc) != null ? `CPC $${num(r.cpc)!.toFixed(2)}` : undefined }];
  });
  if (dots.length === 0) return null;
  const bins = DIFF_BANDS.map(([lo, hi, label], i) => {
    const n = dots.filter((d) => d.x >= lo && d.x <= hi).length;
    return { label, value: n, detail: ["very easy", "easy", "possible", "hard", "very hard", "hardest"][i], color: i < 2 ? "var(--series)" : i < 4 ? "color-mix(in oklab, var(--series) 45%, var(--surface))" : "var(--series-prev)" };
  });
  return (
    <div className="mb-2 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Scatter title="Difficulty vs search volume" sub="Highlighted: easy wins (difficulty 30 or less, 100+ searches)" dots={dots} xLabel="Difficulty" yLabel="Searches / mo" xMax={100}
        band={{ from: 0, to: 30, label: "Easier to rank" }} legend={["Easy win", "Other keyword"]} />
      <FillColumns title="How hard these keywords are" sub="Keywords per difficulty band (0-100)" valueLabel="Keywords" bins={bins} />
    </div>
  );
}
