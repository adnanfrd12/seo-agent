import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { MetricTrend } from "@/components/charts/metric-trend";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { SearchBox } from "@/components/dashboard/search-box";
import { DataTable } from "@/components/tables/data-table";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createClient } from "@/lib/supabase/server";

const PATH = "/search-console";
const PAGE_SIZE = 10;
const SEARCH_TYPES = [
  { value: "web", label: "Web" }, { value: "image", label: "Image" }, { value: "video", label: "Video" },
  { value: "news", label: "News" }, { value: "discover", label: "Discover" }, { value: "googleNews", label: "Google News" },
] as const;

type Totals = { has_data: boolean } & Record<string, unknown>;
type Summary = { current: Totals; previous: Totals; mom: Totals; yoy: Totals; devices: string[]; countries: string[] };
type Table<T> = { total: number; rows: T[] };
type KeywordRow = { query: string; clicks: number; impressions: number; ctr: number | null; position: number | null; position_change: number | null };
type PageRow = { page: string; clicks: number; impressions: number; ctr: number | null; position: number | null };

const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Positive = moved up the results page (e.g. from 8.0 to 5.0 is +3.0), which is good. */
function PositionChange({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.05) return <span className="text-muted">—</span>;
  const up = value > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center justify-end gap-0.5 font-medium ${up ? "text-positive" : "text-negative"}`}
      title={up ? "Moved up in search results" : "Moved down in search results"}>
      <Icon className="size-3" aria-hidden />
      {Math.abs(value).toFixed(1)}
      <span className="sr-only">{up ? "positions up" : "positions down"}</span>
    </span>
  );
}

/**
 * Host + path (protocol dropped). The host stays visible because Search Console can report
 * http://www.example.com/ and https://example.com/ as separate pages. Links only to http(s).
 */
function PageLink({ url }: { url: string }) {
  let label = url;
  let safe = false;
  try {
    const u = new URL(url);
    safe = u.protocol === "https:" || u.protocol === "http:";
    label = `${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    // not a URL; show as text
  }
  return safe ? (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url} className="break-all hover:text-accent hover:underline">
      {label}
    </a>
  ) : (
    <span className="break-all">{label}</span>
  );
}

export default async function SearchConsolePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange(
    { range: first(sp.range), start: first(sp.start), end: first(sp.end) },
    client.timezone, client.defaultRangeDays,
  );
  const compare = first(sp.compare) === "1";

  const searchType = oneOf(first(sp.type), SEARCH_TYPES.map((t) => t.value), "web");
  const device = first(sp.device) || null;
  const country = first(sp.country) || null;
  const kwSearch = (first(sp.q) ?? "").slice(0, 200) || null;
  const pgSearch = (first(sp.url) ?? "").slice(0, 200) || null;

  const kwSort = oneOf(first(sp.kw_sort), ["query", "clicks", "impressions", "ctr", "position", "position_change"] as const, "clicks");
  const kwDir = oneOf(first(sp.kw_dir), ["asc", "desc"] as const, "desc");
  const kwPage = Math.max(1, Number(first(sp.kw_page)) || 1);
  const pgSort = oneOf(first(sp.pg_sort), ["page", "clicks", "impressions", "ctr", "position"] as const, "clicks");
  const pgDir = oneOf(first(sp.pg_dir), ["asc", "desc"] as const, "desc");
  const pgPage = Math.max(1, Number(first(sp.pg_page)) || 1);

  const supabase = await createClient();
  const { data: resources } = await supabase
    .from("integration_resources")
    .select("display_name")
    .eq("client_id", client.id).eq("provider", "gsc").eq("is_selected", true);

  const title = "Google Search Console";
  if (!resources || resources.length === 0) {
    return (
      <>
        <PageHeader title={title} description="Organic search performance." />
        <EmptyState
          title="Search Console isn't connected"
          body="Connect your Google account and choose a Search Console site to start importing data."
          action={{ href: "/integrations", label: "Go to Integrations" }}
        />
      </>
    );
  }

  const args = { p_client_id: client.id, p_start: range.start, p_end: range.end };
  // Query/page detail is stored for web search across all countries only (see lib/sync/gsc.ts),
  // so the tables ignore the search-type and country filters rather than showing empty results.
  const tableArgs = { ...args, p_search_type: "web", p_device: device, p_country: null };
  const [summary, trend, keywords, pages] = await Promise.all([
    supabase.rpc("get_gsc_summary", { ...args, p_search_type: searchType, p_device: device, p_country: country }),
    supabase.rpc("get_analytics_trends", {
      ...args, p_provider: "gsc", p_granularity: "day", p_compare: compare,
      p_search_type: searchType, p_device: device, p_country: country,
    }),
    supabase.rpc("get_gsc_keywords", {
      ...tableArgs, p_search: kwSearch, p_sort: kwSort, p_dir: kwDir, p_limit: PAGE_SIZE, p_offset: (kwPage - 1) * PAGE_SIZE,
    }),
    supabase.rpc("get_gsc_top_pages", {
      ...tableArgs, p_search: pgSearch, p_sort: pgSort, p_dir: pgDir, p_limit: PAGE_SIZE, p_offset: (pgPage - 1) * PAGE_SIZE,
    }),
  ]);

  const header = (
    <PageHeader
      title={title}
      description={`Site: ${resources.map((r) => r.display_name).join(", ")} · dates in Pacific Time · the latest 2–3 days are preliminary`}
    />
  );
  if ([summary, trend, keywords, pages].some((r) => r.error)) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load Search Console data. Please try again.</p>
      </>
    );
  }

  const s = summary.data as Summary;
  const t = trend.data as TrendData;
  const kw = keywords.data as Table<KeywordRow>;
  const pg = pages.data as Table<PageRow>;
  const tablesNarrowed = searchType !== "web" || country !== null;
  const filtersActive = searchType !== "web" || device !== null || country !== null;
  const resetPagers = ["kw_page", "pg_page"];
  const exportBase =
    `/api/export/gsc?start=${range.start}&end=${range.end}` +
    `${device ? `&device=${encodeURIComponent(device)}` : ""}`;

  const filters = (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <FilterSelect label="Search type" name="type" value={searchType} path={PATH} sp={sp} resetKeys={resetPagers}
        options={SEARCH_TYPES.map((x) => ({ value: x.value, label: x.label }))} />
      <FilterSelect label="Device" name="device" value={device ?? ""} path={PATH} sp={sp} resetKeys={resetPagers}
        options={[{ value: "", label: "All devices" }, ...s.devices.map((d) => ({ value: d, label: cap(d) }))]} />
      <FilterSelect label="Country" name="country" value={country ?? ""} path={PATH} sp={sp} resetKeys={resetPagers}
        options={[{ value: "", label: "All countries" }, ...s.countries.map((c) => ({ value: c, label: c.toUpperCase() }))]} />
    </div>
  );

  if (!s.current.has_data) {
    return (
      <>
        {header}
        <RangeSelector path={PATH} sp={sp} range={range} />
        {filtersActive && filters}
        <EmptyState
          title="No Search Console data for this selection"
          body={filtersActive
            ? "Nothing matches these filters in this period. Try All devices / All countries or the Web search type."
            : "Either the initial import hasn't finished, or this date range has no stored data. Try a wider range, or run Sync Now."}
          action={{ href: "/integrations", label: "Open Integrations" }}
        />
      </>
    );
  }

  const cur = s.current, prev = s.previous, mom = s.mom, yoy = s.yoy;
  const kpis = [
    { label: "Total Clicks", k: "clicks", format: fmtInt, higher: true },
    { label: "Total Impressions", k: "impressions", format: fmtInt, higher: true },
    { label: "Average CTR", k: "ctr", format: (n: number | null | undefined) => fmtPercent(n, 2), higher: true, hint: "Total clicks ÷ total impressions." },
    { label: "Average Position", k: "position", format: fmtDecimal, higher: false, hint: "Impression-weighted average ranking position. Lower is better." },
  ];

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />
      {filters}

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((m) => (
          <KpiCard
            key={m.k} label={m.label} hint={m.hint} source="GSC" format={m.format} higherIsBetter={m.higher}
            value={pick(cur, m.k)} previous={pick(prev, m.k)} mom={pick(mom, m.k)} yoy={pick(yoy, m.k)}
          />
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Search visibility" source="GSC" options={[
          { key: "clicks", label: "Clicks", data: dailySeries(t, "clicks", range) },
          { key: "impressions", label: "Impressions", data: dailySeries(t, "impressions", range) },
        ]} />
        <MetricTrend title="Click-through & ranking" source="GSC" options={[
          { key: "ctr", label: "CTR", format: "percent", data: dailySeries(t, "ctr", range, "ratio") },
          { key: "position", label: "Avg position", format: "decimal", reverseY: true, data: dailySeries(t, "position", range, "ratio") },
        ]} />
      </div>

      <div className="mt-6 space-y-6">
        {tablesNarrowed && (
          <p className="flex items-start gap-2 rounded-lg bg-surface p-3 text-sm text-muted ring-1 ring-border">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Keyword and page tables show Web search across all countries; the search type and country filters apply to the
            totals and charts above. The device filter applies everywhere.
          </p>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              Search Console hides rare (anonymized) queries, so keyword rows don&apos;t add up to the totals above.
            </p>
            <SearchBox path={PATH} sp={sp} name="q" resetKey="kw_page" placeholder="Filter queries…" label="query filter" />
          </div>
          <DataTable<KeywordRow>
            title="Keyword performance" path={PATH} sp={sp} prefix="kw" sort={kwSort} dir={kwDir} page={kwPage} pageSize={PAGE_SIZE}
            total={Number(kw.total)} rows={kw.rows}
            emptyText={kwSearch ? `No queries containing “${kwSearch}” in this period.` : "No queries for this period."}
            csvHref={`${exportBase}&kind=keywords&sort=${kwSort}&dir=${kwDir}${kwSearch ? `&search=${encodeURIComponent(kwSearch)}` : ""}`}
            columns={[
              { key: "query", label: "Search query", sort: "query", render: (r) => <span className="break-words">{r.query}</span> },
              { key: "clicks", label: "Clicks", sort: "clicks", align: "right", render: (r) => fmtInt(r.clicks) },
              { key: "impr", label: "Impressions", sort: "impressions", align: "right", render: (r) => fmtInt(r.impressions) },
              { key: "ctr", label: "CTR", sort: "ctr", align: "right", render: (r) => fmtPercent(toNum(r.ctr), 2) },
              { key: "pos", label: "Avg position", sort: "position", align: "right", render: (r) => fmtDecimal(toNum(r.position)) },
              { key: "chg", label: "Position change", sort: "position_change", align: "right", render: (r) => <PositionChange value={toNum(r.position_change)} /> },
            ]}
          />
        </div>

        <div>
          <div className="mb-2 flex justify-end">
            <SearchBox path={PATH} sp={sp} name="url" resetKey="pg_page" placeholder="Filter page URLs…" label="page URL filter" />
          </div>
          <DataTable<PageRow>
            title="Top pages" path={PATH} sp={sp} prefix="pg" sort={pgSort} dir={pgDir} page={pgPage} pageSize={PAGE_SIZE}
            total={Number(pg.total)} rows={pg.rows}
            emptyText={pgSearch ? `No pages containing “${pgSearch}” in this period.` : "No pages for this period."}
            csvHref={`${exportBase}&kind=pages&sort=${pgSort}&dir=${pgDir}${pgSearch ? `&search=${encodeURIComponent(pgSearch)}` : ""}`}
            columns={[
              { key: "page", label: "Page URL", sort: "page", render: (r) => <PageLink url={r.page} /> },
              { key: "clicks", label: "Clicks", sort: "clicks", align: "right", render: (r) => fmtInt(r.clicks) },
              { key: "impr", label: "Impressions", sort: "impressions", align: "right", render: (r) => fmtInt(r.impressions) },
              { key: "ctr", label: "CTR", sort: "ctr", align: "right", render: (r) => fmtPercent(toNum(r.ctr), 2) },
              { key: "pos", label: "Avg position", sort: "position", align: "right", render: (r) => fmtDecimal(toNum(r.position)) },
            ]}
          />
        </div>
      </div>
    </>
  );
}
