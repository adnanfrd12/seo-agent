import { BarList, ColChart, Donut, Heat, LineChart, Stack100 } from "@/components/ga4x/charts";
import { C, deviceColor } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, Note } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { groupM, m } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { labels, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/segments";
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ISO3: Record<string, string> = { usa: "US", can: "CA", gbr: "GB", ind: "IN", pak: "PK", aus: "AU", mex: "MX", phl: "PH", deu: "DE", fra: "FR", bra: "BR", nga: "NG", bgd: "BD", are: "AE", sau: "SA", chn: "CN", jpn: "JP", esp: "ES", ita: "IT", nld: "NL", irl: "IE", nzl: "NZ", zaf: "ZA", sgp: "SG", mys: "MY", idn: "ID", vnm: "VN", tur: "TR", egy: "EG", ken: "KE", col: "CO", arg: "AR", chl: "CL", per: "PE", rus: "RU", ukr: "UA", pol: "PL", swe: "SE", nor: "NO", dnk: "DK", che: "CH", aut: "AT", bel: "BE", prt: "PT", grc: "GR", isr: "IL", kor: "KR", twn: "TW", hkg: "HK", tha: "TH", lka: "LK", npl: "NP", gha: "GH", jam: "JM", dom: "DO", pri: "PR", gtm: "GT", slv: "SV", hnd: "HN", ven: "VE", ecu: "EC" };
const names = new Intl.DisplayNames(["en"], { type: "region" });
const country = (c: string) => { const a2 = ISO3[c.toLowerCase()]; try { return a2 ? names.of(a2) ?? c.toUpperCase() : c.toUpperCase(); } catch { return c.toUpperCase(); } };
const APP: Record<string, string> = { WEB_LIGHT_RESULTS: "Web light results", AMP_BLUE_LINK: "AMP non-rich results", AMP_TOP_STORIES: "AMP top stories", REVIEW_SNIPPET: "Review snippet", FAQ_RICH_RESULT: "FAQ rich result", VIDEO: "Video", TRANSLATED_RESULT: "Translated result", MERCHANT_LISTINGS: "Merchant listings", PRODUCT_SNIPPETS: "Product snippets", ORGANIC_SHOPPING: "Shopping", RECIPE_FEATURE: "Recipe", BREADCRUMBS: "Breadcrumbs", EVENT: "Event", JOB_LISTING: "Job listing" };
const appName = (a: string) => APP[a] ?? a.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Devices, countries, appearance" description="Phones vs computers, where searchers are, when they click and how the site's results look on Google.">
      {({ g, wins }) => {
        const dev = [...groupM(g.DEV.filter(g.inCur), (x) => String(x.device))].sort((a, b) => b[1].clicks - a[1].clicks);
        const cty = [...groupM(g.CD.filter(g.inCur), (x) => String(x.country))].sort((a, b) => b[1].impressions - a[1].impressions);
        const devs = dev.map(([d]) => d);
        // hourly data (property time = Pacific, as Search Console reports it): clicks per weekday and 2-hour band
        const bands: [string, number, number][] = [["0:00", 0, 6], ["6:00", 6, 8], ["8:00", 8, 10], ["10:00", 10, 12], ["12:00", 12, 14], ["14:00", 14, 16], ["16:00", 16, 18], ["18:00", 18, 20], ["20:00", 20, 22], ["22:00", 22, 24]];
        const heat = WD.map((d) => bands.map(([, a, b]) => g.HOUR.filter((x) => { const h = String(x.hour), wd = WD[(new Date(`${h.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7], hr = Number(h.slice(11, 13)); return wd === d && hr >= a && hr < b; }).reduce((s, x) => s + Number(x.clicks), 0)));
        const hourDays = new Set(g.HOUR.map((x) => String(x.hour).slice(0, 10))).size;
        const wdc = (prev: boolean) => WD.map((d) => g.T.filter((x) => x.type === "web" && (prev ? g.inPrev(x) : g.inCur(x)) && WD[(new Date(`${String(x.date)}T00:00:00Z`).getUTCDay() + 6) % 7] === d).reduce((s, x) => s + Number(x.clicks), 0));
        const app = [...groupM(g.APP.filter(g.inCur), (x) => String(x.appearance))].sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions);
        // mobile vs desktop position per page
        const gap = [...groupM(g.pd(), (x) => String(x.page))].map(([p]) => { const mo = m(g.pd().filter((x) => x.page === p && x.device === "MOBILE")), de = m(g.pd().filter((x) => x.page === p && x.device === "DESKTOP")); return { p, mo, de }; })
          .filter((r) => r.mo.pos != null && r.de.pos != null && r.mo.impressions + r.de.impressions >= 20).map((r) => ({ page: pathOf(r.p), mob: r.mo.pos!, desk: r.de.pos!, gap: r.mo.pos! - r.de.pos!, flag: Math.abs(r.mo.pos! - r.de.pos!) > 2 ? "Gap over 2" : "OK" })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Phone vs computer searchers" tech="Device split" sub={`Clicks by device, last ${g.p.days} days.`} span={5}>
                <Donut parts={dev.map(([d, v], i) => ({ label: d.toLowerCase(), value: v.clicks, color: deviceColor(d, i) }))} />
              </Card>
              <Card title="Where searchers are" tech="Countries" sub="Impressions by country. Search Console has no city dimension." span={7}>
                <BarList rows={cty.slice(0, 10).map(([c, v]) => ({ label: country(c), value: v.impressions, color: C[0], right: `${v.impressions.toLocaleString("en-US")} · ${v.clicks} clicks` }))} />
              </Card>
              <Card title="When people click on you" tech="Clicks by weekday and hour" sub={`From hourly data (dataState hourly_all), Pacific time as Search Console reports it. Google keeps hourly data for the last ${hourDays} days only.`}>
                {g.HOUR.length ? <Heat rows={WD} cols={bands.map((b) => b[0])} m={heat} color={C[0]} /> : <Missing why="Search Console returned no hourly data." fix="Hourly data covers only the most recent days; press Sync now." />}
              </Card>
              <Card title="Phone vs computer clicks over time" tech="Clicks by device over time" sub="Daily, from the [date, device] dimension set." span={7}>
                <LineChart id="gsc-dev" labels={labels(g)} series={devs.map((d, i) => ({ name: d.toLowerCase(), values: g.daily(g.DEV.filter((x) => g.inCur(x) && x.device === d), (x) => Number(x.clicks)), color: deviceColor(d, i) }))} />
              </Card>
              <Card title="Clicks by day of the week" tech="Clicks by weekday" sub="This period vs previous." span={5}>
                <ColChart id="gsc-wd" stacked={false} labels={WD} series={[{ name: "This period", values: wdc(false), color: C[0] }, { name: "Previous period", values: wdc(true), color: "var(--series-prev)" }]} />
              </Card>
              <Card title="Phone vs computer, by country" tech="Device mix by country" span={6}>
                <Stack100 rows={cty.slice(0, 8).map(([c]) => ({ label: country(c), parts: devs.map((d) => m(g.CD.filter((x) => g.inCur(x) && x.country === c && x.device === d)).impressions) }))} names={devs.map((d) => d.toLowerCase())} colors={devs.map((d, i) => deviceColor(d, i))} />
              </Card>
              <Card title="Clicks by result type" tech="Clicks by search appearance" span={6}>
                {app.length ? <Donut parts={app.map(([a, v], i) => ({ label: appName(a), value: v.clicks || v.impressions, color: C[i % C.length] }))} /> : <Missing why="Google reported no special result types (rich results, video, translated…) for this site in the period." fix="Add structured data that earns rich results (FAQ, reviews, breadcrumbs, video) to key pages." />}
                {app.length > 0 && app.every(([, v]) => !v.clicks) && <Note>No clicks came from special result types, so the donut shows impressions.</Note>}
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Pages that rank differently on phones and computers" tech="Mobile vs desktop ranking gap" sub="Pages ranking very differently by device (flagged over 2 positions)." span={7}>
                <Table site={siteOf(g)} facets={[{ k: "flag", label: "Gap" }]} rows={gap} cols={[{ k: "page", label: "Page", kind: "page" }, { k: "mob", label: "Mobile pos", num: true, f: "dec1" }, { k: "desk", label: "Desktop pos", num: true, f: "dec1" }, { k: "gap", label: "Gap", num: true, f: "dec1" }]} />
              </Card>
              <Card title="How your results look on Google" tech="Search appearance" sub="Result types and their CTR. Rich results lift CTR." span={5}>
                <Table rows={app.map(([a, v]) => ({ a: appName(a), clicks: v.clicks, impressions: v.impressions, ctr: v.ctr }))} cols={[{ k: "a", label: "Appearance" }, { k: "clicks", label: "Clicks", num: true }, { k: "impressions", label: "Impressions", num: true }, { k: "ctr", label: "CTR", num: true, f: "pct" }]} empty="0: no special result types in this period." />
              </Card>
              <Card title="Countries" tech="Countries table" sub="ISO country codes as Search Console reports them." span={12}>
                <Table limit={15} rows={cty.map(([c, v]) => ({ c: country(c), code: c.toUpperCase(), clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, pos: v.pos }))} cols={[{ k: "c", label: "Country" }, { k: "code", label: "Code", kind: "mono" }, { k: "clicks", label: "Clicks", num: true }, { k: "impressions", label: "Impressions", num: true, bar: C[0] }, { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pos", label: "Position", num: true, f: "dec1" }]} />
              </Card>
            </Grid>
            <Tasks screen="Devices, countries, appearance" id="segments" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
