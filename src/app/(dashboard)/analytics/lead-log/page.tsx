import { ColChart, Donut, Stack100 } from "@/components/ga4x/charts";
import { deviceColor, typeColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { group, shortDate, sum, weekday, WEEKDAYS } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { TYPE_PLAIN } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/lead-log";
const BQ_FIX = "Link GA4 to BigQuery (GA4 Admin → Product links → BigQuery links → daily export; free for standard properties up to 1 million events a day) and share the dataset with this portal. These reports fill in from the first exported day.";

export default async function LeadLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Lead log" description="Every lead with its source, time and device.">
      {({ g, wins }) => {
        const cur = g.lCur(), types = g.types(), bq = g.meta.config.bigquery;
        const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
        const byHour = types.map((t) => ({ name: TYPE_PLAIN[t], color: typeColor(t), values: hours.map((h) => sum(g.l2Cur().filter((x) => g.typeOf(String(x.eventName)) === t && String(x.dateHour).slice(11, 13) === h), (x) => Number(x.eventCount))) }));
        const dev = [...group(cur, (x) => String(x.deviceCategory))].map(([k, v], i) => ({ label: k, value: sum(v, (x) => Number(x.eventCount)), color: deviceColor(k, i) })).sort((a, b) => b.value - a.value);
        const rows = cur.map((x) => ({ when: shortDate(String(x.date)), date: String(x.date), e: String(x.eventName), type: g.typeOf(String(x.eventName)) ?? "", land: String(x.land), sm: String(x.sessionSourceMedium), city: String(x.city), dev: String(x.deviceCategory), n: Number(x.eventCount) }))
          .sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n);
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="How long people take to contact you" tech="Time to lead" sub="From first visit to first lead." span={5}>
                <Missing why={bq ? "BigQuery is linked, but the export tables aren't connected to this portal yet." : "Time from a person's first visit to their first lead needs each user's visits in order. The GA4 Data API only gives totals per day, so only the BigQuery export has it."} fix={BQ_FIX} />
              </Card>
              <Card title="Leads by time of day" tech="Leads by hour of day" sub={`Time zone: ${g.meta.timezone}.`} span={7}>
                <ColChart id="log-hour" labels={hours} series={byHour} />
              </Card>
              <Card title="Leads by device" tech="Lead device" span={5}>
                <Donut parts={dev} />
              </Card>
              <Card title="Time on site before contacting you" tech="Engagement time before the lead" info="How long people spent on the site in the session that produced a lead." span={6}>
                <Missing why="Engagement time of the session that produced each lead is only in the BigQuery export (event_params.engagement_time_msec per session); the Data API can't tie it to the lead." fix={BQ_FIX} />
              </Card>
              <Card title="Lead types by day of the week" tech="Lead types by weekday" span={6}>
                <Stack100 rows={WEEKDAYS.map((d) => ({ label: d, parts: types.map((t) => sum(cur.filter((x) => g.typeOf(String(x.eventName)) === t && weekday(String(x.date)) === d), (x) => Number(x.eventCount))) }))} names={types.map((t) => TYPE_PLAIN[t])} colors={types.map(typeColor)} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Every lead you got" tech="Every lead, one row each" sub="One row per day, event, page, source and place." info="From the GA4 Data API: one row per day, lead event, landing page, source and place, with how many leads it had. Exact time, lead page and engagement per lead need the BigQuery export.">
                <Table site={g.meta.streamUrl} rows={rows} limit={25}
                  cols={[{ k: "when", label: "When" }, { k: "e", label: "Event", kind: "event" }, { k: "type", label: "Type" }, { k: "land", label: "Landing page", kind: "page" }, { k: "sm", label: "Source / medium" }, { k: "city", label: "City" }, { k: "dev", label: "Device" }, { k: "n", label: "Leads", num: true }]}
                  facets={[{ k: "type", label: "Lead type" }, { k: "e", label: "Event" }, { k: "dev", label: "Device" }, { k: "sm", label: "Source / medium" }, { k: "city", label: "City" }]} />
              </Card>
              <Card title="Pages people read before contacting you" tech="Pages viewed before a lead" info="How often each page appears in sessions that ended in a lead vs sessions that didn't." span={7}>
                <Missing why="Which pages were seen in the same session before a lead needs the visit-by-visit page order, which only the BigQuery export has." fix={BQ_FIX} />
              </Card>
            </Grid>
            <ScreenTasks screen="Lead log" wins={forScreen(wins, "leadlog")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
