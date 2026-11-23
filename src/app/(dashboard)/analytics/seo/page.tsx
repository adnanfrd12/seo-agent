import { BarList, CompareBars, LineChart, Scatter } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Missing, Note, ScreenTasks } from "@/components/ga4x/ui";
import type { SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanUrl, group, sum } from "@/lib/ga4x/model";
import { forScreen } from "@/lib/ga4x/quickwins";
import { Ga4xScreen } from "../_ga4x/screen";
import { labels } from "../_ga4x/parts";

export const maxDuration = 120;
const PATH = "/analytics/seo";
type GscRow = { page: string; query?: string; clicks: number; impressions: number; position_x_impressions: number };

/** Search Console rows for the client's sites in a date range (our own synced copy). */
async function gscRows(clientId: string, table: "gsc_page_metrics" | "gsc_query_page_metrics", start: string, end: string): Promise<{ rows: GscRow[]; sites: number }> {
  const admin = createAdminClient();
  const { data: res } = await admin.from("integration_resources").select("id").eq("client_id", clientId).eq("provider", "gsc").eq("is_selected", true);
  const ids = (res ?? []).map((r) => r.id as string);
  if (!ids.length) return { rows: [], sites: 0 };
  const out: GscRow[] = [];
  const cols = table === "gsc_page_metrics" ? "page, clicks, impressions, position_x_impressions" : "page, query, clicks, impressions, position_x_impressions";
  for (let from = 0; from < 200_000; from += 1000) {
    let q = admin.from(table).select(cols).in("resource_id", ids).gte("metric_date", start).lte("metric_date", end);
    if (table === "gsc_page_metrics") q = q.eq("search_type", "web");
    const { data, error } = await q.range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...(data as unknown as GscRow[]));
    if (data.length < 1000) break;
  }
  return { rows: out, sites: ids.length };
}
const pathOf = (u: string) => { try { return cleanUrl(new URL(u).pathname + new URL(u).search); } catch { return cleanUrl(u); } };

export default async function SeoJoinPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  return (
    <Ga4xScreen sp={sp} path={PATH} title="SEO: Search Console + GA4" description="Google search clicks and positions next to the visits and leads they bring, page by page, plus an estimate of leads per search query.">
      {async ({ g, wins, clientId }) => {
        const org = (x: { ch?: unknown }) => x.ch === "Organic Search";
        const sCur = g.sCur().filter(org), lCur = g.lCur().filter(org), lPrev = g.lPrev().filter(org);
        const [pages, pairs] = await Promise.all([gscRows(clientId, "gsc_page_metrics", g.p.start, g.p.end), gscRows(clientId, "gsc_query_page_metrics", g.p.start, g.p.end)]);
        const gsc = new Map<string, { c: number; i: number; px: number }>();
        for (const r of pages.rows) { const k = pathOf(r.page), cur = gsc.get(k) ?? { c: 0, i: 0, px: 0 }; cur.c += r.clicks; cur.i += r.impressions; cur.px += r.position_x_impressions; gsc.set(k, cur); }
        const ga = new Map([...group(sCur, (x) => String(x.land))].map(([k, v]) => [k, sum(v, (x) => Number(x.sessions))]));
        const leads = new Map([...group(lCur, (x) => String(x.land))].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))]));
        const leadsP = new Map([...group(lPrev, (x) => String(x.land))].map(([k, v]) => [k, sum(v, (x) => Number(x.eventCount))]));
        const rows = [...new Set([...gsc.keys(), ...ga.keys()])].map((k) => { const s = gsc.get(k), sess = ga.get(k) ?? 0, l = leads.get(k) ?? 0; return { key: k, gc: s?.c ?? 0, gi: s?.i ?? 0, gp: s && s.i ? s.px / s.i : null, sessions: sess, leads: l, lr: sess ? l / sess : null }; })
          .filter((r) => r.gc || r.sessions).sort((a, b) => b.gc - a.gc || b.sessions - a.sessions);
        const engines = [...group(lCur, (x) => g.source(x))].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.eventCount)) })).sort((a, b) => b.n - a.n);
        const sessEngines = [...group(sCur, (x) => g.source(x))].map(([k, v]) => ({ k, n: sum(v, (x) => Number(x.sessions)) })).sort((a, b) => b.n - a.n);
        // estimated leads per query: a page's organic leads split across its queries by click share
        const byPage = group(pairs.rows, (r) => pathOf(r.page));
        const est = new Map<string, number>();
        for (const [p, qs] of byPage) {
          const l = leads.get(p) ?? 0, clicks = sum(qs, (r) => r.clicks);
          if (!l || !clicks) continue;
          for (const q of qs) if (q.clicks && q.query) est.set(q.query, (est.get(q.query) ?? 0) + (l * q.clicks) / clicks);
        }
        const estRows = [...est].map(([q, v]) => ({ q, v: Math.round(v * 10) / 10 })).sort((a, b) => b.v - a.v);
        const noGsc = pages.sites === 0;
        const lab = labels(g);
        return (
          <>
            <Band title="Charts" sub="Hover for details, click any bar, point or bubble for more." />
            <Grid>
              <Card title="Leads from each search engine" tech="Organic leads by search engine" span={6}>
                {engines.length ? <BarList rows={engines.map((r) => ({ label: r.k, value: r.n, color: C[2] }))} />
                  : <BarList rows={sessEngines.map((r) => ({ label: r.k, value: r.n, color: C[0], right: `${r.n} visits · 0 leads` }))} empty="No organic search visits in this period." />}
                {!engines.length && sessEngines.length > 0 && <Note>No organic search visit ended in a lead in this period, so the bars show visits per search engine.</Note>}
              </Card>
              <Card title="Google search visits and leads each day" tech="Organic sessions and leads, daily" span={6}>
                <LineChart id="seo-day" labels={lab} series={[{ name: "Organic sessions", values: g.daily(sCur, (x) => Number(x.sessions)), color: C[0], area: true }, { name: "Organic leads", values: g.daily(lCur, (x) => Number(x.eventCount)), color: C[2] }]} />
              </Card>
              <Card title="Google clicks vs leads per page" tech="Search Console clicks vs GA4 leads" sub="Each landing page. Pages low on the chart get search traffic but few leads." span={7}>
                {noGsc ? <Missing why="Search Console isn't connected for this client in the portal." fix="Connect Google Search Console on the Integrations page and pick the site." />
                  : <Scatter points={rows.filter((r) => r.gc > 0).slice(0, 40).map((r) => ({ x: r.gc, y: r.leads, s: Math.max(1, r.sessions), label: r.key, show: r.leads > 0 || r.gc >= (rows[0]?.gc ?? 0) * 0.5, c: r.leads ? C[2] : C[1] }))} xLabel="Search Console clicks (log scale)" yLabel="Organic leads" yf="int" logX />}
              </Card>
              <Card title="Google search leads by page: this month vs last" tech="Organic leads by page: this period vs last" span={5}>
                <CompareBars color={C[2]} rows={[...new Set([...leads.keys(), ...leadsP.keys()])].map((k) => ({ label: k, cur: leads.get(k) ?? 0, prev: leadsP.get(k) ?? 0 })).sort((a, b) => b.cur - a.cur).slice(0, 8)} />
              </Card>
            </Grid>
            <Band title="Tables and lists" sub="The data behind the charts. Filter with the chips, sort any column." />
            <Grid>
              <Card title="Google search traffic and leads per page" tech="Organic landing pages: Search Console and GA4 together" sub={`Search Console clicks, impressions and position next to GA4 organic sessions and leads, matched by cleaned URL.${g.meta.config.searchConsole ? "" : " (Joined here from the portal's own Search Console data; the GA4 property itself has no Search Console link.)"}`}>
                {noGsc ? <Missing why="Search Console isn't connected for this client in the portal, so there are no clicks, impressions or positions to put next to GA4." fix="Connect Google Search Console on the Integrations page and pick the site." /> :
                  <Table site={g.meta.streamUrl} limit={15} rows={rows} cols={[{ k: "key", label: "Landing page", kind: "page" }, { k: "gc", label: "GSC clicks", num: true, bar: C[0] }, { k: "gi", label: "GSC impressions", num: true }, { k: "gp", label: "Position", num: true, f: "dec1" }, { k: "sessions", label: "GA4 organic sessions", num: true }, { k: "leads", label: "Leads", num: true, bar: C[2] }, { k: "lr", label: "Lead rate", num: true, f: "pct" }]} />}
                <Note>Search Console data is 2–3 days behind and is never live.</Note>
              </Card>
              <Card title="Leads per Google search (estimate)" tech="Estimated leads by query" sub="A page's organic leads split across its queries by click share. An estimate, labelled as one." span={6}>
                {noGsc ? <Missing why="Search Console isn't connected." fix="Connect Google Search Console on the Integrations page." />
                  : <Table limit={15} rows={estRows} cols={[{ k: "q", label: "Query" }, { k: "v", label: "Est. leads", num: true, f: "dec1" }]} empty="No organic lead in this period came from a page with Search Console query data." />}
              </Card>
            </Grid>
            <ScreenTasks screen="SEO: Search Console + GA4" wins={forScreen(wins, "seo")} />
          </>
        );
      }}
    </Ga4xScreen>
  );
}
