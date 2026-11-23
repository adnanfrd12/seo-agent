import { Donut, LineChart, Stack100 } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { addDays, groupM } from "@/lib/gscx/g";
import { pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { sd, Tasks, weekOf } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/sitemaps";

export default async function SitemapsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Sitemaps and rich results" description="The page lists sent to Google, how much of each is indexed, problems inside them, and extra result features found.">
      {({ g, wins }) => {
        const sms = g.sitemaps.map((s) => {
          const idx = s.urls.filter((u) => g.latest(u)?.verdict === "PASS").length, insp = s.urls.filter((u) => g.latest(u)).length;
          const stale = !s.lastDownloaded || Date.now() - Date.parse(s.lastDownloaded) > 14 * 86_400_000;
          return { ...s, idx, insp, status: s.errors ? "Has errors" : s.isPending ? "Pending" : stale ? "Not read in 14+ days" : "Success", statusTone: s.errors ? "bad" : stale ? "warn" : "good" };
        });
        const health: { issue: string; example: string; urls: number }[] = [];
        const urls = [...new Set(g.sitemaps.flatMap((s) => s.urls))];
        const crawl = (u: string) => g.crawl(u);
        const check = (issue: string, pred: (u: string) => boolean) => { const hit = urls.filter(pred); if (hit.length) health.push({ issue, example: pathOf(hit[0]), urls: hit.length }); };
        check("Redirects", (u) => !!crawl(u)?.redirect);
        check("Returns 4xx", (u) => (crawl(u)?.status ?? 0) >= 400 && (crawl(u)?.status ?? 0) < 500);
        check("Returns 5xx", (u) => (crawl(u)?.status ?? 0) >= 500);
        check("Carries noindex", (u) => /noindex/i.test(`${crawl(u)?.robots ?? ""} ${crawl(u)?.xRobots ?? ""}`));
        check("Canonicalises to another URL", (u) => { const c = crawl(u)?.canonical; return !!c && c.replace(/\/$/, "") !== u.replace(/\/$/, ""); });
        check("Not indexed by Google", (u) => !!g.latest(u) && g.latest(u)!.verdict !== "PASS");
        const rich = new Map<string, { items: number; warnings: number; errors: number }>();
        for (const h of Object.values(g.insp)) for (const r of h[0]?.rich ?? []) { const e = rich.get(r.type) ?? { items: 0, warnings: 0, errors: 0 }; e.items += r.items; e.warnings += r.warnings; e.errors += r.errors; rich.set(r.type, e); }
        const apps = [...new Set(g.APP.map((x) => String(x.appearance)))];
        const from = addDays(g.meta.end, -89);
        const weeks = [...new Set(g.APP.filter((x) => String(x.date) >= from).map((x) => weekOf(String(x.date))))].sort();
        const wk = apps.map((a, i) => { const byW = groupM(g.APP.filter((x) => x.appearance === a && String(x.date) >= from), (x) => weekOf(String(x.date))); return { name: a.replace(/_/g, " ").toLowerCase(), values: weeks.map((w) => byW.get(w)?.clicks ?? 0), color: C[i % C.length] }; });
        const inspectedAny = Object.keys(g.insp).length > 0;
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="How much of each sitemap is on Google" tech="Indexed share per sitemap" sub="Indexed = URLs whose latest inspection is PASS." span={6}>
                {sms.length ? <Stack100 rows={sms.map((s) => ({ label: pathOf(s.path), parts: [s.idx, Math.max(0, s.urls.length - s.idx)] }))} names={["Indexed", "Not indexed or not inspected yet"]} colors={[C[2], "var(--cat-other)"]} />
                  : <Missing why="No sitemap is submitted in Search Console for this site." fix="Submit the sitemap (e.g. /sitemap.xml or /sitemap_index.xml) in Search Console → Sitemaps." />}
              </Card>
              <Card title="Extra result features found" tech="Valid rich result items" sub="By type, from the latest URL inspection of each page." span={6}>
                {rich.size ? <Donut parts={[...rich].map(([t, v], i) => ({ label: t, value: v.items - v.errors, color: C[i % C.length] }))} /> : <Missing why={inspectedAny ? "No inspected page has structured data Google recognises as a rich result." : "URL inspections are still running."} fix="Add structured data (FAQ, Review, Breadcrumb, LocalBusiness) to key pages; it shows here after the next inspection round." />}
              </Card>
              <Card title="Clicks from extra result features" tech="Rich result clicks, weekly" sub="Clicks where a rich result was shown (searchAppearance filter).">
                {apps.length ? <LineChart id="gsc-rich-wk" labels={weeks.map(sd)} series={wk} /> : <Missing why="Google reported no rich-result appearances for this site in the last 180 days." fix="Add structured data that earns rich results (FAQ, reviews, breadcrumbs, video)." />}
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Your sitemaps (page lists sent to Google)" tech="Submitted sitemaps" sub="From sitemaps.list. Indexed counts are computed from inspections because the API's own count is deprecated. Submit and resubmit in Search Console → Sitemaps.">
                <Table rows={sms.map((s) => ({ path: pathOf(s.path), type: s.isIndex ? "Index" : s.type, status: s.status, statusTone: s.statusTone, read: s.lastDownloaded ? sd(s.lastDownloaded.slice(0, 10)) : "never", sub: s.submitted || s.urls.length, idx: s.idx, pct: s.urls.length ? s.idx / s.urls.length : 0, err: s.errors, warn: s.warnings }))}
                  cols={[{ k: "path", label: "Sitemap", kind: "mono" }, { k: "type", label: "Type" }, { k: "status", label: "Status", kind: "tag" }, { k: "read", label: "Last read" }, { k: "sub", label: "Submitted", num: true }, { k: "idx", label: "Indexed", num: true }, { k: "pct", label: "Indexed %", num: true, f: "pct" }, { k: "err", label: "Errors", num: true }, { k: "warn", label: "Warnings", num: true }]} empty="0: no sitemaps submitted." />
              </Card>
              <Card title="Problems in your sitemaps" tech="Sitemap health" sub="URLs in sitemaps that shouldn't be there (from our crawl and the inspections)." span={6}>
                <Table rows={health} cols={[{ k: "issue", label: "Issue" }, { k: "example", label: "Example", kind: "mono" }, { k: "urls", label: "URLs", num: true }]} empty="Every sitemap URL loads, is indexable and is its own canonical." />
              </Card>
              <Card title="Extra result features (FAQs, breadcrumbs, reviews)" tech="Rich results detected" sub="From richResultsResult in URL inspections." span={6}>
                <Table rows={[...rich].map(([t, v]) => ({ t, valid: v.items - v.errors, w: v.warnings, inv: v.errors }))} cols={[{ k: "t", label: "Type" }, { k: "valid", label: "Valid items", num: true }, { k: "w", label: "Warnings", num: true }, { k: "inv", label: "Invalid", num: true }]} empty="0: no rich result items detected yet." />
              </Card>
            </Grid>
            <Tasks screen="Sitemaps and rich results" id="sitemaps" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
