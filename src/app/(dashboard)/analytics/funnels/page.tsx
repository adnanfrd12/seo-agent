import { ColChart, Funnel, Heat, LineChart } from "@/components/ga4x/charts";
import { C, deviceColor } from "@/components/ga4x/fmt";
import { Band, Card, Grid, Missing, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadFunnel, weeklyCohorts, type Cohorts, type FunnelResult } from "@/lib/ga4x/explore";
import { group, pageGroup, shortDate, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { cachedCall } from "@/lib/ga4x/sync";
import { Ga4xScreen } from "../_ga4x/screen";

export const maxDuration = 120;
const PATH = "/analytics/funnels";
const BQ = "Link GA4 to BigQuery (GA4 Admin → Product links → BigQuery links → daily export; free up to 1 million events a day) and share the dataset with this portal. Paths fill in from the first exported day.";

export default async function FunnelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Funnels, paths, cohorts" description="How visitors move toward a lead, and how many come back.">
      {async ({ g, wins, ctx, clientId }) => {
        const admin = createAdminClient();
        const views = [...group(g.pages.filter(g.inCur), (x) => String(x.pagePath))].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.screenPageViews)) })).sort((a, b) => b.n - a.n);
        const service = views.filter((p) => ["Service pages", "City page"].includes(pageGroup(p.k))).map((p) => p.k);
        const contact = views.filter((p) => pageGroup(p.k) === "Contact page").map((p) => p.k);
        const forms = g.eventsOfType("Forms").filter((e) => !e.includes("("));
        const fun = ctx ? await cachedCall<FunnelResult>(admin, clientId, g.meta.resourceId, `funnel:${g.p.start}:${g.p.end}`, 24, () => leadFunnel(ctx, g.p, service, contact, forms)) : { data: null, error: "GA4 isn't connected." };
        const coh = ctx ? await cachedCall<Cohorts>(admin, clientId, g.meta.resourceId, `cohorts:${g.meta.end}`, 24, () => weeklyCohorts(ctx, g.meta.end)) : { data: null, error: "GA4 isn't connected." };
        const f = fun.data, c = coh.data;
        const wk = Array.from({ length: c?.weeks ?? 6 }, (_, i) => `Week ${i}`);
        const devs = f ? Object.keys(f.byDevice) : [];
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="From first visit to lead" tech="Lead funnel" sub="Landing page to form submission." info="From landing to form submission, from your own events (runFunnelReport, open funnel, users)." span={7}>
                {f ? <Funnel steps={f.steps.map((s, i) => [s, f.total[i]])} /> : <Missing why={`GA4's funnel report couldn't be read: ${fun.error ?? "no answer"}.`} fix="Press Sync now; if it keeps failing, reconnect Google Analytics on the Integrations page." />}
                {f && !forms.length && <Note>No form lead event is counted yet, so the last step is 000. Add one (Lead setup → Tracking gaps).</Note>}
                {f && <Note>Service and city pages: {service.length ? service.slice(0, 6).join(", ") + (service.length > 6 ? "…" : "") : "none found"}. Contact pages: {contact.join(", ") || "none found"}.</Note>}
              </Card>
              <Card title="Common routes to a lead" tech="Top paths to a lead" info="Most common page sequences ending in a lead (BigQuery export)." span={5}>
                <Missing why="The order of pages in each visit is only in the BigQuery export; the Data API gives totals, not sequences." fix={BQ} />
              </Card>
              <Card title="How many visitors come back" tech="Weekly retention cohorts" sub="% of each week's new users who came back." info="Percent of each week's new users active again in each later week (cohortSpec).">
                {c ? <Heat rows={c.names.map((n) => `${shortDate(n)} cohort`)} cols={wk} m={c.m.map((r) => r.map((v) => v ?? 0))} color={C[2]} f="raw" suffix="%" /> : <Missing why={`GA4's cohort report couldn't be read: ${coh.error ?? "no answer"}.`} fix="Press Sync now; if it keeps failing, reconnect Google Analytics on the Integrations page." />}
                {c && <Note>Week 0 is the week of the first visit (always 100%).</Note>}
              </Card>
              <Card title="Where people go after the first page" tech="First page → next step" info="Where people go after their landing page (BigQuery session paths).">
                <Missing why="The page or lead that follows each landing page is only in the BigQuery export (session paths)." fix={BQ} />
              </Card>
              <Card title="From first visit to lead, by device" tech="Funnel by device" sub="Share of users reaching each step." span={6}>
                {f && devs.length ? <ColChart id="fun-dev" stacked={false} f="pct" labels={f.steps.map((s) => (s.length > 16 ? `${s.slice(0, 15)}…` : s))} series={devs.map((d, i) => ({ name: d, values: f.byDevice[d].map((v) => (f.byDevice[d][0] ? v / f.byDevice[d][0] : 0)), color: deviceColor(d, i) }))} /> : <Missing why="The funnel report returned no device breakdown." fix="Press Sync now." />}
              </Card>
              <Card title="How many visitors come back (curves)" tech="Retention curves" sub="Share of each cohort still active, by week." span={6}>
                {c ? <LineChart id="fun-ret" noToggle labels={wk} f="pct" series={c.names.map((n, i) => ({ name: `${shortDate(n)} cohort`, values: c.m[i].map((v) => (v == null ? null : v / 100)), color: C[i % C.length] }))} /> : <Missing why="See the cohort table above." fix="Press Sync now." />}
              </Card>
            </Grid>
            <ScreenTasks screen="Funnels, paths, cohorts" wins={forScreen(wins, "funnels")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
