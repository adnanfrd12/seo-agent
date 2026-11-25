import { BarList, ColChart, Donut, Gauge, Sankey, Treemap } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Missing, Note } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { addDays, groupM } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { sd, siteOf, Tasks, weekOf } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/indexing";
const DAY = 86_400_000;

export default async function IndexingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Indexing" description="Which pages are on Google, which aren't, and why.">
      {({ g, wins }) => {
        const inv = g.inv, n = inv.length;
        const lat = inv.map((r) => ({ r, i: g.latest(r.url) }));
        const inspected = lat.filter((x) => x.i);
        const indexed = inspected.filter((x) => x.i!.verdict === "PASS");
        const notIdx = inspected.filter((x) => x.i!.verdict !== "PASS");
        const in30 = inspected.filter((x) => Date.now() - Date.parse(x.i!.at) < 30 * DAY);
        const reasons = [...groupM(notIdx.map((x) => ({ k: x.i!.coverageState, clicks: 1, impressions: 0, posx: 0 })), (x) => String(x.k))].map(([k, v]) => ({ k, n: v.clicks })).sort((a, b) => b.n - a.n);
        const age = (x: (typeof lat)[number]) => (x.i?.lastCrawlTime ? (Date.now() - Date.parse(x.i.lastCrawlTime)) / DAY : null);
        const fresh = [["Under 7 days", (d: number | null) => d != null && d < 7], ["7–30 days", (d: number | null) => d != null && d >= 7 && d < 30], ["30–90 days", (d: number | null) => d != null && d >= 30 && d < 90], ["90+ days", (d: number | null) => d != null && d >= 90], ["Never", (d: number | null) => d == null]] as const;
        const fetchSt = [...groupM(inspected.map((x) => ({ k: x.i!.pageFetchState || "UNSPECIFIED", clicks: 1, impressions: 0, posx: 0 })), (x) => String(x.k))].sort((a, b) => b[1].clicks - a[1].clicks);
        const inSm = (x: (typeof lat)[number]) => x.r.sitemaps.length > 0 || (x.i?.sitemap.length ?? 0) > 0;
        const canon = inspected.filter((x) => x.i!.googleCanonical && x.i!.userCanonical);
        const agreed = canon.filter((x) => x.i!.googleCanonical === x.i!.userCanonical).length;
        const crawled = inspected.filter((x) => x.i!.crawledAs);
        const mobile = crawled.filter((x) => x.i!.crawledAs === "MOBILE").length;
        // weekly indexed vs not, rebuilt from inspection history (latest result as of each week end)
        const allAt = Object.values(g.insp).flat().map((h) => h.at.slice(0, 10)).sort();
        const firstWeek = allAt[0] ? weekOf(allAt[0]) : null;
        const weeks: string[] = []; if (firstWeek) for (let w = firstWeek; w <= g.meta.end || weeks.length === 0; w = addDays(w, 7)) { weeks.push(w); if (weeks.length > 30) break; }
        const asOf = (end: string) => { let a = 0, b = 0; for (const h of Object.values(g.insp)) { const x = h.find((e) => e.at.slice(0, 10) <= end); if (!x) continue; if (x.verdict === "PASS") a++; else b++; } return [a, b]; };
        const wk = weeks.map((w) => asOf(addDays(w, 6)));
        const crawlWeeks = new Map<string, number>(); for (const x of inspected) if (x.i!.lastCrawlTime) { const w = weekOf(x.i!.lastCrawlTime.slice(0, 10)); crawlWeeks.set(w, (crawlWeeks.get(w) ?? 0) + 1); }
        const cw = [...crawlWeeks].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
        const statusOf = (v: string) => (v === "PASS" ? "Indexed (PASS)" : v === "NEUTRAL" ? "Excluded (NEUTRAL)" : "Not indexed (FAIL)");
        const flows: [string, string, number][] = [];
        for (const [a, b] of [["In sitemap", true], ["Not in sitemap", false]] as const) for (const v of ["PASS", "NEUTRAL", "FAIL"]) { const c = inspected.filter((x) => inSm(x) === b && (v === "FAIL" ? !["PASS", "NEUTRAL"].includes(x.i!.verdict) : x.i!.verdict === v)).length; if (c) flows.push([a, statusOf(v), c]); }
        const verdicts = [...groupM(inspected.map((x) => ({ k: statusOf(x.i!.verdict), clicks: 1, impressions: 0, posx: 0 })), (x) => String(x.k))];
        const impr28 = groupM(g.PG.filter((x) => String(x.date) > addDays(g.meta.end, -28)), (x) => String(x.page));
        const lastCrawlTxt = (d: number | null) => (d == null ? "never" : d < 1 ? "today" : `${Math.round(d)} days ago`);
        const rows = lat.map((x) => {
          const d = age(x), st = !x.i ? "Not inspected" : x.i.verdict === "PASS" ? "Indexed" : x.i.verdict === "NEUTRAL" ? "Excluded" : "Not indexed";
          return { url: pathOf(x.r.url), status: st, statusTone: st === "Indexed" ? "good" : st === "Not inspected" ? "mute" : "bad", reason: x.i?.coverageState ?? "Waiting for the inspection queue", last: lastCrawlTxt(d), lastB: d == null ? "never" : d < 7 ? "under 7 days" : d < 30 ? "7–30" : "30+", as: x.i?.crawledAs ?? "–", sm: inSm(x) ? "in" : "not in", refs: x.i?.referringUrls.length ?? 0, impr: impr28.get(x.r.url)?.impressions ?? 0, fetch: x.i?.pageFetchState ?? "–" };
        });
        const quota = g.quota.date === new Date().toISOString().slice(0, 10) ? g.quota.used : 0;
        const daysToCover = Math.ceil(Math.max(0, n - in30.length) / 1800);
        if (!n) return <Missing title="URL inventory not built yet" why="The first sync reads the sitemaps, crawls each page and starts the URL Inspection queue in the background." fix="Reload in a few minutes, or press Sync now." />;
        return (
          <>
            <Kpis>
              <Kpi label="Pages we know about" tech="URLs in inventory" value={fmt("int", n)} note="Sitemap + Search Console + crawl" />
              <Kpi label="On Google" tech="Indexed" value={fmt("int", indexed.length)} note={inspected.length < n ? `of ${inspected.length} inspected so far` : undefined} />
              <Kpi label="Not on Google" tech="Not indexed" value={fmt("int", notIdx.length)} />
              <Kpi label="Checked in the last 30 days" tech="Inspected in 30 days" value={fmt("pct", n ? in30.length / n : 0)} note={`${in30.length} of ${n}${daysToCover ? ` · about ${daysToCover} day(s) to cover the rest` : ""}`} />
              <Kpi label="Page checks used today" tech="Inspection quota today" value={fmt("int", quota)} note="of about 2,000 a day" />
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="Why some pages aren't on Google" tech="Why pages aren't indexed" info="Coverage state from the URL Inspection API for every URL that isn't indexed." span={6}>
                <BarList rows={reasons.map((r) => ({ label: r.k, value: r.n, color: C[7] }))} empty="Every inspected URL is indexed." />
              </Card>
              <Card title="Pages on Google vs not, by week" tech="Indexed vs not indexed, weekly" info="Rebuilt from inspection history." span={6}>
                <ColChart id="gsc-idx-wk" labels={weeks.map(sd)} series={[{ name: "Indexed", values: wk.map((x) => x[0]), color: C[2] }, { name: "Not indexed", values: wk.map((x) => x[1]), color: C[7] }]} />
                {weeks.length < 3 && <Note>Inspection history starts {firstWeek ? sd(firstWeek) : "with the first sync"}; this chart grows a week at a time.</Note>}
              </Card>
              <Card title="How recently Google visited each page" tech="Crawl freshness" sub="Days since Google last crawled each URL." span={6}>
                <BarList rows={fresh.map(([l, f]) => ({ label: l, value: inspected.filter((x) => f(age(x))).length, color: C[0] }))} />
              </Card>
              <Card title="Could Google load each page?" tech="Page fetch state" span={6}>
                <BarList rows={fetchSt.map(([k, v]) => ({ label: k, value: v.clicks, color: k === "SUCCESSFUL" ? C[2] : C[7] }))} />
              </Card>
              <Card title="Index health" info="Indexed = PASS ÷ inspected. In a sitemap = URLs in a submitted sitemap ÷ inventory. Crawled in 30 days = lastCrawlTime within 30 days ÷ inspected. Canonical agreed = Google's canonical = yours ÷ URLs with both. Crawled as mobile = MOBILE ÷ crawled.">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <Gauge v={inspected.length ? indexed.length / inspected.length : null} label="Indexed" color={C[2]} />
                  <Gauge v={n ? lat.filter(inSm).length / n : null} label="In a sitemap" color={C[0]} />
                  <Gauge v={inspected.length ? inspected.filter((x) => (age(x) ?? 999) < 30).length / inspected.length : null} label="Crawled in 30 days" color={C[6]} />
                  <Gauge v={canon.length ? agreed / canon.length : null} label="Canonical agreed" color={C[3]} />
                  <Gauge v={crawled.length ? mobile / crawled.length : null} label="Crawled as mobile" color={C[4]} />
                </div>
              </Card>
              <Card title="Pages in your sitemap vs pages on Google" tech="Discovery → index status" span={6}>
                <Sankey flows={flows} rightColor={C[2]} />
              </Card>
              <Card title="Why pages aren't on Google" tech="Not-indexed reasons" sub="Area = number of URLs." span={6}>
                <Treemap items={reasons.map((r, i) => ({ label: r.k, value: r.n, color: C[(i + 1) % C.length] }))} />
              </Card>
              <Card title="Google's visits to your site each week" tech="Googlebot crawls per week" info="Last crawl times per week, from inspection history." span={6}>
                <ColChart id="gsc-idx-crawl" labels={cw.map(([w]) => sd(w))} series={[{ name: "URLs crawled", values: cw.map(([, v]) => v), color: C[0] }]} />
              </Card>
              <Card title="Pages on Google" tech="Index status" span={6}>
                <Donut parts={verdicts.map(([k, v]) => ({ label: k, value: v.clicks, color: k.startsWith("Indexed") ? C[2] : k.startsWith("Excluded") ? C[3] : C[7] }))} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Every page and whether it's on Google" tech="Every URL and its index status" sub="Request indexing and Validate fix are done in Search Console itself." info="Index verdict, coverage state, last crawl, crawler, canonicals and sitemap membership per URL. 'Request indexing' and 'Validate fix' are buttons in Search Console only (no API).">
                <Table site={siteOf(g)} limit={25} rows={rows}
                  facets={[{ k: "status", label: "Index status" }, { k: "reason", label: "Reason" }, { k: "as", label: "Crawled as" }, { k: "sm", label: "Sitemap" }, { k: "lastB", label: "Last crawled" }, { k: "fetch", label: "Page fetch" }]}
                  cols={[{ k: "url", label: "URL", kind: "page" }, { k: "status", label: "Status", kind: "tag" }, { k: "reason", label: "Reason / coverage state", wrap: true }, { k: "last", label: "Last crawl" }, { k: "as", label: "Crawled as" }, { k: "sm", label: "In sitemap" }, { k: "refs", label: "Referring URLs", num: true }, { k: "impr", label: "Impr. 28d", num: true }]} />
              </Card>
              <Card title="Pages where Google picked a different main version" tech="Canonical mismatches" span={6}>
                <Table rows={canon.filter((x) => x.i!.googleCanonical !== x.i!.userCanonical).map((x) => ({ url: pathOf(x.r.url), yours: pathOf(x.i!.userCanonical!), google: pathOf(x.i!.googleCanonical!) }))} cols={[{ k: "url", label: "URL", wrap: true }, { k: "yours", label: "Your canonical", wrap: true }, { k: "google", label: "Google's choice", wrap: true }]} empty="Google agrees with every declared canonical." />
              </Card>
            </Grid>
            <Tasks screen="Indexing" id="indexing" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
