import Link from "next/link";
import { AlertTriangle, TrendingUp } from "lucide-react";
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
import { EXTRAS_MAX, extrasEstimate, loadCompetitorExtras, loadCompetitors, type PageType } from "@/lib/dataforseo/competitors";
import { Donut, MultiLine, StackedBars, type LineMetric } from "@/components/charts/ai-charts";
import { GroupedBars } from "@/components/charts/market-extra";
import { MarketRefreshButton } from "@/components/market/refresh-button";
import { BarList } from "@/components/charts/bar-list";
import { cat } from "@/lib/charts/colors";
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
    { term: "Traffic share", text: "Each site's estimated traffic as a share of the total across you and your tracked competitors: a simple share-of-voice yardstick." },
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
  const [ranks, ai, cache, local, extras] = await Promise.all([
    loadRanks(supabase, client.id), loadAi(supabase, client.id), loadCache(supabase, client.id), loadLocal(supabase, createAdminClient(), client.id),
    loadCompetitorExtras(supabase, client.id, target.domain, comp.tracked),
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
  const packCount = new Map<string, number>(), adCount = new Map<string, number>(), citeCount = new Map<string, number>();
  for (const r of ranks.ok ? ranks.rows : []) {
    for (const p of r.serp?.local_pack ?? []) { const k = p.own ? `${p.title ?? self} (you)` : p.title ?? p.domain ?? "?"; packCount.set(k, (packCount.get(k) ?? 0) + 1); }
    for (const a of r.serp?.ads ?? []) adCount.set(a, (adCount.get(a) ?? 0) + 1);
    for (const c of new Set((r.serp?.ai_overview ?? []).map((a) => bare(a.domain)).filter(Boolean))) { const k = c === self ? `${c} (you)` : c; citeCount.set(k, (citeCount.get(k) ?? 0) + 1); }
  }
  const packList = [...packCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
  const adList = [...adCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
  // the right-hand column stacks ads and AI Overview citations; size the second list so both columns end level
  const citeList = [...citeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(3, packList.length - adList.length - 2)).map(([label, value]) => ({ label, value }));
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

  /* ---------------------------------------------------------------- charts from the rows above */
  // identity slots follow the summary order (you first), so a site keeps its colour across charts
  const slot = new Map(summary.map((s, i) => [s.domain, i]));
  const label = (s: { domain: string; you: boolean }) => (s.you ? `${s.domain} (you)` : s.domain);
  const byTraffic = [...summary].filter((s) => (s.traffic ?? 0) > 0).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
  const trafficTotal = byTraffic.reduce((a, s) => a + (s.traffic ?? 0), 0);
  const shareItems = [
    ...byTraffic.slice(0, 5).map((s) => ({ label: label(s), value: s.traffic ?? 0, color: cat(slot.get(s.domain) ?? 8) })),
    ...(byTraffic.length > 5 ? [{ label: "Other", value: byTraffic.slice(5).reduce((a, s) => a + (s.traffic ?? 0), 0), color: "var(--cat-other)" }] : []),
  ];
  const myShare = me?.traffic && trafficTotal ? Math.round((me.traffic / trafficTotal) * 100) : null;
  const footprint = summary.filter((s) => s.keywords != null).map((s) => ({
    label: label(s), values: { top10: s.top10 ?? 0, rest: Math.max(0, (s.keywords ?? 0) - (s.top10 ?? 0)) },
  }));
  const h2hRows = sharedBy.map((g) => {
    const rows = withDelta(g);
    return { label: g.competitor, values: { ahead: rows.filter((r) => Number(r.delta) >= 1).length, tied: rows.filter((r) => r.delta === 0).length, behind: rows.filter((r) => Number(r.delta) <= -1).length } };
  }).filter((r) => r.values.ahead + r.values.tied + r.values.behind > 0);
  const gapIntent = new Map<string, number>();
  for (const r of mergedGaps) { const k = String(r.intent ?? "unknown"); gapIntent.set(k, (gapIntent.get(k) ?? 0) + 1); }
  const INTENTS = ["informational", "navigational", "commercial", "transactional"];
  const gapIntentItems = [...gapIntent].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
    const i = INTENTS.indexOf(k);
    return { label: `${k[0].toUpperCase()}${k.slice(1)} · ${fmtInt(v)}`, value: v, color: i >= 0 ? cat(i) : "var(--cat-other)" };
  });
  const charts2 = [
    h2hRows.length > 0 && <StackedBars key="h2h" title="Head to head on shared keywords" sub="Keywords you both rank for, by who ranks higher" valueLabel="Keywords"
      keys={[{ key: "ahead", label: "You rank higher", color: "var(--positive)" }, { key: "tied", label: "Same position", color: "var(--series-prev)" }, { key: "behind", label: "They rank higher", color: "var(--negative)" }]} rows={h2hRows} />,
    gapIntentItems.length > 0 && <Donut key="intent" title="What the keyword gaps are for" sub={`${fmtInt(mergedGaps.length)} gap keywords by search intent`} items={gapIntentItems}
      center={`${Math.round((gapIntentItems[0].value / Math.max(1, mergedGaps.length)) * 100)}%`} centerLabel={gapIntentItems[0].label.split(" · ")[0]} />,
  ].filter(Boolean);

  /* ---------------------------------------------------------------- trends: rank history, link growth, reviews, content */
  const extraDomains = [self, ...comp.tracked.slice(0, EXTRAS_MAX).map(bare)];
  const dLabel = (d: string) => (d === self ? `${d} (you)` : d);
  const dColor = (d: string, i: number) => cat(slot.get(d) ?? slot.get(`www.${d}`) ?? i);
  const rankDates = [...new Set(extras.rankTrend.map((r) => r.date))];
  const rankMetrics: LineMetric[] = [
    { key: "avg", label: "Average position (top 10)", reverse: true, series: extraDomains.map((d, i) => ({ key: `r${i}`, label: dLabel(d), color: dColor(d, i), data: extras.rankTrend.filter((r) => r.domain === d).map((r) => ({ date: r.date, value: r.avg })) })) },
    // the client's own checks go to 100 results: its full average next to the competitors' top-10 average
    { key: "all", label: "Average position (you: top 100)", reverse: true, series: extraDomains.map((d, i) => ({ key: `r${i}`, label: d === self ? `${d} (you, top 100)` : `${d} (top 10)`, color: dColor(d, i), data: extras.rankTrend.filter((r) => r.domain === d).map((r) => ({ date: r.date, value: r.avgRanked })) })) },
    { key: "top10", label: "Keywords in the top 10", series: extraDomains.map((d, i) => ({ key: `r${i}`, label: dLabel(d), color: dColor(d, i), data: extras.rankTrend.filter((r) => r.domain === d).map((r) => ({ date: r.date, value: r.top10 })) })) },
  ];
  const rankRows: Row[] = extras.rankTrend.map((r) => ({ date: r.date, site: dLabel(r.domain), avg: r.avg, top10: r.top10, all: r.domain === self ? r.avgRanked : null, ranked: r.domain === self ? r.ranked : null, checks: r.checks }));
  const linkMetrics: LineMetric[] = [
    { key: "rd", label: "Referring domains", series: extras.links.map((l, i) => ({ key: `l${i}`, label: dLabel(l.domain), color: dColor(l.domain, i), data: l.months.slice(-12).map((m) => ({ date: m.date, value: m.referring_domains })) })) },
    { key: "bl", label: "Backlinks", series: extras.links.map((l, i) => ({ key: `l${i}`, label: dLabel(l.domain), color: dColor(l.domain, i), data: l.months.slice(-12).map((m) => ({ date: m.date, value: m.backlinks })) })) },
  ];
  const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const lastMonth = extras.links.map((l) => ({ l, m: l.months.at(-1) })).filter((x) => x.m);
  const linkChange = lastMonth.map(({ l, m }) => ({ label: dLabel(l.domain), note: monthName(m!.date) + (m!.date >= today.slice(0, 7) ? " to date" : ""), values: { new_domains: m!.new_domains, lost_domains: m!.lost_domains, new_backlinks: m!.new_backlinks, lost_backlinks: m!.lost_backlinks } }));
  const linkRows: Row[] = extras.links.map((l) => {
    const last = l.months.at(-1), yearAgo = l.months.length > 12 ? l.months.at(-13) : l.months[0];
    return { site: dLabel(l.domain), referring_domains: last?.referring_domains ?? null, change: last && yearAgo && last.referring_domains != null && yearAgo.referring_domains != null ? last.referring_domains - yearAgo.referring_domains : null,
      new_domains: last?.new_domains ?? null, lost_domains: last?.lost_domains ?? null, new_backlinks: last?.new_backlinks ?? null, lost_backlinks: last?.lost_backlinks ?? null, month: last?.date ?? null };
  });
  // review velocity: new Google reviews per month over the last 6 months, from the stored reviews (newest first)
  const months6 = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
  const reviewSets = [
    ...(local.reviews ? [{ name: `${local.profile?.data.title ?? "You"} (you)`, own: true, items: local.reviews.items, rating: local.profile?.data.rating ?? local.reviews.rating, total: local.profile?.data.votes ?? local.reviews.total }] : []),
    ...local.rivals.filter((r) => r.reviews).map((r) => ({ name: (r.profile?.title ?? r.reviews!.name).split(/\s[|–-]\s/)[0], own: false, items: r.reviews!.items, rating: r.profile?.rating ?? r.reviews!.rating, total: r.profile?.votes ?? r.reviews!.total })),
  ];
  const reviewMetrics: LineMetric[] = [{ key: "rv", label: "New reviews per month", series: reviewSets.map((r, i) => ({ key: `v${i}`, label: r.name, color: cat(i), data: months6.map((m) => ({ date: `${m}-01`, value: r.items.filter((x) => x.date?.startsWith(m)).length })) })) }];
  const reviewRows: Row[] = reviewSets.map((r) => {
    const st = reviewStats(r.items);
    return { business: r.name, rating: r.rating, reviews: r.total, last6: r.items.filter((x) => (x.date ?? "") >= `${months6[0]}-01`).length, last90: st.last90, reply: st.replyRate == null ? null : Math.round(st.replyRate * 100) };
  });
  const reviewBars = reviewRows.map((r) => ({ label: String(r.business), values: { last90: Number(r.last90 ?? 0), last6: Number(r.last6 ?? 0) } }));
  // content: what kind of pages earn each site its traffic
  const TYPES: { key: PageType; label: string }[] = [{ key: "service", label: "Service / product" }, { key: "location", label: "Location" }, { key: "guide", label: "Blog / guide" }, { key: "pricing", label: "Cost / pricing" }, { key: "other", label: "Other (home, about...)" }];
  const contentRows: Row[] = extras.content.map((c) => ({ site: dLabel(c.domain), pages: c.pages, traffic: c.traffic, keywords: c.keywords, top_page: c.topPage, top_traffic: c.topTraffic, ...Object.fromEntries(TYPES.map((t) => [t.key, c.types[t.key]])) }));
  const contentBars = extras.content.map((c) => ({ label: dLabel(c.domain), values: Object.fromEntries(TYPES.map((t) => [t.key, c.types[t.key]])), note: `${fmtInt(c.pages)} pages` }));
  const extrasAt = [...extras.links.filter((l) => !l.own).map((l) => l.fetchedAt), ...extras.content.filter((c) => !c.own).map((c) => c.fetchedAt ?? "")].filter(Boolean).sort().at(-1)?.slice(0, 10) ?? null;
  const dashed = "rounded-[10px] border border-dashed border-border p-4 text-sm text-muted";

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

      <section aria-label="Headline comparison" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-4">
        <KpiCard label="Your ranking keywords" source="DFS" format={fmtInt} value={me?.keywords ?? null} previous={me && me.change !== null && me.keywords !== null ? me.keywords - me.change : null} hint="Keywords you rank for in Google's top 100; change is since the first stored snapshot." />
        <KpiCard label="Your est. traffic / month" source="DFS" format={fmtInt} value={me?.traffic ?? null} previous={null} hint="Modelled from search volume and position." />
        <KpiCard label="Competitors tracked" source="DFS" format={fmtInt} value={rivals.length} previous={null} />
        <KpiCard label="Keyword opportunities" source="DFS" format={fmtInt} value={mergedGaps.length} previous={null} hint="Keywords competitors rank top-20 for (50+ searches/month) that you don't rank for." />
      </section>

      {(comp.threats.length > 0 || beatenBy > 0 || winnable > 0) && (
        <section aria-label="What stands out" className="mt-6 flex flex-wrap gap-3 [&>*]:min-w-[16rem] [&>*]:flex-1">
          {comp.threats.map((t) => (
            <div key={t.domain} className="rounded-[10px] border border-negative/40 bg-negative/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-negative"><AlertTriangle className="size-4" aria-hidden /> {t.kind === "overtaking" ? `${t.domain} overtook you` : `${t.domain} is rising`}</p>
              <p className="mt-1 text-muted">Ranking keywords {fmtInt(t.keywordsFrom)} → {fmtInt(t.keywordsTo)} in {Math.round(t.days)} days (estimate).</p>
            </div>
          ))}
          {winnable > 0 && (
            <div className="rounded-[10px] border border-positive/40 bg-positive/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-positive"><TrendingUp className="size-4" aria-hidden /> {fmtInt(winnable)} easier opportunities</p>
              <p className="mt-1 text-muted">Keywords with 100+ monthly searches and difficulty ≤ 35 where a competitor ranks and you don&apos;t. See the keyword gap tab.</p>
            </div>
          )}
          {beatenBy > 0 && (
            <div className="rounded-[10px] border border-border bg-surface p-4 text-sm">
              <p className="font-semibold">{fmtInt(beatenBy)} shared keywords where a competitor outranks you</p>
              <p className="mt-1 text-muted">Same searches, better position for them: improving those pages is usually the fastest gain.</p>
            </div>
          )}
        </section>
      )}

      <div className="mt-6"><CompareTrend snapshots={comp.snapshots} /></div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Donut title="Estimated traffic share" sub="Your share of the estimated organic traffic across the tracked sites" items={shareItems}
          center={myShare == null ? "—" : `${myShare}%`} centerLabel="your share" />
        <StackedBars title="Keyword footprint" sub="Ranking keywords per site, split into top 10 and positions 11–100" valueLabel="Keywords"
          keys={[{ key: "top10", label: "Top 10", color: "var(--series)" }, { key: "rest", label: "Positions 11–100", color: "color-mix(in oklab, var(--series) 35%, var(--surface))" }]} rows={footprint} />
      </div>
      {charts2.length > 0 && <div className={`mt-4 grid gap-4 ${charts2.length > 1 ? "lg:grid-cols-2" : ""}`}>{charts2}</div>}

      <div className="mt-6 overflow-x-auto rounded-[10px] border border-border bg-surface" role="region" aria-label="Visibility comparison">
        <h2 className="px-4 pt-4 text-sm font-semibold">Side by side <span className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">estimate</span></h2>
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

      <section aria-label="Competitor trends" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">You vs competitors over time</h2>
            <p className="text-xs text-muted">Rankings from your Rank Tracking checks; links, reviews and pages from DataForSEO{extrasAt ? ` (competitor links and pages updated ${extrasAt})` : ""}. Refreshes weekly.</p>
          </div>
          {canEdit && comp.tracked.length > 0 && <MarketRefreshButton action="compExtras" label="Fetch competitor links & pages" estimate={`≈$${extrasEstimate(Math.min(EXTRAS_MAX, comp.tracked.length)).toFixed(2)}`} />}
        </div>
        <Tabs label="Competitor trends" items={[
          { key: "rank", label: "Rank history", badge: rankDates.length, content: rankRows.length ? (
            <div className="space-y-4">
              <MultiLine title="Average position on your tracked keywords" sub={`Each Rank Tracking check · keywords where the site is in Google's top 10 · lower is better${extras.rankTrend.some((r) => r.domain === self && r.ranked > 0) ? "" : ` · ${self} is not in the top 100 for these keywords yet`}`} metrics={rankMetrics} />
              <ResearchTable title="Rank history by site" rows={rankRows} initialSort={{ key: "date", dir: "desc" }} pageSize={8} facets={[{ key: "site", label: "Site" }]} csvName={`competitor-rank-history-${target.domain}`}
                columns={[{ key: "date", label: "Checked", type: "date" }, { key: "site", label: "Site" }, { key: "avg", label: "Avg position (top 10)", type: "dec" }, { key: "top10", label: "Keywords in top 10", type: "int" }, { key: "all", label: "Your avg position (top 100)", type: "dec" }, { key: "ranked", label: "Your keywords in top 100", type: "int" }, { key: "checks", label: "Keywords checked", type: "int" }]}
                note="Rank checks store the top 10 results for every keyword, so competitors are compared inside the top 10; your own positions are checked to 100." />
            </div>
          ) : <p className={dashed}>Appears after the first Rank Tracking check.</p> },
          { key: "links", label: "Link growth", badge: extras.links.length, content: extras.links.length ? (
            <div className="space-y-4">
              <MultiLine title="Referring domains, last 12 months" sub="Websites linking to each site, at the end of each month" metrics={linkMetrics} />
              <GroupedBars title="Links earned and lost in the latest month" sub="New and lost referring domains and backlinks (DataForSEO backlink history)" valueLabel="Count" rows={linkChange}
                keys={[{ key: "new_domains", label: "Referring domains gained", color: "var(--positive)" }, { key: "lost_domains", label: "Referring domains lost", color: "var(--negative)" }, { key: "new_backlinks", label: "Backlinks gained", color: "color-mix(in oklab, var(--positive) 45%, var(--surface))" }, { key: "lost_backlinks", label: "Backlinks lost", color: "color-mix(in oklab, var(--negative) 45%, var(--surface))" }]} />
              <ResearchTable title="Link growth by site" rows={linkRows} initialSort={{ key: "referring_domains", dir: "desc" }} pageSize={6}
                columns={[{ key: "site", label: "Site" }, { key: "referring_domains", label: "Referring domains", type: "int" }, { key: "change", label: "12-month change", type: "delta" }, { key: "new_domains", label: "Gained (month)", type: "int" }, { key: "lost_domains", label: "Lost (month)", type: "int" }, { key: "new_backlinks", label: "Backlinks gained", type: "int" }, { key: "lost_backlinks", label: "Backlinks lost", type: "int" }, { key: "month", label: "Month ending", type: "date" }]} />
            </div>
          ) : <p className={dashed}>Collected with the next weekly run{canEdit ? " (or “Fetch competitor links & pages”)" : ""}.</p> },
          { key: "reviews", label: "Review velocity", badge: reviewSets.length, content: reviewSets.length ? (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <MultiLine title="New Google reviews per month" sub="Last 6 months, you and the nearby competitors compared on Local SEO" metrics={reviewMetrics} />
                <GroupedBars title="Recent reviews" sub="New reviews in the last 90 days and 6 months" valueLabel="Reviews" rows={reviewBars}
                  keys={[{ key: "last90", label: "Last 90 days", color: "var(--series)" }, { key: "last6", label: "Last 6 months", color: "color-mix(in oklab, var(--series) 40%, var(--surface))" }]} />
              </div>
              <ResearchTable title="Reviews compared" rows={reviewRows} initialSort={{ key: "last90", dir: "desc" }} pageSize={8}
                columns={[{ key: "business", label: "Business" }, { key: "rating", label: "Rating", type: "dec" }, { key: "reviews", label: "Total reviews", type: "int" }, { key: "last90", label: "Reviews · 90 days", type: "int" }, { key: "last6", label: "Reviews · 6 months", type: "int" }, { key: "reply", label: "Owner response rate %", type: "int" }]}
                note="From the newest reviews stored for each business (Google Business Profile via DataForSEO); response rate is over those reviews." />
            </div>
          ) : <p className={dashed}>Compare nearby businesses on the <Link href="/local-seo" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Local SEO &amp; Reviews</Link> tab to see their review pace here.</p> },
          { key: "content", label: "Content", badge: extras.content.length, content: extras.content.length ? (
            <div className="space-y-4">
              <StackedBars title="What kind of pages rank" sub="Each site's ranking pages by type (from the page address)" valueLabel="Pages" rows={contentBars}
                keys={TYPES.map((t, i) => ({ key: t.key, label: t.label, color: t.key === "other" ? "var(--cat-other)" : cat(i) }))} />
              <ResearchTable title="Content compared" rows={contentRows} initialSort={{ key: "traffic", dir: "desc" }} pageSize={6}
                columns={[{ key: "site", label: "Site" }, { key: "pages", label: "Ranking pages", type: "int" }, { key: "traffic", label: "Est. traffic / mo", type: "int" }, { key: "keywords", label: "Keywords", type: "int" }, { key: "top_page", label: "Top page", type: "url" }, { key: "top_traffic", label: "Top page traffic", type: "int" },
                  ...TYPES.map((t) => ({ key: t.key, label: t.label, type: "int" as const }))]}
                note="Up to 100 pages per site, ordered by estimated traffic (DataForSEO Labs). Page types are read from the address, so they are a guide, not an exact count." />
            </div>
          ) : <p className={dashed}>Collected with the next weekly run.</p> },
        ]} />
      </section>

      <div className="mt-8 space-y-6">
        <section aria-label="Keyword analysis">
          <h2 className="mb-3 text-base font-semibold">Keyword analysis</h2>
          <div className="mb-3 space-y-1">
            <KeywordGapForm canEdit={canEdit} suggestions={[...new Set([...comp.tracked, ...(comp.auto?.data ?? []).map((a) => a.domain.toLowerCase())])]} />
            <p className="text-xs text-muted">Content gap against any site you type: keywords it ranks top-20 for that you don&apos;t rank for. About 3 cents, stored for 7 days, counted in the daily spend limit. Results appear as their own tab below.</p>
          </div>
          {gapsBy.length === 0 && sharedBy.length === 0 && onDemand.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border p-6 text-sm text-muted">Keyword gaps and head-to-head rankings are refreshed weekly. They appear after the next analysis completes.</div>
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

          <Tabs label="Competitor research" items={[
            { key: "matrix", label: "Rankings matrix", badge: matrix.length, content: matrix.length ? (
              <ResearchTable title="Where you and each competitor rank for your tracked keywords" rows={matrix} searchKeys={["keyword", "leader"]} csvName={`ranking-matrix-${target.domain}`} initialSort={{ key: "volume", dir: "desc" }}
                columns={[
                  { key: "keyword", label: "Keyword" }, { key: "device", label: "Device", type: "badge" }, { key: "volume", label: "Volume", type: "int" }, { key: "you", label: "You", type: "int" },
                  ...rivalsList.map((d, i) => ({ key: `c${i}`, label: d, type: "int" as const })), { key: "leader", label: "Ranks #1" },
                ]} note="Empty = not in the top 10 (you: top 30)." />
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Track keywords on the Rank Tracking tab to compare positions here.</p> },
            { key: "pages", label: "Their top pages", badge: compPages.length, content: compPages.length ? (
              <ResearchTable title="The pages competitors win with" rows={compPages} searchKeys={["page", "competitor"]} facets={[{ key: "competitor", label: "Competitor" }]} initialSort={{ key: "traffic", dir: "desc" }} csvName={`competitor-pages-${target.domain}`}
                columns={[{ key: "competitor", label: "Competitor" }, { key: "page", label: "Page", type: "url" }, { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "keywords", label: "Keywords", type: "int" }, { key: "top3", label: "In top 3", type: "int" }, { key: "value", label: "Traffic value", type: "usd" }]}
 />
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Collected with the next weekly competitor analysis.</p> },
            { key: "links", label: "Link authority", badge: authority.length, content: authority.length > 1 ? (
              <div className="space-y-4">
                <ResearchTable title="Backlink profiles" rows={authority} initialSort={{ key: "referring_domains", dir: "desc" }}
                  columns={[{ key: "site", label: "Site" }, { key: "rank", label: "Domain rank", type: "int" }, { key: "referring_domains", label: "Referring domains", type: "int" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "spam", label: "Spam", type: "spam" }]} />
                <BarList title="Referring domains" valueLabel="Domains" items={authority.map((a) => ({ label: String(a.site), value: Number(a.referring_domains ?? 0) }))} />
              </div>
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Collected with the next weekly competitor analysis.</p> },
            { key: "serp", label: "Map pack & ads", content: packCount.size || adCount.size ? (
              <div className="grid gap-4 md:grid-cols-2">
                <BarList title="Who appears in the Google map pack" valueLabel="Keywords" items={packList} emptyText="No map pack on your tracked keywords." />
                <div className="grid content-start gap-4">
                  <BarList title="Who buys Google ads on your keywords" valueLabel="Keywords" items={adList} emptyText="No ads seen on your tracked keywords." />
                  {citeList.length > 0 && <BarList title="Who Google's AI Overview cites" valueLabel="Keywords" items={citeList} />}
                </div>
              </div>
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Appears after the next Rank Tracking check.</p> },
            { key: "ai", label: "AI answers", badge: aiRows.length, content: aiRows.length ? (
              <ResearchTable title="Who the AI assistants name" rows={aiRows} initialSort={{ key: "mentions", dir: "desc" }} csvName={`ai-share-of-voice-${target.domain}`}
                columns={[{ key: "brand", label: "Brand" }, ...usedEngines.map((e) => ({ key: e, label: ENGINES[e].label, type: "int" as const })), { key: "mentions", label: "Mentions", type: "int" }, { key: "detection", label: "Share of answers %", type: "int" }, { key: "position", label: "Avg position", type: "dec" }, { key: "sentiment", label: "Sentiment", type: "int" }, { key: "citations", label: "Citations", type: "int" }]}
 />
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Add questions on the AI Visibility tab to see who the assistants recommend.</p> },
            { key: "gbp", label: "Google profiles", badge: gbpRows.length, content: gbpRows.length > 1 ? (
              <ResearchTable title="Business Profile comparison" rows={gbpRows} initialSort={{ key: "reviews", dir: "desc" }}
                columns={[{ key: "business", label: "Business" }, { key: "rating", label: "Rating", type: "dec" }, { key: "reviews", label: "Reviews", type: "int" }, { key: "last90", label: "Reviews · 90 days", type: "int" }, { key: "reply", label: "Reply rate %", type: "int" }]}
 />
            ) : <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Compare nearby businesses on the <Link href="/local-seo" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Local SEO &amp; Reviews</Link> tab.</p> },
          ]} />
        </section>

        <section className="rounded-[10px] border border-border bg-surface p-4" aria-label="AI competitor recommendations">
          <h2 className="mb-1 text-sm font-semibold">AI recommendations from this data <span className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">ai interpretation</span></h2>
          <p className="mb-3 text-xs text-muted">Written by AI from the competitor data above. They are hypotheses to test, never guaranteed outcomes.</p>
          {(aiRecs ?? []).length === 0 ? (
            <p className="text-sm text-muted">No competitor-specific recommendations yet. They are added to the next AI analysis, which refreshes weekly for active clients once new data is available. <Link href="/insights" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Open AI Insights</Link></p>
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
          <section className="rounded-[10px] border border-border bg-surface p-4" aria-label="Discovered competitors">
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

        <details className="rounded-[10px] border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Manage competitors <span className="ml-2 text-accent">{canEdit ? "Edit" : "View"}</span></summary>
          <div className="mt-3">
            <CompetitorManager canEdit={canEdit} mode={target.competitor_mode} manual={target.competitors} excluded={target.competitors_excluded}
              suggestions={(comp.auto?.data ?? []).map((a) => a.domain.toLowerCase())} />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          {reanalyze}
          <p>Google Maps competitors, reviews and map rankings are on the <Link href="/local-seo" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Local SEO &amp; Reviews</Link> tab.</p>
        </div>
      </div>
    </>
  );
}
