import { ColChart, Donut } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Insight } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { alertEvents, insights, RULES } from "@/lib/gscx/alerts";
import { addDays } from "@/lib/gscx/g";
import { GscScreen } from "../_gscx/screen";
import { sd, Tasks, weekOf } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/alerts";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Alerts and insights" description="What changed, why, and the alerts we watch for.">
      {({ g, wins }) => {
        const cards = insights(g), ev = alertEvents(g);
        const from = weekOf(addDays(g.meta.end, -83));
        const weeks: string[] = []; for (let w = from; w <= g.meta.end; w = addDays(w, 7)) weeks.push(w);
        const sev = (["High", "Medium", "Low"] as const).map((s, i) => ({ name: s, values: weeks.map((w) => ev.filter((e) => e.severity === s && weekOf(e.date) === w).length), color: [C[7], C[3], C[0]][i] }));
        const types = [...new Set(ev.map((e) => e.type))].map((t, i) => ({ label: t, value: ev.filter((e) => e.type === t).length, color: C[i % C.length] }));
        return (
          <>
            <Grid>
              <Card title="What changed and why" tech="Insights" sub="Written automatically from the numbers each day.">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cards.map((c) => <Insight key={c.title} {...c} />)}</div>
              </Card>
            </Grid>
            <Band title="Charts" />
            <Grid>
              <Card title="Alerts each week" tech="Alerts per week" sub="By severity, last 12 weeks." info="By severity, last 12 weeks (rules replayed over the synced history)." span={7}>
                <ColChart id="gsc-alerts-wk" labels={weeks.map(sd)} series={sev} />
              </Card>
              <Card title="Kinds of alerts" tech="Alerts by type" sub="Last 90 days." span={5}>
                {types.length ? <Donut parts={types} /> : <p className="py-6 text-center text-sm text-muted">No alert fired in the last 90 days.</p>}
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Alerts that fired" tech="Alert events">
                <Table facets={[{ k: "type", label: "Type" }, { k: "sev", label: "Severity" }]} rows={ev.map((e) => ({ date: sd(e.date), sev: e.severity, sevTone: e.severity === "High" ? "bad" : e.severity === "Medium" ? "warn" : "acc", type: e.type, text: e.text }))}
                  cols={[{ k: "date", label: "Date" }, { k: "sev", label: "Severity", kind: "tag" }, { k: "type", label: "Type" }, { k: "text", label: "What happened", wrap: true }]} empty="No alert fired in the last 90 days." />
              </Card>
              <Card title="Alerts we watch for you" tech="Alert rules" sub="Shown on this screen only; email and Slack aren't set up yet.">
                <Table rows={RULES} cols={[{ k: "rule", label: "Rule" }, { k: "scope", label: "Scope", wrap: true }, { k: "condition", label: "Condition", wrap: true }, { k: "sends", label: "Sends to" }]} />
              </Card>
            </Grid>
            <Tasks screen="Alerts and insights" id="alerts" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
