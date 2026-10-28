import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, Wrench } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Tabs } from "@/components/research/tabs";
import { fmtDecimal, fmtInt, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import type { CompetitorData } from "@/lib/dataforseo/competitors";
import type { Growth, HealthCheck } from "@/lib/overview/score";
import type { SourceStatus } from "@/lib/overview/status";
import { monthlyWins, notableDeclines, type Compared, type ReportData, type Win } from "@/lib/report/data";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
const card = "rounded-2xl border border-border bg-surface p-5";
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "—");

/* ------------------------------------------------------------------ freshness */
const DOT = { ok: "bg-positive", stale: "bg-[#D4970A]", error: "bg-negative", pending: "bg-ink-muted" } as const;

export function FreshnessChips({ status, dark = false }: { status: SourceStatus[]; dark?: boolean }) {
  if (status.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Data freshness">
      {status.map((s) => (
        <li key={s.key} title={`${s.note}. Next scheduled update: ${at(s.nextAt)}.${s.error ? ` Last error: ${s.error}` : ""}`}
          className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", dark ? "border-ink-border bg-ink-soft text-ink-foreground" : "border-border bg-surface-muted")}>
          <span className={cn("size-1.5 rounded-full", DOT[s.health])} aria-hidden />
          <span className="font-medium">{s.label}</span>
          <span className={dark ? "text-ink-muted" : "text-muted"}>{s.health === "error" ? "needs attention" : s.health === "pending" ? "waiting for first sync" : `synced ${ago(s.lastSyncedAt)}`}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ hero */
function Ring({ score, band }: { score: number; band: Growth["band"] }) {
  const r = 52, len = 2 * Math.PI * r;
  const color = band === "Growing" ? "var(--positive)" : band === "Declining" ? "var(--negative)" : "#D4970A";
  return (
    <div className="relative size-36 shrink-0" role="img" aria-label={`Growth Index ${score} out of 100, ${band}`}>
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--ink-border)" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)}
          className="ring-arc" style={{ ["--ring-len" as string]: len }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums leading-none">{score}</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">of 100</span>
      </div>
    </div>
  );
}

export function Hero({ clientName, rangeLabel, growth, status, comp, unseenAlerts }: {
  clientName: string; rangeLabel: string; growth: Growth | null; status: SourceStatus[]; comp: CompetitorData | null; unseenAlerts: number;
}) {
  const movers = growth ? [...growth.factors].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3) : [];
  const rivals = comp?.snapshots.length ? new Map(comp.snapshots.map((s) => [s.domain, s])) : null;
  const me = comp?.snapshots.filter((s) => s.is_self).at(-1);
  const strongest = comp ? [...new Set(comp.snapshots.filter((s) => !s.is_self).map((s) => s.domain))].map((d) => comp.snapshots.filter((s) => s.domain === d).at(-1)!).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))[0] : null;
  void rivals;
  return (
    <section className="rise relative overflow-hidden rounded-3xl border border-ink-border bg-ink p-6 text-ink-foreground sm:p-8" aria-label="Performance summary">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
        {growth ? <Ring score={growth.score} band={growth.band} /> : <div className="flex size-36 shrink-0 items-center justify-center rounded-full border border-dashed border-ink-border text-center text-xs text-ink-muted">Growth Index appears once two metrics have a previous period</div>}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{clientName} · {rangeLabel}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {growth ? <>Your search performance is <span style={{ color: growth.band === "Growing" ? "var(--positive)" : growth.band === "Declining" ? "var(--negative)" : "#E8B534" }}>{growth.band.toLowerCase()}</span></> : "Your performance at a glance"}
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-foreground/90">
            {movers.map((f) => (
              <li key={f.key} className="flex items-baseline gap-2">
                <span className={cn("font-semibold tabular-nums", (f.lowerIsBetter ? -f.changePct : f.changePct) >= 0 ? "text-positive" : "text-negative")}>{f.changePct > 0 ? "+" : ""}{f.changePct.toFixed(0)}%</span>
                <span>{f.label} <span className="text-ink-muted">({f.source}: {f.key === "gsc_pos" || f.key === "ga4_eng" ? fmtDecimal(f.previous * (f.key === "ga4_eng" ? 100 : 1)) : fmtInt(f.previous)} → {f.key === "gsc_pos" || f.key === "ga4_eng" ? fmtDecimal(f.current * (f.key === "ga4_eng" ? 100 : 1)) : fmtInt(f.current)})</span></span>
              </li>
            ))}
            {me && strongest && (
              <li className="flex items-baseline gap-2"><span className="font-semibold">vs {strongest.domain}</span><span>you rank for {fmtInt(me.keywords)} keywords, they rank for {fmtInt(strongest.keywords)} <span className="text-ink-muted">(DataForSEO estimate)</span></span></li>
            )}
            {unseenAlerts > 0 && <li><Link href="#alerts" className="font-semibold text-accent hover:underline">{unseenAlerts} new alert{unseenAlerts > 1 ? "s" : ""} to review</Link></li>}
          </ul>
          {growth && (
            <details className="mt-4 text-xs text-ink-muted">
              <summary className="cursor-pointer font-medium text-ink-foreground/80 hover:text-ink-foreground">How the Growth Index is calculated ({growth.used} metrics)</summary>
              <div className="mt-2 space-y-2 rounded-xl border border-ink-border bg-ink-soft p-3">
                <p>Each metric is compared with the previous period of equal length and mapped to 0-100 (50 = unchanged, +20% = 100, −20% = 0; inverted for average position). The index is the weighted average of the metrics with enough volume. It shows direction of travel, not absolute quality or Google ranking factors.</p>
                <ul className="space-y-1">
                  {growth.factors.map((f) => (
                    <li key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-ink-foreground/90">
                      <span>{f.label} <span className="text-ink-muted">· weight {f.weight}</span></span><span className="tabular-nums">{f.score.toFixed(0)}/100 ({f.changePct > 0 ? "+" : ""}{f.changePct.toFixed(1)}%)</span>
                      <span className="col-span-2 h-1 overflow-hidden rounded-full bg-ink-border"><span className="block h-full rounded-full" style={{ width: `${f.score}%`, background: f.score >= 55 ? "var(--positive)" : f.score >= 45 ? "#D4970A" : "var(--negative)" }} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </div>
      </div>
      <div className="relative mt-6 border-t border-ink-border pt-4"><FreshnessChips status={status} dark /></div>
    </section>
  );
}

/* ------------------------------------------------------------------ KPI band */
const v = (c: Compared | undefined | null, k: string, w: "current" | "previous" | "mom" | "yoy" = "current"): Num => (c?.[w]?.has_data ? toNum(c[w][k]) : null);

export function KpiBand({ d }: { d: ReportData }) {
  type Tile = { label: string; source: string; c: Compared | undefined | null; k: string; format: (n: Num) => string; lower?: boolean; hint?: string };
  const tiles: Tile[] = [];
  if (d.connected.gsc) tiles.push(
    { label: "Search clicks", source: "GSC", c: d.gsc, k: "clicks", format: fmtInt },
    { label: "Search impressions", source: "GSC", c: d.gsc, k: "impressions", format: fmtInt },
    { label: "Average position", source: "GSC", c: d.gsc, k: "position", format: fmtDecimal, lower: true, hint: "Impression-weighted. Lower is better." },
  );
  if (d.connected.ga4) tiles.push(
    { label: "Website sessions", source: "GA4", c: d.ga4, k: "sessions", format: fmtInt },
    { label: "Key events", source: "GA4", c: d.ga4, k: "key_events", format: fmtInt, hint: "GA4 key events (formerly conversions)." },
    { label: "Engagement rate", source: "GA4", c: d.ga4, k: "engagement_rate", format: (n) => fmtPercent(n, 1) },
  );
  if (d.connected.gbp) tiles.push({ label: "Business Profile views", source: "GBP", c: d.gbp, k: "impressions", format: fmtInt });
  if (d.bing?.totals.current?.has_data) tiles.push({ label: "Bing clicks", source: "Bing", c: d.bing.totals, k: "clicks", format: fmtInt });
  const shown = tiles.slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Key metrics" className="rise rise-1 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map((t) => (
        <KpiCard key={t.label} label={t.label} source={t.source} hint={t.hint} format={t.format} higherIsBetter={!t.lower}
          value={v(t.c, t.k)} previous={v(t.c, t.k, "previous")} mom={v(t.c, t.k, "mom")} yoy={v(t.c, t.k, "yoy")} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ what changed */
function WinList({ title, items, good }: { title: string; items: Win[]; good: boolean }) {
  return (
    <div>
      <h3 className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", good ? "text-positive" : "text-negative")}>{good ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted">{good ? "No metric rose 10%+ with enough volume." : "No significant declines (10%+)."}</p> : (
        <ul className="space-y-1.5 text-sm">{items.slice(0, 4).map((w) => <li key={w.label} className="flex justify-between gap-3"><span>{w.text}</span><span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">{w.source}</span></li>)}</ul>
      )}
    </div>
  );
}

export function ChangesPanel({ d }: { d: ReportData }) {
  return (
    <section className={cn(card, "rise rise-2")} aria-labelledby="changes-h">
      <h2 id="changes-h" className="mb-4 text-sm font-semibold">What changed</h2>
      <div className="grid gap-5 sm:grid-cols-2"><WinList title="Improved" items={monthlyWins(d)} good /><WinList title="Declined" items={notableDeclines(d)} good={false} /></div>
      <p className="mt-4 text-xs text-muted">Calculated from the data, not written by AI. A change counts only at 10% or more with enough volume to be meaningful.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ next actions */
export interface NextAction { title: string; why: string; priority: "high" | "medium" | "low"; href: string; source: "AI" | "Data" }
const PR = { high: "bg-negative/10 text-negative", medium: "bg-[#D4970A]/10 text-[#B7791F]", low: "bg-surface-muted text-muted" } as const;

export function NextActions({ items }: { items: NextAction[] }) {
  return (
    <section className={cn(card, "rise rise-2")} aria-labelledby="next-h">
      <h2 id="next-h" className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-accent" aria-hidden /> What to do next</h2>
      {items.length === 0 ? <p className="text-sm text-muted">No priority actions right now. New recommendations appear after the next AI analysis.</p> : (
        <ol className="space-y-2.5">
          {items.map((a, i) => (
            <li key={a.title}>
              <Link href={a.href} className="lift group flex gap-3 rounded-xl border border-border p-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
                <span className="min-w-0 text-sm">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-medium leading-snug">{a.title}</span><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", PR[a.priority])}>{a.priority}</span><span className="text-[10px] uppercase text-muted">{a.source}</span></span>
                  <span className="mt-0.5 block text-xs text-muted">{a.why}</span>
                </span>
                <ArrowRight className="ml-auto mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ health */
const H = { pass: { icon: CheckCircle2, cls: "text-positive", label: "Good" }, watch: { icon: CircleAlert, cls: "text-[#B7791F]", label: "Watch" }, fix: { icon: CircleAlert, cls: "text-negative", label: "Fix" } } as const;

export function HealthPanel({ checks }: { checks: HealthCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <section className={cn(card, "rise rise-3")} aria-labelledby="health-h">
      <h2 id="health-h" className="mb-3 text-sm font-semibold">Health checks</h2>
      <ul className="space-y-2">
        {checks.map((c) => {
          const h = H[c.status];
          return (
            <li key={c.key} title={c.rule} className="flex gap-3 text-sm">
              <h.icon className={cn("mt-0.5 size-4 shrink-0", h.cls)} aria-label={h.label} />
              <div className="min-w-0 flex-1"><p className="font-medium leading-snug">{c.label}</p><p className="text-xs text-muted">{c.detail}</p></div>
              {c.href && <Link href={c.href} className="shrink-0 text-xs text-accent hover:underline">Details</Link>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">Pass / watch / fix against fixed guideline thresholds (hover a check to see its rule).</p>
    </section>
  );
}

/* ------------------------------------------------------------------ competitors */
export function CompetitorSnapshot({ comp }: { comp: CompetitorData | null }) {
  const latest = comp ? [...new Set(comp.snapshots.map((s) => s.domain))].map((dom) => comp.snapshots.filter((s) => s.domain === dom).at(-1)!) : [];
  const rows = [...latest].sort((a, b) => (b.keywords ?? 0) - (a.keywords ?? 0)).slice(0, 5);
  return (
    <section className={cn(card, "rise rise-3")} aria-labelledby="comp-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="comp-h" className="text-sm font-semibold">Competitors <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">estimate</span></h2>
        <Link href="/competitors" className="text-xs text-accent hover:underline">Full analysis →</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">The competitor analysis runs automatically every 24 hours. Results appear here as soon as the first one completes.</p>
      ) : (
        <>
          <BarList title="Organic keywords ranked (top 100)" valueLabel="Keywords" items={rows.map((s) => ({ label: s.is_self ? `${s.domain} (you)` : s.domain, value: s.keywords ?? 0, detail: s.traffic != null ? `~${fmtInt(Math.round(s.traffic))} visits/mo` : undefined }))} />
          {comp && comp.threats.length > 0 && <p className="mt-3 text-xs text-negative">{comp.threats[0].domain} is {comp.threats[0].kind === "overtaking" ? "overtaking you" : "gaining visibility"}.</p>}
          <p className="mt-2 text-xs text-muted">Latest analysis {comp?.latestAt}. Counts and traffic are DataForSEO estimates.</p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ top lists + opportunities */
const link = (u: unknown) => { try { const x = new URL(String(u)); return `${x.host}${x.pathname}`; } catch { return String(u ?? "—"); } };

export function TopAndOpportunities({ d }: { d: ReportData }) {
  const o = d.opportunities;
  const list = (rows: Row[], cols: { label: string; render: (r: Row) => React.ReactNode; right?: boolean }[], empty: string) => rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
    <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted">{cols.map((c) => <th key={c.label} className={cn("px-2 py-1.5 font-medium", c.right && "text-right")}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 6).map((r, i) => <tr key={i} className="border-t border-border">{cols.map((c) => <td key={c.label} className={cn("px-2 py-1.5", c.right && "text-right tabular-nums")}>{c.render(r)}</td>)}</tr>)}</tbody></table>
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
    <section className={cn(card, "rise rise-4")} aria-label="Top performers and opportunities">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Top performers and opportunities</h2><Link href="/search-console" className="text-xs text-accent hover:underline">Open Search Console →</Link></div>
      <Tabs label="Top performers and opportunities" items={items} />
    </section>
  );
}
