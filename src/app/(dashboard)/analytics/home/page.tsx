import { BarList, BubbleMap, CalHeat, ColChart, Gauge, LineChart, Sankey, Scatter } from "@/components/ga4x/charts";
import { C, channelColor, fmt, typeColor } from "@/components/ga4x/fmt";
import { Band, Card, Grid, Insight, Kpi, Kpis, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { cityKey, loadGeo } from "@/lib/ga4x/geo";
import { notableChanges } from "@/lib/ga4x/insights";
import { group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { realtime } from "@/lib/ga4x/realtime";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels, TYPE_PLAIN, typeMissing } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/home";

export default async function Ga4HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} users title="Home" description="Visitors, engagement and leads at a glance, with what changed and where leads come from.">
      {async ({ g, wins, ctx, clientId }) => {
        const T = g.total(), Tp = g.total(true), U = g.users?.totals;
        const dU = g.daily(g.D, (x) => Number(x.activeUsers)), dN = g.daily(g.D, (x) => Number(x.newUsers));
        const sDaily = (prev = false) => g.daily(prev ? g.sPrev() : g.sCur(), (x) => Number(x.sessions), prev);
        const dS = sDaily(), dE = g.daily(g.sCur(), (x) => Number(x.engagedSessions)), dSec = g.daily(g.sCur(), (x) => Number(x.userEngagementDuration));
        const dL = g.leadsDaily();
        const aetUser = U?.cur.activeUsers ? T.sec / U.cur.activeUsers : null, aetUserP = U?.prev.activeUsers ? Tp.sec / U.prev.activeUsers : null;
        const fs = g.formStarts(), fl = g.formLeads();
        const [rt, geo] = await Promise.all([ctx ? realtime(ctx) : null, loadGeo(createAdminClient(), clientId)]);
        const types = g.types();
        const ch = g.by((x) => String(x.ch)).sort((a, b) => b.sessions - a.sessions);
        const lp = g.by((x) => String(x.land)).sort((a, b) => b.sessions - a.sessions).slice(0, 7);
        const cities = g.byGeo((x) => String(x.city)).filter((r) => r.key !== "(not set)").sort((a, b) => b.sessions - a.sessions).slice(0, 7);
        const insights = notableChanges(g);
        const flows: [string, string, number][] = [];
        for (const r of ch) for (const t of types) if (r.types[t]) flows.push([r.key, TYPE_PLAIN[t], r.types[t]]);
        const inArea = sum(g.lCur().filter((x) => g.inArea(String(x.city))), (x) => Number(x.eventCount));
        const mobile = sum(g.sCur().filter((x) => x.deviceCategory === "mobile"), (x) => Number(x.sessions));
        const isNew = sum(g.sCur().filter((x) => x.newVsReturning === "new"), (x) => Number(x.sessions));
        // leads by city on the map (cities with coordinates)
        const byCity = [...group(g.lCur(), (x) => `${x.city}|${x.country}`)].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.eventCount)) }));
        const pts = byCity.flatMap(({ k, n }) => { const [city, country] = k.split("|"); const c = geo[cityKey(city, g.cityRegion.get(city) ?? "", country)]; return c ? [{ label: city, lat: c[0], lon: c[1], v: n }] : []; });
        // calendar: every stored day up to the end of the period
        const calStart = g.meta.start, calDays = Math.round((Date.parse(g.p.end) - Date.parse(calStart)) / 86_400_000) + 1;
        const cal = new Array<number>(Math.max(0, calDays)).fill(0);
        for (const x of g.L) { if (g.typeOf(String(x.eventName)) === null || (g.qualified && g.isBot(x))) continue; const i = Math.round((Date.parse(String(x.date)) - Date.parse(calStart)) / 86_400_000); if (i >= 0 && i < cal.length) cal[i] += Number(x.eventCount); }
        return (
          <>
            <Kpis>
              <Kpi label="Visitors" tech="Active users" value={U ? fmt("int", U.cur.activeUsers) : "000"} cur={U?.cur.activeUsers} prev={U?.prev.activeUsers} spark={dU} color={C[0]} missing={U ? undefined : "000: the user count for this range couldn't be read from GA4 (users can't be added up from daily rows). Press Sync now or reload in a minute."} />
              <Kpi label="New visitors" tech="New users" value={U ? fmt("int", U.cur.newUsers) : "000"} cur={U?.cur.newUsers} prev={U?.prev.newUsers} spark={dN} color={C[3]} />
              <Kpi label="Average time on site per visitor" tech="Avg engagement time per active user" value={aetUser == null ? "000" : fmt("dur", aetUser)} cur={aetUser} prev={aetUserP} spark={dSec.map((v, i) => v / Math.max(1, dS[i]))} color={C[1]} />
              <Kpi label="Visits" tech="Sessions" value={fmt("int", T.sessions)} cur={T.sessions} prev={Tp.sessions} spark={dS} color={C[2]} />
              <Kpi label="Visits that engaged" tech="Engagement rate" value={fmt("pct", T.er)} cur={T.er} prev={Tp.er} spark={dE.map((v, i) => v / Math.max(1, dS[i]))} color={C[5]} />
              <Kpi label="Leads" value={fmt("int", T.leads)} cur={T.leads} prev={Tp.leads} note={`${types.map((t) => TYPE_PLAIN[t].toLowerCase()).join(", ")}`} spark={dL} color={C[4]} />
            </Kpis>
            <div className="mt-3"><Kpis>
              {types.map((t) => <Kpi key={t} label={TYPE_PLAIN[t]} value={g.eventsOfType(t).length ? fmt("int", T.types[t] ?? 0) : "000"} cur={T.types[t] ?? 0} prev={Tp.types[t] ?? 0} missing={typeMissing(g, t)} />)}
              <Kpi label="Visits that became leads" tech="Lead rate" value={fmt("pct", T.lr)} cur={T.lr} prev={Tp.lr} />
              <Kpi label="Started a form but didn't send it" tech="Form abandonment" value={fs && fl <= fs ? fmt("pct", 1 - fl / fs) : fs ? "n/a" : "000"} cur={fs && fl <= fs ? 1 - fl / fs : null} prev={g.formStarts(true) && g.formLeads(true) <= g.formStarts(true) ? 1 - g.formLeads(true) / g.formStarts(true) : null} invert
                missing={!fs ? "000: GA4 has no form_start event in this period, so abandonment can't be worked out. Turn on Enhanced measurement → Form interactions in GA4 (Admin → Data streams)." : fl > fs ? `There are more form submissions (${fl}) than form starts (${fs}): ${g.eventsOfType("Forms").join(" and ")} probably count the same form, so abandonment can't be worked out. Mark one of them as "Not a lead" on Lead setup (see Insights and data quality → Data checks).` : undefined} />
            </Kpis></div>

            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="What changed recently" tech="Notable changes" sub="Generated daily by comparing each slice with its expected value.">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{insights.map((c) => <Insight key={c.title} {...c} />)}</div>
                {!insights.length && <p className="text-sm text-muted">Nothing unusual in this period.</p>}
              </Card>
              <Card title="Visitors per day" tech="Active users" sub="Daily, with the previous period dashed." span={8}>
                <LineChart id="home-users" labels={labels(g)} series={[{ name: "This period", values: dU, color: C[0], area: true }, { name: "Previous period", values: g.daily(g.D, (x) => Number(x.activeUsers), true), color: C[0], dash: true }]} />
              </Card>
              <Card title="People on your site right now" tech="Active users in last 30 minutes" span={4}
                sub={<><b className="text-lg text-foreground">{rt ? fmt("int", sum(rt.perMinute.slice(-5), (v) => v)) : "000"}</b> right now · Live from the GA4 Realtime API (last 30 minutes, refreshed every minute)</>}>
                {rt?.error ? <p className="text-sm text-negative">{rt.error}</p> : rt && <ColChart id="home-rt" labels={rt.perMinute.map((_, i) => String(i - 29))} series={[{ name: "Active users per minute", values: rt.perMinute, color: C[0] }]} h={150} />}
                {rt && !rt.error && <Note>Top country: {rt.byCountry[0]?.[0] ?? "–"} · Top page: {rt.byPage[0]?.[0] ?? "–"}</Note>}
              </Card>
              <Card title="Where visitors come from" tech="Top channels" sub="Sessions and leads." span={4}>
                <BarList rows={ch.map((r, i) => ({ label: r.key, value: r.sessions, color: channelColor(r.key, i), right: `${fmt("int", r.sessions)} · ${fmt("int", r.leads)} leads` }))} />
              </Card>
              <Card title="Pages people arrive on" tech="Top landing pages" sub="Sessions and leads." span={4}>
                <BarList rows={lp.map((r) => ({ label: r.key, value: r.sessions, color: C[2], right: `${fmt("int", r.sessions)} · ${fmt("int", r.leads)} leads` }))} />
              </Card>
              <Card title="Where visitors are" tech="Top cities" sub="Sessions and leads." span={4}>
                <BarList rows={cities.map((r) => ({ label: r.key, value: r.sessions, color: C[1], right: `${fmt("int", r.sessions)} · ${fmt("int", r.leads)} leads` }))} />
              </Card>
              <Card title="Key rates" info="Engagement rate = engaged sessions ÷ sessions. Leads from service area = leads in your service-area cities ÷ leads. Sessions on mobile = mobile sessions ÷ sessions. New visitors = sessions of new users ÷ sessions. Form completion = form leads ÷ form_start.">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <Gauge v={T.er} label="Engagement rate" color={C[2]} />
                  <Gauge v={T.leads ? inArea / T.leads : null} label="Leads from service area" color={C[0]} sub={T.leads ? undefined : "No leads yet"} />
                  <Gauge v={T.sessions ? mobile / T.sessions : null} label="Sessions on mobile" color={C[6]} />
                  <Gauge v={T.sessions ? isNew / T.sessions : null} label="New visitors" color={C[1]} />
                  <Gauge v={fs && fl <= fs ? fl / fs : null} label="Form completion" color={C[4]} sub={!fs ? "No form_start event" : fl > fs ? "More submissions than starts (double-counted form)" : undefined} />
                </div>
              </Card>
              <Card title="Where your leads come from" tech="Where leads come from" sub="Channel → lead type. Band width = number of leads." span={7}>
                <Sankey flows={flows} rightColor={typeColor("Forms")} />
              </Card>
              <Card title="Leads by town (map)" tech="Leads by city" sub="Bubble size = leads. Approximate positions." span={5}>
                <BubbleMap pts={pts} color={C[2]} label="leads" />
                <Note>City positions © OpenStreetMap contributors.</Note>
              </Card>
              <Card title="Leads each day (calendar)" tech="Daily leads calendar" sub={`Last ${cal.length} days. Darker = more leads.`} span={6}>
                <CalHeat values={cal} start={calStart} color={C[2]} label="leads" />
              </Card>
              <Card title="Sources: visits vs how many become leads" tech="Channels: traffic vs lead rate" sub="Bubble = leads. Top-right channels bring volume and convert." span={6}>
                <Scatter points={ch.filter((r) => r.sessions > 0).map((r, i) => ({ x: r.sessions, y: r.lr, s: Math.max(1, r.leads), label: r.key, show: true, c: channelColor(r.key, i) }))} xLabel="Sessions (log scale)" yLabel="Lead rate" logX yRef={T.lr} />
              </Card>
            </Grid>
            <ScreenTasks screen="Home" wins={forScreen(wins, "home")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
