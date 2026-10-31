import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Tabs } from "@/components/research/tabs";
import { fmtDecimal, fmtInt, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import type { CompetitorData } from "@/lib/dataforseo/competitors";
import type { Growth, HealthCheck } from "@/lib/overview/score";
import type { SourceStatus } from "@/lib/overview/status";
import { monthlyWins, notableDeclines, type Compared, type ReportData, type Win } from "@/lib/report/data";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
const panel = "overflow-hidden rounded-[10px] border border-border bg-surface";
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "—");

function PanelHead({ id, title, children }: { id?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
      <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
const headLink = "text-[13px] font-medium text-secondary hover:text-foreground";

/* ------------------------------------------------------------------ freshness */
const DOT = { ok: "bg-positive", stale: "bg-warn", error: "bg-negative", pending: "bg-faint" } as const;

export function FreshnessChips({ status }: { status: SourceStatus[]; dark?: boolean }) {
  if (status.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Data freshness">
      {status.map((s) => (
        <li key={s.key} title={`${s.note}. Next scheduled update: ${at(s.nextAt)}.${s.error ? ` Last error: ${s.error}` : ""}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className={cn("size-1.5 rounded-full", DOT[s.health])} aria-hidden />
          <span className="font-medium text-secondary">{s.label}</span>
          <span>{s.health === "error" ? "needs attention" : s.health === "pending" ? "waiting for first sync" : `synced ${ago(s.lastSyncedAt)}`}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ summary (page header) */
function Ring({ score, band, className = "size-12" }: { score: number; band: Growth["band"]; className?: string }) {
  const r = 20, len = 2 * Math.PI * r;
  const color = band === "Growing" ? "var(--positive)" : band === "Declining" ? "var(--negative)" : "var(--warn)";
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0 -rotate-90", className)} role="img" aria-label={`Growth Index ${score} out of 100, ${band}`}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--hairline)" strokeWidth="4.5" />
      <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)} />
      <text x="24" y="29" textAnchor="middle" transform="rotate(90 24 24)" fontSize="14" fontWeight="600" fill="var(--foreground)">{score}</text>
    </svg>
  );
}

export function Hero({ clientName, rangeLabel, growth, status, comp, unseenAlerts, actions }: {
  clientName: string; rangeLabel: string; growth: Growth | null; status: SourceStatus[]; comp: CompetitorData | null; unseenAlerts: number;
  /** page actions (export) shown at the top right */
  actions?: React.ReactNode;
}) {
  const movers = growth ? [...growth.factors].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3) : [];
  const me = comp?.snapshots.filter((s) => s.is_self).at(-1);
  const strongest = comp ? [...new Set(comp.snapshots.filter((s) => !s.is_self).map((s) => s.domain))].map((d) => comp.snapshots.filter((s) => s.domain === d).at(-1)!).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))[0] : null;
  const fmtF = (f: Growth["factors"][number], n: number) => (f.key === "gsc_pos" || f.key === "ga4_eng" ? fmtDecimal(n * (f.key === "ga4_eng" ? 100 : 1)) : fmtInt(n));
  return (
    <section aria-label="Performance summary" className="space-y-4">
      {/* the Growth Index card takes the whole right side of the hero, as tall as the movers list */}
      <div className="flex flex-col gap-x-8 gap-y-4 lg:flex-row lg:items-stretch lg:justify-between">
        <div className="min-w-0 max-w-3xl lg:flex-1">
          <p className="text-[13px] text-muted">{clientName} · {rangeLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em]">
            {growth ? <>Search performance is <span className={growth.band === "Growing" ? "text-positive" : growth.band === "Declining" ? "text-negative" : "text-warn"}>{growth.band.toLowerCase()}</span></> : "Your performance at a glance"}
          </h1>
          {(movers.length > 0 || (me && strongest) || unseenAlerts > 0) && (
            <ul className="mt-2.5 space-y-1 text-sm text-secondary">
              {movers.map((f) => (
                <li key={f.key} className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn("w-12 shrink-0 font-medium tabular-nums", (f.lowerIsBetter ? -f.changePct : f.changePct) >= 0 ? "text-positive" : "text-negative")}>{f.changePct > 0 ? "+" : ""}{f.changePct.toFixed(0)}%</span>
                  <span className="text-foreground">{f.label}</span>
                  <span className="text-muted">{f.source} · {fmtF(f, f.previous)} → {fmtF(f, f.current)}</span>
                </li>
              ))}
              {me && strongest && (
                <li className="flex flex-wrap items-baseline gap-x-2"><span className="w-12 shrink-0 text-muted">vs</span><span className="text-foreground">{strongest.domain}</span><span className="text-muted">you rank for {fmtInt(me.keywords)} keywords, they rank for {fmtInt(strongest.keywords)} (DataForSEO estimate)</span></li>
              )}
              {unseenAlerts > 0 && <li><Link href="#alerts" className="font-medium text-foreground underline underline-offset-2">{unseenAlerts} new alert{unseenAlerts > 1 ? "s" : ""} to review</Link></li>}
            </ul>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:w-[24rem] lg:shrink-0 xl:w-[28rem]">
          {actions && <div className="flex lg:justify-end">{actions}</div>}
          {growth ? (
            <div className="flex flex-1 flex-wrap items-center gap-5 rounded-[10px] border border-border bg-surface px-5 py-4">
              <Ring score={growth.score} band={growth.band} className="size-28 sm:size-32" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted">Growth index</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.01em]">
                  <span className={growth.band === "Growing" ? "text-positive" : growth.band === "Declining" ? "text-negative" : "text-warn"}>{growth.band}</span>
                  <span className="text-base font-normal text-muted"> · {growth.used} metrics</span>
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{growth.score} of 100 · 50 means unchanged against the previous period of equal length.</p>
              </div>
            </div>
          ) : (
            <p className="flex flex-1 items-center rounded-[10px] border border-dashed border-border-strong px-5 py-4 text-sm text-muted">The Growth Index appears once two metrics have a previous period.</p>
          )}
        </div>
      </div>
      {growth && (
        <details className="group text-[13px]">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">How the Growth Index is calculated</summary>
          <div className="mt-2 space-y-3 rounded-[10px] border border-border bg-surface p-4">
            <p className="leading-relaxed text-secondary">Each metric is compared with the previous period of equal length and mapped to 0-100 (50 = unchanged, +20% = 100, −20% = 0; inverted for average position). The index is the weighted average of the metrics with enough volume. It shows direction of travel, not absolute quality or Google ranking factors.</p>
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {growth.factors.map((f) => (
                <li key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                  <span>{f.label} <span className="text-muted">· weight {f.weight}</span></span><span className="tabular-nums text-secondary">{f.score.toFixed(0)}/100 ({f.changePct > 0 ? "+" : ""}{f.changePct.toFixed(1)}%)</span>
                  <span className="col-span-2 mt-1 h-1 overflow-hidden rounded-full bg-surface-muted"><span className={cn("block h-full rounded-full", f.score >= 55 ? "bg-positive" : f.score >= 45 ? "bg-warn" : "bg-negative")} style={{ width: `${f.score}%` }} /></span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      <FreshnessChips status={status} />
    </section>
  );
}

/* ------------------------------------------------------------------ KPI band */
const v = (c: Compared | undefined | null, k: string, w: "current" | "previous" | "mom" | "yoy" = "current"): Num => (c?.[w]?.has_data ? toNum(c[w][k]) : null);

export function KpiBand({ d }: { d: ReportData }) {
  type Tile = { label: string; source: string; c: Compared | undefined | null; k: string; format: (n: Num) => string; lower?: boolean; hint?: string };
  const tiles: Tile[] = [];
  if (d.connected.gsc) tiles.push(
    { label: "Search clicks", source: "Search Console", c: d.gsc, k: "clicks", format: fmtInt },
    { label: "Search impressions", source: "Search Console", c: d.gsc, k: "impressions", format: fmtInt },
    { label: "Average position", source: "Search Console", c: d.gsc, k: "position", format: fmtDecimal, lower: true, hint: "Impression-weighted. Lower is better." },
  );
  if (d.connected.ga4) tiles.push(
    { label: "Website sessions", source: "Google Analytics 4", c: d.ga4, k: "sessions", format: fmtInt },
    { label: "Key events", source: "Google Analytics 4", c: d.ga4, k: "key_events", format: fmtInt, hint: "GA4 key events (formerly conversions)." },
    { label: "Engagement rate", source: "Google Analytics 4", c: d.ga4, k: "engagement_rate", format: (n) => fmtPercent(n, 1) },
  );
  if (d.connected.gbp) tiles.push({ label: "Business Profile views", source: "Google Business Profile", c: d.gbp, k: "impressions", format: fmtInt });
  if (d.bing?.totals.current?.has_data) tiles.push({ label: "Bing clicks", source: "Bing Webmaster", c: d.bing.totals, k: "clicks", format: fmtInt });
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Key metrics" className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", tiles.length > 6 ? "2xl:grid-cols-8" : tiles.length > 4 ? "xl:grid-cols-6" : "")}>
      {tiles.map((t) => (
        <KpiCard key={t.label} label={t.label} source={t.source} hint={t.hint} format={t.format} higherIsBetter={!t.lower}
          value={v(t.c, t.k)} previous={v(t.c, t.k, "previous")} mom={v(t.c, t.k, "mom")} yoy={v(t.c, t.k, "yoy")} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ what changed */
function WinRows({ items, good }: { items: Win[]; good: boolean }) {
  if (items.length === 0) return <li className="px-4 py-3 text-[13px] text-muted sm:px-5">{good ? "No metric rose 10%+ with enough volume." : "No significant declines (10%+)."}</li>;
  return (
    <>
      {items.slice(0, 4).map((w) => (
        <li key={w.label} className="flex items-start gap-3 border-t border-hairline px-4 py-2.5 first:border-t-0 sm:px-5">
          <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", good ? "bg-positive" : "bg-negative")} aria-label={good ? "Improved" : "Declined"} role="img" />
          <span className="min-w-0 flex-1 text-sm">{w.text}</span>
          <span className="shrink-0 text-xs text-muted">{w.source}</span>
        </li>
      ))}
    </>
  );
}

export function ChangesPanel({ d }: { d: ReportData }) {
  return (
    <section className={panel} aria-labelledby="changes-h">
      <PanelHead id="changes-h" title="What changed"><span className="text-xs text-muted">10%+ moves with enough volume</span></PanelHead>
      {/* stacked rather than side by side: the two lists rarely have the same length */}
      <div>
        <div><p className="px-4 pb-1 pt-3 text-xs font-medium text-positive sm:px-5">Improved</p><ul><WinRows items={monthlyWins(d)} good /></ul></div>
        <div className="border-t border-hairline"><p className="px-4 pb-1 pt-3 text-xs font-medium text-negative sm:px-5">Declined</p><ul><WinRows items={notableDeclines(d)} good={false} /></ul></div>
      </div>
      <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted sm:px-5">Calculated from the data, not written by AI.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ next actions */
export interface NextAction { title: string; why: string; priority: "high" | "medium" | "low"; href: string; source: "AI" | "Data" }
const PR = { high: "text-negative", medium: "text-warn", low: "text-muted" } as const;

export function NextActions({ items }: { items: NextAction[] }) {
  return (
    <section className={panel} aria-labelledby="next-h">
      <PanelHead id="next-h" title="Do next"><Link href="/coach" className={headLink}>Coach</Link></PanelHead>
      {items.length === 0 ? <p className="px-4 py-4 text-sm text-muted sm:px-5">No priority actions right now. New recommendations appear after the next AI analysis.</p> : (
        <ol>
          {items.map((a, i) => (
            <li key={a.title} className="border-t border-hairline first:border-t-0">
              <Link href={a.href} className="group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken sm:px-5">
                <span className="w-4 shrink-0 pt-px text-[13px] tabular-nums text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{a.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-secondary">{a.why}</span>
                  <span className="mt-1 block text-xs text-muted"><span className={cn("font-medium capitalize", PR[a.priority])}>{a.priority}</span> · {a.source === "AI" ? "AI recommendation" : "From the data"}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-faint transition-colors group-hover:text-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ health */
const H = { pass: { dot: "bg-positive", label: "Good" }, watch: { dot: "bg-warn", label: "Watch" }, fix: { dot: "bg-negative", label: "Fix" } } as const;

export function HealthPanel({ checks }: { checks: HealthCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <section className={panel} aria-labelledby="health-h">
      <PanelHead id="health-h" title="Health"><span className="text-xs text-muted">{checks.length} checks</span></PanelHead>
      <ul>
        {checks.map((c) => {
          const h = H[c.status];
          return (
            <li key={c.key} title={c.rule} className="flex gap-3 border-t border-hairline px-4 py-2.5 first:border-t-0 sm:px-5">
              <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", h.dot)} role="img" aria-label={h.label} />
              <div className="min-w-0 flex-1"><p className="text-sm leading-snug">{c.label}</p><p className="mt-0.5 text-xs text-muted">{c.detail}</p></div>
              {c.href && <Link href={c.href} className="shrink-0 text-xs font-medium text-secondary hover:text-foreground">Details</Link>}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted sm:px-5">Pass / watch / fix against fixed thresholds (hover a check for its rule).</p>
    </section>
  );
}

/* ------------------------------------------------------------------ competitors */
export function CompetitorSnapshot({ comp }: { comp: CompetitorData | null }) {
  const latest = comp ? [...new Set(comp.snapshots.map((s) => s.domain))].map((dom) => comp.snapshots.filter((s) => s.domain === dom).at(-1)!) : [];
  const rows = [...latest].sort((a, b) => (b.keywords ?? 0) - (a.keywords ?? 0)).slice(0, 5);
  return (
    <section className={panel} aria-labelledby="comp-h">
      <PanelHead id="comp-h" title="Competitors"><Link href="/competitors" className={headLink}>Full analysis</Link></PanelHead>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">The competitor analysis runs automatically every 24 hours. Results appear here as soon as the first one completes.</p>
      ) : (
        <div className="px-4 py-3.5 sm:px-5">
          <p className="mb-2.5 text-xs font-medium text-muted">Organic keywords ranked (top 100)</p>
          <ul className="space-y-2.5">
            {rows.map((s) => {
              const max = Math.max(1, ...rows.map((r) => r.keywords ?? 0));
              return (
                <li key={s.domain} className="text-[13px]">
                  <div className="flex justify-between gap-3"><span className={cn("truncate", s.is_self && "font-medium")}>{s.is_self ? `${s.domain} (you)` : s.domain}</span><span className="shrink-0 tabular-nums">{fmtInt(s.keywords)}{s.traffic != null && <span className="ml-2 text-muted">~{fmtInt(Math.round(s.traffic))}/mo</span>}</span></div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted"><div className={cn("h-full rounded-full", s.is_self ? "bg-accent" : "bg-series-prev")} style={{ width: `${Math.max(1.5, ((s.keywords ?? 0) / max) * 100)}%` }} /></div>
                </li>
              );
            })}
          </ul>
          {comp && comp.threats.length > 0 && <p className="mt-3 text-xs text-negative">{comp.threats[0].domain} is {comp.threats[0].kind === "overtaking" ? "overtaking you" : "gaining visibility"}.</p>}
          <p className="mt-3 text-xs text-muted">Latest analysis {comp?.latestAt}. DataForSEO estimates.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ top lists + opportunities */
const link = (u: unknown) => { try { const x = new URL(String(u)); return `${x.host}${x.pathname}`; } catch { return String(u ?? "—"); } };

export function TopAndOpportunities({ d }: { d: ReportData }) {
  const o = d.opportunities;
  const list = (rows: Row[], cols: { label: string; render: (r: Row) => React.ReactNode; right?: boolean }[], empty: string) => rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[28rem] text-[13px]">
        <thead className="bg-surface-sunken"><tr className="border-y border-hairline text-left text-xs text-muted">{cols.map((c) => <th key={c.label} className={cn("px-3 py-2 font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.right && "text-right")}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 6).map((r, i) => <tr key={i} className="border-t border-hairline first:border-t-0">{cols.map((c) => <td key={c.label} className={cn("px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", c.right && "text-right tabular-nums")}>{c.render(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  const items = [
    { key: "kw", label: "Top keywords", content: list(d.topQueries, [
      { label: "Query", render: (r) => <span className="break-words">{String(r.query)}</span> }, { label: "Clicks", right: true, render: (r) => fmtInt(toNum(r.clicks)) },
      { label: "Impressions", right: true, render: (r) => fmtInt(toNum(r.impressions)) }, { label: "Position", right: true, render: (r) => fmtDecimal(toNum(r.position)) }], "Connect Search Console to see top keywords.") },
    { key: "pg", label: "Top pages", content: list(d.topPages, [
      { label: "Page", render: (r) => <span className="break-all">{link(r.page)}</span> }, { label: "Clicks", right: true, render: (r) => fmtInt(toNum(r.clicks)) },
      { label: "Impressions", right: true, render: (r) => fmtInt(toNum(r.impressions)) }], "Connect Search Console to see top pages.") },
    ...(o ? [
      { key: "qw", label: "Quick wins", badge: o.quick_wins.length, content: list(o.quick_wins, [
        { label: "Query", render: (r) => <span className="break-words">{String(r.query)}</span> }, { label: "Impressions", right: true, render: (r) => fmtInt(toNum(r.impressions)) },
        { label: "CTR", right: true, render: (r) => fmtPercent(toNum(r.ctr), 1) }, { label: "Position", right: true, render: (r) => fmtDecimal(toNum(r.position)) }], "No quick wins found in this period.") },
      { key: "dk", label: "Declining keywords", badge: o.declining_keywords.length, content: list(o.declining_keywords, [
        { label: "Query", render: (r) => <span className="break-words">{String(r.query)}</span> }, { label: "Was", right: true, render: (r) => fmtDecimal(toNum(r.previous_position)) },
        { label: "Now", right: true, render: (r) => fmtDecimal(toNum(r.current_position)) }], "No declining keywords.") },
      { key: "dp", label: "Declining pages", badge: o.decaying_pages.length, content: list(o.decaying_pages, [
        { label: "Page", render: (r) => <span className="break-all">{link(r.page)}</span> }, { label: "Was", right: true, render: (r) => fmtInt(toNum(r.previous_clicks)) },
        { label: "Now", right: true, render: (r) => fmtInt(toNum(r.current_clicks)) }], "No declining pages.") },
    ] : []),
  ];
  return (
    <section className={panel} aria-label="Top of search">
      <PanelHead title="Top of search"><Link href="/search-console" className={headLink}>Search Console</Link></PanelHead>
      <div className="px-4 pb-1 pt-3.5 sm:px-5"><Tabs label="Top performers and opportunities" items={items} /></div>
    </section>
  );
}
