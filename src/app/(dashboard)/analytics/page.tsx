import Link from "next/link";
import { Info } from "lucide-react";
import { Columns } from "@/components/charts/ai-charts";
import { ShareDonut } from "@/components/charts/analytics-charts";
import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { EmptyState } from "@/components/dashboard/page-header";
import { Highlights } from "@/components/dashboard/highlights";
import { TabHeader } from "@/components/dashboard/tab-header";
import { movement, pickHighlights } from "@/lib/overview/highlights";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { DataTable } from "@/components/tables/data-table";
import { ResearchTable } from "@/components/research/research-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtDuration, fmtInt, fmtMoney, fmtPercent, toNum, type Num } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, withParams, type SearchParams } from "@/lib/analytics/url";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";

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

  const scope = await resourceScope(client.id, sp);
  const supabase = scope.supabase; // RPCs scoped to the picked property (or all tracked ones)
  const resources = scope.ga4Pick ? [scope.ga4Pick] : scope.ga4;
  const propertyOptions = resourceOptions(scope.ga4, "All properties (combined)");

  if (scope.ga4.length === 0) {
    return (
      <>
        <TabHeader source="ga4" title="Google Analytics 4" description="Who visits your website, how they behave and which actions they take." />
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
    <TabHeader
      source="ga4" title="Google Analytics 4"
      description={`Who visits your website, how they behave and which actions they take. Property: ${resources.map((r) => r.display_name).join(", ")}${resources[0]?.timezone ? ` · reporting time zone ${resources[0].timezone}` : ""}`}
      guide={[
        { term: "Active users", text: "People who visited and engaged with the site. A person active on several days is counted once per day." },
        { term: "Sessions", text: "Visits to the site. One person can have several sessions." },
        { term: "Engagement rate", text: "The share of sessions that lasted 10+ seconds, had a key event, or viewed 2+ pages. Higher means visitors found something worth their time." },
        { term: "Key events", text: "The actions you decided matter (form sent, call tapped, purchase). Called conversions before." },
        { term: "Traffic channel", text: "How visitors arrived: Organic Search (Google/Bing), Direct, Referral (other sites), Social, Paid, Email." },
        { term: "Landing page", text: "The first page a visitor sees. Good landing pages match the search that brought people there." },
      ]}
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
      {propertyOptions && (
        <FilterSelect label="Property" name="property" value={scope.ga4Pick?.id ?? ""} path={PATH} sp={sp}
          resetKeys={["ts_page", "tp_page"]} options={propertyOptions} />
      )}
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

  // extra breakdowns (cities, new vs returning); absent until the latest migration is applied and a sync has run
  const [cityRes, userTypeRes, eventsRes] = await Promise.all([
    supabase.rpc("get_ga4_dimension", { ...args, p_dim: "city", p_limit: 15 }),
    supabase.rpc("get_ga4_dimension", { ...args, p_dim: "user_type", p_limit: 5 }),
    supabase.rpc("get_ga4_events", args),
  ]);
  const totalEvents = pick(stats.current, "event_count");
  const events = (eventsRes.error ? [] : ((eventsRes.data ?? []) as { value: string; event_count: number; users: number; key_events: number; revenue: number }[]))
    .map((e) => ({
      event: e.value, count: Number(e.event_count), share: totalEvents ? Number(((Number(e.event_count) / totalEvents) * 100).toFixed(1)) : null,
      users: Number(e.users), per_user: Number(e.users) > 0 ? Number((Number(e.event_count) / Number(e.users)).toFixed(2)) : null,
      key: Number(e.key_events) > 0 ? "Key event" : "", key_events: Number(e.key_events), revenue: Number(e.revenue),
    }));
  const cities = cityRes.error ? [] : ((cityRes.data ?? []) as { value: string; sessions: number }[]);
  const userTypes = userTypeRes.error ? [] : ((userTypeRes.data ?? []) as { value: string; sessions: number }[]);
  const topChannel = b.channels[0];
  const totalSessions = b.channels.reduce((a, c) => a + Number(c.sessions), 0);
  const hl = pickHighlights([
    movement("Website sessions", pick(stats.current, "sessions"), pick(stats.previous, "sessions"), { fmt: fmtInt, minBase: 30, actionWhenBad: "See which channel dropped in Traffic by channel below.", action: "See which channel grew in Traffic by channel below." }),
    movement("Engagement rate", pick(stats.current, "engagement_rate"), pick(stats.previous, "engagement_rate"), { fmt: (n) => fmtPercent(n, 1), minBase: 0.01, minPct: 5, actionWhenBad: "Check the top landing pages: low engagement usually means the page doesn't match what visitors expected." }),
    movement("Key events", pick(stats.current, "key_events"), pick(stats.previous, "key_events"), { fmt: fmtInt, minBase: 3, actionWhenBad: "Check which page or channel stopped producing actions." }),
    pick(stats.current, "key_events") === 0 && { tone: "info" as const, title: "No key events recorded", detail: "Without them, GA4 can't show which visits turn into leads or sales.", action: "Mark your goals (form submit, call tap, purchase) as key events in GA4." },
    topChannel && totalSessions > 0 && Number(topChannel.sessions) / totalSessions >= 0.5 && { tone: "info" as const, title: `${topChannel.value} brings ${Math.round((Number(topChannel.sessions) / totalSessions) * 100)}% of visits`, detail: "Relying on one channel is risky if it changes.", action: "Build a second source (e.g. local listings, email, content) so one change can't cut traffic in half." },
  ]);

  const src = sources.data as Table<SourceRow>;
  const pg = pages.data as Table<PageRow>;
  const exportBase = `/api/export/ga4?start=${range.start}&end=${range.end}${scope.ga4Pick ? `&property=${scope.ga4Pick.id}` : ""}`;
  const r = range;
  // average sessions per weekday over the days stored in the period (UTC calendar dates)
  const wd = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  for (const p of t?.current ?? []) {
    const w = wd[(new Date(`${p.date}T00:00:00Z`).getUTCDay() + 6) % 7];
    w.sum += toNum(p.sessions) ?? 0;
    w.days += 1;
  }
  const wdAvg = wd.map((w) => (w.days ? Math.round(w.sum / w.days) : 0));
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ label, value: wdAvg[i], highlight: wdAvg[i] > 0 && wdAvg[i] === Math.max(...wdAvg) }));

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

      <Highlights items={hl} />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-4">
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

      {/* panels are paired by length (donuts with a column chart, lists with lists of the same rows) so no card stretches */}
      <div className={`mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 ${userTypes.length > 0 ? "xl:grid-cols-3" : ""} md:[&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(odd)]:col-span-1`}>
        <ShareDonut title="Device categories" sub={device ? `${device} selected` : "Share of sessions"} centerLabel="sessions"
          items={b.devices.map((d) => ({ label: d.value, value: Number(d.sessions) }))} />
        {userTypes.length > 0 && (
          <ShareDonut title="New vs returning visitors" sub="Share of sessions · all traffic" centerLabel="sessions"
            items={userTypes.map((c) => ({ label: c.value === "new" ? "New visitors" : c.value === "returning" ? "Returning visitors" : c.value, value: Number(c.sessions) }))} />
        )}
        <Columns title="Sessions by day of week" sub="Average per day in this period; busiest day highlighted" valueLabel="Avg sessions" bins={weekdays} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:[&>*:last-child:nth-child(odd)]:col-span-2">
        <BarList title="Traffic by channel" valueLabel="Sessions"
          items={b.channels.map((c) => ({ label: c.value === channel ? `${c.value} (selected)` : c.value, value: Number(c.sessions) }))} />
        <BarList title="Key events by channel" valueLabel="Key events"
          items={b.channels.map((c) => ({ label: c.value === channel ? `${c.value} (selected)` : c.value, value: Number(c.key_events), detail: Number(c.sessions) > 0 ? fmtPercent(Number(c.key_events) / Number(c.sessions), 1) : undefined }))} />
        <BarList title="Top countries" valueLabel="Sessions"
          items={b.countries.slice(0, 15).map((d) => ({ label: d.value === country ? `${d.value} (selected)` : d.value, value: Number(d.sessions) }))} />
        {cities.length > 0 && <BarList title="Top cities" valueLabel="Sessions · all traffic" items={cities.map((c) => ({ label: c.value, value: Number(c.sessions) }))} />}
      </div>

      <div className="mt-4">
        <BarList title="Key event performance" valueLabel="Key events · all traffic"
          emptyText="No key events recorded. Mark events as key events in GA4 to see them here."
          items={s.key_events.map((e) => ({ label: e.value, value: Number(e.key_events) }))} />
      </div>

      <section aria-label="Events" className="mt-6">
        {events.length > 0 ? (
          <ResearchTable title="Events" rows={events} columns={[
            { key: "event", label: "Event name" }, { key: "count", label: "Event count", type: "int" }, { key: "share", label: "% of events", type: "dec" },
            { key: "users", label: "Total users", type: "int", hint: "Summed per day: someone who fired the event on two days counts twice." },
            { key: "per_user", label: "Events per user", type: "dec" }, { key: "key", label: "Key event", type: "badge" },
            { key: "key_events", label: "Key event count", type: "int" }, { key: "revenue", label: "Revenue", type: "usd" },
          ]} searchKeys={["event"]} facets={[{ key: "key", label: "Type" }]} ranges={[{ key: "count", label: "Event count" }]}
            presets={[{ label: "Key events only", where: [{ key: "key_events", op: "gte", value: 1 }] }]}
            initialSort={{ key: "count", dir: "desc" }} csvName={`ga4-events-${range.start}-${range.end}`} />
        ) : (
          <p className="rounded-[10px] border border-dashed border-border p-4 text-sm text-muted">Events appear after the next GA4 sync.</p>
        )}
      </section>

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
