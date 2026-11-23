import { BarList, Donut, LineChart, Scatter, Stack100 } from "@/components/ga4x/charts";
import { C, deviceColor, typeColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels, TYPE_PLAIN } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/tech";

export default async function TechPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Devices and tech" description="Phones, computers and tablets, browsers, systems and screen sizes, and which of them bring leads.">
      {({ g, wins }) => {
        const T = g.total();
        const dv = g.by((x) => String(x.deviceCategory)).sort((a, b) => b.sessions - a.sessions);
        const br = g.by((x) => String(x.browser)).sort((a, b) => b.sessions - a.sessions);
        const os = [...group(g.s2Cur(), (x) => String(x.operatingSystem))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) })).sort((a, b) => b.s - a.s).slice(0, 8);
        const res = [...group(g.rCur(), (x) => String(x.screenResolution))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) })).sort((a, b) => b.s - a.s).slice(0, 8);
        const types = g.types(), evs = g.leadEvents;
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Phone, computer or tablet" tech="Device category" span={5}>
                <Donut parts={dv.map((r, i) => ({ label: r.key, value: r.sessions, color: deviceColor(r.key, i) }))} />
              </Card>
              <Card title="Web browsers used" tech="Browsers" span={4}><BarList rows={br.slice(0, 8).map((r) => ({ label: r.key, value: r.sessions, color: C[0] }))} /></Card>
              <Card title="Phone and computer systems" tech="Operating systems" span={3}><BarList rows={os.map((r) => ({ label: r.k, value: r.s, color: C[2] }))} /></Card>
              <Card title="Screen sizes" tech="Screen resolution" span={4}><BarList rows={res.map((r) => ({ label: r.k, value: r.s, color: C[1] }))} /></Card>
              <Card title="Phone vs computer visits over time" tech="Sessions by device over time" span={8}>
                <LineChart id="tech-dev" labels={labels(g)} series={dv.map((r, i) => ({ name: r.key, values: g.daily(g.sCur().filter((x) => x.deviceCategory === r.key), (x) => Number(x.sessions)), color: deviceColor(r.key, i) }))} />
              </Card>
              <Card title="Lead types by device" tech="Lead types by device" span={6}>
                <Stack100 rows={dv.filter((r) => r.leads).map((r) => ({ label: r.key, parts: types.map((t) => r.types[t] ?? 0) }))} names={types.map((t) => TYPE_PLAIN[t])} colors={types.map(typeColor)} />
              </Card>
              <Card title="Browsers: visits vs engagement" tech="Browsers: sessions vs engagement rate" span={6}>
                <Scatter points={br.filter((r) => r.sessions > 0).slice(0, 15).map((r) => ({ x: r.sessions, y: r.er, s: Math.max(1, r.leads), label: r.key, show: true, c: r.er < 0.2 ? C[7] : C[0] }))} xLabel="Sessions (log scale)" yLabel="Engagement rate" logX yRef={T.er} />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Leads by device" tech="Leads by device" sub="Phone clicks come mostly from mobile." span={8}>
                <Table rows={dv.map((r) => ({ key: r.key, sessions: r.sessions, lr: r.lr, ...Object.fromEntries(evs.map((e) => [e, r.ev[e] ?? 0])) }))}
                  cols={[{ k: "key", label: "Device" }, { k: "sessions", label: "Sessions", num: true }, { k: "lr", label: "Lead rate", num: true, f: "pct" }, ...evs.map((e) => ({ k: e, label: e, num: true }))]} />
              </Card>
              <Card title="Browsers" tech="Browsers" span={4}>
                <Table limit={10} rows={br.map((r) => ({ key: r.key, sessions: r.sessions, er: r.er, leads: r.leads }))} cols={[{ k: "key", label: "Browser" }, { k: "sessions", label: "Sessions", num: true, bar: C[0] }, { k: "er", label: "Engagement rate", num: true, f: "pct" }, { k: "leads", label: "Leads", num: true }]} />
              </Card>
            </Grid>
            <ScreenTasks screen="Devices and tech" wins={forScreen(wins, "tech")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
