import Link from "next/link";
import { BarList, Scatter, Treemap } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { QwDone, QwList } from "@/components/ga4x/qw-list";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";

export const maxDuration = 120;
const PATH = "/analytics/quick-wins";
const SCREENS: [string, string, string][] = [
  ["home", "Home", "/analytics/home"], ["leads", "Leads overview", "/analytics/leads"], ["explorer", "Explore your leads", "/analytics/explorer"], ["leadlog", "Lead log", "/analytics/lead-log"],
  ["setup", "Lead setup", "/analytics/lead-setup"], ["acq", "Acquisition", "/analytics/acquisition"], ["eng", "Engagement", "/analytics/engagement"], ["geo", "Audience and places", "/analytics/audience"],
  ["tech", "Devices and tech", "/analytics/tech"], ["funnels", "Funnels, paths, cohorts", "/analytics/funnels"], ["realtime", "Realtime", "/analytics/realtime"],
  ["quality", "Insights and data quality", "/analytics/quality"], ["seo", "SEO: Search Console + GA4", "/analytics/seo"],
];
const EFF = { Low: 1, Medium: 2, High: 3 } as const;

export default async function QuickWinsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Quick wins" description="Changes that bring more leads, ranked by gain for the effort.">
      {({ g, wins, clientId }) => {
        const total = Math.round(sum(wins, (w) => w.gain) * 10) / 10;
        const pages = new Set(wins.map((w) => w.page));
        const byType = [...group(wins, (w) => w.type)].map(([k, v]) => ({ k, v: Math.round(sum(v, (w) => w.gain) * 10) / 10 })).sort((a, b) => b.v - a.v);
        const byPage = [...group(wins, (w) => w.page)].map(([k, v]) => ({ k, v: sum(v, (w) => w.gain) })).sort((a, b) => b.v - a.v);
        const scope = `${clientId}:${g.meta.resourceId}`;
        return (
          <>
            <Kpis>
              <Kpi label="Changes we found" tech="Quick wins found" value={String(wins.length)} note={`${wins.length} still to do`} />
              <Kpi label="Extra leads you could get" tech="Estimated gain" value={`+${total}`} note="leads/mo if all are done" />
              <Kpi label="Quick and easy changes" tech="Low-effort wins" value={String(wins.filter((w) => w.effort === "Low").length)} note="under an hour each" />
              <Kpi label="Pages affected" value={String(pages.size)} />
              <div className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface p-3.5"><div className="text-[13px] font-medium">Done</div><QwDone scope={scope} total={wins.length} /></div>
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="What to do first" tech="Impact vs effort" sub="Top-left = big gain, little work." span={7}>
                <Scatter points={wins.map((w) => ({ x: EFF[w.effort] + (w.rank % 5) * 0.06, y: w.gain, s: w.gain, label: `#${w.rank} ${w.title}`, show: w.rank <= 5, c: w.effort === "Low" ? C[2] : w.effort === "Medium" ? C[3] : C[7] }))} xLabel="Effort (1 = low, 3 = high)" yLabel="Extra leads a month" xf="dec1" yf="dec1" quad={[["Do first", 0, 1], ["Plan", 1, 1]]} />
              </Card>
              <Card title="Which kinds of changes pay off most" tech="Gain by type of change" span={5}>
                <BarList rows={byType.map((r) => ({ label: r.k, value: r.v, color: C[2] }))} f="dec1" />
              </Card>
              <Card title="Which pages to work on" tech="Gain by page">
                <Treemap items={byPage.slice(0, 16).map((r, i) => ({ label: r.k, value: Math.round(r.v * 10) / 10, color: C[i % C.length] }))} f="dec1" />
              </Card>
              <Card title="Your to-do list" tech="All quick wins" sub={'Ranked by gain ÷ effort. "Done" ticks are saved in this browser only.'}
                info="Generated from the last 30 days of GA4 data by fixed rules: landing pages with traffic but a low lead rate, blog posts without calls to action, mobile pages with few phone clicks, form abandonment, untracked lead actions, AI assistant traffic, service-area cities that don't convert, peak call hours, expensive ad campaigns, social traffic sent to the home page, data-quality fixes, pages that don't engage, and the best page to promote. Gain = extra leads a month if the page reached the target lead rate. Data-quality fixes show a small gain because they make leads measurable rather than adding them. Score = gain × confidence (1 / 0.75 / 0.5) ÷ effort (1 / 2 / 3); the list is ranked by score and rebuilt after every daily sync.">
                {wins.length ? <QwList wins={wins} scope={scope} /> : <p className="py-6 text-sm text-muted">No quick wins right now.</p>}
              </Card>
            </Grid>
            <Band title="Quick wins by screen" />
            <div className="space-y-4">
              {SCREENS.map(([id, label, href]) => {
                const list = forScreen(wins, id);
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
    </Ga4xScreen>
  );
}
