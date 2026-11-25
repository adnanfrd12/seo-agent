import { BarList, BubbleMap, ColChart, CompareBars, Donut, Stack100 } from "@/components/ga4x/charts";
import { C, channelColor, deviceColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGeo } from "@/lib/ga4x/geo";
import { group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { mapPoints } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/audience";
const AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

export default async function AudiencePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} users title="Audience and places" description="Where visitors are, who they are and which places bring leads.">
      {async ({ g, wins, clientId, areaSource }) => {
        const T = g.total();
        const cities = g.byGeo((x) => String(x.city)).filter((r) => r.key !== "(not set)").sort((a, b) => b.sessions - a.sessions);
        const citiesPrev = g.byGeo((x) => String(x.city), undefined, true);
        const inA = g.geoCur().filter((x) => g.inArea(String(x.city))), outA = g.geoCur().filter((x) => !g.inArea(String(x.city)));
        const leadsIn = sum(g.lCur().filter((x) => g.inArea(String(x.city))), (x) => Number(x.eventCount));
        const nvr = [...group(g.sCur(), (x) => String(x.newVsReturning))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) }));
        const regions = [...group(g.geoCur(), (x) => String(x.region))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) })).sort((a, b) => b.s - a.s).slice(0, 8);
        const langs = [...group(g.s2Cur(), (x) => String(x.language))].map(([k, v]) => ({ k, s: sum(v, (x) => Number(x.sessions)) })).sort((a, b) => b.s - a.s).slice(0, 8);
        const ag = g.users?.ageGender ?? [];
        const known = ag.filter((r) => r.age !== "unknown" && r.gender !== "unknown");
        const countries = g.byGeo((x) => String(x.country)).sort((a, b) => b.sessions - a.sessions);
        const geo = await loadGeo(createAdminClient(), clientId);
        const pts = mapPoints(g, geo, g.geoCur().map((x) => ({ city: String(x.city), country: String(x.country), v: Number(x.sessions) })));
        const topC = cities.slice(0, 8);
        const chs = [...new Set(g.geoCur().map((x) => String(x.ch)))], devs = [...new Set(g.geoCur().map((x) => String(x.deviceCategory)))];
        const usersBy = g.users?.byCity ?? {};
        const region = (c: string) => g.cityRegion.get(c) ?? "";
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="Visitors from your service area" tech="Service area" span={4} info={`Service area: ${areaSource}. Change it on Lead setup.`}>
                <Donut parts={[{ label: "Inside service area", value: sum(inA, (x) => Number(x.sessions)), color: C[2] }, { label: "Outside", value: sum(outA, (x) => Number(x.sessions)), color: C[3] }]} />
                <Note>{T.leads ? `${Math.round((leadsIn / T.leads) * 1000) / 10}%` : "000"} of leads come from inside the service area. ({areaSource}{g.serviceArea.length ? `, ${g.serviceArea.length} cities` : ""}.)</Note>
              </Card>
              <Card title="New and returning visitors" tech="New vs returning" span={4}>
                <Donut parts={nvr.map((r, i) => ({ label: r.k === "new" ? "New" : r.k === "returning" ? "Returning" : r.k, value: r.s, color: [C[0], C[2], C[7]][i % 3] }))} />
              </Card>
              <Card title="Visitors by state" tech="Regions" span={4}>
                <BarList rows={regions.map((r) => ({ label: r.k, value: r.s, color: C[2] }))} />
              </Card>
              <Card title="Visitor age and gender" tech="Age and gender" info="Needs Google signals. Small groups are hidden by GA4 thresholding." span={7}>
                {known.length ? <ColChart id="aud-age" stacked={false} labels={AGES} series={["female", "male"].map((gd, i) => ({ name: gd, values: AGES.map((a) => sum(known.filter((r) => r.age === a && r.gender === gd), (r) => r.users)), color: [C[4], C[0]][i] }))} />
                  : <Missing why={g.meta.config.signals === "GOOGLE_SIGNALS_ENABLED" ? "Google signals is on, but GA4 withheld every age and gender group in this range (thresholding hides small groups)." : "Age and gender need Google signals, which is off for this property."} fix={g.meta.config.signals === "GOOGLE_SIGNALS_ENABLED" ? "Pick a longer date range; groups appear once enough signed-in visitors are in each one." : "GA4 Admin → Data collection → Google signals → turn on. Data appears for visits after that."} />}
                {known.length > 0 && <Note>{Math.round((sum(ag.filter((r) => r.age === "unknown" || r.gender === "unknown"), (r) => r.users) / Math.max(1, sum(ag, (r) => r.users))) * 100)}% of visitors have no age or gender (not signed in to Google, or hidden by thresholding).</Note>}
              </Card>
              <Card title="Visitor language" tech="Language" span={5}>
                <BarList rows={langs.map((r) => ({ label: r.k, value: r.s, color: C[5] }))} />
              </Card>
              <Card title="Visitors by town (map)" tech="Sessions by city" sub="Bubble = sessions. Approximate positions." span={7}>
                <BubbleMap pts={pts} color={C[0]} label="sessions" /><Note>City positions © OpenStreetMap contributors.</Note>
              </Card>
              <Card title="Leads by town: this month vs last" tech="Leads by city: this period vs last" span={5}>
                <CompareBars color={C[2]} rows={[...new Set([...cities.filter((r) => r.leads).map((r) => r.key), ...citiesPrev.filter((r) => r.leads).map((r) => r.key)])].slice(0, 10).map((k) => ({ label: k, cur: cities.find((r) => r.key === k)?.leads ?? 0, prev: citiesPrev.find((r) => r.key === k)?.leads ?? 0 }))} />
              </Card>
              <Card title="Sources by town" tech="Channel mix by city" span={6}>
                <Stack100 rows={topC.map((r) => ({ label: r.key, parts: chs.map((c) => sum(g.geoCur().filter((x) => x.city === r.key && x.ch === c), (x) => Number(x.sessions))) }))} names={chs} colors={chs.map((c, i) => channelColor(c, i))} />
              </Card>
              <Card title="Phone vs computer by town" tech="Device mix by city" span={6}>
                <Stack100 rows={topC.map((r) => ({ label: r.key, parts: devs.map((d) => sum(g.geoCur().filter((x) => x.city === r.key && x.deviceCategory === d), (x) => Number(x.sessions))) }))} names={devs} colors={devs.map((d, i) => deviceColor(d, i))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Visitors by country" tech="Countries" span={5}>
                <Table rows={countries.map((r) => ({ key: r.key, sessions: r.sessions, er: r.er, leads: r.leads }))} cols={[{ k: "key", label: "Country" }, { k: "sessions", label: "Sessions", num: true, bar: C[0] }, { k: "er", label: "Engagement rate", num: true, f: "pct" }, { k: "leads", label: "Leads", num: true }]} />
              </Card>
              <Card title="Visitors by town" tech="Cities" span={7}>
                <Table limit={15} facets={[{ k: "area", label: "Service area" }]} rows={cities.map((r) => ({ key: r.key, area: g.inArea(r.key) ? "service area" : "outside", areaTone: g.inArea(r.key) ? "good" : "mute", region: region(r.key), sessions: r.sessions, users: usersBy[r.key] ?? null, leads: r.leads, lr: r.lr }))}
                  cols={[{ k: "key", label: "City" }, { k: "area", label: "Area", kind: "tag" }, { k: "region", label: "Region" }, { k: "sessions", label: "Sessions", num: true, bar: C[2] }, { k: "users", label: "Users", num: true }, { k: "leads", label: "Leads", num: true }, { k: "lr", label: "Lead rate", num: true, f: "pct" }]} />
              </Card>
            </Grid>
            <ScreenTasks screen="Audience and places" wins={forScreen(wins, "geo")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
