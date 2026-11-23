import { BarList, BubbleMap, ColChart } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { AutoRefresh } from "@/components/ga4x/info";
import { Band, Card, Grid, Kpi, Kpis, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { cityKey, loadGeo } from "@/lib/ga4x/geo";
import { forScreen } from "@/lib/ga4x/quickwins";
import { realtime } from "@/lib/ga4x/realtime";
import { Ga4xScreen } from "../_ga4x/screen";
import { eventColor, plainEvent } from "../_ga4x/parts";

export const maxDuration = 60;
const PATH = "/analytics/realtime";

export default async function RealtimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="Realtime" description="Who is on the website right now: live from GA4 (last 30 minutes), refreshed every minute while this screen is open.">
      {async ({ g, wins, ctx, clientId }) => {
        const [rt, geo] = await Promise.all([ctx ? realtime(ctx, g.leadEvents) : null, loadGeo(createAdminClient(), clientId)]);
        if (!rt) return <p className="text-sm text-muted">GA4 isn&apos;t connected.</p>;
        const now = rt.perMinute.slice(-5).reduce((a, b) => a + b, 0);
        const leadsNow = rt.feed.reduce((a, f) => a + f.n, 0);
        const evTop = Object.entries(rt.eventsPerMinute).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)] as const).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
        const pts = rt.byCity.flatMap(([city, country, n]) => { const c = Object.entries(geo).find(([k]) => k.startsWith(`${city}|`) && k.endsWith(`|${country}`))?.[1] ?? geo[cityKey(city, "", country)]; return c ? [{ label: city, lat: c[0], lon: c[1], v: n }] : []; });
        return (
          <>
            <AutoRefresh seconds={60} />
            {rt.error && <p className="mb-4 rounded-lg border border-negative/40 bg-negative-soft px-3 py-2 text-sm text-negative">The GA4 Realtime API didn&apos;t answer: {rt.error}</p>}
            <Kpis>
              <Kpi label="People on site (last 30 min)" tech="Active users, last 30 min" value={fmt("int", rt.perMinute.reduce((a, b) => a + b, 0))} note={`${now} in the last 5 minutes`} />
              <Kpi label="Page views (last 30 min)" tech="Views, last 30 min" value={fmt("int", rt.views)} />
              <Kpi label="Leads (last 30 min)" tech="Leads, last 30 min" value={fmt("int", leadsNow)} note={g.meta.fallbacks.length ? "Named lead events only (map-link clicks can't be filtered live)" : undefined} />
            </Kpis>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Visitors per minute" tech="Active users per minute" sub="runRealtimeReport with minutesAgo, refreshed every 60 seconds. This is the only live data Google offers: GA4 allows the last 30 minutes through its Realtime API; Search Console has no live data (2–3 day delay, hourly data for recent days only)." span={8}>
                <ColChart id="rt-min" labels={rt.perMinute.map((_, i) => `${29 - i}m`)} series={[{ name: "Active users", values: rt.perMinute, color: C[0] }]} h={170} />
                <Note>Live · read {new Date(rt.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</Note>
              </Card>
              <Card title="Leads as they happen" tech="Live lead feed" sub="Lead events as they arrive." span={4}>
                {rt.feed.length ? (
                  <ul className="divide-y divide-hairline text-sm">
                    {rt.feed.map((f, i) => <li key={i} className="py-2"><time className="mr-2 text-xs text-muted">{f.minutesAgo ? `${f.minutesAgo} min ago` : "just now"}</time><span className="font-mono text-xs">{f.event}</span>{f.n > 1 && <b className="ml-1 text-xs">×{f.n}</b>}<span className="block text-xs text-muted">{f.page} · {f.city} · {f.device}</span></li>)}
                  </ul>
                ) : <p className="py-4 text-sm text-muted">No lead events in the last 30 minutes.</p>}
              </Card>
              <Card title="Live visitors by town" tech="By city" span={4}><BarList rows={rt.byCity.slice(0, 8).map(([c, , n]) => ({ label: c, value: n }))} empty="Nobody on the site right now." /></Card>
              <Card title="Live pages being viewed" tech="By page" span={4}><BarList rows={rt.byPage.slice(0, 8).map(([p, n]) => ({ label: p, value: n, color: C[2] }))} empty="No page views in the last 30 minutes." /></Card>
              <Card title="Live actions" tech="By event" span={4}><BarList rows={rt.byEvent.slice(0, 8).map(([e, n]) => ({ label: e, value: n, color: C[1], mono: true }))} empty="No events in the last 30 minutes." /></Card>
              <Card title="People on your site now (map)" tech="Active users on the map" sub="Last 30 minutes." span={6}>
                <BubbleMap pts={pts} label="active users" />
                {rt.byCity.length > pts.length && <Note>{rt.byCity.length - pts.length} town(s) aren&apos;t on the map yet (their position is looked up on the next sync).</Note>}
              </Card>
              <Card title="Actions per minute" tech="Events per minute" span={6}>
                <ColChart id="rt-ev" labels={rt.perMinute.map((_, i) => `${29 - i}m`)} series={evTop.map((e, i) => ({ name: g.typeOf(e) ? plainEvent(g, e) : e, tech: e, values: rt.eventsPerMinute[e], color: g.typeOf(e) ? eventColor(g, e) : C[(i + 3) % C.length] }))} h={200} />
              </Card>
            </Grid>
            <ScreenTasks screen="Realtime" wins={forScreen(wins, "realtime")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
