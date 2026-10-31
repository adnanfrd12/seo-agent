import { Donut } from "@/components/charts/ai-charts";
import { BarList } from "@/components/charts/bar-list";
import { FillColumns, GainLoss, Scatter } from "@/components/charts/research-charts";
import { MetricTrend } from "@/components/charts/metric-trend";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine, TargetSettings } from "@/components/research/chrome";
import { RefreshControls } from "@/components/research/controls";
import { ResearchTable } from "@/components/research/research-table";
import { fmtInt } from "@/lib/analytics/format";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { marketLabel } from "@/lib/dataforseo/locations";
import { cat } from "@/lib/charts/colors";
import { estimate, TIER1, TIER2 } from "@/lib/dataforseo/research";
import { researchPage } from "@/lib/dataforseo/view";

type Row = Record<string, unknown>;
type Overview = { keywords: number; traffic: number; traffic_value: number; new: number; up: number; down: number; lost: number; buckets: { name: string; count: number }[]; paid_keywords: number };

const BUCKET_LABEL: Record<string, string> = {
  pos_1: "Position 1", pos_2_3: "Positions 2–3", pos_4_10: "Positions 4–10", pos_11_20: "Positions 11–20", pos_21_30: "Positions 21–30", pos_31_40: "Positions 31–40",
  pos_41_50: "Positions 41–50", pos_51_60: "Positions 51–60", pos_61_70: "Positions 61–70", pos_71_80: "Positions 71–80", pos_81_90: "Positions 81–90", pos_91_100: "Positions 91–100",
};
const BUCKET_SHORT: Record<string, string> = {
  pos_1: "1", pos_2_3: "2–3", pos_4_10: "4–10", pos_11_20: "11–20", pos_21_30: "21–30", pos_31_40: "31–40",
  pos_41_50: "41–50", pos_51_60: "51–60", pos_61_70: "61–70", pos_71_80: "71–80", pos_81_90: "81–90", pos_91_100: "91–100",
};
// fixed slot per intent so the colours never shift between clients or refreshes
const INTENTS = ["informational", "navigational", "commercial", "transactional"];
const usd0 = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export default async function OrganicKeywordsPage() {
  const page = await researchPage();
  if (!page) return null;
  const { canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Organic Keywords" description="Google keywords the website ranks for in the top 100: positions, search volume, estimated traffic and movement. Data from DataForSEO." guide={[
          { term: "Position", text: "Where the page appears in Google for that keyword (1 = top). Page one is positions 1-10." },
          { term: "Volume", text: "Estimated monthly searches for the keyword." },
          { term: "Est. traffic", text: "Modelled visits from the ranking (volume × position). An estimate, not measured visits." },
          { term: "Difficulty", text: "0-100: how hard it is to reach the top 10. Lower is easier." },
          { term: "Intent", text: "What the searcher wants: information, a comparison, or to buy. Match the page to the intent." },
          { term: "Quick wins", text: "Keywords on page two (positions 11-20) with real search demand: the cheapest traffic gains." },
        ]} />;
  if (!configured) return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website to analyse yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const { target } = cache;
  const overview = cache.get<Overview>("rank_overview");
  const ranked = cache.get<Row[]>("ranked_keywords");
  const competitors = cache.get<Row[]>("competitors");
  const relevant = cache.get<Row[]>("relevant_pages");
  const links = cache.get<{ backlinks: number | null; referring_domains: number | null; rank: number | null }>("summary");
  const coreAt = overview?.fetchedAt ?? null;
  const controls = <RefreshControls canEdit={canEdit} coreAt={coreAt} deepAt={cache.get("backlinks")?.fetchedAt ?? null} estCore={estimate(TIER1.filter((k) => k !== "history"))} estDeep={estimate(TIER2)} />;
  const chrome = <div className="mb-5 space-y-3"><TargetSettings canEdit={canEdit} target={target} /><SpendLine budget={budget} /></div>;

  if (!overview || !ranked) {
    return (
      <>
        {header}{chrome}
        <EmptyState title={`No keyword data for ${target.domain} yet`} body="Nothing is fetched automatically when you open this page. The first analysis costs about 10 cents and is stored; after that it refreshes weekly in the background." />
        <div className="mt-4">{controls}</div>
      </>
    );
  }

  const o = overview.data;
  const rows = ranked.data;
  const snaps = cache.snapshots;
  const monthAgo = shiftDays(todayIn("UTC"), -28);
  const prev = [...snaps].reverse().find((s) => String(s.snapshot_date) <= monthAgo);
  const top10 = o.buckets.filter((b) => ["pos_1", "pos_2_3", "pos_4_10"].includes(b.name)).reduce((a, b) => a + b.count, 0);
  const intent = new Map<string, number>();
  for (const r of rows) { const k = String(r.intent ?? "unknown"); intent.set(k, (intent.get(k) ?? 0) + 1); }
  const pages = new Map<string, { url: string; keywords: number; traffic: number; best: number; volume: number }>();
  for (const r of rows) {
    if (typeof r.url !== "string") continue;
    const p = pages.get(r.url) ?? { url: r.url, keywords: 0, traffic: 0, best: 999, volume: 0 };
    p.keywords++; p.traffic += Number(r.traffic) || 0; p.best = Math.min(p.best, Number(r.position) || 999); p.volume += Number(r.volume) || 0;
    pages.set(r.url, p);
  }
  const quickWins = rows.filter((r) => Number(r.position) >= 4 && Number(r.position) <= 20 && Number(r.volume) >= 100).length;
  const intentItems = [...intent].sort((a, b) => b[1] - a[1]).map(([label, value]) => {
    const slot = INTENTS.indexOf(label);
    return { label: `${label[0].toUpperCase()}${label.slice(1)} · ${fmtInt(value)}`, value, color: slot >= 0 ? cat(slot) : "var(--cat-other)" };
  });
  const pagePath = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; } };
  const topPages = [...pages.values()].sort((a, b) => b.traffic - a.traffic).slice(0, 8)
    .map((p) => ({ label: pagePath(p.url), value: Math.round(p.traffic), detail: `${p.keywords} kw` }));
  const dots = rows.filter((r) => Number(r.position) > 0 && Number(r.volume) > 0).map((r) => {
    const pos = Number(r.position), vol = Number(r.volume);
    return { label: String(r.keyword), x: pos, y: vol, highlight: pos >= 4 && pos <= 20 && vol >= 100, detail: r.difficulty != null ? `difficulty ${r.difficulty}` : undefined };
  });
  const trendPts = (key: string) => snaps.filter((s) => s[key] != null).map((s) => ({ date: String(s.snapshot_date), value: Number(s[key]) }));

  return (
    <>
      {header}{chrome}
      <section aria-label="Organic summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-4">
        <KpiCard label="Ranking keywords" source="DFS" format={fmtInt} value={o.keywords} previous={prev ? Number(prev.organic_keywords) : null} hint="Keywords where the site ranks in Google's top 100." />
        <KpiCard label="Est. monthly organic traffic" source="DFS" format={fmtInt} value={Math.round(o.traffic)} previous={prev ? Math.round(Number(prev.organic_traffic)) : null} hint="Estimated visits per month from these rankings, based on search volume and position. An estimate, not measured traffic." />
        <KpiCard label="Top-10 keywords" source="DFS" format={fmtInt} value={top10} previous={null} />
        <KpiCard label="Traffic value / month" source="DFS" format={usd0} value={o.traffic_value} previous={null} hint="What the same traffic would cost through Google Ads." />
      </section>
      {links && (
        <p className="mt-2 text-xs text-muted">Authority behind these rankings: {fmtInt(links.data.backlinks)} backlinks from {fmtInt(links.data.referring_domains)} referring domains · domain rank {fmtInt(links.data.rank)} (details on the Backlinks tab).</p>
      )}
      <p className="mt-2 text-xs text-muted">Market: {marketLabel(target.location_code)} · updated {coreAt?.slice(0, 10)} · {o.paid_keywords} paid keywords detected · {quickWins} quick wins (positions 4–20 with 100+ searches).</p>
      <div className="mt-3">{controls}</div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-[10px] border border-border bg-surface p-4" aria-label="Movement">
          <h2 className="text-sm font-semibold">Movement since the last update</h2>
          <dl className="grid grid-cols-2 gap-3 text-center">
            {[["New", o.new, "text-positive"], ["Improved", o.up, "text-positive"], ["Declined", o.down, "text-negative"], ["Lost", o.lost, "text-negative"]].map(([l, v, c]) => (
              <div key={String(l)} className="rounded-lg bg-surface-muted p-3"><dt className="text-xs font-medium text-muted">{l}</dt><dd className={`mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.02em] ${c}`}>{fmtInt(Number(v))}</dd></div>
            ))}
          </dl>
          <div className="mt-auto"><GainLoss gain={o.new + o.up} loss={o.down + o.lost} gainLabel="New + improved" lossLabel="Declined + lost" /></div>
        </section>
        <FillColumns title="Rankings by position" sub="Keywords per Google position band, 1 to 100" valueLabel="Keywords"
          bins={o.buckets.map((b) => ({ label: BUCKET_SHORT[b.name] ?? b.name, value: b.count, detail: BUCKET_LABEL[b.name], color: ["pos_1", "pos_2_3", "pos_4_10"].includes(b.name) ? "var(--series)" : "color-mix(in oklab, var(--series) 45%, var(--surface))" }))} />
        <Donut title="Search intent of ranking keywords" sub={`${fmtInt(rows.length)} keywords by what the searcher wants`} items={intentItems}
          center={intentItems[0] ? `${Math.round((intentItems[0].value / Math.max(1, rows.length)) * 100)}%` : "—"} centerLabel={intentItems[0]?.label.split(" · ")[0] ?? ""} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Scatter title="Where the opportunities are" sub="Each dot is a ranking keyword; highlighted dots are quick wins (positions 4–20, 100+ searches)" dots={dots}
          xLabel="Position" yLabel="Searches / mo" xMax={100} band={{ from: 4, to: 20, label: "Quick-win zone" }} legend={["Quick win", "Other keyword"]} />
        <BarList title="Pages with the most estimated traffic" valueLabel="Est. visits / mo" items={topPages} emptyText="No ranking pages yet." />
      </div>

      {snaps.length >= 2 && (
        <div className="mt-6">
          <MetricTrend title="Organic footprint over time" source="DFS" options={[
            { key: "kw", label: "Ranking keywords", data: trendPts("organic_keywords") },
            { key: "tr", label: "Est. traffic", data: trendPts("organic_traffic") },
          ]} />
        </div>
      )}
      {snaps.length < 2 && <p className="mt-6 text-xs text-muted">The trend chart appears after the second weekly update; each refresh adds one point without extra cost.</p>}

      <div className="mt-6 space-y-6">
        <ResearchTable title="Ranking keywords" rows={rows} searchKeys={["keyword", "url"]} initialSort={{ key: "traffic", dir: "desc" }} csvName={`organic-keywords-${target.domain}`}
          ranges={[{ key: "position", label: "Position" }, { key: "volume", label: "Volume / mo" }, { key: "difficulty", label: "Difficulty" }, { key: "traffic", label: "Est. traffic" }]} facets={[{ key: "intent", label: "Intent" }]}
          columns={[
            { key: "keyword", label: "Keyword" }, { key: "position", label: "Position", type: "int", hint: "Absolute Google position" },
            { key: "previous", label: "Change", type: "change", hint: "Movement since the previous update" }, { key: "volume", label: "Volume / mo", type: "int" },
            { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "difficulty", label: "Difficulty", type: "int" }, { key: "cpc", label: "CPC", type: "usd" },
            { key: "intent", label: "Intent", type: "badge" }, { key: "url", label: "Ranking page", type: "url" },
          ]}
          presets={[
            { label: "Top 3", where: [{ key: "position", op: "lte", value: 3 }] }, { label: "Top 10", where: [{ key: "position", op: "lte", value: 10 }] },
            { label: "Page 2 (11–20)", where: [{ key: "position", op: "gte", value: 11 }, { key: "position", op: "lte", value: 20 }] },
            { label: "Quick wins (4–20, 100+ searches)", where: [{ key: "position", op: "gte", value: 4 }, { key: "position", op: "lte", value: 20 }, { key: "volume", op: "gte", value: 100 }] },
            { label: "New", where: [{ key: "is_new", op: "true" }] }, { label: "Improved", where: [{ key: "is_up", op: "true" }] }, { label: "Declined", where: [{ key: "is_down", op: "true" }] },
          ]}
          note="Quick wins are keywords already close to page one with real search demand: improving the page's content, title and internal links is usually the cheapest traffic gain." />

        {relevant ? (
          <ResearchTable title="Top pages by organic traffic" rows={relevant.data} searchKeys={["page"]} initialSort={{ key: "traffic", dir: "desc" }} csvName={`top-pages-${target.domain}`}
            ranges={[{ key: "traffic", label: "Est. traffic" }, { key: "keywords", label: "Keywords" }]}
            columns={[
              { key: "page", label: "Page", type: "url" }, { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "keywords", label: "Keywords", type: "int" },
              { key: "top10", label: "Top 10", type: "int" }, { key: "value", label: "Value", type: "usd", hint: "What the same clicks would cost in Google Ads" },
              { key: "new", label: "New", type: "int" }, { key: "lost", label: "Lost", type: "int" },
            ]} />
        ) : (
          <ResearchTable title="Top pages by organic traffic" rows={[...pages.values()]} searchKeys={["url"]} initialSort={{ key: "traffic", dir: "desc" }}
            columns={[
              { key: "url", label: "Page", type: "url" }, { key: "keywords", label: "Keywords", type: "int" }, { key: "best", label: "Best position", type: "int" },
              { key: "traffic", label: "Est. traffic", type: "dec" }, { key: "volume", label: "Total volume", type: "int" },
            ]} note="Built from the ranking keywords above. The deep dive adds a per-page breakdown with positions and traffic value." />
        )}

        {competitors ? (
          <ResearchTable title="Organic competitors" rows={competitors.data} searchKeys={["domain"]} initialSort={{ key: "shared", dir: "desc" }}
            columns={[
              { key: "domain", label: "Domain" }, { key: "shared", label: "Shared keywords", type: "int" }, { key: "avg_position", label: "Avg position", type: "dec" },
              { key: "keywords", label: "Their keywords", type: "int" }, { key: "traffic", label: "Their est. traffic", type: "int" },
            ]} note="Sites that rank for the same keywords. Add the relevant ones as competitors in the settings above to run link gap analysis." />
        ) : (
          <div className="rounded-[10px] border border-dashed border-border p-5 text-sm text-muted">Organic competitors are part of the deep dive. Run it from the buttons above (about 25 cents, stored for 14 days).</div>
        )}
      </div>
    </>
  );
}
