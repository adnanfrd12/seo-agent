import { BarList, CompareBars, Donut, Scatter } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { ctrChanges, noClicks, noImpressions, pageTable } from "@/lib/gscx/analysis";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/watchlists";
const CATS = ["Not indexed", "Indexed but no demand", "Duplicate/canonicalised", "Excluded on purpose (noindex/robots)", "Redirect or 404", "Not inspected yet"];

export default async function WatchlistsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Page watchlists" description="Pages never clicked, never shown, or with a changing click rate.">
      {({ g, wins }) => {
        const pages = pageTable(g);
        const nc = noClicks(g, pages), ni = noImpressions(g, pages), ch = ctrChanges(g, pages);
        const up = ch.filter((x) => x.dCtr > 0).sort((a, b) => b.gained - a.gained), down = ch.filter((x) => x.dCtr < 0).sort((a, b) => a.gained - b.gained);
        const wasted = nc.reduce((a, p) => a + p.impressions, 0);
        const site = siteOf(g);
        return (
          <>
            <Kpis>
              <Kpi label="Pages never clicked" tech="Pages with no clicks" value={fmt("int", nc.length)} note={`${fmt("int", wasted)} impressions wasted`} />
              <Kpi label="Pages never shown" tech="Pages with no impressions" value={fmt("int", ni.length)} note={`in the last ${g.p.days} days`} missing={g.inv.length ? undefined : "0: the URL inventory (sitemaps + crawl) is still being built on the first sync."} />
              <Kpi label="Pages clicked more often" tech="Pages with CTR up" value={fmt("int", up.length)} note={`vs previous ${g.p.days} days`} />
              <Kpi label="Pages clicked less often" tech="Pages with CTR down" value={fmt("int", down.length)} note={`vs previous ${g.p.days} days`} />
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="Shown on Google, never clicked" tech="Impressions without a click" span={4}>
                <BarList rows={nc.slice(0, 8).map((p) => ({ label: pathOf(p.page), value: p.impressions, color: C[7] }))} empty="Every page shown on Google got at least one click." />
              </Card>
              <Card title="Why these pages never show on Google" tech="Why they get no impressions" span={4}>
                <Donut parts={CATS.map((c, i) => ({ label: c, value: ni.filter((x) => x.cat === c).length, color: [C[7], C[3], C[6], C[5], C[1], "var(--cat-other)"][i] })).filter((x) => x.value)} />
              </Card>
              <Card title="Click rate: before vs now" tech="CTR before vs now" sub="Points above the diagonal improved. Bubble = impressions." span={4}>
                <Scatter points={ch.slice(0, 50).map((p) => ({ x: p.ctrPrev, y: p.ctr, s: p.impressions, label: pathOf(p.page), show: Math.abs(p.gained) >= 3, c: p.dCtr >= 0 ? C[2] : C[7] }))} xLabel="CTR before" yLabel="CTR now" xf="pct" diag />
              </Card>
              <Card title="Click rate change by page" tech="CTR change by page">
                <CompareBars f="pct" rows={[...up.slice(0, 4), ...down.slice(0, 4)].map((p) => ({ label: pathOf(p.page), cur: p.ctr, prev: p.ctrPrev }))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Pages people see on Google but never click" tech="Pages and posts with no clicks" sub={`Last ${g.p.days} days.`}>
                <Table site={site} facets={[{ k: "reason", label: "Likely reason" }]} rows={nc.map((p) => ({ page: pathOf(p.page), impressions: p.impressions, pos: p.pos, top: p.topQuery ?? "–", reason: p.reason, todo: p.todo }))}
                  cols={[{ k: "page", label: "Page", kind: "page" }, { k: "impressions", label: "Impr.", num: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "top", label: "Top query", wrap: true }, { k: "reason", label: "Likely reason", wrap: true }, { k: "todo", label: "What to do", wrap: true }]} empty="No page with impressions and zero clicks." />
              </Card>
              <Card title="Pages Google never shows" tech="Pages and posts with no impressions" info="From the URL inventory (sitemaps, crawl, Search Console), joined with inspections.">
                <Table site={site} facets={[{ k: "cat", label: "Category" }, { k: "status", label: "Index status" }]} rows={ni.map((p) => ({ page: pathOf(p.url), status: p.status, links: p.linksIn, cat: p.cat, reason: p.reason, todo: p.todo }))}
                  cols={[{ k: "page", label: "Page", kind: "page" }, { k: "status", label: "Index status", wrap: true }, { k: "links", label: "Internal links in", num: true }, { k: "reason", label: "Likely reason", wrap: true }, { k: "todo", label: "What to do", wrap: true }]} empty="Every known page was shown on Google in this period." />
              </Card>
              <Card title="Pages getting clicked more often" tech="Pages and posts with CTR increased" sub="Pages with 100+ impressions in both periods.">
                <Table site={site} rows={up.map((p) => ({ page: pathOf(p.page), before: p.ctrPrev, now: p.ctr, chg: `+${(p.dCtr * 100).toFixed(1)} pp`, extra: p.gained, dpos: p.dPos, reason: p.reason }))}
                  cols={[{ k: "page", label: "Page", kind: "page" }, { k: "before", label: "CTR before", num: true, f: "pct" }, { k: "now", label: "CTR now", num: true, f: "pct" }, { k: "chg", label: "Change" }, { k: "extra", label: "Extra clicks", num: true, f: "dec1" }, { k: "dpos", label: "Δ pos", num: true, f: "dec1" }, { k: "reason", label: "Likely reason", wrap: true }]} empty="No page with 100+ impressions in both periods improved its CTR." />
              </Card>
              <Card title="Pages getting clicked less often" tech="Pages and posts with CTR decreased" info="Clicks lost = impressions × (old CTR − new CTR).">
                <Table site={site} rows={down.map((p) => ({ page: pathOf(p.page), before: p.ctrPrev, now: p.ctr, chg: `${(p.dCtr * 100).toFixed(1)} pp`, lost: -p.gained, dpos: p.dPos, reason: p.reason }))}
                  cols={[{ k: "page", label: "Page", kind: "page" }, { k: "before", label: "CTR before", num: true, f: "pct" }, { k: "now", label: "CTR now", num: true, f: "pct" }, { k: "chg", label: "Change" }, { k: "lost", label: "Clicks lost", num: true, f: "dec1" }, { k: "dpos", label: "Δ pos", num: true, f: "dec1" }, { k: "reason", label: "Likely reason", wrap: true }]} empty="No page with 100+ impressions in both periods lost CTR." />
              </Card>
            </Grid>
            <Tasks screen="Page watchlists" id="watch" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
