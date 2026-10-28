import { AlertTriangle, Info, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { CompareTrend } from "@/components/research/compare-trend";
import { CompetitorManager, DiscoveredActions, ReanalyzeButton } from "@/components/research/competitor-controls";
import { SpendLine } from "@/components/research/chrome";
import { ResearchTable, type Col } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadCompetitors } from "@/lib/dataforseo/competitors";
import { marketLabel } from "@/lib/dataforseo/locations";
import { nextRun } from "@/lib/jobs/log";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const GAP_COLS: Col[] = [
  { key: "keyword", label: "Keyword" }, { key: "competitor", label: "Competitor" }, { key: "volume", label: "Volume / mo", type: "int" },
  { key: "difficulty", label: "Difficulty", type: "int", hint: "0-100: how hard it is to reach the top 10" }, { key: "cpc", label: "CPC", type: "usd" },
  { key: "intent", label: "Intent", type: "badge" }, { key: "their_position", label: "Their rank", type: "int" }, { key: "their_url", label: "Their page", type: "url" },
];
const H2H_COLS: Col[] = [
  { key: "keyword", label: "Keyword" }, { key: "competitor", label: "Competitor" }, { key: "volume", label: "Volume / mo", type: "int" },
  { key: "you", label: "You", type: "int" }, { key: "them", label: "Them", type: "int" }, { key: "delta", label: "You vs them", type: "delta", hint: "Positions you are ahead (▲) or behind (▼)" },
  { key: "you_url", label: "Your page", type: "url" },
];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "—");

export default async function CompetitorsPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, configured, budget } = page;
  const header = <PageHeader title="Competitor Intelligence" description="How your organic visibility compares with the sites that compete for the same searches. Analysed automatically every 24 hours; this page shows the latest stored analysis." />;
  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const supabase = await createClient();
  const comp = await loadCompetitors(supabase, client.id);
  if (!comp.target) {
    return <>{header}<EmptyState title="No website to analyse yet" body="Connect Bing, Search Console or Business Profile so the website can be detected. If you just updated the app, ask an admin to confirm the latest database migration is applied." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const { target } = comp;
  const next = nextRun("research");
  const today = todayIn("UTC");
  const analysedToday = comp.latestAt === today;
  const reanalyze = <ReanalyzeButton canEdit={canEdit} analysedToday={analysedToday} />;

  if (comp.snapshots.length === 0) {
    return (
      <>
        {header}
        <div className="mb-5"><SpendLine budget={budget} /></div>
        <EmptyState title={`No competitor analysis for ${target.domain} yet`} body={`The first analysis runs automatically at the next scheduled update (${when(next.toISOString())}). Nothing needs to be done, or an owner/admin can start it now for about 12 cents.`} />
        <div className="mt-4">{reanalyze}</div>
      </>
    );
  }

  /* ---------------------------------------------------------------- per-domain summary */
  const byDomain = new Map<string, typeof comp.snapshots>();
  for (const s of comp.snapshots) byDomain.set(s.domain, [...(byDomain.get(s.domain) ?? []), s]);
  const summary = [...byDomain].map(([domain, list]) => {
    const l = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const first = l[0], last = l.at(-1)!;
    return {
      domain, you: last.is_self, keywords: last.keywords, top10: last.top10, traffic: last.traffic === null ? null : Math.round(last.traffic), shared: last.shared_keywords,
      avg_position: last.avg_position, change: l.length > 1 && first.keywords !== null && last.keywords !== null ? last.keywords - first.keywords : null, since: first.snapshot_date, at: last.snapshot_date,
    };
  }).sort((a, b) => Number(b.you) - Number(a.you) || (b.traffic ?? 0) - (a.traffic ?? 0));
  const me = summary.find((s) => s.you);
  const rivals = summary.filter((s) => !s.you);
  const stale = comp.latestAt !== null && comp.latestAt < shiftDays(todayIn("UTC"), -2);
  const strongest = [...rivals].sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))[0];

  /* ---------------------------------------------------------------- gap and head-to-head rows */
  const tracked = new Set(comp.tracked);
  const gapsBy = comp.gaps.filter((g) => tracked.has(g.competitor));
  const sharedBy = comp.shared.filter((g) => tracked.has(g.competitor));
  const mergedGaps: Row[] = [];
  const seen = new Set<string>();
  for (const g of gapsBy) for (const r of g.rows) { const k = String(r.keyword); if (!seen.has(k)) { seen.add(k); mergedGaps.push({ ...r, competitor: g.competitor }); } }
  const withDelta = (g: (typeof sharedBy)[number]) => g.rows.map((r) => ({ ...r, competitor: g.competitor, delta: typeof r.you === "number" && typeof r.them === "number" ? r.them - r.you : null }));
  const mergedShared = sharedBy.flatMap(withDelta);
  const gapPresets = [
    { label: "Easier wins (difficulty ≤ 35)", where: [{ key: "difficulty", op: "lte" as const, value: 35 }] },
    { label: "High volume (≥ 1,000)", where: [{ key: "volume", op: "gte" as const, value: 1000 }] },
    { label: "Commercial / transactional", where: [{ key: "intent", op: "eq" as const, value: "commercial" }] },
    { label: "Transactional", where: [{ key: "intent", op: "eq" as const, value: "transactional" }] },
  ];
  const h2hPresets = [
    { label: "They beat you", where: [{ key: "delta", op: "lte" as const, value: -1 }] },
    { label: "You beat them", where: [{ key: "delta", op: "gte" as const, value: 1 }] },
    { label: "You're on page 2+ (11+)", where: [{ key: "you", op: "gte" as const, value: 11 }] },
  ];
  const winnable = mergedGaps.filter((r) => Number(r.difficulty) <= 35 && Number(r.volume) >= 100).length;
  const beatenBy = mergedShared.filter((r) => Number(r.delta) <= -1).length;

  return (
    <>
      {header}
      <div className="mb-5 space-y-2">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>Latest analysis: <strong className="text-foreground">{comp.latestAt}</strong>{stale ? " (older than 2 days: the daily run may have been skipped; see Integrations)" : ""}</span>
          <span>Next automatic update: {when(next.toISOString())}</span>
          <span>Market: {marketLabel(target.location_code)}</span>
        </p>
        <SpendLine budget={budget} />
      </div>

      <div className="mb-5 flex gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <p className="text-muted">
          <strong className="text-foreground">How to read this page.</strong> Rankings are positions DataForSEO observed in Google results. Keyword counts, traffic and traffic value are
          <strong className="text-foreground"> modelled estimates</strong> (volume × position), not measured visits, and competitor figures are never from their own analytics.
          Treat them as a consistent yardstick for comparison. The gap and threat text below is derived from that data.
        </p>
      </div>

      <section aria-label="Headline comparison" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Your ranking keywords" source="DFS" format={fmtInt} value={me?.keywords ?? null} previous={me && me.change !== null && me.keywords !== null ? me.keywords - me.change : null} hint="Keywords you rank for in Google's top 100; change is since the first stored snapshot." />
        <KpiCard label="Your est. traffic / month" source="DFS" format={fmtInt} value={me?.traffic ?? null} previous={null} hint="Modelled from search volume and position." />
        <KpiCard label="Competitors tracked" source="DFS" format={fmtInt} value={rivals.length} previous={null} />
        <KpiCard label="Keyword opportunities" source="DFS" format={fmtInt} value={mergedGaps.length} previous={null} hint="Keywords competitors rank top-20 for (50+ searches/month) that you don't rank for." />
      </section>

      {(comp.threats.length > 0 || beatenBy > 0 || winnable > 0) && (
        <section aria-label="What stands out" className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {comp.threats.map((t) => (
            <div key={t.domain} className="rounded-xl border border-negative/40 bg-negative/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-negative"><AlertTriangle className="size-4" aria-hidden /> {t.kind === "overtaking" ? `${t.domain} overtook you` : `${t.domain} is rising`}</p>
              <p className="mt-1 text-muted">Ranking keywords {fmtInt(t.keywordsFrom)} → {fmtInt(t.keywordsTo)} in {Math.round(t.days)} days (estimate).</p>
            </div>
          ))}
          {winnable > 0 && (
            <div className="rounded-xl border border-positive/40 bg-positive/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-positive"><TrendingUp className="size-4" aria-hidden /> {fmtInt(winnable)} easier opportunities</p>
              <p className="mt-1 text-muted">Keywords with 100+ monthly searches and difficulty ≤ 35 where a competitor ranks and you don&apos;t. See the keyword gap tab.</p>
            </div>
          )}
          {beatenBy > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <p className="font-semibold">{fmtInt(beatenBy)} shared keywords where a competitor outranks you</p>
              <p className="mt-1 text-muted">Same searches, better position for them: improving those pages is usually the fastest gain.</p>
            </div>
          )}
        </section>
      )}

      <div className="mt-6"><CompareTrend snapshots={comp.snapshots} /></div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface" role="region" aria-label="Visibility comparison">
        <h2 className="px-4 pt-4 text-sm font-semibold">Side by side <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">estimate</span></h2>
        <table className="mt-2 w-full min-w-[44rem] text-sm">
          <thead><tr className="text-left text-xs text-muted">
            {["Site", "Ranking keywords", "Top-10", "Est. traffic / mo", "Shared with you", "Change", "Updated"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i && i < 6 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.domain} className={`border-t border-border ${s.you ? "bg-accent-soft/40 font-medium" : ""}`}>
                <td className="px-4 py-2">{s.domain}{s.you && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground">you</span>}{!s.you && strongest?.domain === s.domain && <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">largest</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.keywords)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.top10)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.traffic)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.you ? "—" : fmtInt(s.shared)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${s.change === null ? "text-muted" : s.change >= 0 ? "text-positive" : "text-negative"}`}>{s.change === null ? "—" : `${s.change > 0 ? "+" : ""}${fmtInt(s.change)}`}</td>
                <td className="px-4 py-2 text-xs text-muted">{s.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 pb-3 pt-1 text-xs text-muted">Change = ranking keywords since the first stored snapshot for that site (from {summary[0]?.since}).</p>
      </div>

      <div className="mt-8 space-y-6">
        <section aria-label="Keyword analysis">
          <h2 className="mb-3 text-base font-semibold">Keyword analysis</h2>
          {gapsBy.length === 0 && sharedBy.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Keyword gaps and head-to-head rankings are refreshed weekly. They appear after the next analysis completes.</div>
          ) : (
            <Tabs label="Keyword analysis" items={[
              { key: "gap", label: "Keyword gaps", badge: fmtInt(mergedGaps.length), content: (
                <ResearchTable title="Keywords competitors rank for and you don't" rows={mergedGaps} columns={GAP_COLS} searchKeys={["keyword", "competitor"]} presets={gapPresets}
                  initialSort={{ key: "volume", dir: "desc" }} csvName={`keyword-gaps-${target.domain}`} empty="No keyword gaps found."
                  note="Competitor top-20 keywords with 50+ monthly searches where you have no top-100 ranking, excluding the competitor's own brand name. Volume, difficulty and CPC are estimates." />) },
              { key: "h2h", label: "Head to head", badge: fmtInt(mergedShared.length), content: (
                <ResearchTable title="Keywords you both rank for" rows={mergedShared} columns={H2H_COLS} searchKeys={["keyword", "competitor"]} presets={h2hPresets}
                  initialSort={{ key: "volume", dir: "desc" }} csvName={`head-to-head-${target.domain}`} empty="No shared keywords found."
                  note="Both positions are Google ranks observed by DataForSEO. ▲ means you rank better by that many positions." />) },
              ...gapsBy.map((g) => ({
                key: `gap-${g.competitor}`, label: g.competitor, badge: fmtInt(g.total),
                content: <ResearchTable title={`Gaps vs ${g.competitor}`} rows={g.rows.map((r) => ({ ...r, competitor: g.competitor }))} columns={GAP_COLS.filter((c) => c.key !== "competitor")} searchKeys={["keyword"]} presets={gapPresets}
                  initialSort={{ key: "volume", dir: "desc" }} note={`${fmtInt(g.total)} keywords in total; the top ${g.rows.length} by search volume are stored. Updated ${g.fetchedAt.slice(0, 10)}.`} />,
              })),
            ]} />
          )}
        </section>

        {comp.auto && (
          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Discovered competitors">
            <h2 className="mb-1 text-sm font-semibold">Who competes with you in search</h2>
            <p className="mb-3 text-xs text-muted">Sites that rank for the most of the same keywords as you (discovered weekly, popular generic sites removed). Track the ones that are real rivals and hide the rest.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead><tr className="text-left text-xs text-muted">{["Site", "Shared keywords", "Their keywords", "Their est. traffic", "Avg position on shared", ""].map((h, i) => <th key={i} className={`px-2 py-2 font-medium ${i && i < 5 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {comp.auto.data.filter((a) => !target.competitors_excluded.includes(a.domain.toLowerCase())).slice(0, 15).map((a) => (
                    <tr key={a.domain} className="border-t border-border">
                      <td className="px-2 py-1.5">{a.domain}{tracked.has(a.domain.toLowerCase()) && <span className="ml-2 rounded bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-positive">tracked</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(a.shared)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(a.keywords)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(a.traffic === null ? null : Math.round(a.traffic))}</td><td className="px-2 py-1.5 text-right tabular-nums">{a.avg_position === null ? "—" : a.avg_position.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right"><DiscoveredActions canEdit={canEdit} domain={a.domain.toLowerCase()} mode={target.competitor_mode} manual={target.competitors} excluded={target.competitors_excluded} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Discovered {comp.auto.fetchedAt.slice(0, 10)}. Large national brands can appear here; hide any that don&apos;t compete for your customers.</p>
          </section>
        )}

        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Manage competitors <span className="ml-2 text-accent">{canEdit ? "Edit" : "View"}</span></summary>
          <div className="mt-3">
            <CompetitorManager canEdit={canEdit} mode={target.competitor_mode} manual={target.competitors} excluded={target.competitors_excluded}
              suggestions={(comp.auto?.data ?? []).map((a) => a.domain.toLowerCase())} />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          {reanalyze}
          <p>Local (Google Maps) competitor listings aren&apos;t included: Local Brand Manager reports your own ranking grids, and map competitor data would be a separate paid DataForSEO product.</p>
        </div>
      </div>
    </>
  );
}
