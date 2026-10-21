import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { ReportTable, Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { resourceScope } from "@/lib/analytics/resource-scope";
import { first, type SearchParams } from "@/lib/analytics/url";
import type { Opportunities } from "@/lib/report/data";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "—" : String(v));
const n = (v: unknown) => toNum(v);
const url = (u: unknown) => { try { const x = new URL(String(u)); return `${x.host}${x.pathname}`; } catch { return s(u); } };
const clampInt = (v: string | undefined, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range) ?? (first(sp.start) ? undefined : "30"), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays);
  const minImpr = clampInt(first(sp.min_impr), 10, 1, 100000);
  const minPos = clampInt(first(sp.min_pos), 1, 1, 50);
  const decay = clampInt(first(sp.decay), 20, 5, 95);
  const scope = await resourceScope(client.id, sp);
  const { data, error } = await scope.supabase.rpc("get_gsc_opportunities", {
    p_client_id: client.id, p_start: range.start, p_end: range.end,
    p_min_impressions: minImpr, p_min_pos_change: minPos, p_decay_pct: decay, p_limit: 50,
  });
  const o = data as Opportunities | null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title="SEO Opportunities" description="Deterministic Search Console analysis: current period vs the equal-length period before it, Web search, rates re-weighted from totals." />
      <RangeSelector path="/opportunities" sp={sp} range={range} showCompare={false} />
      <form className="flex flex-wrap items-end gap-3 text-xs text-muted" action="/opportunities">
        {["range", "start", "end", "site"].map((k) => first(sp[k]) && <input key={k} type="hidden" name={k} value={first(sp[k])} />)}
        <label>Min. impressions<input name="min_impr" type="number" defaultValue={minImpr} min={1} className="mt-0.5 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground" /></label>
        <label>Min. position change<input name="min_pos" type="number" defaultValue={minPos} min={1} className="mt-0.5 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground" /></label>
        <label>Decay threshold (%)<input name="decay" type="number" defaultValue={decay} min={5} max={95} className="mt-0.5 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground" /></label>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted">Apply thresholds</button>
      </form>

      {error || !o ? (
        <Unavailable title="Opportunity analysis isn't available yet" body="Apply migration 20261021000010 in Supabase, then run a Search Console sync so query × page data is imported." />
      ) : (
        <>
          <ReportTable<Row> title="Quick wins: visible but under-clicked" source="GSC" empty="No queries in positions 4–20 with enough impressions."
            rows={o.quick_wins} columns={[
              { label: "Query", render: (x) => s(x.query) },
              { label: "Ranking page", render: (x) => <span className="break-all text-xs">{x.page ? url(x.page) : "—"}</span> },
              { label: "Impr.", align: "right", render: (x) => fmtInt(n(x.impressions)) },
              { label: "Clicks", align: "right", render: (x) => fmtInt(n(x.clicks)) },
              { label: "CTR", align: "right", render: (x) => fmtPercent(n(x.ctr), 2) },
              { label: "Position", align: "right", render: (x) => fmtDecimal(n(x.position)) },
              { label: "Score", align: "right", render: (x) => fmtDecimal(n(x.score)) },
            ]} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ReportTable<Row> title="Keywords losing positions" source="GSC" empty="None above the thresholds." rows={o.declining_keywords} columns={[
              { label: "Keyword", render: (x) => s(x.query) },
              { label: "Page", render: (x) => <span className="break-all text-xs">{x.page ? url(x.page) : "—"}</span> },
              { label: "Prior → now", align: "right", render: (x) => `${fmtDecimal(n(x.previous_position))} → ${fmtDecimal(n(x.current_position))}` },
              { label: "Clicks Δ", align: "right", render: (x) => fmtInt(n(x.clicks_change)) },
            ]} />
            <ReportTable<Row> title="Keywords moving up" source="GSC" empty="None above the thresholds." rows={o.improving_keywords} columns={[
              { label: "Keyword", render: (x) => s(x.query) },
              { label: "Prior → now", align: "right", render: (x) => `${fmtDecimal(n(x.previous_position))} → ${fmtDecimal(n(x.current_position))}` },
              { label: "Clicks", align: "right", render: (x) => fmtInt(n(x.clicks)) },
            ]} />
          </div>
          <ReportTable<Row> title="Decaying pages" source="GSC" empty="No page lost clicks beyond the threshold." rows={o.decaying_pages} columns={[
            { label: "Page", render: (x) => <span className="break-all">{url(x.page)}</span> },
            { label: "Clicks", align: "right", render: (x) => `${fmtInt(n(x.previous_clicks))} → ${fmtInt(n(x.current_clicks))}` },
            { label: "Change", align: "right", render: (x) => <span className="text-negative">{fmtDecimal(n(x.clicks_change_pct))}%</span> },
            { label: "Impr.", align: "right", render: (x) => `${fmtInt(n(x.previous_impressions))} → ${fmtInt(n(x.current_impressions))}` },
            { label: "Position", align: "right", render: (x) => `${fmtDecimal(n(x.previous_position))} → ${fmtDecimal(n(x.current_position))}` },
            { label: "Same period last year", align: "right", render: (x) => (x.same_period_last_year_clicks == null ? "no data" : `${fmtInt(n(x.same_period_last_year_clicks))} clicks`) },
          ]} />
          <ReportTable<Row> title={`New queries (${o.newly_clicked_queries} newly clicked)`} source="GSC" empty="No queries without impressions in the previous period." rows={o.new_queries} columns={[
            { label: "Query", render: (x) => s(x.query) },
            { label: "Type", render: (x) => (x.kind === "newly_clicked" ? "Newly clicked" : "Newly observed") },
            { label: "Best page", render: (x) => <span className="break-all text-xs">{x.page ? url(x.page) : "—"}</span> },
            { label: "Impr.", align: "right", render: (x) => fmtInt(n(x.impressions)) },
            { label: "Position", align: "right", render: (x) => fmtDecimal(n(x.position)) },
          ]} />
          <ReportTable<Row> title="Possible keyword cannibalization" source="GSC"
            empty={o.has_query_page_data ? "No query split its impressions across two or more pages (≥10% each)." : "Needs query × page data from the next Search Console sync."}
            rows={o.cannibalization} columns={[
              { label: "Query", render: (x) => s(x.query) },
              { label: "Competing pages", render: (x) => (
                <ul className="space-y-0.5 text-xs">{(x.detail as Row[]).map((p, i) => <li key={i} className="break-all">{url(p.page)} · {fmtInt(n(p.impressions))} impr · pos {fmtDecimal(n(p.position))} · {fmtPercent(n(p.share), 0)}</li>)}</ul>) },
              { label: "Impr.", align: "right", render: (x) => fmtInt(n(x.impressions)) },
            ]} />
          <p className="text-xs text-muted">
            &quot;New&quot; means new within stored Search Console history. Average position is impression-weighted, not an exact rank.
            Multiple pages ranking for one query can be normal; review intent before consolidating, and never redirect or canonicalise
            without checking the destination. Quick-win score = impressions × (10% target CTR − current CTR), a prioritisation aid, not a forecast.
          </p>
        </>
      )}
    </div>
  );
}
