import { BarList, CompareBars, Scatter, Stack100, WhatChanged } from "@/components/ga4x/charts";
import { C, deviceColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { dropCause, noImpressions, pageTable } from "@/lib/gscx/analysis";
import { m } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/pages";

export default async function GscPagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Pages" description="Which pages get Google traffic, which are growing or declining and why, and pages Google never shows.">
      {({ g, wins }) => {
        const pages = pageTable(g), tot = pages.reduce((a, p) => a + p.clicks, 0), cur = g.totals(), prev = g.totals(true);
        const sorted = [...pages].sort((a, b) => b.clicks - a.clicks);
        const conc = [1, 3, 5, 10].map((n) => ({ label: `Top ${n} page${n > 1 ? "s" : ""}`, value: tot ? sorted.slice(0, n).reduce((a, p) => a + p.clicks, 0) / tot : 0 }));
        const top6 = [...pages].sort((a, b) => Math.abs(b.dClicks) - Math.abs(a.dClicks)).slice(0, 6);
        const growing = pages.filter((p) => p.dClicks > 0).sort((a, b) => b.dClicks - a.dClicks);
        const prevPages = g.pages(true);
        const declining = [...pages.filter((p) => p.dClicks < 0), ...[...prevPages].filter(([p, v]) => v.clicks > 0 && !pages.some((x) => x.page === p)).map(([p, v]) => ({ page: p, clicks: 0, impressions: 0, ctr: 0, pos: 0, prev: v, dClicks: -v.clicks, queries: 0, topQuery: null, topQueryImpr: 0 }))].sort((a, b) => a.dClicks - b.dClicks);
        const devs = ["MOBILE", "DESKTOP", "TABLET"];
        const devMix = sorted.slice(0, 8).map((p) => ({ label: pathOf(p.page), parts: devs.map((d) => m(g.pd().filter((x) => x.page === p.page && x.device === d)).clicks) }));
        const zero = noImpressions(g, pages).filter((x) => x.cat === "Indexed but no demand");
        const days = (iso: string | null) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 86_400_000) : null);
        const row = (p: (typeof pages)[number]) => ({ page: pathOf(p.page), clicks: p.clicks, d: p.dClicks, impressions: p.impressions, ctr: p.ctr, pos: p.pos, queries: p.queries });
        const cols = [{ k: "page", label: "Page", kind: "page" as const }, { k: "clicks", label: "Clicks", num: true }, { k: "d", label: "Δ clicks", num: true }, { k: "impressions", label: "Impressions", num: true }, { k: "ctr", label: "CTR", num: true, f: "pct" as const }, { k: "pos", label: "Position", num: true, f: "dec1" as const }, { k: "queries", label: "Queries", num: true }];
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="How much traffic depends on a few pages" tech="Click concentration" sub="Share of clicks from the top pages." span={6}>
                <BarList rows={conc.map((r) => ({ label: r.label, value: r.value, color: C[0] }))} f="pct" max={1} />
              </Card>
              <Card title="Which pages caused the change in clicks" tech="Click change by page" sub={`Waterfall from the previous ${g.p.days} days.`} span={6}>
                <WhatChanged id="gsc-pages-wf" unit="clicks" start={prev.clicks} items={[...top6.map((p) => ({ label: pathOf(p.page), value: p.dClicks })), { label: "All other pages", value: (cur.clicks - prev.clicks) - top6.reduce((a, p) => a + p.dClicks, 0) }]} />
              </Card>
              <Card title="Pages: times shown vs click rate" tech="Impressions vs CTR by page" sub="Bubble = clicks. Right and low means many impressions but a weak snippet." span={7}>
                <Scatter points={pages.filter((p) => p.impressions >= 10).slice(0, 60).map((p) => ({ x: p.impressions, y: p.ctr, s: Math.max(1, p.clicks), label: pathOf(p.page), show: p.clicks >= (sorted[2]?.clicks ?? 0) && p.clicks > 0, c: p.dClicks >= 0 ? C[2] : C[7] }))} xLabel="Impressions (log scale)" yLabel="CTR" logX />
              </Card>
              <Card title="Top pages: this month vs last" tech="Top pages: this period vs last" span={5}>
                <CompareBars rows={sorted.slice(0, 8).map((p) => ({ label: pathOf(p.page), cur: p.clicks, prev: p.prev?.clicks ?? 0 }))} />
              </Card>
              <Card title="Phone vs computer, by page" tech="Device mix per page" sub="Clicks by device ([page, device] dimension set). Search Console returns fewer rows when page and device are combined, so these shares come from part of each page's clicks.">
                <Stack100 rows={devMix} names={["Mobile", "Desktop", "Tablet"]} colors={devs.map((d, i) => deviceColor(d, i))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Pages getting more visits from Google" tech="Growing pages" sub="Ranked by click gain." span={6}>
                <Table site={siteOf(g)} limit={10} rows={growing.map(row)} cols={cols} empty="No page gained clicks in this period." />
              </Card>
              <Card title="Pages losing visits from Google" tech="Declining pages" sub="With the main cause of the drop." span={6}>
                <Table site={siteOf(g)} limit={10} rows={declining.map((p) => ({ page: pathOf(p.page), clicks: p.clicks, d: p.dClicks, cause: p.impressions ? dropCause(p) : "No longer shown on Google" }))} cols={[{ k: "page", label: "Page", kind: "page" }, { k: "clicks", label: "Clicks", num: true }, { k: "d", label: "Δ clicks", num: true }, { k: "cause", label: "Main cause", wrap: true }]} empty="No page lost clicks in this period." />
              </Card>
              <Card title="Every page and how it does on Google" tech="All pages" sub="Clicks, impressions, CTR, position and query count per page.">
                <Table site={siteOf(g)} limit={25} rows={sorted.map(row)} cols={cols} />
              </Card>
              <Card title="Pages Google knows about but never shows" tech="Indexed pages with zero impressions" sub={`Indexed in Google but never shown in results in ${g.p.days} days.`} span={6}>
                <Table site={siteOf(g)} rows={zero.map((z) => ({ url: pathOf(z.url), cs: "Submitted and indexed", last: days(z.lastCrawl) }))} cols={[{ k: "url", label: "URL", kind: "page" }, { k: "cs", label: "Coverage state" }, { k: "last", label: "Last crawl (days)", num: true }]}
                  empty={Object.keys(g.insp).length ? "Every indexed page was shown at least once." : "0: URL inspections are still running for this site; this list fills in as they finish."} />
              </Card>
            </Grid>
            <Tasks screen="Pages" id="pages" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
