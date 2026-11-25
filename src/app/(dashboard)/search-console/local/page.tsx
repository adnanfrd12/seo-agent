import { after } from "next/server";
import { BubbleMap, CompareBars, Heat, LineChart, Stack100 } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { GscSettingsForm } from "@/components/ga4x/gsc-settings";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, Note } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientNap } from "@/lib/reviews/listings";
import { cityKey, geocodeCities, loadGeo } from "@/lib/ga4x/geo";
import { STATES } from "@/lib/ga4x/model";
import { cityOf, queryPages } from "@/lib/gscx/analysis";
import { pathOf, titleCase } from "@/lib/gscx/model";
import { saveGscSettings } from "../gscx-actions";
import { GscScreen } from "../_gscx/screen";
import { labels, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/local";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function LocalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { client } = await getSession();
  const canEdit = !!client && ["owner", "admin"].includes(client.role);
  return (
    <GscScreen sp={sp} path={PATH} title="Local demand" description="Services searched by town, 'near me' searches and missing town pages.">
      {async ({ g, wins, clientId, settingsSource }) => {
        const form = <Card title="Cities and services" sub="Local demand depends on these lists." info="Local demand is read from the words in each query (Search Console has no city dimension), so it depends on these lists."><GscSettingsForm initial={g.settings} sources={settingsSource} action={saveGscSettings} disabled={!canEdit} /></Card>;
        const cities = g.settings.cities, services = g.settings.services;
        if (!cities.length) return <><Missing title="No cities set" why="Local demand counts searches that name a town you serve, and no towns are known for this business." fix="Add the towns you serve below (or on GA4 Lead setup → service area)." /><div className="mt-4"><Grid>{form}</Grid></div></>;
        const cur = [...g.queries()], prev = [...g.queries(true)];
        const has = (q: string, t: string) => new RegExp(`\\b${esc(t)}`, "i").test(q);
        const imp = (xs: typeof cur, pred: (q: string) => boolean) => xs.filter(([q]) => pred(q)).reduce((a, [, v]) => a + v.impressions, 0);
        const topCities = cities.map((c) => ({ c, v: imp(cur, (q) => has(q, c)), p: imp(prev, (q) => has(q, c)) })).sort((a, b) => b.v - a.v);
        const shownCities = topCities.filter((x) => x.v || x.p).slice(0, 10);
        const topServices = services.map((s) => ({ s, v: imp(cur, (q) => has(q, s)) })).sort((a, b) => b.v - a.v).filter((x) => x.v).slice(0, 10);
        const heat = topServices.map(({ s }) => shownCities.map(({ c }) => imp(cur, (q) => has(q, s) && has(q, c))));
        const near = /\bnear (me|by)\b|\bnearby\b/i;
        const nearDaily = g.daily(g.q().filter((x) => near.test(String(x.query))), (x) => Number(x.impressions));
        // map (coordinates looked up once, in the background)
        const admin = createAdminClient();
        const nap = await clientNap(admin, clientId).catch(() => null);
        const state = nap?.state ? STATES[nap.state] ?? "" : "";
        const geo = await loadGeo(admin, clientId);
        const want = shownCities.map((x) => ({ city: titleCase(x.c), region: state, country: "United States" }));
        if (want.some((w) => !(cityKey(w.city, w.region, w.country) in geo))) after(() => geocodeCities(createAdminClient(), clientId, want, 15).then(() => undefined, () => undefined));
        const pts = shownCities.flatMap((x) => { const c = geo[cityKey(titleCase(x.c), state, "United States")]; return c && x.v ? [{ label: titleCase(x.c), lat: c[0], lon: c[1], v: x.v }] : []; });
        const pagesFor = (c: string) => g.inv.filter((r) => pathOf(r.url).toLowerCase().includes(c.replace(/\s+/g, "-")));
        const noPage = topCities.filter((x) => x.v && !pagesFor(x.c).length);
        const qp = queryPages(g);
        const cityPages = cities.flatMap((c) => pagesFor(c).map((r) => {
          const rows = qp.filter((x) => x.page === r.url), clicks = rows.reduce((a, x) => a + x.clicks, 0), impr = rows.reduce((a, x) => a + x.impressions, 0);
          const own = rows.filter((x) => has(x.query, c)).reduce((a, x) => a + x.clicks, 0);
          const pos = impr ? rows.reduce((a, x) => a + x.pos * x.impressions, 0) / impr : null;
          return { page: pathOf(r.url), city: titleCase(c), clicks, impr, pos, own: clicks ? own / clicks : null };
        }));
        const localOnHome = qp.filter((r) => (near.test(r.query) || cityOf(g, r.query)) && pathOf(r.page) === "/").reduce((a, r) => a + r.impressions, 0);
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="Which services people search for in each town" tech="Service × city demand" sub="Impressions." info="Impressions for queries naming each service and city (from words in the query; there's no city dimension).">
                {topServices.length && shownCities.length ? <Heat rows={topServices.map((x) => titleCase(x.s))} cols={shownCities.map((x) => titleCase(x.c))} m={heat} color={C[0]} />
                  : <Missing why={!topServices.length ? "No query in this period names one of the services in the list." : "No query in this period names one of the towns in the list."} fix="Check the service and city lists below; add the words people actually type (e.g. 'channel letters', 'neon')." />}
              </Card>
              <Card title="'Near me' searches over time" tech="'Near me' impressions" sub="Daily." info="Daily impressions for queries containing near me / nearby." span={7}>
                <LineChart id="gsc-near" labels={labels(g)} series={[{ name: "Near me impressions", values: nearDaily, color: C[2], area: true }]} />
              </Card>
              <Card title="Searches by town (map)" tech="Search demand by city" sub="Impressions for queries naming each place. Positions are approximate." span={5}>
                <BubbleMap pts={pts} color={C[0]} label="impressions" />
                <Note>City positions © OpenStreetMap contributors.{pts.length < shownCities.filter((x) => x.v).length ? " Some towns are still being placed on the map." : ""}</Note>
              </Card>
              <Card title="Towns: this month vs last" tech="Cities: this period vs last" sub="Impressions." span={5}>
                <CompareBars rows={shownCities.map((x) => ({ label: titleCase(x.c), cur: x.v, prev: x.p }))} />
              </Card>
              <Card title="Services searched in each town" tech="Service mix per city" span={7}>
                <Stack100 rows={shownCities.filter((x) => x.v).map((x, i) => ({ label: titleCase(x.c), parts: topServices.map((_, j) => heat[j]?.[shownCities.indexOf(x)] ?? i * 0) }))} names={topServices.map((x) => titleCase(x.s))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Towns people search that have no page on your site" tech="Cities searched with no page" span={5}>
                <Table rows={noPage.map((x) => ({ c: titleCase(x.c), v: x.v }))} cols={[{ k: "c", label: "City" }, { k: "v", label: "Impressions", num: true, bar: C[0] }]} empty="Every town people search has its own page." />
                {localOnHome > 0 && <Note>{localOnHome} impressions from near-me and city searches land on the home page.</Note>}
              </Card>
              <Card title="How your town pages perform" tech="City page performance" sub="Share of each city page's clicks that mention its own city." span={7}>
                <Table site={siteOf(g)} rows={cityPages} cols={[{ k: "page", label: "Page", kind: "page" }, { k: "city", label: "City" }, { k: "clicks", label: "Clicks", num: true }, { k: "impr", label: "Impr.", num: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "own", label: "Own-city share", num: true, f: "pct" }]} empty="0: no page address names one of the towns in the list." />
              </Card>
              {form}
            </Grid>
            <Tasks screen="Local demand" id="local" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
