import { after } from "next/server";
import { ColChart, Gauge, LineChart, Scatter, Treemap } from "@/components/ga4x/charts";
import { C, fmt } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Note } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerFormat, hasHeading, pageTable, queryPages, queryTable } from "@/lib/gscx/analysis";
import { addDays, groupM, m } from "@/lib/gscx/g";
import { labelOf, labelQueries, loadLabels } from "@/lib/gscx/labels";
import { isQuestion, LEN_BANDS, pathOf, titleCase, words } from "@/lib/gscx/model";
import { GscScreen } from "../_gscx/screen";
import { QueryTable, sd, siteOf, Tasks, weekOf } from "../_gscx/parts";

export const maxDuration = 120;
const PATH = "/search-console/ai";

export default async function QuestionsAiPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <GscScreen sp={sp} path={PATH} title="Questions and AI search" description="Questions and long, AI-style searches, and where to answer them.">
      {async ({ g, wins, clientId, clientName }) => {
        const qc = g.queries(), qp = g.queries(true);
        const all = [...qc], allImp = all.reduce((a, [, v]) => a + v.impressions, 0);
        const qs = all.filter(([q]) => isQuestion(q)), prompt = all.filter(([q]) => words(q) >= 8), promptP = [...qp].filter(([q]) => words(q) >= 8);
        const sumI = (xs: [string, ReturnType<typeof m>][]) => xs.reduce((a, [, v]) => a + v.impressions, 0);
        const avgLen = (xs: [string, ReturnType<typeof m>][]) => { const i = sumI(xs); return i ? xs.reduce((a, [q, v]) => a + words(q) * v.impressions, 0) / i : 0; };
        const zero = all.filter(([, v]) => v.impressions >= 100 && v.clicks <= 1);
        const firstP = all.filter(([q]) => /\b(i|im|i'm|my|me|we|our|us)\b/i.test(q));
        const band = (xs: [string, ReturnType<typeof m>][]) => LEN_BANDS.map(([, lo, hi]) => xs.filter(([q]) => words(q) >= lo && words(q) <= hi).reduce((a, [, v]) => a + v.impressions, 0));
        // 16 months of query length (monthly query totals)
        const months = [...new Set(g.QM.map((x) => String(x.month)))].sort();
        const monthLen = months.map((mo) => { const rows = g.QM.filter((x) => x.month === mo); const i = rows.reduce((a, x) => a + Number(x.impressions), 0); return i ? rows.reduce((a, x) => a + words(String(x.query)) * Number(x.impressions), 0) / i : 0; });
        // weekly shares
        const from = addDays(g.meta.end, -89);
        const weeks = [...new Set(g.Q.filter((x) => String(x.date) >= from).map((x) => weekOf(String(x.date))))].sort().filter((w) => addDays(w, 6) <= g.meta.end);
        const share = (pred: (q: string) => boolean) => weeks.map((w) => { const rows = g.Q.filter((x) => weekOf(String(x.date)) === w), i = rows.reduce((a, x) => a + Number(x.impressions), 0); return i ? rows.filter((x) => pred(String(x.query))).reduce((a, x) => a + Number(x.impressions), 0) / i : 0; });
        // topics (LLM labels, cached; new queries are labelled in the background)
        const admin = createAdminClient();
        const labels = await loadLabels(admin, clientId);
        const toLabel = [...qs, ...prompt].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 300).map(([q]) => q);
        const missing = toLabel.filter((q) => !labelOf(labels, q));
        if (missing.length) after(() => labelQueries(createAdminClient(), clientId, toLabel, clientName).then(() => undefined, () => undefined));
        const topics = [...groupM([...qs, ...prompt].map(([q, v]) => ({ t: labelOf(labels, q) ?? "Not labelled yet", impressions: v.impressions, clicks: v.clicks, posx: (v.pos ?? 0) * v.impressions })), (x) => String(x.t))].sort((a, b) => b[1].impressions - a[1].impressions);
        // where to answer each question
        const pairs = queryPages(g);
        const where = [...qs, ...prompt.filter(([q]) => !isQuestion(q))].sort((a, b) => b[1].impressions - a[1].impressions).map(([q, v]) => {
          const page = pairs.filter((r) => r.query === q).sort((a, b) => b.impressions - a.impressions)[0]?.page ?? "";
          const fmtA = answerFormat(q), has = page ? hasHeading(g, page, q) : false;
          return { q, impr: v.impressions, pos: v.pos ?? 0, page: pathOf(page), h: has ? "Already has a matching heading" : `H2: ${titleCase(q.replace(/\?*$/, "?"))}`, fmt: fmtA, schema: "FAQPage" };
        });
        const pages = pageTable(g);
        const upFlat = pages.filter((p) => p.prev && p.prev.impressions >= 20 && p.impressions >= p.prev.impressions * 1.2 && p.clicks <= p.prev.clicks * 1.05 && p.prev.pos != null && Math.abs(p.pos - p.prev.pos) < 1)
          .map((p) => ({ page: pathOf(p.page), ic: `+${Math.round((p.impressions / p.prev!.impressions - 1) * 100)}%`, cc: p.prev!.clicks ? `${Math.round((p.clicks / p.prev!.clicks - 1) * 100)}%` : `${p.clicks} (was 0)`, pos: p.pos, ppos: p.prev!.pos }));
        const zeroRows = zero.map(([q, v]) => ({ q, impr: v.impressions, pos: v.pos ?? 0, reason: (v.pos ?? 99) > 10 ? "Ranks below page one" : isQuestion(q) ? "Answered on the results page (likely AI Overview or snippet)" : g.isBrand(q) ? "Navigational: people go straight to a map/profile result" : "Title or snippet doesn't match the search" }));
        return (
          <>
            <Kpis>
              <Kpi label="Questions people ask" tech="Question queries" value={fmt("int", qs.length)} note={`${fmt("int", sumI(qs))} impressions`} />
              <Kpi label="Long, AI-style searches" tech="Prompt-like (8+ words)" value={fmt("int", prompt.length)} cur={sumI(prompt)} prev={sumI(promptP)} note="impressions vs previous" />
              <Kpi label="Average search length" tech="Avg query length" value={`${avgLen(all).toFixed(2)} words`} cur={avgLen(all)} prev={avgLen([...qp])} />
              <Kpi label="Seen but not clicked" tech="Zero-click queries" value={fmt("int", zero.length)} note="100+ impressions, at most 1 click" />
            </Kpis>
            <Band title="Charts" />
            <Grid>
              <Card title="Are people typing longer, AI-style searches?" tech="Impressions by query length" sub={`This vs previous ${g.p.days} days.`} info="Growth in 8+ word queries means more conversational, AI-style searching." span={6}>
                <ColChart id="gsc-ai-len" stacked={false} labels={LEN_BANDS.map((b) => `${b[0]} word${b[0] === "1" ? "" : "s"}`)} series={[{ name: "This period", values: band(all), color: C[0] }, { name: "Previous period", values: band([...qp]), color: "var(--series-prev)" }]} />
              </Card>
              <Card title="How long searches are getting" tech="Average query length by month" info="Impression-weighted words per query." span={6}>
                <LineChart id="gsc-ai-month" noToggle f="dec2" labels={months.map((x) => new Date(`${x}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }))} series={[{ name: "Words per query", values: monthLen, color: C[6], area: true }]} />
                {months.length < 16 && <Note>{months.length} months shown: Search Console has data for this site from {sd(g.meta.start)}.</Note>}
              </Card>
              <Card title="Question and AI-search shares" info="Impressions from questions = question query impressions ÷ query impressions. From prompt-like queries = 8+ word query impressions ÷ query impressions. Impressions with no click = impressions of queries with 100+ impressions and at most 1 click ÷ query impressions. First-person phrasing = queries with I / my / we ÷ query impressions.">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Gauge v={allImp ? sumI(qs) / allImp : null} label="Impressions from questions" color={C[2]} />
                  <Gauge v={allImp ? sumI(prompt) / allImp : null} label="From prompt-like queries" color={C[6]} />
                  <Gauge v={allImp ? sumI(zero) / allImp : null} label="Impressions with no click" color={C[7]} />
                  <Gauge v={allImp ? sumI(firstP) / allImp : null} label="First-person phrasing" color={C[4]} />
                </div>
              </Card>
              <Card title="Share of questions and AI-style searches" tech="Share of impressions, weekly" info="Question queries and prompt-like (8+ word) queries as a share of all impressions." span={6}>
                <LineChart id="gsc-ai-share" f="pct" labels={weeks.map(sd)} series={[{ name: "Questions", values: share(isQuestion), color: C[2] }, { name: "Prompt-like (8+ words)", values: share((q) => words(q) >= 8), color: C[6] }]} />
              </Card>
              <Card title="Topics people ask about" tech="What people ask about" info="Question and prompt-like impressions grouped by topic (AI labels)." span={6}>
                <Treemap items={topics.slice(0, 14).map(([t, v], i) => ({ label: t, value: v.impressions, color: C[i % C.length] }))} />
                {missing.length > 0 && <Note>{missing.length} queries are being labelled by the AI now; reload in a minute for the full topic map.</Note>}
              </Card>
              <Card title="Questions: ranking vs click rate" tech="Questions: position vs CTR" sub="Bubble = impressions." info="Bubble = impressions. The dashed line is position 5; questions ranking well with low CTR are likely answered on the results page.">
                <Scatter points={qs.filter(([, v]) => v.impressions >= 3).slice(0, 80).map(([q, v]) => ({ x: Math.max(1, v.pos ?? 1), y: v.ctr, s: v.impressions, label: q, show: v.impressions >= (qs[0]?.[1].impressions ?? 0) * 0.4, c: (v.pos ?? 99) <= 5 && v.ctr < g.expected(v.pos ?? 5) * 0.5 ? C[7] : C[2] }))} xLabel="Average position (log scale)" yLabel="CTR" xf="dec1" logX xRef={5} />
              </Card>
            </Grid>
            <Band title="Tables and lists" />
            <Grid>
              <Card title="Where to answer each question on your site" tech="Questions → where to answer them" info="Every question and conversational query, with the page, the heading to add and the answer format that fits it.">
                <Table site={siteOf(g)} facets={[{ k: "fmt", label: "Answer format" }]} rows={where} cols={[{ k: "q", label: "Question people search", wrap: true }, { k: "impr", label: "Impr.", num: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "page", label: "Answer on", kind: "page" }, { k: "h", label: "Heading to add", wrap: true }, { k: "fmt", label: "Answer format" }, { k: "schema", label: "Schema" }]} empty="No question queries in this period." />
              </Card>
              <Card title="Long, ChatGPT-style questions people type into Google" tech="Prompt-like queries" sub="8+ word queries." info="8+ word queries, the closest signal to AI-style searching that Search Console offers.">
                <QueryTable rows={queryTable(g, (q) => words(q) >= 8)} site={siteOf(g)} empty="No 8+ word queries in this period." />
              </Card>
              <Card title="Pages Google shows more but people click less" tech="Impressions up, clicks flat" info="Pages where impressions grew 20%+ while clicks didn't and position held. A common pattern when AI Overviews answer the question on the results page." span={6}>
                <Table site={siteOf(g)} rows={upFlat} cols={[{ k: "page", label: "Page", kind: "page" }, { k: "ic", label: "Impressions change" }, { k: "cc", label: "Clicks change" }, { k: "pos", label: "Position", num: true, f: "dec1" }, { k: "ppos", label: "Prev position", num: true, f: "dec1" }]} empty="No page matches: impressions and clicks moved together." />
              </Card>
              <Card title="Searches where people saw you but didn't click" tech="Zero-click queries" sub="100+ impressions, at most 1 click." span={6}>
                <Table rows={zeroRows} cols={[{ k: "q", label: "Query", wrap: true }, { k: "impr", label: "Impr.", num: true }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "reason", label: "Likely reason", wrap: true }]} empty="No query with 100+ impressions has fewer than 2 clicks." />
              </Card>
              <Card title="Questions people ask Google that you show up for" tech="Questions people search" info="Every question query with the page that answers it. These feed the FAQ suggestions in Quick wins.">
                <QueryTable rows={queryTable(g, isQuestion)} site={siteOf(g)} empty="No question queries in this period." />
              </Card>
            </Grid>
            <Tasks screen="Questions and AI search" id="ai" wins={wins} />
          </>
        );
      }}
    </GscScreen>
  );
}
