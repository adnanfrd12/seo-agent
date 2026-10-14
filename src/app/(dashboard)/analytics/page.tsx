import Link from "next/link";
import { Info } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { DataTable } from "@/components/tables/data-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtDuration, fmtInt, fmtMoney, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";

const PATH = "/analytics";
const PAGE_SIZE = 10;

type Totals = { has_data: boolean } & Record<string, unknown>;
type Compared = { current: Totals; previous: Totals; mom: Totals; yoy: Totals };
type Summary = Compared & {
  devices: { value: string; sessions: number; users: number }[];
  countries: { value: string; sessions: number; users: number }[];
  key_events: { value: string; key_events: number }[];
  channels: { channel_group: string; sessions: number; users: number }[];
};
type Breakdown = { value: string; sessions: number; users: number; key_events: number }[];
type Filtered = Compared & { trend: TrendData; channels: Breakdown; devices: Breakdown; countries: Breakdown };
type Table<T> = { total: number; rows: T[] };
type SourceRow = { source: string; medium: string | null; sessions: number; users: number; engagement_rate: number | null; key_events: number };
type PageRow = { page_path: string; views: number; users: number; sessions: number; avg_engagement_seconds: number | null; key_events: number };

const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

export default async function Ga4Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange(
    { range: first(sp.range), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";
  const channel = (first(sp.channel) ?? "").slice(0, 80) || null;
  const device = (first(sp.device) ?? "").slice(0, 40) || null;
  const country = (first(sp.country) ?? "").slice(0, 80) || null;
  const filtered = Boolean(channel || device || country);

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
  // Unfiltered totals come from the exact daily report; any filter uses the channel x device x
  // country breakdown (which also feeds the filter options and breakdown panels).
  const [summary, trend, breakdown, sources, pages] = await Promise.all([
    supabase.rpc("get_ga4_summary", args),
    filtered
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc("get_analytics_trends", { ...args, p_provider: "ga4", p_granularity: "day", p_compare: compare }),
    supabase.rpc("get_ga4_filtered", { ...args, p_channel: channel, p_device: device, p_country: country, p_compare: compare }),
    supabase.rpc("get_ga4_traffic_sources", {
      ...args, p_sort: tsSort, p_dir: tsDir, p_limit: PAGE_SIZE, p_offset: (tsPage - 1) * PAGE_SIZE, p_channel: channel,
    }),
    supabase.rpc("get_ga4_top_pages", {
      ...args, p_kind: pageKind, p_sort: tpSort, p_dir: tpDir, p_limit: PAGE_SIZE, p_offset: (tpPage - 1) * PAGE_SIZE,
    }),
  ]);

  const header = (
    <PageHeader
      title="Google Analytics 4"
      description={`Property: ${resources.map((r) => r.display_name).join(", ")}${resources[0]?.timezone ? ` · reporting time zone ${resources[0].timezone}` : ""}`}
    />
  );
  if ([summary, trend, breakdown, sources, pages].some((r) => r.error)) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load analytics. Please try again.</p>
      </>
    );
  }

  const s = summary.data as Summary;
  const b = breakdown.data as Filtered;
  const stats: Compared = filtered ? b : s;
  const t: TrendData = filtered ? b.trend : (trend.data as TrendData);
  // keep the selected value in the list even if it has no traffic under the other filters
  const opts = (list: Breakdown, selected: string | null, all: string) => [
    { value: "", label: all },
    ...(selected && !list.some((x) => x.value === selected) ? [{ value: selected, label: selected }] : []),
    ...list.map((x) => ({ value: x.value, label: x.value })),
  ];
  const filters = (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <FilterSelect label="Traffic channel" name="channel" value={channel ?? ""} path={PATH} sp={sp} resetKeys={["ts_page"]}
        options={opts(b.channels, channel, "All channels")} />
      <FilterSelect label="Device" name="device" value={device ?? ""} path={PATH} sp={sp} resetKeys={["ts_page"]}
        options={opts(b.devices, device, "All devices")} />
      <FilterSelect label="Country" name="country" value={country ?? ""} path={PATH} sp={sp} resetKeys={["ts_page"]}
        options={opts(b.countries, country, "All countries")} />
    </div>
  );
  const filterLabel = [channel, device, country].filter(Boolean).join(" · ");

  if (!stats.current.has_data) {
    return (
      <>
        {header}
        <RangeSelector path={PATH} sp={sp} range={range} />
        {filters}
        <EmptyState
          title={filtered ? `No traffic for ${filterLabel} in this period` : "No GA4 data for this period"}
          body={filtered
            ? "Change the filters or widen the date range."
            : "Either the initial import hasn't finished, or this date range has no stored data. Try a wider range, or run Sync Now."}
          action={filtered ? undefined : { href: "/integrations", label: "Open Integrations" }}
        />
      </>
    );
  }

  const hasRevenue = !filtered && pick(stats.current, "revenue") != null;
  const all = [
    { label: "Active Users", k: "users", format: fmtInt, hint: "Summed daily active users; someone active on several days is counted once per day." },
    { label: "New Users", k: "new_users", format: fmtInt },
    { label: "Sessions", k: "sessions", format: fmtInt },
    { label: "Engaged Sessions", k: "engaged_sessions", format: fmtInt },
    { label: "Engagement Rate", k: "engagement_rate", format: fmtPercent, hint: "Engaged sessions ÷ sessions." },
    { label: "Avg Engagement Time", k: "avg_engagement_seconds", format: fmtDuration, hint: "Total engagement time ÷ active users." },
    { label: "Event Count", k: "event_count", format: fmtInt },
    { label: "Key Events", k: "key_events", format: fmtInt, hint: "GA4 key events (formerly conversions)." },
    ...(hasRevenue ? [{ label: "Total Revenue", k: "revenue", format: (n: Num) => fmtMoney(n) }] : []),
  ];
  const kpis = all;

  const src = sources.data as Table<SourceRow>;
  const pg = pages.data as Table<PageRow>;
  const exportBase = `/api/export/ga4?start=${range.start}&end=${range.end}`;
  const r = range;

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />
      {filters}

      {filtered && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-surface p-3 text-sm text-muted ring-1 ring-border">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Filtered to {filterLabel}. These figures come from GA4&apos;s channel × device × country breakdown, where a session
          that touches more than one value is counted in each, so they can read a few percent above the unfiltered totals.
          Top pages and key events below cover all traffic.
        </p>
      )}

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((m) => (
          <KpiCard
            key={m.k} label={m.label} hint={m.hint} source="GA4" format={m.format}
            value={pick(stats.current, m.k)} previous={pick(stats.previous, m.k)} mom={pick(stats.mom, m.k)} yoy={pick(stats.yoy, m.k)}
          />
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Traffic over time" source="GA4" options={[
          { key: "users", label: "Users", data: dailySeries(t, "users", r) },
          { key: "sessions", label: "Sessions", data: dailySeries(t, "sessions", r) },
        ]} />
        <MetricTrend title="Engagement & conversions" source="GA4" options={[
          { key: "engagement_rate", label: "Engagement rate", format: "percent", data: dailySeries(t, "engagement_rate", r, "ratio") },
          { key: "key_events", label: "Key events", data: dailySeries(t, "key_events", r) },
        ]} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BarList title="Traffic by channel" valueLabel="Sessions"
          items={b.channels.map((c) => ({ label: c.value === channel ? `${c.value} (selected)` : c.value, value: Number(c.sessions) }))} />
        <BarList title="Device categories" valueLabel="Sessions"
          items={b.devices.map((d) => ({ label: d.value === device ? `${d.value} (selected)` : d.value, value: Number(d.sessions) }))} />
        <BarList title="Top countries" valueLabel="Sessions"
          items={b.countries.slice(0, 15).map((d) => ({ label: d.value === country ? `${d.value} (selected)` : d.value, value: Number(d.sessions) }))} />
        <BarList title="Key event performance" valueLabel="Key events · all traffic"
          emptyText="No key events recorded. Mark events as key events in GA4 to see them here."
          items={s.key_events.map((e) => ({ label: e.value, value: Number(e.key_events) }))} />
      </div>

      <div className="mt-6 space-y-6">
        <DataTable<SourceRow>
          title={`Traffic sources${channel ? ` · ${channel}` : ""}${device || country ? " (channel filter only)" : ""}`} path={PATH} sp={sp} prefix="ts" sort={tsSort} dir={tsDir} page={tsPage} pageSize={PAGE_SIZE}
          total={Number(src.total)} rows={src.rows} emptyText="No traffic sources for this period."
          csvHref={`${exportBase}&kind=sources&sort=${tsSort}&dir=${tsDir}${channel ? `&channel=${encodeURIComponent(channel)}` : ""}`}
          columns={[
            { key: "source", label: "Source", sort: "source", render: (x) => x.source },
            { key: "medium", label: "Medium", sort: "medium", render: (x) => x.medium ?? "—" },
            { key: "sessions", label: "Sessions", sort: "sessions", align: "right", render: (x) => fmtInt(x.sessions) },
            { key: "users", label: "Users", sort: "users", align: "right", render: (x) => fmtInt(x.users) },
            { key: "eng", label: "Engagement rate", sort: "engagement_rate", align: "right", render: (x) => fmtPercent(toNum(x.engagement_rate)) },
            { key: "ke", label: "Key events", sort: "key_events", align: "right", render: (x) => fmtDecimal(toNum(x.key_events)) },
          ]}
        />

        <div>
          <div className="mb-2 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm" role="group" aria-label="Page report type">
            {(["views", "landing"] as const).map((k) => (
              <Link
                key={k} href={withParams(PATH, sp, { pages: k, tp_page: null, tp_sort: null })} aria-current={pageKind === k ? "true" : undefined}
                className={`rounded-md px-3 py-1 font-medium ${pageKind === k ? "bg-accent text-accent-foreground" : "hover:bg-surface-muted"}`}
              >
                {k === "views" ? "Top pages by views" : "Top landing pages"}
              </Link>
            ))}
          </div>
          <DataTable<PageRow>
            title={`${pageKind === "views" ? "Top pages by views" : "Top landing pages"}${filtered ? " · all traffic" : ""}`}
            path={PATH} sp={sp} prefix="tp" sort={tpSort} dir={tpDir} page={tpPage} pageSize={PAGE_SIZE}
            total={Number(pg.total)} rows={pg.rows} emptyText="No pages for this period."
            csvHref={`${exportBase}&kind=pages&pages=${pageKind}&sort=${tpSort}&dir=${tpDir}`}
            columns={[
              { key: "path", label: "Page path", sort: "page_path", render: (x) => <span className="break-all">{x.page_path}</span> },
              ...(pageKind === "views"
                ? [{ key: "views", label: "Views", sort: "views", align: "right" as const, render: (x: PageRow) => fmtInt(x.views) }]
                : [{ key: "sessions", label: "Sessions", sort: "sessions", align: "right" as const, render: (x: PageRow) => fmtInt(x.sessions) }]),
              { key: "users", label: "Active users", sort: "users", align: "right", render: (x) => fmtInt(x.users) },
              { key: "eng", label: "Avg engagement", sort: "avg_engagement_seconds", align: "right", render: (x) => fmtDuration(toNum(x.avg_engagement_seconds)) },
              { key: "ke", label: "Key events", sort: "key_events", align: "right", render: (x) => fmtDecimal(toNum(x.key_events)) },
            ]}
          />
        </div>
      </div>
    </>
  );
}
