import Link from "next/link";
import { BarList, Scatter, Treemap } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { QwDone, QwList } from "@/components/ga4x/qw-list";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { gscForScreen } from "@/lib/gscx/quickwins";
import { GscScreen } from "../_gscx/screen";

export const maxDuration = 120;
const PATH = "/search-console/quick-wins";
const SCREENS: [string, string, string][] = [
  ["overview", "Overview", "/search-console/overview"], ["queries", "Queries and regex", "/search-console/queries"], ["pages", "Pages", "/search-console/pages"], ["watch", "Page watchlists", "/search-console/watchlists"],
  ["segments", "Devices, countries, appearance", "/search-console/segments"], ["ai", "Questions and AI search", "/search-console/ai"], ["brand", "Brand", "/search-console/brand"], ["opps", "Opportunities", "/search-console/opportunities"],
  ["cannibal", "Cannibalization", "/search-console/cannibalization"], ["local", "Local demand", "/search-console/local"], ["indexing", "Indexing", "/search-console/indexing"],
  ["sitemaps", "Sitemaps and rich results", "/search-console/sitemaps"], ["alerts", "Alerts and insights", "/search-console/alerts"],
];
const EFF = { Low: 1, Medium: 2, High: 3 } as const;

export default async function GscQuickWinsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Quick wins" description="Website changes that bring more Google clicks, ranked by gain for effort.">
      {({ g, wins, clientId }) => {
        const total = Math.round(wins.reduce((a, w) => a + w.gain, 0) * 10) / 10;
        const byType = [...new Set(wins.map((w) => w.type))].map((t) => ({ k: t, v: Math.round(wins.filter((w) => w.type === t).reduce((a, w) => a + w.gain, 0) * 10) / 10 })).sort((a, b) => b.v - a.v);
        const byPage = [...new Set(wins.map((w) => w.page))].map((p) => ({ k: p, v: wins.filter((w) => w.page === p).reduce((a, w) => a + w.gain, 0) })).sort((a, b) => b.v - a.v);
        const scope = `gsc:${clientId}:${g.meta.resourceId}`;
        return (
          <>
            <Kpis>
              <Kpi label="Changes we found" tech="Quick wins found" value={String(wins.length)} note={`${wins.length} still to do`} />
              <Kpi label="Extra clicks you could get" tech="Estimated gain" value={`+${total}`} note="clicks/mo if all are done" />
              <Kpi label="Quick and easy changes" tech="Low-effort wins" value={String(wins.filter((w) => w.effort === "Low").length)} note="under an hour each" />
              <Kpi label="Pages affected" value={String(new Set(wins.map((w) => w.page)).size)} />
              <div className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface p-3.5"><div className="text-[13px] font-medium">Done</div><QwDone scope={scope} total={wins.length} /></div>
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="What to do first" tech="Impact vs effort" info="Each bubble is a quick win. Top-left = do first (big gain, little work)." span={7}>
                <Scatter points={wins.map((w) => ({ x: EFF[w.effort] + (w.rank % 5) * 0.06, y: w.gain, s: w.score, label: `#${w.rank} ${w.title}`, show: w.rank <= 5, c: w.effort === "Low" ? C[2] : w.effort === "Medium" ? C[3] : C[7] }))} xLabel="Effort (1 = low, 3 = high)" yLabel="Extra clicks a month" xf="dec1" yf="dec1" quad={[["Do first", 0, 1], ["Plan", 1, 1]]} />
              </Card>
              <Card title="Which kinds of changes pay off most" tech="Gain by type of change" span={5}>
                <BarList rows={byType.map((r) => ({ label: r.k, value: r.v, color: C[0] }))} f="dec1" />
              </Card>
              <Card title="Which pages to work on" tech="Gain by page">
                <Treemap items={byPage.slice(0, 16).map((r, i) => ({ label: r.k, value: Math.round(r.v * 10) / 10, color: C[i % C.length] }))} f="dec1" />
              </Card>
              <Card title="Your to-do list" tech="All quick wins" sub={'Tick "Done" as you go (saved in this browser).'}
                info="Built by fixed rules from the last 28 days of Search Console data, our crawl of the site and the URL Inspection results. Gain = extra clicks a month from the expected click rate at the target position. Score = gain × confidence (1 / 0.75 / 0.5) ÷ effort (1 / 2 / 3). Suggested text never invents facts: anything not on the site is a [placeholder].">
                {wins.length ? <QwList wins={wins} scope={scope} unit="clicks/mo" /> : <p className="py-6 text-sm text-muted">No quick wins right now: none of the rules found a page holding clicks back in the last 28 days.</p>}
              </Card>
            </Grid>
            <Band title="Quick wins by screen" />
            <div className="space-y-4">
              {SCREENS.map(([id, label, href]) => {
                const list = gscForScreen(wins, id);
                return (
                  <Card key={id} title={label} sub={<>{list.length} task{list.length === 1 ? "" : "s"} from the <Link href={href} className="underline underline-offset-2">{label}</Link> screen.</>}>
                    <Table limit={10} rows={list.map((w) => ({ rank: w.rank, title: w.title, page: w.page, where: w.where, gain: w.gain, effort: w.effort }))} empty="Nothing to change from this screen right now."
                      cols={[{ k: "rank", label: "#", num: true }, { k: "title", label: "Change", wrap: true }, { k: "page", label: "Page", kind: "mono" }, { k: "where", label: "Where on the page", wrap: true }, { k: "gain", label: "Est. gain", num: true, f: "dec1" }, { k: "effort", label: "Effort" }]} />
                  </Card>
                );
              })}
            </div>
          </>
        );
      }}
    </GscScreen>
  );
}
