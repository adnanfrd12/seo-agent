import { PageHeader } from "@/components/dashboard/page-header";
import { FetchKeywords } from "@/components/aiqw/fetch-keywords";
import { BarList } from "@/components/ga4x/charts";
import { C } from "@/components/ga4x/fmt";
import { Table } from "@/components/ga4x/table";
import { Band, Card, Grid, Kpi, Kpis, Missing } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { pathOf } from "@/lib/gscx/model";
import { gscWinsFor } from "@/lib/gscx/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadKw, loadSerp } from "@/lib/aiqw/dfs";

export const maxDuration = 120;

const FEATURE: Record<string, string> = {
  featured_snippet: "Featured snippet", people_also_ask: "People Also Ask", ai_overview: "AI Overview", local_pack: "Map pack", images: "Images", video: "Videos",
  knowledge_graph: "Knowledge panel", top_stories: "Top stories", shopping: "Shopping", related_searches: "Related searches", perspectives: "Perspectives", discussions_and_forums: "Forums",
};
const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");

/** Search Console queries side by side with DataForSEO search volume, difficulty, intent and SERP features. */
export default async function KeywordsPage() {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const [gsc, kw, serp] = await Promise.all([gscWinsFor(admin, client.id).catch(() => null), loadKw(admin, client.id), loadSerp(admin, client.id)]);
  const canEdit = ["owner", "admin"].includes(client.role);
  const header = <PageHeader title="Keywords: Search Console + DataForSEO" description="Your Google queries (last 28 days) with volume, difficulty and intent." />;
  if (!gsc) return <>{header}<Missing title="Search Console is not connected" why="This screen starts from the queries Search Console reports." fix="Connect Search Console on the Integrations page." /></>;
  const topPage = new Map<string, string>();
  for (const r of [...gsc.g.qp()].sort((a, b) => Number(b.impressions) - Number(a.impressions))) if (!topPage.has(String(r.query))) topPage.set(String(r.query), pathOf(String(r.page)));
  const rows = [...gsc.g.queries()].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 500).map(([q, m]) => {
    const k = kw.get(norm(q)), s = serp.get(norm(q));
    const feats = (s?.features ?? k?.serp ?? []).filter((f) => FEATURE[f]).map((f) => FEATURE[f]);
    return {
      query: q, page: topPage.get(q) ?? "", clicks: m.clicks, impressions: m.impressions, ctr: m.ctr, pos: m.pos, volume: k?.volume ?? null, kd: k?.difficulty ?? null,
      intent: k?.intent ?? (k ? "–" : null), cpc: k?.cpc ?? null, serp: feats.join(", ") || (k ? "–" : ""), ours: s?.ourPosition ?? null,
    };
  });
  const withVol = rows.filter((r) => r.volume != null);
  const withKd = withVol.filter((r) => r.kd != null);
  const latest = [...kw.values()].reduce((a, k) => (k.at > a ? k.at : a), "");
  const feat = new Map<string, number>(), intents = new Map<string, number>();
  for (const r of rows) for (const f of r.serp.split(", ").filter((x) => x && x !== "–")) feat.set(f, (feat.get(f) ?? 0) + 1);
  for (const r of withVol) if (r.intent && r.intent !== "–") intents.set(r.intent, (intents.get(r.intent) ?? 0) + 1);
  return (
    <>
      {header}
      <Kpis>
        <Kpi label="Queries (28 days)" value={rows.length.toLocaleString()} />
        <Kpi label="With DataForSEO data" value={withVol.length.toLocaleString()} note={latest ? `fetched ${new Date(latest).toLocaleString()}` : "not fetched yet"} />
        <Kpi label="Monthly searches (sum)" value={withVol.reduce((a, r) => a + (r.volume ?? 0), 0).toLocaleString()} />
        <Kpi label="Average difficulty" value={withKd.length ? (withKd.reduce((a, r) => a + (r.kd ?? 0), 0) / withKd.length).toFixed(0) : "0"} note="0–100, DataForSEO Labs" />
        <Kpi label="Live Google results checked" value={String(serp.size)} note="Deep runs, top 20 opportunities" />
        <Kpi label="Queries on page 1" value={rows.filter((r) => r.pos != null && r.pos <= 10).length.toLocaleString()} />
      </Kpis>
      <div className="mt-4"><FetchKeywords canEdit={canEdit} /></div>
      {!withVol.length && <p className="mt-2 text-sm text-muted">0 queries have DataForSEO data yet. Press Fetch DataForSEO data, or run a Deep or nightly quick-wins run.</p>}
      <Band title="Charts" />
      <Grid>
        <Card title="SERP features on your queries" tech="serp_info.serp_item_types" sub="How many of your queries show each Google feature." span={6}>
          {feat.size ? <BarList rows={[...feat].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: C[i % C.length] }))} /> : <p className="text-sm text-muted">0: fetch DataForSEO data first.</p>}
        </Card>
        <Card title="Search intent" tech="search_intent_info.main_intent" span={6}>
          {intents.size ? <BarList rows={[...intents].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: C[i % C.length] }))} /> : <p className="text-sm text-muted">0: fetch DataForSEO data first.</p>}
        </Card>
      </Grid>
      <Band title="Tables and lists" />
      <Grid>
        <Card title="Your queries with search volume and difficulty" tech="Search Console 28 days × DataForSEO Labs keyword overview">
          <Table site={gsc.site} limit={50} rows={rows} facets={[{ k: "intent", label: "Intent" }]} cols={[
            { k: "query", label: "Query" }, { k: "page", label: "Top page", kind: "page" }, { k: "clicks", label: "Clicks", num: true }, { k: "impressions", label: "Impr.", num: true },
            { k: "ctr", label: "CTR", num: true, f: "pct" }, { k: "pos", label: "Pos", num: true, f: "dec1" }, { k: "volume", label: "Searches/mo", num: true }, { k: "kd", label: "KD", num: true },
            { k: "intent", label: "Intent" }, { k: "cpc", label: "CPC", num: true, f: "dec2" }, { k: "serp", label: "SERP features", wrap: true }, { k: "ours", label: "Live pos", num: true },
          ]} />
        </Card>
      </Grid>
    </>
  );
}
