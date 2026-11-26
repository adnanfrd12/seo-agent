import { BarList, LineChart, Scatter, Stack100, WhatChanged } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Note } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { belowExpected, decliningQueries, lostQueries, pageTable, pageTwoRescue, strikingDistance, titleCandidates } from "@/lib/gscx/analysis";
import { benchmarkCtr, pathOf } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { QueryTable, siteOf, Tasks } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/opportunities";

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Opportunities" description="Keywords close to page one, missed clicks, lost searches and titles to rewrite.">
      {({ g, wins }) => {
        const f = 30 / g.p.days;
        const sd = strikingDistance(g), be = belowExpected(g), tc = titleCandidates(g, pageTable(g)), p2 = pageTwoRescue(g), lq = lostQueries(g), dq = decliningQueries(g);
        const curve = g.ownCurve();
        const pos = Array.from({ length: 20 }, (_, i) => i + 1);
        const potByPage = new Map<string, number>(); for (const r of sd) potByPage.set(r.page, (potByPage.get(r.page) ?? 0) + r.potential);
        const missByPage = new Map<string, number>(); for (const r of be) missByPage.set(r.page, (missByPage.get(r.page) ?? 0) + r.missed);
        const linkByPage = new Map<string, number>(); for (const w of wins.filter((x) => x.type === "Internal links")) linkByPage.set(w.page, (linkByPage.get(w.page) ?? 0) + w.gain);
        const mixPages = [...new Set([...potByPage.keys(), ...missByPage.keys()])].map((p) => ({ p, parts: [potByPage.get(p) ?? 0, missByPage.get(p) ?? 0, linkByPage.get(pathOf(p)) ?? 0] })).sort((a, b) => b.parts.reduce((x, y) => x + y, 0) - a.parts.reduce((x, y) => x + y, 0)).slice(0, 8);
        const now = g.totals().clicks * f;
        const titleGain = now * 0.04;
        const items = [
          { label: "Rank higher (35% of striking-distance potential)", value: sd.reduce((a, r) => a + r.potential, 0) * 0.35 * f },
          { label: "Fix CTR (50% of missed clicks)", value: be.reduce((a, r) => a + r.missed, 0) * 0.5 * f },
          { label: "Rescue page two (60% of last period's clicks)", value: p2.reduce((a, r) => a + r.prevClicks, 0) * 0.6 * f },
          { label: "Title rewrites (4% of clicks)", value: titleGain },
        ].map((x) => ({ ...x, value: Math.round(x.value * 10) / 10 }));
        return (
          <>
            <Band title="Charts" />
            <Grid>
              <Card title="Are you getting the clicks your rankings deserve?" tech="Expected vs actual CTR by position" info="The site's own non-brand CTR curve (last 90 days, positions with 200+ impressions) compared with the benchmark the portal uses." span={5}>
                <LineChart id="gsc-opp-curve" noToggle f="pct" labels={pos.map(String)} series={[{ name: "This site (non-brand)", values: pos.map((p) => curve.get(p) ?? null), color: C[0] }, { name: "Benchmark", values: pos.map((p) => benchmarkCtr(p)), color: "var(--series-prev)", dash: true }]} />
                {curve.size < 5 && <Note>Only {curve.size} positions have enough impressions for the site&apos;s own curve; the benchmark fills the rest in calculations.</Note>}
              </Card>
              <Card title="Keywords almost on page one (map)" tech="Striking distance map" sub="Positions 8–20 · bubble = potential clicks." info="Each bubble is a query at position 8–20, sized by potential clicks. Higher = more impressions to win." span={7}>
                <Scatter points={sd.slice(0, 60).map((r) => ({ x: r.pos, y: r.impressions, s: Math.max(0.1, r.potential), label: r.query, show: r.potential >= (sd[0]?.potential ?? 0) * 0.4 }))} xLabel="Position" yLabel="Impressions" xf="dec1" yf="int" />
              </Card>
              <Card title="Pages with the most clicks to win" tech="Potential clicks by page" info="Sum of striking-distance potential." span={5}>
                <BarList rows={[...potByPage].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, v]) => ({ label: pathOf(p), value: v, color: C[2] }))} f="dec1" empty="No query at positions 8–20 with 100+ impressions." />
              </Card>
              <Card title="Clicks you could gain" tech="Click forecast if the work is done" sub="An estimate; assumptions are in each bar's name." info="Monthly clicks now, plus the estimated gain from each type of fix. An estimate: assumptions are in each bar's name." span={7}>
                <WhatChanged id="gsc-opp-fc" unit="clicks a month" f="dec1" start={Math.round(now * 10) / 10} items={items} startLabel="Clicks a month now" endLabel="If the work is done" />
              </Card>
              <Card title="What each page needs" tech="Opportunity mix by page" sub="By potential clicks.">
                <Stack100 f="dec1" rows={mixPages.map((x) => ({ label: pathOf(x.p), parts: x.parts }))} names={["Rank higher", "Fix CTR", "Add internal links"]} colors={[C[2], C[1], C[0]]} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Keywords almost on page one" tech="Striking distance" sub="Positions 8–20 with 100+ impressions." info="Positions 8–20 with 100+ impressions. Score = impressions × (CTR at position 3 − current CTR)." span={7}>
                <Table site={siteOf(g)} rows={sd.map((r) => ({ q: r.query, pos: r.pos, impr: r.impressions, ctr: r.ctr, pot: r.potential, page: pathOf(r.page) }))} cols={[{ k: "q", label: "Query", wrap: true }, { k: "pos", label: "Position", num: true, f: "dec1" }, { k: "impr", label: "Impr.", num: true }, { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pot", label: "Potential clicks", num: true, f: "dec1", bar: C[2] }, { k: "page", label: "Page", kind: "page" }]} empty="0: no query sits at positions 8–20 with 100+ impressions in this period." />
              </Card>
              <Card title="Searches where you get fewer clicks than you should" tech="CTR below expected" sub="200+ impressions, CTR under 75% of expected." info="Rows getting fewer clicks than their position should bring (200+ impressions, CTR under 75% of expected), with the clicks missed." span={5}>
                <Table rows={be.map((r) => ({ q: r.query, pos: r.pos, ctr: r.ctr, exp: r.exp, missed: r.missed }))} cols={[{ k: "q", label: "Query", wrap: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "exp", label: "Expected", num: true, f: "pct" }, { k: "missed", label: "Missed clicks", num: true, f: "dec1" }]} empty="0: every query with 200+ impressions gets at least 75% of the expected clicks." />
              </Card>
              <Card title="Pages whose Google headline should be rewritten" tech="Title rewrite candidates" sub="Edit the [placeholder] before using a title." info="Pages ranking well (position ≤ 8.5) with weak CTR, with a draft title built from their top query. Edit the [placeholder] before using it.">
                <Table site={siteOf(g)} rows={tc.map((p) => ({ page: pathOf(p.page), title: p.title ?? "(not crawled yet)", q: p.topQuery ?? "", s: p.suggested }))} cols={[{ k: "page", label: "Page", kind: "page" }, { k: "title", label: "Current title", wrap: true }, { k: "q", label: "Top query", wrap: true }, { k: "s", label: "Suggested title", wrap: true }]} empty="0: no page at position ≤ 8.5 with 100+ impressions has a CTR below 80% of expected." />
              </Card>
              <Card title="Keywords that slipped to page two" tech="Page two rescue">
                <QueryTable rows={p2} site={siteOf(g)} empty="0: no query dropped from page one to page two." />
              </Card>
              <Card title="Searches you lost" tech="Lost queries" sub={`Clicks or impressions in the previous ${g.p.days} days, none in the last ${g.p.days}.`} info="Queries that had clicks or impressions in the previous period and none in this one, with the page they landed on before, its status now and the likely cause. Google hides rare (anonymized) queries, so very small ones can drop out of the data without being lost." span={7}>
                <Table site={siteOf(g)} facets={[{ k: "cause", label: "Likely cause" }]} rows={lq.map((r) => ({ q: r.query, clicks: r.prevClicks, impr: r.prevImpr, pos: r.prevPos, page: r.page ? pathOf(r.page) : "–", cause: r.cause }))}
                  cols={[{ k: "q", label: "Query", wrap: true }, { k: "clicks", label: "Clicks before", num: true, bar: C[7] }, { k: "impr", label: "Impr. before", num: true }, { k: "pos", label: "Pos before", num: true, f: "dec1" }, { k: "page", label: "Page", kind: "page" }, { k: "cause", label: "Likely cause", wrap: true }]} empty="0: every search from the previous period still shows the site." />
              </Card>
              <Card title="Searches bringing fewer clicks" tech="Declining queries" sub="Still shown, fewer clicks than the previous period." span={5}>
                <Table rows={dq.map((r) => ({ q: r.query, clicks: r.clicks, d: r.dClicks, pos: r.pos, dpos: r.dPos }))} cols={[{ k: "q", label: "Query", wrap: true }, { k: "clicks", label: "Clicks", num: true }, { k: "d", label: "Δ clicks", num: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "dpos", label: "Δ pos", num: true, f: "dec1" }]} empty="0: no query lost clicks in this period." />
              </Card>
            </Grid>
            <Tasks screen="Opportunities" id="opps" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
