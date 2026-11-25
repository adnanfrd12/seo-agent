import { CompareBars, Scatter, Stack100, Treemap } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { RegexBox } from "@/components/ga4x/regex-box";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Note } from "@/components/ga4x/ui";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import { queryTable } from "@/lib/gscx/analysis";
import { m } from "@/lib/gscx/g";
import { isQuestion, matcher, re2Error } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { QueryTable, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/queries";
const BUCKETS: [string, number, number][] = [["1-3", 0, 3.5], ["4-10", 3.5, 10.5], ["11-20", 10.5, 20.5], ["21+", 20.5, 1e9]];

export default async function QueriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const seg = first(sp.seg) ?? "", rx = (first(sp.rx) ?? "").slice(0, 4096);
  return (
    <GscScreen sp={sp} path={PATH} types title="Queries and regex" description="Every search that shows your site, filtered by segment or regex.">
      {({ g, wins }) => {
        const s = g.segs.find((x) => x.id === seg) ?? null;
        const rxErr = rx ? re2Error(rx) : null;
        const re = rx && !rxErr ? new RegExp(rx, "i") : null;
        const segM = s ? matcher(s) : null;
        const pass = (q: string) => (!segM || segM(q)) && (!re || re.test(q));
        const rows = queryTable(g, pass);
        const all = m(g.q()), allP = m(g.q(true));
        const sel = m(g.q().filter((x) => pass(String(x.query)))), selP = m(g.q(true).filter((x) => pass(String(x.query))));
        const segStats = g.segs.map((sg) => { const f = matcher(sg); const cur = m(g.q().filter((x) => f(String(x.query)))), prev = m(g.q(true).filter((x) => f(String(x.query)))); const qs = new Set(g.q().filter((x) => f(String(x.query))).map((x) => String(x.query))).size; return { sg, cur, prev, qs }; });
        const topSegs = segStats.filter((x) => x.cur.impressions > 0).sort((a, b) => b.cur.clicks - a.cur.clicks || b.cur.impressions - a.cur.impressions).slice(0, 12);
        const posMix = topSegs.map((x) => { const f = matcher(x.sg); const qs = [...g.queries()].filter(([q]) => f(q)); return { label: x.sg.name, parts: BUCKETS.map(([, lo, hi]) => qs.filter(([, v]) => v.pos != null && v.pos > lo && v.pos <= hi).reduce((a, [, v]) => a + v.impressions, 0)) }; });
        const unset = (id: string) => (id === "brand" || id === "nonbrand" ? !g.settings.brand.length : id === "cities" ? !g.settings.cities.length : id === "services" ? !g.settings.services.length : id === "competitors" ? !g.settings.competitors.length : false);
        return (
          <>
            <Grid>
              <Card title="Filter the searches people make" tech="Segment and regex filter" sub="Pick a segment, type a regex (RE2, case-insensitive), or both." info="Pick a saved segment, type any regex (RE2 syntax, case-insensitive), or both. The regex runs on the stored Search Console query rows (the same rows an includingRegex filter returns from the API), so it filters within a second.">
                <div className="flex flex-wrap items-end gap-4">
                  <FilterSelect label="Segment" name="seg" value={seg} path={PATH} sp={sp} options={[{ value: "", label: "All queries" }, ...g.segs.map((x) => ({ value: x.id, label: `${x.name}${unset(x.id) ? " (set the list first)" : ""}` }))]} />
                  <RegexBox value={rx} hrefFor={{ base: withParams(PATH, sp, { rx: null }) }} />
                </div>
                {s && <Note>Segment pattern: <code className="font-mono">{s.exclude ? "NOT " : ""}{s.rx.length > 200 ? `${s.rx.slice(0, 200)}…` : s.rx}</code>{unset(s.id) && " · The list behind this segment is empty, so it matches nothing (0). Add it on the Brand or Local demand screen."}</Note>}
                {rxErr && <p className="mt-2 text-xs text-negative">Invalid pattern: {rxErr}</p>}
              </Card>
            </Grid>
            <div className="mt-4"><Kpis>
              <Kpi label="Searches that match" tech="Matching queries" value={fmt("int", new Set(g.q().filter((x) => pass(String(x.query))).map((x) => String(x.query))).size)} />
              <Kpi label="Clicks" value={fmt("int", sel.clicks)} cur={sel.clicks} prev={selP.clicks} />
              <Kpi label="Times shown on Google" tech="Impressions" value={fmt("int", sel.impressions)} cur={sel.impressions} prev={selP.impressions} />
              <Kpi label="Click rate" tech="CTR" value={fmt("pct", sel.ctr)} cur={sel.ctr} prev={selP.ctr} />
              <Kpi label="Average Google ranking" tech="Avg position" value={sel.pos == null ? "0" : sel.pos.toFixed(1)} cur={sel.pos} prev={selP.pos} invert />
              <Kpi label="Share of all your clicks" tech="Share of site clicks" value={fmt("pct", all.clicks ? sel.clicks / all.clicks : 0)} cur={all.clicks ? sel.clicks / all.clicks : 0} prev={allP.clicks ? selP.clicks / allP.clicks : 0} />
            </Kpis></div>
            <Band title="Charts" />
            <Grid>
              <Card title="Ranking vs click rate for each search" tech="Position vs CTR" sub="Bubble = impressions." info="Each bubble is a query, sized by impressions. Bottom-left queries rank well but get few clicks." span={7}>
                <Scatter points={rows.filter((r) => r.impressions >= 5).slice(0, 80).map((r) => ({ x: Math.max(1, r.pos), y: r.ctr, s: r.impressions, label: r.query, show: r.clicks >= (rows[0]?.clicks ?? 0) * 0.5 && r.clicks > 0, c: g.isBrand(r.query) ? C[4] : isQuestion(r.query) ? C[2] : C[0] }))} xLabel="Average position (log scale)" yLabel="CTR" xf="dec1" logX quad={[["Rank well, few clicks", 0, 0]]} />
                <Note>Pink = brand · green = questions · blue = other.</Note>
              </Card>
              <Card title="Which searches bring the clicks" tech="Clicks by query" sub="Share of this filter's clicks." span={5}>
                <Treemap items={[...rows].sort((a, b) => b.impressions - a.impressions).slice(0, 14).filter((r) => r.clicks > 0).map((r, i) => ({ label: r.query, value: r.clicks, color: C[i % C.length] }))} />
              </Card>
              <Card title="Search groups: this month vs last" tech="Segments: this period vs last" sub="Clicks per segment; grey line = previous period." span={6}>
                <CompareBars rows={topSegs.map((x) => ({ label: x.sg.name, cur: x.cur.clicks, prev: x.prev.clicks }))} />
              </Card>
              <Card title="How high each search group ranks" tech="Position mix per segment" span={6}>
                <Stack100 rows={posMix} names={BUCKETS.map((b) => `Position ${b[0]}`)} colors={[C[2], C[0], C[3], C[7]]} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Searches that match your filter" tech="Matching queries" sub={`Last ${g.p.days} days vs previous ${g.p.days} days.`}>
                <QueryTable rows={rows} site={siteOf(g)} limit={25} empty="No query matches this filter in the period." />
              </Card>
              <Card title="Search groups compared side by side" tech="All segments compared">
                <Table limit={50} facets={[]} rows={segStats.map((x) => ({ seg: x.sg.name, queries: x.qs, clicks: x.cur.clicks, chg: x.cur.clicks, prev: x.prev.clicks, impressions: x.cur.impressions, ctr: x.cur.ctr, pos: x.cur.pos, share: all.clicks ? x.cur.clicks / all.clicks : 0 }))}
                  cols={[{ k: "seg", label: "Segment" }, { k: "queries", label: "Queries", num: true }, { k: "clicks", label: "Clicks", num: true, bar: C[0] }, { k: "chg", label: "Change", num: true, kind: "delta", prevKey: "prev" }, { k: "impressions", label: "Impressions", num: true }, { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pos", label: "Position", num: true, f: "dec1" }, { k: "share", label: "Share of clicks", num: true, f: "pct" }]} />
              </Card>
            </Grid>
            <Tasks screen="Queries and regex" id="queries" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
