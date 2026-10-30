import Link from "next/link";
import { AlertTriangle, Info, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { CompareTrend } from "@/components/research/compare-trend";
import { CompetitorManager, DiscoveredActions, KeywordGapForm, ReanalyzeButton } from "@/components/research/competitor-controls";
import { SpendLine } from "@/components/research/chrome";
import { ResearchTable, type Col } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadCompetitors } from "@/lib/dataforseo/competitors";
import { BarList } from "@/components/charts/bar-list";
import { brandStats, ENGINES, loadAi, type EngineKey } from "@/lib/ai/visibility";
import { loadLocal, reviewStats } from "@/lib/dataforseo/local";
import { loadRanks } from "@/lib/dataforseo/rank";
import { loadCache } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const header = <TabHeader source="dfs" title="Competitor Intelligence" description="How your organic visibility compares with the sites that compete for the same searches. Analysed automatically every 24 hours; this page shows the latest stored analysis." guide={[
    { term: "Ranking keywords", text: "Google keywords a site ranks for in the top 100. A modelled estimate from DataForSEO's index." },
    { term: "Estimated traffic", text: "Visits the rankings would bring, based on search volume and position. A consistent yardstick, not measured visits." },
    { term: "Keyword gap", text: "Keywords a competitor ranks top-20 for that you don't rank for at all: content you could create." },
    { term: "Head to head", text: "Keywords you both rank for, with both positions. Where they outrank you is the fastest place to gain." },
    { term: "Relative change", text: "Each site's ranking keywords indexed to the first snapshot (100), so a small site and a big brand can be compared by direction." },
  ]} />;
  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const supabase = await createClient();
  const comp = await loadCompetitors(supabase, client.id);
  if (!comp.target) {
    return <>{header}<EmptyState title="No website to analyse yet" body="Connect Bing, Search Console or Business Profile so the website can be detected. If you just updated the app, ask an admin to confirm the latest database migration is applied." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const { target } = comp;
  const { data: aiRecs } = await supabase.from("analytics_insights")
    .select("id, title, summary, priority, confidence, estimated_effort, recommended_action, expected_impact_hypothesis, success_metric, category, implementation_status")
    .eq("client_id", client.id).in("category", ["competitor", "link_building"]).neq("implementation_status", "dismissed").order("created_at", { ascending: false }).limit(6);
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
  const onDemand = comp.gaps.filter((g) => !tracked.has(g.competitor)); // gaps you ran yourself against any domain
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

  /* ---------------------------------------------------------------- competitor research from the other stored datasets (no extra calls) */
  const bare = (d: string | null | undefined) => (d ?? "").replace(/^www\./, "").toLowerCase();
  const self = bare(target.domain);
  const rivalsList = comp.tracked.slice(0, 4);
  const [ranks, ai, cache, local] = await Promise.all([
    loadRanks(supabase, client.id), loadAi(supabase, client.id), loadCache(supabase, client.id), loadLocal(supabase, createAdminClient(), client.id),
  ]);
  const posIn = (top: { position: number; domain: string | null }[], d: string) => top.find((t) => { const x = bare(t.domain); return x === d || x.endsWith(`.${d}`); })?.position ?? null;
  const matrix: Row[] = ranks.ok ? ranks.rows.filter((r) => r.checkedOn).map((r) => ({
    keyword: r.keyword, device: r.device, volume: r.volume, you: r.position,
    ...Object.fromEntries(rivalsList.map((d, i) => [`c${i}`, posIn(r.top, d)])),
    leader: r.top[0]?.domain ? bare(r.top[0].domain) : null,
  })) : [];
  const compPages: Row[] = comp.pages.filter((p) => tracked.has(p.competitor)).flatMap((p) => p.rows.map((r) => ({ ...r, competitor: p.competitor })));
  const selfLinks = cache.get<{ rank: number | null; backlinks: number | null; referring_domains: number | null; spam_score: number | null }>("summary")?.data ?? null;
  const authority: Row[] = [
    ...(selfLinks ? [{ site: `${self} (you)`, rank: selfLinks.rank, backlinks: selfLinks.backlinks, referring_domains: selfLinks.referring_domains, spam: selfLinks.spam_score }] : []),
    ...comp.links.filter((l) => tracked.has(l.competitor)).map((l) => ({ site: l.competitor, rank: l.data.rank, backlinks: l.data.backlinks, referring_domains: l.data.referring_domains, spam: l.data.spam_score })),
  ];
  const packCount = new Map<string, number>(), adCount = new Map<string, number>();
  for (const r of ranks.ok ? ranks.rows : []) {
    for (const p of r.serp?.local_pack ?? []) { const k = p.own ? `${p.title ?? self} (you)` : p.title ?? p.domain ?? "?"; packCount.set(k, (packCount.get(k) ?? 0) + 1); }
    for (const a of r.serp?.ads ?? []) adCount.set(a, (adCount.get(a) ?? 0) + 1);
  }
  const aiBrands = ai.ok ? brandStats(ai, self).slice(0, 10) : [];
  const usedEngines = [...new Set(ai.latest.map((c) => c.engine))] as EngineKey[];
  const aiRows: Row[] = aiBrands.map((b) => ({
    brand: b.own ? `${b.name} (you)` : b.name, ...Object.fromEntries(usedEngines.map((e) => [e, b.engines[e]?.mentions ?? 0])),
    mentions: b.mentions, detection: b.detection, position: b.latestPosition, sentiment: b.avgSentiment, citations: b.citations,
  }));
  const gbpRows: Row[] = [
    ...(local.profile ? [{ business: `${local.profile.data.title ?? "You"} (you)`, rating: local.profile.data.rating, reviews: local.profile.data.votes, reply: local.reviews ? reviewStats(local.reviews.items).replyRate : null, last90: local.reviews ? reviewStats(local.reviews.items).last90 : null }] : []),
    ...local.rivals.filter((r) => r.profile).map((r) => ({ business: r.profile!.title, rating: r.profile!.rating, reviews: r.profile!.votes, reply: r.reviews ? reviewStats(r.reviews.items).replyRate : null, last90: r.reviews ? reviewStats(r.reviews.items).last90 : null })),
  ].map((r) => ({ ...r, reply: r.reply == null ? null : Math.round(Number(r.reply) * 100) }));
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
          <div className="mb-3 space-y-1">
            <KeywordGapForm canEdit={canEdit} suggestions={[...comp.tracked, ...(comp.auto?.data ?? []).map((a) => a.domain)]} />
            <p className="text-xs text-muted">Content gap against any site you type: keywords it ranks top-20 for that you don&apos;t rank for. About 3 cents, stored for 7 days, counted in the daily spend limit. Results appear as their own tab below.</p>
          </div>
          {gapsBy.length === 0 && sharedBy.length === 0 && onDemand.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">Keyword gaps and head-to-head rankings are refreshed weekly. They appear after the next analysis completes.</div>
          ) : (
            <Tabs label="Keyword analysis" items={[
              { key: "gap", label: "Keyword gaps", badge: fmtInt(mergedGaps.length), content: (
                <ResearchTable title="Keywords competitors rank for and you don't" rows={mergedGaps} columns={GAP_COLS} searchKeys={["keyword", "competitor"]} presets={gapPresets}
                  ranges={[{ key: "volume", label: "Volume / mo" }, { key: "difficulty", label: "Difficulty" }, { key: "their_position", label: "Their position" }]} facets={[{ key: "intent", label: "Intent" }, { key: "competitor", label: "Competitor" }]}
                  initialSort={{ key: "volume", dir: "desc" }} csvName={`keyword-gaps-${target.domain}`} empty="No keyword gaps found."
                  note="Competitor top-20 keywords with 50+ monthly searches where you have no top-100 ranking, excluding the competitor's own brand name. Volume, difficulty and CPC are estimates." />) },
              { key: "h2h", label: "Head to head", badge: fmtInt(mergedShared.length), content: (
                <ResearchTable title="Keywords you both rank for" rows={mergedShared} columns={H2H_COLS} searchKeys={["keyword", "competitor"]} presets={h2hPresets}
                  ranges={[{ key: "volume", label: "Volume / mo" }, { key: "difficulty", label: "Difficulty" }, { key: "you", label: "Your position" }, { key: "them", label: "Their position" }]} facets={[{ key: "competitor", label: "Competitor" }]}
                  initialSort={{ key: "volume", dir: "desc" }} csvName={`head-to-head-${target.domain}`} empty="No shared keywords found."
                  note="Both positions are Google ranks observed by DataForSEO. ▲ means you rank better by that many positions." />) },
              ...[...gapsBy, ...onDemand].map((g) => ({
                key: `gap-${g.competitor}`, label: g.competitor, badge: fmtInt(g.total),
                content: <ResearchTable title={`Gaps vs ${g.competitor}`} rows={g.rows.map((r) => ({ ...r, competitor: g.competitor }))} columns={GAP_COLS.filter((c) => c.key !== "competitor")} searchKeys={["keyword"]} presets={gapPresets}
                  initialSort={{ key: "volume", dir: "desc" }} note={`${fmtInt(g.total)} keywords in total; the top ${g.rows.length} by search volume are stored. Updated ${g.fetchedAt.slice(0, 10)}.`} />,
              })),
            ]} />
          )}
        </section>

        <section aria-label="Competitor research">
          <h2 className="mb-1 text-base font-semibold">Competitor research</h2>
          <p className="mb-3 text-sm text-muted">Rankings, winning pages, link authority, results-page features, AI answers and Google profiles side by side. Built from data that refreshes automatically: weekly for pages and links, and with every Rank Tracking, AI Visibility and Local SEO check.</p>
          <Tabs label="Competitor research" items={[
            { key: "matrix", label: "Rankings matrix", badge: matrix.length, content: matrix.length ? (
              <ResearchTable title="Where you and each competitor rank for your tracked keywords" rows={matrix} searchKeys={["keyword", "leader"]} csvName={`ranking-matrix-${target.domain}`} initialSort={{ key: "volume", dir: "desc" }}
                columns={[
                  { key: "keyword", label: "Keyword" }, { key: "device", label: "Device", type: "badge" }, { key: "volume", label: "Volume", type: "int" }, { key: "you", label: "You", type: "int" },
                  ...rivalsList.map((d, i) => ({ key: `c${i}`, label: d, type: "int" as const })), { key: "leader", label: "Ranks #1" },
                ]} note="From the latest Rank Tracking check. A competitor's position shows when it is in the top 10; empty means not in the top 10 (for you: not in the top 30)." />
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Track keywords on the Rank Tracking tab to compare positions here.</p> },
            { key: "pages", label: "Their top pages", badge: compPages.length, content: compPages.length ? (
              <ResearchTable title="The pages competitors win with" rows={compPages} searchKeys={["page", "competitor"]} facets={[{ key: "competitor", label: "Competitor" }]} initialSort={{ key: "traffic", dir: "desc" }} csvName={`competitor-pages-${target.domain}`}
                columns={[{ key: "competitor", label: "Competitor" }, { key: "page", label: "Page", type: "url" }, { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "keywords", label: "Keywords", type: "int" }, { key: "top3", label: "In top 3", type: "int" }, { key: "value", label: "Traffic value", type: "usd" }]}
                note="Each tracked competitor's 20 strongest pages by estimated organic traffic (DataForSEO Labs, refreshed weekly)." />
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Collected with the next weekly competitor analysis.</p> },
            { key: "links", label: "Link authority", badge: authority.length, content: authority.length > 1 ? (
              <div className="space-y-4">
                <ResearchTable title="Backlink profiles" rows={authority} initialSort={{ key: "referring_domains", dir: "desc" }}
                  columns={[{ key: "site", label: "Site" }, { key: "rank", label: "Domain rank", type: "int" }, { key: "referring_domains", label: "Referring domains", type: "int" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "spam", label: "Spam", type: "spam" }]} />
                <BarList title="Referring domains" valueLabel="Domains" items={authority.map((a) => ({ label: String(a.site), value: Number(a.referring_domains ?? 0) }))} />
                <p className="text-xs text-muted">Sites linking to competitors but not to you are on the Backlinks tab (Link gap).</p>
              </div>
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Collected with the next weekly competitor analysis.</p> },
            { key: "serp", label: "Map pack & ads", content: packCount.size || adCount.size ? (
              <div className="grid gap-4 md:grid-cols-2">
                <BarList title="Who appears in the Google map pack" valueLabel="Keywords" items={[...packCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }))} emptyText="No map pack on your tracked keywords." />
                <BarList title="Who buys Google ads on your keywords" valueLabel="Keywords" items={[...adCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }))} emptyText="No ads seen on your tracked keywords." />
              </div>
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Appears after the next Rank Tracking check.</p> },
            { key: "ai", label: "AI answers", badge: aiRows.length, content: aiRows.length ? (
              <ResearchTable title="Who the AI assistants name" rows={aiRows} initialSort={{ key: "mentions", dir: "desc" }} csvName={`ai-share-of-voice-${target.domain}`}
                columns={[{ key: "brand", label: "Brand" }, ...usedEngines.map((e) => ({ key: e, label: ENGINES[e].label, type: "int" as const })), { key: "mentions", label: "Mentions", type: "int" }, { key: "detection", label: "Share of answers %", type: "int" }, { key: "position", label: "Avg position", type: "dec" }, { key: "sentiment", label: "Sentiment", type: "int" }, { key: "citations", label: "Citations", type: "int" }]}
                note="From the latest AI Visibility check. Open that tab for the competition map, citations and sentiment." />
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Add questions on the AI Visibility tab to see who the assistants recommend.</p> },
            { key: "gbp", label: "Google profiles", badge: gbpRows.length, content: gbpRows.length > 1 ? (
              <ResearchTable title="Business Profile comparison" rows={gbpRows} initialSort={{ key: "reviews", dir: "desc" }}
                columns={[{ key: "business", label: "Business" }, { key: "rating", label: "Rating", type: "dec" }, { key: "reviews", label: "Reviews", type: "int" }, { key: "last90", label: "Reviews · 90 days", type: "int" }, { key: "reply", label: "Reply rate %", type: "int" }]}
                note="From Local SEO & Reviews, which also has the map rank grid and review velocity." />
            ) : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Compare nearby businesses on the <Link href="/local-seo" className="text-accent hover:underline">Local SEO &amp; Reviews</Link> tab.</p> },
          ]} />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4" aria-label="AI competitor recommendations">
          <h2 className="mb-1 text-sm font-semibold">AI recommendations from this data <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">ai interpretation</span></h2>
          <p className="mb-3 text-xs text-muted">Written by AI from the competitor data above. They are hypotheses to test, never guaranteed outcomes.</p>
          {(aiRecs ?? []).length === 0 ? (
            <p className="text-sm text-muted">No competitor-specific recommendations yet. They are added to the next AI analysis, which refreshes weekly for active clients once new data is available. <Link href="/insights" className="text-accent hover:underline">Open AI Insights</Link></p>
          ) : (
            <ul className="space-y-3">
              {(aiRecs ?? []).map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{r.title}<span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">{r.priority} priority · {r.confidence} confidence · {r.estimated_effort} effort</span></p>
                  <p className="mt-1 text-muted">{r.summary}</p>
                  <p className="mt-2"><span className="font-medium">Next step: </span>{r.recommended_action}</p>
                  <p className="mt-1 text-xs text-muted"><span className="font-medium">Hypothesis: </span>{r.expected_impact_hypothesis} <span className="font-medium">Measure: </span>{r.success_metric}</p>
                </li>
              ))}
            </ul>
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
          <p>Google Maps competitors, reviews and map rankings are on the <Link href="/local-seo" className="text-accent hover:underline">Local SEO &amp; Reviews</Link> tab.</p>
        </div>
      </div>
    </>
  );
}
