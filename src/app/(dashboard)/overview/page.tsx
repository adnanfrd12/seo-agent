import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { SectionHeader } from "@/components/dashboard/section-header";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";

const PATH = "/overview";

type Totals = { has_data: boolean } & Record<string, unknown>;
type Compared = { current: Totals; previous: Totals; mom: Totals; yoy: Totals };
type Overview = { connected: { ga4: boolean; gsc: boolean; gbp: boolean }; ga4: Compared; gsc: Compared };
type KeywordRow = { query: string; clicks: number; impressions: number; position: number | null };

const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);
const pct2 = (n: Num) => fmtPercent(n, 2);

function NotConnected({ name }: { name: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-6 text-center">
      <p className="text-sm font-medium">{name} isn&apos;t connected</p>
      <p className="mt-1 text-xs text-muted">Connect it to see these metrics here.</p>
      <Link href="/integrations" className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90">
        Connect
      </Link>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange(
    { range: first(sp.range), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";
  const args = { p_client_id: client.id, p_start: range.start, p_end: range.end };

  const supabase = await createClient();
  const [overview, ga4Trend, gscTrend, ga4Summary, keywords, resources] = await Promise.all([
    supabase.rpc("get_seo_overview", args),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "ga4", p_granularity: "day", p_compare: compare }),
    // the overview's Search Console figures are Web search, matching the KPI cards
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "gsc", p_granularity: "day", p_compare: compare, p_search_type: "web" }),
    supabase.rpc("get_ga4_summary", args),
    supabase.rpc("get_gsc_keywords", { ...args, p_search_type: "web", p_sort: "clicks", p_dir: "desc", p_limit: 5, p_offset: 0 }),
    supabase.from("integration_resources").select("provider, display_name").eq("client_id", client.id).eq("is_selected", true),
  ]);

  const header = <PageHeader title="Overview" description={`${client.name} · consolidated performance across Google Analytics and Search Console`} />;
  if (overview.error || ga4Trend.error || gscTrend.error) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load the overview. Please try again.</p>
      </>
    );
  }

  const o = overview.data as Overview;
  const names = (p: string) => (resources.data ?? []).filter((r) => r.provider === p).map((r) => r.display_name).join(", ");
  const ga = o.ga4, gs = o.gsc;
  const ga4Cards = [
    { label: "Total Users", k: "users", format: fmtInt, hint: "Sum of daily active users: someone active on 3 days counts 3 times." },
    { label: "Sessions", k: "sessions", format: fmtInt },
    { label: "Engagement Rate", k: "engagement_rate", format: fmtPercent, hint: "Engaged sessions ÷ sessions." },
    { label: "Conversions", k: "key_events", format: fmtInt, hint: "GA4 key events (Google's new name for conversions)." },
  ];
  const gscCards = [
    { label: "Total Clicks", k: "clicks", format: fmtInt, higher: true },
    { label: "Total Impressions", k: "impressions", format: fmtInt, higher: true },
    { label: "Average CTR", k: "ctr", format: pct2, higher: true, hint: "Total clicks ÷ total impressions." },
    { label: "Average Position", k: "position", format: fmtDecimal, higher: false, hint: "Impression-weighted average ranking. Lower is better." },
  ];
  const ga4T = ga4Trend.data as TrendData;
  const gscT = gscTrend.data as TrendData;
  const channels = ((ga4Summary.data as { channels?: { channel_group: string; sessions: number }[] } | null)?.channels ?? []);
  const kw = ((keywords.data as { rows?: KeywordRow[] } | null)?.rows ?? []);

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />

      <section aria-labelledby="ov-ga4" className="mb-8">
        <SectionHeader id="ov-ga4" source="GA4" title="Website performance" subtitle={names("ga4") || undefined} href={o.connected.ga4 ? "/analytics" : undefined} />
        {o.connected.ga4 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {ga4Cards.map((m) => (
              <KpiCard key={m.k} label={m.label} hint={m.hint} source="GA4" format={m.format}
                value={pick(ga.current, m.k)} previous={pick(ga.previous, m.k)} mom={pick(ga.mom, m.k)} yoy={pick(ga.yoy, m.k)} />
            ))}
          </div>
        ) : <NotConnected name="Google Analytics 4" />}
      </section>

      <section aria-labelledby="ov-gsc" className="mb-8">
        <SectionHeader id="ov-gsc" source="GSC" title="Organic search performance" subtitle={names("gsc") ? `${names("gsc")} · Web search` : undefined} href={o.connected.gsc ? "/search-console" : undefined} />
        {o.connected.gsc ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {gscCards.map((m) => (
              <KpiCard key={m.k} label={m.label} hint={m.hint} source="GSC" format={m.format} higherIsBetter={m.higher}
                value={pick(gs.current, m.k)} previous={pick(gs.previous, m.k)} mom={pick(gs.mom, m.k)} yoy={pick(gs.yoy, m.k)} />
            ))}
          </div>
        ) : <NotConnected name="Google Search Console" />}
      </section>

      <section aria-label="Trends" className="grid gap-4 lg:grid-cols-2">
        {o.connected.ga4 && (
          <MetricTrend title="Website traffic" source="GA4" options={[
            { key: "users", label: "Users", data: dailySeries(ga4T, "users", range) },
            { key: "sessions", label: "Sessions", data: dailySeries(ga4T, "sessions", range) },
            { key: "engagement_rate", label: "Engagement", format: "percent", data: dailySeries(ga4T, "engagement_rate", range, "ratio") },
            { key: "key_events", label: "Conversions", data: dailySeries(ga4T, "key_events", range) },
          ]} />
        )}
        {o.connected.gsc && (
          <MetricTrend title="Organic search" source="GSC" options={[
            { key: "clicks", label: "Clicks", data: dailySeries(gscT, "clicks", range) },
            { key: "impressions", label: "Impressions", data: dailySeries(gscT, "impressions", range) },
            { key: "ctr", label: "CTR", format: "percent", data: dailySeries(gscT, "ctr", range, "ratio") },
            { key: "position", label: "Position", format: "decimal", reverseY: true, data: dailySeries(gscT, "position", range, "ratio") },
          ]} />
        )}
      </section>

      <section aria-label="Breakdowns" className="mt-6 grid gap-4 lg:grid-cols-2">
        {o.connected.ga4 && (
          <BarList title="Sessions by traffic channel" valueLabel="Sessions · GA4"
            items={channels.map((c) => ({ label: c.channel_group, value: Number(c.sessions) }))} />
        )}
        {o.connected.gsc && (
          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Top search queries">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Top search queries</h2>
              <Link href="/search-console" className="text-xs font-medium text-accent hover:underline">All queries</Link>
            </div>
            {kw.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No queries for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-medium">Query</th>
                    <th className="pb-2 text-right font-medium">Clicks</th>
                    <th className="pb-2 text-right font-medium">Impr.</th>
                    <th className="pb-2 text-right font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {kw.map((r) => (
                    <tr key={r.query} className="border-t border-border">
                      <td className="max-w-0 truncate py-2 pr-2" title={r.query}>{r.query}</td>
                      <td className="py-2 text-right tabular-nums">{fmtInt(r.clicks)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtInt(r.impressions)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtDecimal(toNum(r.position))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </section>
    </>
  );
}
