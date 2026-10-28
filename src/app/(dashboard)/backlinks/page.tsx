import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import type { TrendPoint } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SpendLine, SpikeAlert, TargetSettings } from "@/components/research/chrome";
import { LinkGapForm, RefreshControls } from "@/components/research/controls";
import { ResearchTable, type Col } from "@/components/research/research-table";
import { Tabs } from "@/components/research/tabs";
import { fmtInt } from "@/lib/analytics/format";
import { detectLinkSpike, estimate, TIER1, TIER2 } from "@/lib/dataforseo/research";
import { pointAgo, profileSeries, researchPage } from "@/lib/dataforseo/view";

type Row = Record<string, unknown>;
type Named = { name: string; count: number };
type Summary = {
  rank: number | null; backlinks: number | null; referring_domains: number | null; referring_pages: number | null; referring_main_domains: number | null;
  spam_score: number | null; broken_backlinks: number | null; nofollow: number | null; dofollow: number | null; first_seen: string | null;
  tld: Named[]; types: Named[]; platforms: Named[]; countries: Named[]; attributes: Named[]; semantic: Named[]; referring_ips: number | null; crawled_pages: number | null;
};
type Month = { date: string | null; new_backlinks: number; lost_backlinks: number; new_domains: number; lost_domains: number };
type List = { total: number; rows: Row[] };

const BACKLINK_COLS: Col[] = [
  { key: "from", label: "Linking page", type: "url" }, { key: "anchor", label: "Anchor" }, { key: "to", label: "Links to", type: "url" },
  { key: "dofollow", label: "Follow", type: "bool", hint: "Yes = dofollow (passes ranking value)" }, { key: "rank", label: "Link rank", type: "int", hint: "DataForSEO rank of the link (0-1000)" },
  { key: "domain_rank", label: "Domain rank", type: "int" }, { key: "spam", label: "Spam", type: "spam", hint: "Backlink spam score, 0-100" }, { key: "first_seen", label: "First seen", type: "date" },
];
const REF_COLS: Col[] = [
  { key: "domain", label: "Domain" }, { key: "rank", label: "Rank", type: "int" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "pages", label: "Linking pages", type: "int" },
  { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" }, { key: "lost", label: "Lost", type: "date" },
];
const SPAM_PRESET = { label: "High spam (≥ 50)", where: [{ key: "spam", op: "gte" as const, value: 50 }] };

function Bars({ title, items, total }: { title: string; items: Named[] | undefined; total: number | null }) {
  return <BarList title={title} valueLabel="Backlinks" items={(items ?? []).map((x) => ({ label: x.name, value: x.count, detail: total ? `${((x.count / total) * 100).toFixed(0)}%` : undefined }))} emptyText="Not reported." />;
}

export default async function BacklinksPage() {
  const page = await researchPage();
  if (!page) return null;
  const { canEdit, configured, cache, budget } = page;
  const header = <PageHeader title="Backlinks" description="Who links to the website: authority, referring domains, new and lost links, anchors and link opportunities. Data from DataForSEO." />;

  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  if (!cache.target) {
    return <>{header}<EmptyState title="No website to analyse yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  const { target } = cache;
  const summary = cache.get<Summary>("summary");
  const newLost = cache.get<Month[]>("new_lost");
  const history = cache.get<Row[]>("history");
  const deepAt = cache.get("backlinks")?.fetchedAt ?? null;
  const coreAt = summary?.fetchedAt ?? null;
  const controls = (
    <RefreshControls canEdit={canEdit} coreAt={coreAt} deepAt={deepAt} estCore={estimate(TIER1.filter((k) => k !== "history"))} estDeep={estimate(TIER2)} />
  );
  const chrome = (
    <div className="mb-5 space-y-3">
      <TargetSettings canEdit={canEdit} target={target} />
      <SpendLine budget={budget} />
    </div>
  );

  if (!summary) {
    return (
      <>
        {header}{chrome}
        <EmptyState title={`No backlink data for ${target.domain} yet`} body="Nothing is fetched automatically when you open this page. The first analysis costs about 10 cents and is stored; after that it refreshes weekly in the background." />
        <div className="mt-4">{controls}</div>
      </>
    );
  }

  const s = summary.data;
  const series = profileSeries(history?.data, cache.snapshots);
  const month = pointAgo(series, 28);
  const spike = detectLinkSpike(newLost?.data ?? []);
  const pts = (key: "backlinks" | "referring_domains" | "rank"): TrendPoint[] => series.filter((p) => p[key] != null).map((p) => ({ date: p.date, value: p[key] }));
  const nl = (newLost?.data ?? []).filter((m) => m.date);
  const nlPts = (key: keyof Omit<Month, "date">): TrendPoint[] => nl.map((m) => ({ date: m.date!, value: m[key] }));

  const lists = {
    backlinks: cache.get<List>("backlinks"), new: cache.get<List>("new_backlinks"), lost: cache.get<List>("lost_backlinks"),
    domains: cache.get<List>("referring_domains"), anchors: cache.get<List>("anchors"), pages: cache.get<List>("domain_pages"),
  };
  const deep = Boolean(lists.backlinks);
  const dofollowShare = s.backlinks ? ((s.dofollow ?? 0) / s.backlinks) * 100 : null;

  return (
    <>
      {header}{chrome}
      {spike && <div className="mb-5"><SpikeAlert spike={spike} /></div>}

      <section aria-label="Backlink profile" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Domain rank" source="DFS" format={fmtInt} value={s.rank} previous={month?.rank ?? null} hint="DataForSEO domain rank, 0-1000. Higher means a stronger link profile." />
        <KpiCard label="Backlinks" source="DFS" format={fmtInt} value={s.backlinks} previous={month?.backlinks ?? null} />
        <KpiCard label="Referring domains" source="DFS" format={fmtInt} value={s.referring_domains} previous={month?.referring_domains ?? null} />
        <KpiCard label="Referring pages" source="DFS" format={fmtInt} value={s.referring_pages} previous={null} />
        <KpiCard label="Spam score" source="DFS" format={fmtInt} value={s.spam_score} previous={month?.spam ?? null} higherIsBetter={false} hint="0-100 estimate of how spammy the backlink profile looks. Lower is better; above 50 deserves a review." />
      </section>
      <p className="mt-2 text-xs text-muted">
        Overview data updated {coreAt?.slice(0, 10)} · {dofollowShare != null ? `${dofollowShare.toFixed(0)}% dofollow · ` : ""}{fmtInt(s.broken_backlinks)} broken backlinks · first seen {s.first_seen ?? "—"} · comparison is vs about a month ago when history exists.
      </p>
      <div className="mt-3">{controls}</div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Link profile over time" source="DFS" options={[
          { key: "backlinks", label: "Backlinks", data: pts("backlinks") },
          { key: "referring_domains", label: "Referring domains", data: pts("referring_domains") },
          { key: "rank", label: "Domain rank", data: pts("rank") },
        ]} />
        <MetricTrend title="New and lost links by month" source="DFS" options={[
          { key: "new_backlinks", label: "New backlinks", data: nlPts("new_backlinks") },
          { key: "lost_backlinks", label: "Lost backlinks", data: nlPts("lost_backlinks") },
          { key: "new_domains", label: "New domains", data: nlPts("new_domains") },
          { key: "lost_domains", label: "Lost domains", data: nlPts("lost_domains") },
        ]} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Bars title="Link attributes" items={s.attributes} total={s.backlinks} />
        <Bars title="Link types" items={s.types} total={s.backlinks} />
        <Bars title="Top domain extensions" items={s.tld} total={s.backlinks} />
        <Bars title="Top countries" items={s.countries} total={s.backlinks} />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Link details</h2>
        {!deep ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm">
            <p className="font-medium">The detailed lists haven&apos;t been loaded.</p>
            <p className="mt-1 text-muted">The deep dive fetches the backlink list (top 1,000 by rank), new and lost links, referring domains, anchors, linked pages and organic competitors in one go, then stores them for 14 days.</p>
          </div>
        ) : (
          <Tabs label="Backlink lists" items={[
            { key: "backlinks", label: "Backlinks", badge: fmtInt(lists.backlinks!.data.total), content: (
              <ResearchTable title="Backlinks (top 1,000 by rank)" rows={lists.backlinks!.data.rows} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "to", "domain"]}
                presets={[{ label: "Dofollow", where: [{ key: "dofollow", op: "true" }] }, SPAM_PRESET, { label: "Strong (link rank ≥ 100)", where: [{ key: "rank", op: "gte", value: 100 }] }]}
                initialSort={{ key: "rank", dir: "desc" }} note={`Showing ${lists.backlinks!.data.rows.length} of ${fmtInt(lists.backlinks!.data.total)} backlinks in total.`} />) },
            { key: "new", label: "New links", badge: fmtInt(lists.new?.data.total ?? 0), content: (
              <ResearchTable title="New backlinks" rows={lists.new?.data.rows ?? []} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "domain"]} presets={[SPAM_PRESET]}
                initialSort={{ key: "first_seen", dir: "desc" }} empty="No new backlinks were found." note={`Top ${lists.new?.data.rows.length ?? 0} of ${fmtInt(lists.new?.data.total ?? 0)} new backlinks, by link rank.`} />) },
            { key: "lost", label: "Lost links", badge: fmtInt(lists.lost?.data.total ?? 0), content: (
              <ResearchTable title="Lost backlinks" rows={lists.lost?.data.rows ?? []} columns={BACKLINK_COLS} searchKeys={["from", "anchor", "domain"]}
                initialSort={{ key: "rank", dir: "desc" }} empty="No lost backlinks were found." />) },
            { key: "domains", label: "Referring domains", badge: fmtInt(lists.domains?.data.total ?? 0), content: (
              <ResearchTable title="Referring domains (top 1,000 by rank)" rows={lists.domains?.data.rows ?? []} columns={REF_COLS} searchKeys={["domain"]}
                presets={[SPAM_PRESET, { label: "Strong (rank ≥ 50)", where: [{ key: "rank", op: "gte", value: 50 }] }, { label: "Multiple links (≥ 3)", where: [{ key: "backlinks", op: "gte", value: 3 }] }]}
                initialSort={{ key: "rank", dir: "desc" }} />) },
            { key: "anchors", label: "Anchors", badge: fmtInt(lists.anchors?.data.total ?? 0), content: (
              <ResearchTable title="Anchor texts" rows={lists.anchors?.data.rows ?? []} columns={[
                { key: "anchor", label: "Anchor text" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "domains", label: "Domains", type: "int" },
                { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" },
              ]} searchKeys={["anchor"]} presets={[SPAM_PRESET]} initialSort={{ key: "backlinks", dir: "desc" }}
                note="An anchor with thousands of backlinks and a high spam score usually points to a spam campaign." />) },
            { key: "pages", label: "Linked pages", badge: fmtInt(lists.pages?.data.total ?? 0), content: (
              <ResearchTable title="Pages receiving links" rows={lists.pages?.data.rows ?? []} columns={[
                { key: "page", label: "Page", type: "url" }, { key: "backlinks", label: "Backlinks", type: "int" }, { key: "domains", label: "Domains", type: "int" },
                { key: "rank", label: "Rank", type: "int" }, { key: "status", label: "HTTP status", type: "int" },
              ]} searchKeys={["page"]} presets={[{ label: "Broken (4xx/5xx)", where: [{ key: "status", op: "gte", value: 400 }] }]} initialSort={{ key: "backlinks", dir: "desc" }}
                note="Pages with an error status that still receive links are quick wins: redirect them to a working page." />) },
          ]} />
        )}
      </div>

      <div className="mt-8 space-y-3">
        <h2 className="text-base font-semibold">Link gap</h2>
        <p className="text-sm text-muted">Sites that link to a competitor but not to {target.domain}: the best outreach targets. Each competitor costs about 4 cents once and is stored for 14 days.</p>
        <LinkGapForm canEdit={canEdit} competitors={target.competitors} />
        {cache.gaps.length === 0 ? <p className="text-sm text-muted">No link gap run yet.</p> : (
          <Tabs label="Link gap by competitor" items={cache.gaps.map((g) => ({
            key: g.competitor, label: g.competitor, badge: fmtInt(g.data.total),
            content: <ResearchTable title={`Domains linking to ${g.competitor} but not ${target.domain}`} rows={g.data.rows} columns={[
              { key: "domain", label: "Domain" }, { key: "rank", label: "Rank", type: "int" }, { key: "backlinks", label: "Links to competitor", type: "int" },
              { key: "pages", label: "Linking pages", type: "int" }, { key: "spam", label: "Spam", type: "spam" }, { key: "first_seen", label: "First seen", type: "date" },
            ]} searchKeys={["domain"]} presets={[{ label: "Skip spam (≤ 30)", where: [{ key: "spam", op: "lte", value: 30 }] }]} initialSort={{ key: "rank", dir: "desc" }} />,
          }))} />
        )}
      </div>
    </>
  );
}
