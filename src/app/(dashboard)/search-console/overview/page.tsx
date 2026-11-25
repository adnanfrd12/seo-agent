import { BarList, CalHeat, ColChart, Gauge, LineChart, Treemap, WhatChanged } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Note } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { pageTable, queryTable } from "@/lib/gscx/analysis";
import { addDays, groupM, m } from "@/lib/gscx/g";
import { pathOf, POS_BUCKETS, section } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { labels, sd, Tasks, weekOf } from "../_gscx/parts";
import { TYPES } from "@/lib/gscx/load";

export const maxDuration = 120;
const PATH = "/search-console/overview";

export default async function GscOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} types title="Overview" description="Clicks, impressions, click rate and ranking on Google search.">
      {({ g, wins }) => {
        const cur = g.totals(), prev = g.totals(true);
        const day = (prevP = false) => groupM(g.T.filter((x) => x.type === g.type && (prevP ? g.inPrev(x) : g.inCur(x))), (x) => String(x.date));
        const dc = day(), dp = day(true);
        const series = (mm: Map<string, ReturnType<typeof m>>, start: string, f: (v: ReturnType<typeof m>) => number) => Array.from({ length: g.p.days }, (_, i) => { const v = mm.get(addDays(start, i)); return v ? f(v) : 0; });
        const qAll = m(g.q()), qPrev = m(g.q(true));
        const hidden = cur.clicks ? Math.max(0, 1 - qAll.clicks / cur.clicks) : 0, hiddenP = prev.clicks ? Math.max(0, 1 - qPrev.clicks / prev.clicks) : 0;
        const brandC = m(g.q().filter((x) => g.isBrand(String(x.query)))).clicks, brandCP = m(g.q(true).filter((x) => g.isBrand(String(x.query)))).clicks;
        const brandShare = qAll.clicks ? brandC / qAll.clicks : 0, brandShareP = qPrev.clicks ? brandCP / qPrev.clicks : 0;
        // last 90 days for the long charts
        const s90 = addDays(g.meta.end, -89);
        const d90 = groupM(g.T.filter((x) => x.type === g.type && String(x.date) >= s90), (x) => String(x.date));
        const l90 = Array.from({ length: 90 }, (_, i) => addDays(s90, i));
        const byType = TYPES.map(([k, l]) => ({ label: l, value: g.totals(false, k).clicks }));
        // position distribution per week: queries per bucket (each query's weekly average position)
        const weeks = [...new Set(g.Q.filter((x) => String(x.date) >= s90).map((x) => weekOf(String(x.date))))].sort().filter((w) => addDays(w, 6) <= g.meta.end);
        const wq = new Map<string, Map<string, ReturnType<typeof m>>>();
        for (const w of weeks) wq.set(w, groupM(g.Q.filter((x) => weekOf(String(x.date)) === w), (x) => String(x.query)));
        const posDist = POS_BUCKETS.map(([b, lo, hi], i) => ({ name: b, values: weeks.map((w) => [...wq.get(w)!.values()].filter((v) => v.pos != null && v.pos > lo && v.pos <= hi).length), color: C[i] }));
        // new vs lost queries per week (seen for the first time / not seen again)
        const firstSeen = new Map<string, string>(), lastSeen = new Map<string, string>();
        for (const x of g.Q) { const w = weekOf(String(x.date)), q = String(x.query); if (!firstSeen.has(q) || w < firstSeen.get(q)!) firstSeen.set(q, w); if (!lastSeen.has(q) || w > lastSeen.get(q)!) lastSeen.set(q, w); }
        const firstWeek = [...firstSeen.values()].sort()[0];
        const lastWeek = weeks.at(-1);
        const newQ = weeks.map((w) => (w === firstWeek ? 0 : [...firstSeen.values()].filter((x) => x === w).length));
        const lostQ = weeks.map((w) => (w === lastWeek ? 0 : [...lastSeen.values()].filter((x) => x === w).length));
        const withClicks = weeks.map((w) => [...wq.get(w)!.values()].filter((v) => v.clicks > 0).length);
        const pagesWithClicks = weeks.map((w) => new Set(g.PG.filter((x) => weekOf(String(x.date)) === w && Number(x.clicks) > 0).map((x) => String(x.page))).size);
        const pages = pageTable(g);
        const top6 = [...pages].sort((a, b) => Math.abs(b.dClicks) - Math.abs(a.dClicks)).slice(0, 6);
        const rest = (cur.clicks - prev.clicks) - top6.reduce((a, p) => a + p.dClicks, 0);
        const sections = [...groupM(g.pg(), (x) => section(String(x.page)))].map(([k, v], i) => ({ label: k, value: v.clicks, color: C[i % C.length] }));
        const movers = queryTable(g).concat([...g.queries(true)].filter(([q]) => !g.queries().has(q)).map(([q, v]) => ({ query: q, page: "", clicks: 0, impressions: 0, ctr: 0, pos: 0, dClicks: -v.clicks, dPos: null, prevClicks: v.clicks }))).sort((a, b) => Math.abs(b.dClicks) - Math.abs(a.dClicks)).slice(0, 12);
        // gauges
        const urls = g.inv.length, indexed = g.inv.filter((r) => g.latest(r.url)?.verdict === "PASS").length;
        const devs = groupM(g.DEV.filter(g.inCur), (x) => String(x.device));
        const qc = g.queries(), p1 = [...qc.values()].filter((v) => v.pos != null && v.pos <= 10).reduce((a, v) => a + v.impressions, 0), allImp = [...qc.values()].reduce((a, v) => a + v.impressions, 0);
        const rich = m(g.APP.filter((x) => g.inCur(x) && !/^(WEB_LIGHT|AMP_BLUE_LINK)/.test(String(x.appearance)))).clicks;
        const cal = Array.from({ length: 90 }, (_, i) => d90.get(addDays(s90, i))?.clicks ?? 0);
        const typeName = TYPES.find(([k]) => k === g.type)?.[1] ?? "Web";
        return (
          <>
            <Kpis>
              <Kpi label="Clicks" value={fmt("int", cur.clicks)} cur={cur.clicks} prev={prev.clicks} spark={series(dc, g.p.start, (v) => v.clicks)} color={C[0]} />
              <Kpi label="Times shown on Google" tech="Impressions" value={fmt("int", cur.impressions)} cur={cur.impressions} prev={prev.impressions} spark={series(dc, g.p.start, (v) => v.impressions)} color={C[6]} />
              <Kpi label="Click rate" tech="CTR" value={fmt("pct", cur.ctr)} cur={cur.ctr} prev={prev.ctr} spark={series(dc, g.p.start, (v) => v.ctr)} color={C[2]} />
              <Kpi label="Average Google ranking" tech="Average position" value={cur.pos == null ? "0" : cur.pos.toFixed(1)} cur={cur.pos} prev={prev.pos} invert spark={series(dc, g.p.start, (v) => -(v.pos ?? 0))} color={C[3]} />
              <Kpi label="Clicks from private searches" tech="Hidden (anonymized) clicks" value={fmt("pct", hidden)} cur={hidden} prev={hiddenP} invert note="Totals minus visible query rows" />
              <Kpi label="Clicks from people searching your name" tech="Brand share of clicks" value={g.settings.brand.length ? fmt("pct", brandShare) : "0"} cur={brandShare} prev={brandShareP} missing={g.settings.brand.length ? undefined : "0: no brand terms are set. Add them on the Brand screen."} />
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="How many people saw and clicked your site on Google" tech="Clicks and impressions, last 90 days" sub="Daily totals." info="Daily, from date-only requests (true totals). Impressions rising faster than clicks in the last month is flagged in AI search." span={8}>
                <LineChart id="gsc-ov-90" labels={l90.map(sd)} series={[{ name: "Clicks", values: l90.map((d) => d90.get(d)?.clicks ?? 0), color: C[0], area: true }, { name: "Impressions ÷ 10", tech: "impressions / 10", values: l90.map((d) => (d90.get(d)?.impressions ?? 0) / 10), color: C[6] }]} />
              </Card>
              <Card title="Which Google tab people found you in" tech="Clicks by search type" info="Web, Image, Video, Discover and News are separate search types in Search Console." span={4}>
                <BarList rows={byType.map((r, i) => ({ label: r.label, value: r.value, color: C[i % C.length] }))} />
                {byType.slice(1).every((r) => !r.value) && <Note>Only Web search had clicks in this period.</Note>}
              </Card>
              <Card title="How high your keywords rank" tech="Position distribution" sub="Queries per position bucket, weekly." span={6}>
                <ColChart id="gsc-ov-posdist" labels={weeks.map(sd)} series={posDist} />
              </Card>
              <Card title="Key shares" info="Pages indexed = URLs whose latest inspection is PASS ÷ URLs in the inventory. Clicks from brand searches = brand query clicks ÷ query clicks. Clicks on mobile = mobile clicks ÷ clicks. Impressions on page one = impressions of queries at position ≤ 10 ÷ query impressions. Clicks with a rich result = clicks with a search appearance ÷ clicks.">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <Gauge v={urls ? indexed / urls : null} label="Pages indexed" sub={urls ? `${indexed} of ${urls} URLs` : "Inspections still running"} color={C[2]} />
                  <Gauge v={g.settings.brand.length ? brandShare : null} label="Clicks from brand searches" color={C[4]} />
                  <Gauge v={cur.clicks ? (devs.get("MOBILE")?.clicks ?? 0) / Math.max(1, [...devs.values()].reduce((a, v) => a + v.clicks, 0)) : null} label="Clicks on mobile" color={C[0]} />
                  <Gauge v={allImp ? p1 / allImp : null} label="Impressions on page one" color={C[6]} />
                  <Gauge v={cur.clicks ? rich / cur.clicks : null} label="Clicks with a rich result" color={C[3]} />
                </div>
              </Card>
              <Card title="Clicks from Google each day" tech="Daily clicks calendar" sub="Last 90 days · darker = more clicks." span={6}>
                <CalHeat values={cal} start={s90} color={C[0]} label="clicks" />
              </Card>
              <Card title="Click rate and ranking over time" tech="CTR and average position" sub="Daily. Position axis is reversed so up is better." span={6}>
                <LineChart id="gsc-ov-ctr" f="pct" labels={labels(g)} series={[{ name: "CTR", values: series(dc, g.p.start, (v) => v.ctr), color: C[2], area: true }, { name: "Previous period", values: series(dp, g.p.pstart, (v) => v.ctr), color: C[2], dash: true }]} h={160} />
                <LineChart labels={labels(g)} invert series={[{ name: "Average position", values: series(dc, g.p.start, (v) => v.pos ?? 0).map((v) => v || null), color: C[3] }]} h={160} />
              </Card>
              <Card title="What caused the change in clicks" tech="What changed clicks" sub={`By page, vs the previous ${g.p.days} days.`} span={6}>
                <WhatChanged id="gsc-ov-wf" unit="clicks" start={prev.clicks} items={[...top6.map((p) => ({ label: pathOf(p.page), value: p.dClicks })), { label: "All other pages", value: rest }]} />
              </Card>
              <Card title="Which parts of your site get the clicks" tech="Where clicks land" sub="Clicks by site section." span={6}>
                <Treemap items={sections} />
              </Card>
              <Card title="New searches you started showing for vs ones you lost" tech="New vs lost queries per week" info="Queries seen for the first time vs queries that stopped appearing (query-level daily data)." span={6}>
                <ColChart id="gsc-ov-newlost" stacked={false} labels={weeks.map(sd)} series={[{ name: "New queries", values: newQ, color: C[2] }, { name: "Lost queries", values: lostQ, color: C[7] }]} />
              </Card>
              <Card title="How many searches and pages bring clicks" tech="Queries and pages with clicks" sub="Weekly." info="Distinct queries and pages with at least one click, weekly." span={6}>
                <LineChart id="gsc-ov-distinct" labels={weeks.map(sd)} series={[{ name: "Queries with clicks", values: withClicks, color: C[0] }, { name: "Pages with clicks", values: pagesWithClicks, color: C[1] }]} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Searches that changed the most" tech="Biggest movers" sub={`Click change vs the previous ${g.p.days} days.`} span={6}>
                <Table rows={movers.map((r) => ({ query: r.query, clicks: r.clicks, chg: r.dClicks }))} cols={[{ k: "query", label: "Query", wrap: true }, { k: "clicks", label: "Clicks", num: true }, { k: "chg", label: "Change", num: true }]} />
              </Card>
              <Card title="Clicks by search type" tech={`Search type: ${typeName}`} info="True totals per Search Console search type for this period." span={6}>
                <Table rows={TYPES.map(([k, l]) => { const v = g.totals(false, k), p = g.totals(true, k); return { t: l, clicks: v.clicks, chg: v.clicks, prev: p.clicks, impressions: v.impressions, ctr: v.ctr, pos: v.pos }; })}
                  cols={[{ k: "t", label: "Search type" }, { k: "clicks", label: "Clicks", num: true }, { k: "chg", label: "Change", num: true, kind: "delta", prevKey: "prev" }, { k: "impressions", label: "Impressions", num: true }, { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pos", label: "Position", num: true, f: "dec1" }]} />
              </Card>
            </Grid>
            <Tasks screen="Overview" id="overview" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
