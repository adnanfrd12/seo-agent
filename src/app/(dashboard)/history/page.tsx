import { MetricTrend } from "@/components/charts/metric-trend";
import { DivergingBars } from "@/components/charts/ops-charts";
import type { TrendPoint } from "@/components/charts/trend-chart";
import { TabHeader } from "@/components/dashboard/tab-header";
import { Highlights } from "@/components/dashboard/highlights";
import { movement, pickHighlights } from "@/lib/overview/highlights";
import { ReportTable, Unavailable } from "@/components/report/report-ui";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { monthLabel, monthRange, previousMonth, todayIn } from "@/lib/analytics/range";
import { resourceScope } from "@/lib/analytics/resource-scope";
import type { SearchParams } from "@/lib/analytics/url";

type Row = { date: string } & Record<string, unknown>;

/** Long-term view: complete calendar months only (the current partial month is excluded). */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const last = previousMonth(todayIn(client.timezone));
  let firstM = last;
  for (let i = 0; i < 11; i++) firstM = previousMonth(`${firstM}-15`);
  const range = { start: monthRange(firstM).start, end: monthRange(last).end };
  const scope = await resourceScope(client.id, sp);
  const args = { p_client_id: client.id, p_start: range.start, p_end: range.end, p_granularity: "month", p_compare: false };
  const [ga4, gsc] = await Promise.all([
    scope.supabase.rpc("get_analytics_trends", { ...args, p_provider: "ga4" }),
    scope.supabase.rpc("get_analytics_trends", { ...args, p_provider: "gsc", p_search_type: "web" }),
  ]);
  const g = ((ga4.data as { current?: Row[] } | null)?.current ?? []);
  const s = ((gsc.data as { current?: Row[] } | null)?.current ?? []);
  const pts = (rows: Row[], k: string): TrendPoint[] => rows.map((r) => ({ date: String(r.date), value: toNum(r[k]) }));
  const months = [...new Set([...g, ...s].map((r) => String(r.date)))].sort().reverse();
  const at = (rows: Row[], m: string) => rows.find((r) => String(r.date) === m);
  const [m0, m1] = months;
  // percentage change of each month against the one before it (newest first, like the table)
  const mom = (rows: Row[], k: string) => months.slice(0, -1).map((m, i) => {
    const cur = toNum(at(rows, m)?.[k]), prev = toNum(at(rows, months[i + 1])?.[k]);
    return { label: monthLabel(m.slice(0, 7)), value: cur == null || !prev ? null : Number((((cur - prev) / prev) * 100).toFixed(1)), detail: `${fmtInt(prev)} → ${fmtInt(cur)}` };
  });
  const hl = m0 && m1 ? pickHighlights([
    movement(`Search clicks in ${monthLabel(m0.slice(0, 7))}`, toNum(at(s, m0)?.clicks), toNum(at(s, m1)?.clicks), { fmt: fmtInt, minBase: 20, minPct: 5 }),
    movement(`Sessions in ${monthLabel(m0.slice(0, 7))}`, toNum(at(g, m0)?.sessions), toNum(at(g, m1)?.sessions), { fmt: fmtInt, minBase: 30, minPct: 5 }),
    movement(`Average position in ${monthLabel(m0.slice(0, 7))}`, toNum(at(s, m0)?.position), toNum(at(s, m1)?.position), { fmt: (n) => n.toFixed(1), lowerIsBetter: true, minPct: 3 }),
    movement(`Search impressions in ${monthLabel(m0.slice(0, 7))}`, toNum(at(s, m0)?.impressions), toNum(at(s, m1)?.impressions), { fmt: fmtInt, minBase: 100, minPct: 5 }),
  ]) : [];

  return (
    <div className="space-y-6">
      <TabHeader source={null} eyebrow="Reporting" title="Historical Reports" description={`Complete months from ${monthLabel(firstM)} to ${monthLabel(last)}. History starts when each source was connected (GA4 and Search Console import 90 days at connection).`} guide={[
  { term: "Complete months", text: "Only full calendar months are shown, so months are comparable." },
  { term: "History starts at connection", text: "Each source's history begins when it was connected; the earliest month can be partial." },
]} />
      {months.length > 1 && <Highlights items={hl} stableNote={`${monthLabel(months[0].slice(0, 7))} was in line with ${monthLabel(months[1].slice(0, 7))}.`} />}
      {months.length === 0 ? (
        <Unavailable title="No historical data yet" body="Connect and sync Google Analytics 4 or Search Console." />
      ) : (
        <>
          <div className={g.length > 0 && s.length > 0 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
            {g.length > 0 && <MetricTrend title="Website traffic by month" source="GA4" options={[
              { key: "sessions", label: "Sessions", data: pts(g, "sessions") },
              { key: "users", label: "Users", data: pts(g, "users") },
              { key: "key_events", label: "Key events", data: pts(g, "key_events") },
              { key: "engagement_rate", label: "Engagement", format: "percent", data: pts(g, "engagement_rate") },
            ]} />}
            {s.length > 0 && <MetricTrend title="Organic search by month" source="GSC" options={[
              { key: "clicks", label: "Clicks", data: pts(s, "clicks") },
              { key: "impressions", label: "Impressions", data: pts(s, "impressions") },
              { key: "ctr", label: "CTR", format: "percent", data: pts(s, "ctr") },
              { key: "position", label: "Position", format: "decimal", reverseY: true, data: pts(s, "position") },
            ]} />}
          </div>
          {months.length > 1 && (
            <section aria-label="Month-on-month change" className={g.length > 1 && s.length > 1 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
              {s.length > 1 && <DivergingBars title="Search clicks, change vs the month before" sub="Search Console · each complete month" format="pct" valueLabel="Change" rows={mom(s, "clicks")} />}
              {g.length > 1 && <DivergingBars title="Sessions, change vs the month before" sub="Google Analytics 4 · each complete month" format="pct" valueLabel="Change" rows={mom(g, "sessions")} />}
            </section>
          )}
          <ReportTable<string> title="Month by month" empty="" rows={months} columns={[
            { label: "Month", render: (m) => monthLabel(m.slice(0, 7)) },
            { label: "Sessions", align: "right", render: (m) => fmtInt(toNum(at(g, m)?.sessions)) },
            { label: "Users", align: "right", render: (m) => fmtInt(toNum(at(g, m)?.users)) },
            { label: "Engagement", align: "right", render: (m) => fmtPercent(toNum(at(g, m)?.engagement_rate)) },
            { label: "Clicks", align: "right", render: (m) => fmtInt(toNum(at(s, m)?.clicks)) },
            { label: "Impressions", align: "right", render: (m) => fmtInt(toNum(at(s, m)?.impressions)) },
            { label: "CTR", align: "right", render: (m) => fmtPercent(toNum(at(s, m)?.ctr), 2) },
            { label: "Position", align: "right", render: (m) => fmtDecimal(toNum(at(s, m)?.position)) },
          ]} />
          <p className="text-xs text-muted">A month only covers the days that were imported; the earliest month can be partial. Compare any two custom periods on the Overview with the date picker and &quot;Compare to previous period&quot;.</p>
        </>
      )}
    </div>
  );
}
