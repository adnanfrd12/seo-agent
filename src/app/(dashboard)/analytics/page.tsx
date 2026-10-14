import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { TrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { DataTable } from "@/components/tables/data-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtDuration, fmtInt, fmtMoney, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";

const PATH = "/analytics";
const PAGE_SIZE = 10;

type Totals = { has_data: boolean } & Record<string, unknown>;
type Summary = {
  current: Totals; previous: Totals; mom: Totals; yoy: Totals;
  devices: { value: string; sessions: number; users: number }[];
  countries: { value: string; sessions: number; users: number }[];
  key_events: { value: string; key_events: number }[];
  channels: { channel_group: string; sessions: number; users: number }[];
};
type Table<T> = { total: number; rows: T[] };
type SourceRow = { source: string; medium: string | null; sessions: number; users: number; engagement_rate: number | null; key_events: number };
type PageRow = { page_path: string; views: number; users: number; sessions: number; avg_engagement_seconds: number | null; key_events: number };
type Trend = { current: ({ date: string } & Record<string, number | null>)[]; previous: ({ date: string } & Record<string, number | null>)[] };

const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

function trendPoints(t: Trend | null, key: string): TrendPoint[] {
  if (!t) return [];
  const prev = new Map(t.previous.map((p) => [p.date, toNum(p[key])]));
  return t.current.map((p) => ({ date: p.date, value: toNum(p[key]), previous: prev.get(p.date) ?? null }));
}

export default async function Ga4Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange(
    { range: first(sp.range), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";

  const tsSort = oneOf(first(sp.ts_sort), ["source", "medium", "sessions", "users", "engagement_rate", "key_events"] as const, "sessions");
  const tsDir = oneOf(first(sp.ts_dir), ["asc", "desc"] as const, "desc");
  const tsPage = Math.max(1, Number(first(sp.ts_page)) || 1);
  const pageKind = oneOf(first(sp.pages), ["views", "landing"] as const, "views");
  // landing rows carry sessions (views are always 0), page-view rows carry views
  const tpSort = oneOf(
    first(sp.tp_sort), ["page_path", "views", "users", "sessions", "avg_engagement_seconds", "key_events"] as const,
    pageKind === "landing" ? "sessions" : "views",
  );
  const tpDir = oneOf(first(sp.tp_dir), ["asc", "desc"] as const, "desc");
  const tpPage = Math.max(1, Number(first(sp.tp_page)) || 1);

  const supabase = await createClient();
  const { data: resources } = await supabase
    .from("integration_resources")
    .select("display_name, timezone")
    .eq("client_id", client.id).eq("provider", "ga4").eq("is_selected", true);

  if (!resources || resources.length === 0) {
    return (
      <>
        <PageHeader title="Google Analytics 4" description="Traffic, engagement and key events." />
        <EmptyState
          title="Google Analytics 4 isn't connected"
          body="Connect your Google account and choose a GA4 property to start importing data."
          action={{ href: "/integrations", label: "Go to Integrations" }}
        />
      </>
    );
  }

  const args = { p_client_id: client.id, p_start: range.start, p_end: range.end };
  const [summary, trend, sources, pages] = await Promise.all([
    supabase.rpc("get_ga4_summary", args),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "ga4", p_granularity: "day", p_compare: compare }),
    supabase.rpc("get_ga4_traffic_sources", {
      ...args, p_sort: tsSort, p_dir: tsDir, p_limit: PAGE_SIZE, p_offset: (tsPage - 1) * PAGE_SIZE,
    }),
    supabase.rpc("get_ga4_top_pages", {
      ...args, p_kind: pageKind, p_sort: tpSort, p_dir: tpDir, p_limit: PAGE_SIZE, p_offset: (tpPage - 1) * PAGE_SIZE,
    }),
  ]);

  const failed = [summary, trend, sources, pages].find((r) => r.error);
  const header = (
    <PageHeader
      title="Google Analytics 4"
      description={`Property: ${resources.map((r) => r.display_name).join(", ")}${resources[0]?.timezone ? ` · reporting time zone ${resources[0].timezone}` : ""}`}
    />
  );
  if (failed?.error) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load analytics. Please try again.</p>
      </>
    );
  }

  const s = summary.data as Summary;
  if (!s.current.has_data) {
    return (
      <>
        {header}
        <RangeSelector path={PATH} sp={sp} range={range} />
        <EmptyState
          title="No GA4 data for this period"
          body="Either the initial import hasn't finished, or this date range has no stored data. Try a wider range, or run Sync Now."
          action={{ href: "/integrations", label: "Open Integrations" }}
        />
      </>
    );
  }

  const cur = s.current, prev = s.previous, mom = s.mom, yoy = s.yoy;
  const hasRevenue = pick(cur, "revenue") != null;
  const kpis = [
    { label: "Active Users", k: "users", format: fmtInt, hint: "Summed daily active users; returning users are counted once per day they were active." },
    { label: "New Users", k: "new_users", format: fmtInt },
    { label: "Sessions", k: "sessions", format: fmtInt },
    { label: "Engaged Sessions", k: "engaged_sessions", format: fmtInt },
    { label: "Engagement Rate", k: "engagement_rate", format: fmtPercent, hint: "Engaged sessions ÷ sessions." },
    { label: "Avg Engagement Time", k: "avg_engagement_seconds", format: fmtDuration, hint: "Total engagement time ÷ active users." },
    { label: "Event Count", k: "event_count", format: fmtInt },
    { label: "Key Events", k: "key_events", format: fmtInt },
    ...(hasRevenue ? [{ label: "Total Revenue", k: "revenue", format: (n: number | null | undefined) => fmtMoney(n) }] : []),
  ];

  const t = trend.data as Trend;
  const src = sources.data as Table<SourceRow>;
  const pg = pages.data as Table<PageRow>;
  const exportBase = `/api/export/ga4?start=${range.start}&end=${range.end}`;

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {kpis.map((m) => (
          <KpiCard
            key={m.k} label={m.label} hint={m.hint} source="GA4" format={m.format}
            value={pick(cur, m.k)} previous={pick(prev, m.k)} mom={pick(mom, m.k)} yoy={pick(yoy, m.k)}
          />
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TrendChart title="Users over time" seriesLabel="Active users" data={trendPoints(t, "users")} />
        <TrendChart title="Sessions over time" seriesLabel="Sessions" data={trendPoints(t, "sessions")} />
        <TrendChart title="Key events over time" seriesLabel="Key events" data={trendPoints(t, "key_events")} />
        <TrendChart title="Engagement rate over time" seriesLabel="Engagement rate" format="percent" data={trendPoints(t, "engagement_rate")} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BarList title="Traffic by channel" valueLabel="Sessions"
          items={s.channels.map((c) => ({ label: c.channel_group, value: Number(c.sessions) }))} />
        <BarList title="Device categories" valueLabel="Sessions"
          items={s.devices.map((d) => ({ label: d.value, value: Number(d.sessions) }))} />
        <BarList title="Top countries" valueLabel="Sessions"
          items={s.countries.map((d) => ({ label: d.value, value: Number(d.sessions) }))} />
        <BarList title="Key event performance" valueLabel="Key events"
          emptyText="No key events recorded. Mark events as key events in GA4 to see them here."
          items={s.key_events.map((e) => ({ label: e.value, value: Number(e.key_events) }))} />
      </div>

      <div className="mt-6 space-y-6">
        <DataTable<SourceRow>
          title="Traffic sources" path={PATH} sp={sp} prefix="ts" sort={tsSort} dir={tsDir} page={tsPage} pageSize={PAGE_SIZE}
          total={Number(src.total)} rows={src.rows} emptyText="No traffic sources for this period."
          csvHref={`${exportBase}&kind=sources&sort=${tsSort}&dir=${tsDir}`}
          columns={[
            { key: "source", label: "Source", sort: "source", render: (r) => r.source },
            { key: "medium", label: "Medium", sort: "medium", render: (r) => r.medium ?? "—" },
            { key: "sessions", label: "Sessions", sort: "sessions", align: "right", render: (r) => fmtInt(r.sessions) },
            { key: "users", label: "Users", sort: "users", align: "right", render: (r) => fmtInt(r.users) },
            { key: "eng", label: "Engagement rate", sort: "engagement_rate", align: "right", render: (r) => fmtPercent(toNum(r.engagement_rate)) },
            { key: "ke", label: "Key events", sort: "key_events", align: "right", render: (r) => fmtDecimal(toNum(r.key_events)) },
          ]}
        />

        <div>
          <div className="mb-2 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm" role="group" aria-label="Page report type">
            {(["views", "landing"] as const).map((k) => (
              <Link
                key={k} href={withParams(PATH, sp, { pages: k, tp_page: null })} aria-current={pageKind === k ? "true" : undefined}
                className={`rounded-md px-3 py-1 font-medium ${pageKind === k ? "bg-accent text-accent-foreground" : "hover:bg-surface-muted"}`}
              >
                {k === "views" ? "Top pages by views" : "Top landing pages"}
              </Link>
            ))}
          </div>
          <DataTable<PageRow>
            title={pageKind === "views" ? "Top pages by views" : "Top landing pages"}
            path={PATH} sp={sp} prefix="tp" sort={tpSort} dir={tpDir} page={tpPage} pageSize={PAGE_SIZE}
            total={Number(pg.total)} rows={pg.rows} emptyText="No pages for this period."
            csvHref={`${exportBase}&kind=pages&pages=${pageKind}&sort=${tpSort}&dir=${tpDir}`}
            columns={[
              { key: "path", label: "Page path", sort: "page_path", render: (r) => <span className="break-all">{r.page_path}</span> },
              ...(pageKind === "views"
                ? [{ key: "views", label: "Views", sort: "views", align: "right" as const, render: (r: PageRow) => fmtInt(r.views) }]
                : [{ key: "sessions", label: "Sessions", sort: "sessions", align: "right" as const, render: (r: PageRow) => fmtInt(r.sessions) }]),
              { key: "users", label: "Active users", sort: "users", align: "right", render: (r) => fmtInt(r.users) },
              { key: "eng", label: "Avg engagement", sort: "avg_engagement_seconds", align: "right", render: (r) => fmtDuration(toNum(r.avg_engagement_seconds)) },
              { key: "ke", label: "Key events", sort: "key_events", align: "right", render: (r) => fmtDecimal(toNum(r.key_events)) },
            ]}
          />
        </div>
      </div>
    </>
  );
}
