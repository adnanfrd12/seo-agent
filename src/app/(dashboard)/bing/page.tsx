import { MetricTrend } from "@/components/charts/metric-trend";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { Highlights } from "@/components/dashboard/highlights";
import { TabHeader } from "@/components/dashboard/tab-header";
import { movement, pickHighlights } from "@/lib/overview/highlights";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { getSession } from "@/lib/analytics/client-context";
import { fmtDecimal, fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { bingDate, bingDateTime } from "@/lib/bing/api";

const PATH = "/bing";
type Totals = { has_data: boolean } & Record<string, unknown>;
type Row = { clicks: number; impressions: number; ctr: number | null; position: number | null };
type Crawl = Record<string, number | string | null> & { metric_date: string };
type Summary = {
  current: Totals; previous: Totals; mom: Totals; yoy: Totals;
  daily: TrendData["current"]; daily_previous: TrendData["previous"];
  queries: (Row & { query: string })[]; pages: (Row & { page: string })[];
  page_queries: { page: string; query: string; clicks: number; impressions: number; position: number | null }[];
  crawl: Crawl[]; coverage: { first: string | null; last: string | null } | null;
};
type Feed = { Url: string; Type: string; Status: string; UrlCount: number; LastCrawled: string; Submitted: string; Compressed: boolean };
type BingMeta = {
  feeds?: Feed[] | null; crawl_issues?: { Url?: string; Issues?: number; HttpCode?: number; InLinks?: number }[] | null;
  url_submission_quota?: { DailyQuota: number; MonthlyQuota: number } | null; content_submission_quota?: { DailyQuota: number; MonthlyQuota: number } | null;
  crawl_settings?: { CrawlBoostAvailable: boolean; CrawlBoostEnabled: boolean; CrawlRate: number[] } | null;
  blocked_urls?: { Url?: string; EntityType?: number; RequestType?: number; Date?: string }[] | null;
  query_parameters?: { Parameter?: string; IsEnabled?: boolean }[] | null;
  home_index?: { AnchorCount?: number; DiscoveryDate?: string; LastCrawledDate?: string; DocumentSize?: number; TotalChildUrlCount?: number } | null;
  inbound_links?: { Url?: string; Count?: number }[] | null;
  connected_pages?: unknown[] | null; country_region_settings?: unknown[] | null; deep_link_blocks?: unknown[] | null;
  page_preview_blocks?: unknown[] | null; fetched_urls?: unknown[] | null;
};
type Volume = Record<string, { week: string | null; impressions: number; broad: number }[]>;

const card = "rounded-xl border border-border bg-surface p-4";
const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);
const host = (u: string) => { try { const x = new URL(u); return `${x.host}${x.pathname}${x.search}`; } catch { return u; } };
const safe = (u: string) => /^https?:\/\//.test(u);

function Table<T>({ title, rows, cols, empty, max = 25 }: {
  title: string; rows: T[]; empty: string; max?: number;
  cols: { label: string; right?: boolean; render: (r: T) => React.ReactNode }[];
}) {
  const head = (
    <thead className="sticky top-0 bg-surface"><tr className="text-left text-xs text-muted">
      {cols.map((c) => <th key={c.label} className={`px-3 py-2 font-medium ${c.right ? "text-right" : ""}`}>{c.label}</th>)}
    </tr></thead>
  );
  const body = (list: T[]) => (
    <tbody>{list.map((r, i) => (
      <tr key={i} className="border-t border-border">{cols.map((c) => <td key={c.label} className={`px-3 py-1.5 ${c.right ? "text-right tabular-nums" : ""}`}>{c.render(r)}</td>)}</tr>
    ))}</tbody>
  );
  return (
    <section className={card} aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2><span className="text-xs text-muted">{fmtInt(rows.length)} rows</span></div>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
        <>
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm">{head}{body(rows.slice(0, max))}</table></div>
          {rows.length > max && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-accent">Show all {fmtInt(rows.length)}</summary>
              <div className="mt-2 max-h-[32rem] overflow-auto"><table className="w-full min-w-[34rem] text-sm">{head}{body(rows.slice(max))}</table></div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export default async function BingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const compare = first(sp.compare) === "1";
  const title = "Bing Webmaster Tools";
  const scope = await resourceScope(client.id, sp);
  if (scope.bing.length === 0) {
    return (
      <>
        <TabHeader source="bing" title={title} description="How your website performs in Bing search, and how healthy it looks to Bing." />
        <EmptyState title="Bing isn't connected" body="Connect Bing Webmaster Tools with an API key and choose this client's site on the Integrations page."
          action={{ href: "/integrations", label: "Go to Integrations" }} />
      </>
    );
  }
  const supabase = scope.supabase;
  const sites = scope.bingPick ? [scope.bingPick] : scope.bing;
  const [summary, res, conn] = await Promise.all([
    supabase.rpc("get_bing_summary", { p_client_id: client.id, p_start: range.start, p_end: range.end }),
    supabase.from("integration_resources").select("id, display_name, external_id, metadata").in("id", sites.map((s) => s.id)),
    supabase.from("integration_connections").select("last_synced_at, last_error").eq("client_id", client.id).eq("provider", "bing").maybeSingle(),
  ]);
  const siteOptions = resourceOptions(scope.bing, "All sites (combined)");
  const header = (
    <TabHeader source="bing" title={title}
      description={`How your website performs in Bing search, and how healthy it looks to Bing. Site: ${scope.label(scope.bing, scope.bingPick)} · Bing dates in UTC`}
      guide={[
          { term: "Clicks and impressions", text: "How often your site appeared in Bing results (impressions) and how often it was clicked." },
          { term: "Average position", text: "Where you typically appear in Bing (1 = top). It is an impression-weighted average of Bing's weekly figures." },
          { term: "Index and crawl", text: "Pages Bing has stored (index) and how often it visits (crawl). Crawl errors mean pages Bing couldn't read." },
          { term: "Weekly data", text: "Bing reports queries and pages in weekly buckets, so they are less exact than daily Google data." },
        ]} />
  );
  const filters = siteOptions && (
    <div className="mb-5 flex flex-wrap items-end gap-3"><FilterSelect label="Site" name="bsite" value={scope.bingPick?.id ?? ""} path={PATH} sp={sp} options={siteOptions} /></div>
  );
  if (summary.error) {
    return <>{header}<p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load Bing data (has migration 20261027000015 been applied?).</p></>;
  }
  const s = summary.data as Summary;
  const t: TrendData = { current: s.daily, previous: compare ? s.daily_previous : [] };
  const coverage = s.coverage?.first ? `Bing data stored from ${s.coverage.first} to ${s.coverage.last}.` : "";

  /* --------------------------------------------------------------- crawl */
  const crawl = s.crawl;
  const latest = crawl.at(-1);
  const sumC = (k: string) => crawl.reduce((a, c) => a + (Number(c[k]) || 0), 0);
  const crawlTrend: TrendData = { current: crawl.map((c) => ({ ...c, date: c.metric_date })), previous: [] };
  const codes = [["2xx (OK)", "code_2xx"], ["301 redirects", "code_301"], ["302 redirects", "code_302"], ["4xx errors", "code_4xx"], ["5xx errors", "code_5xx"],
    ["Other codes", "all_other_codes"], ["Blocked by robots.txt", "blocked_by_robots"], ["DNS failures", "dns_failures"], ["Timeouts", "connection_timeout"], ["Malware", "contains_malware"]] as const;

  const resources = (res.data ?? []) as { id: string; display_name: string | null; external_id: string; metadata: { bing?: BingMeta; keyword_volume?: Volume } | null }[];
  const crawlErrPct = latest && Number(latest.crawled_pages) > 0 ? (Number(latest.crawl_errors) / Number(latest.crawled_pages)) * 100 : null;
  const hl = pickHighlights([
    movement("Bing clicks", pick(s.current, "clicks"), pick(s.previous, "clicks"), { fmt: fmtInt, minBase: 10, actionWhenBad: "Check the Queries table for terms that lost visibility." }),
    movement("Bing impressions", pick(s.current, "impressions"), pick(s.previous, "impressions"), { fmt: fmtInt, minBase: 100 }),
    movement("Average position", pick(s.current, "position"), pick(s.previous, "position"), { fmt: (n) => n.toFixed(1), lowerIsBetter: true, minPct: 5 }),
    crawlErrPct != null && crawlErrPct >= 5 && { tone: "bad" as const, title: `${crawlErrPct.toFixed(0)}% of pages Bing crawled had errors`, detail: "Pages Bing can't read can't rank.", action: "Open Crawl health below and fix broken pages (4xx) or server errors (5xx)." },
  ]);
  const pq = new Map<string, Summary["page_queries"]>();
  for (const r of s.page_queries) pq.set(r.page, [...(pq.get(r.page) ?? []), r]);

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />
      {filters}
      {conn.data?.last_error && <p role="alert" className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-negative">{conn.data.last_error}</p>}

      {!s.current.has_data ? (
        <EmptyState title="No Bing search data for this period" body={`${coverage} The first import may still be running, or try a different range.`}
          action={{ href: "/integrations", label: "Open Integrations" }} />
      ) : (
        <>
          <Highlights items={hl} />
          <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {([
              { label: "Bing clicks", k: "clicks", format: fmtInt, higher: true },
              { label: "Bing impressions", k: "impressions", format: fmtInt, higher: true },
              { label: "Click-through rate", k: "ctr", format: (n: number | null | undefined) => fmtPercent(n, 2), higher: true, hint: "Clicks ÷ impressions." },
              { label: "Average position", k: "position", format: fmtDecimal, higher: false, hint: "Impression-weighted average of Bing's weekly query positions. Lower is better." },
            ]).map((m) => (
              <KpiCard key={m.k} label={m.label} hint={m.hint} source="Bing" format={m.format} higherIsBetter={m.higher}
                value={pick(s.current, m.k)} previous={pick(s.previous, m.k)} mom={pick(s.mom, m.k)} yoy={pick(s.yoy, m.k)} />
            ))}
          </section>
          <p className="mt-2 text-xs text-muted">{coverage} Query and page statistics are weekly buckets; weeks starting inside the range are included.</p>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <MetricTrend title="Bing search performance" source="Bing" options={[
              { key: "clicks", label: "Clicks", data: dailySeries(t, "clicks", range) },
              { key: "impressions", label: "Impressions", data: dailySeries(t, "impressions", range) },
              { key: "ctr", label: "CTR", format: "percent", data: dailySeries(t, "ctr", range, "ratio") },
            ]} />
            <MetricTrend title="Crawl & index" source="Bing" options={[
              { key: "in_index", label: "Indexed pages", data: dailySeries(crawlTrend, "in_index", range, "ratio") },
              { key: "crawled_pages", label: "Crawled", data: dailySeries(crawlTrend, "crawled_pages", range) },
              { key: "crawl_errors", label: "Crawl errors", data: dailySeries(crawlTrend, "crawl_errors", range) },
              { key: "in_links", label: "Inbound links", data: dailySeries(crawlTrend, "in_links", range, "ratio") },
            ]} />
          </div>
        </>
      )}

      <div className="mt-6 space-y-6">
        <Table title="Search queries" rows={s.queries} empty="No query data for this period."
          cols={[
            { label: "Query", render: (r) => <span className="break-words">{r.query}</span> },
            { label: "Clicks", right: true, render: (r) => fmtInt(r.clicks) },
            { label: "Impressions", right: true, render: (r) => fmtInt(r.impressions) },
            { label: "CTR", right: true, render: (r) => fmtPercent(toNum(r.ctr), 2) },
            { label: "Avg position", right: true, render: (r) => fmtDecimal(toNum(r.position)) },
          ]} />

        <Table title="Pages" rows={s.pages} empty="No page data for this period."
          cols={[
            { label: "Page", render: (r) => (
              <div>
                {safe(r.page) ? <a href={r.page} target="_blank" rel="noopener noreferrer" className="break-all hover:text-accent hover:underline">{host(r.page)}</a> : <span className="break-all">{r.page}</span>}
                {pq.has(r.page) && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-accent">{pq.get(r.page)!.length} queries for this page</summary>
                    <ul className="mt-1 space-y-0.5">{pq.get(r.page)!.slice(0, 50).map((q) => (
                      <li key={q.query} className="flex justify-between gap-3"><span className="break-words">{q.query}</span>
                        <span className="shrink-0 tabular-nums text-muted">{fmtInt(q.clicks)} clicks · {fmtInt(q.impressions)} impr · pos {fmtDecimal(toNum(q.position))}</span></li>
                    ))}</ul>
                  </details>
                )}
              </div>
            ) },
            { label: "Clicks", right: true, render: (r) => fmtInt(r.clicks) },
            { label: "Impressions", right: true, render: (r) => fmtInt(r.impressions) },
            { label: "CTR", right: true, render: (r) => fmtPercent(toNum(r.ctr), 2) },
            { label: "Avg position", right: true, render: (r) => fmtDecimal(toNum(r.position)) },
          ]} />

        {crawl.length > 0 && (
          <section className={card} aria-label="Crawl health">
            <h2 className="mb-3 text-sm font-semibold">Crawl health ({crawl.length} days in range)</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[["Pages in Bing's index", latest?.in_index], ["Inbound links", latest?.in_links], ["Pages crawled", sumC("crawled_pages")], ["Crawl errors", sumC("crawl_errors")]].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg bg-surface-muted p-3"><p className="text-[11px] font-semibold uppercase text-muted">{l}</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmtInt(toNum(v))}</p></div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Index and inbound-link counts are the latest day ({latest?.metric_date}); crawled pages and errors are summed over the range.</p>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {codes.map(([label, k]) => <li key={k} className="flex justify-between border-b border-border/60 py-1"><span>{label}</span><span className="tabular-nums">{fmtInt(sumC(k))}</span></li>)}
            </ul>
            <p className="mt-1 text-xs text-muted">HTTP response counts summed over the days in range.</p>
          </section>
        )}

        {resources.map((r) => {
          const b = r.metadata?.bing ?? {};
          const vol = r.metadata?.keyword_volume ?? {};
          const settings = b.crawl_settings;
          return (
            <div key={r.id} className="space-y-6">
              <h2 className="text-base font-semibold">{r.display_name ?? r.external_id}: site details</h2>
              <Table title="Sitemaps & feeds" rows={b.feeds ?? []} empty="No sitemaps submitted to Bing."
                cols={[
                  { label: "Sitemap", render: (f) => <span className="break-all">{f.Url}</span> },
                  { label: "Type", render: (f) => f.Type },
                  { label: "Status", render: (f) => <span className={f.Status === "Success" ? "text-positive" : "text-negative"}>{f.Status}</span> },
                  { label: "URLs", right: true, render: (f) => fmtInt(f.UrlCount) },
                  { label: "Last crawled", render: (f) => bingDate(f.LastCrawled) ?? "—" },
                ]} />
              <Table title="Crawl issues" rows={b.crawl_issues ?? []} empty="Bing reports no crawl issues."
                cols={[
                  { label: "URL", render: (i) => <span className="break-all">{i.Url ?? "—"}</span> },
                  { label: "HTTP code", right: true, render: (i) => i.HttpCode ?? "—" },
                  { label: "Issue flags", right: true, render: (i) => i.Issues ?? "—" },
                  { label: "Inbound links", right: true, render: (i) => fmtInt(i.InLinks ?? null) },
                ]} />
              <Table title="Pages with inbound links" rows={b.inbound_links ?? []} empty="Bing lists no pages with inbound links."
                cols={[{ label: "Page", render: (l) => <span className="break-all">{l.Url}</span> }, { label: "Links", right: true, render: (l) => fmtInt(l.Count ?? null) }]} />
              {Object.keys(vol).length > 0 && (
                <Table title="Bing search volume for top queries (US, weekly)" rows={Object.entries(vol)} empty=""
                  cols={[
                    { label: "Query", render: ([q]) => q },
                    { label: "Latest week", render: ([, v]) => v.at(-1)?.week ?? "—" },
                    { label: "Exact impressions", right: true, render: ([, v]) => fmtInt(v.at(-1)?.impressions ?? null) },
                    { label: "Broad impressions", right: true, render: ([, v]) => fmtInt(v.at(-1)?.broad ?? null) },
                    { label: "Avg / week", right: true, render: ([, v]) => fmtInt(v.length ? Math.round(v.reduce((a, x) => a + x.impressions, 0) / v.length) : null) },
                  ]} />
              )}
              <section className={card} aria-label="Bing settings">
                <h3 className="mb-2 text-sm font-semibold">Index, quotas and settings</h3>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  {b.home_index && <>
                    <dt className="text-muted">Homepage first discovered</dt><dd>{bingDate(b.home_index.DiscoveryDate) ?? "—"}</dd>
                    <dt className="text-muted">Homepage last crawled</dt><dd>{bingDateTime(b.home_index.LastCrawledDate)?.replace("T", " ").slice(0, 16) ?? "—"}</dd>
                    <dt className="text-muted">Homepage anchors (links found)</dt><dd>{fmtInt(b.home_index.AnchorCount ?? null)}</dd>
                  </>}
                  {b.url_submission_quota && <><dt className="text-muted">URL submission quota</dt><dd>{fmtInt(b.url_submission_quota.DailyQuota)} / day · {fmtInt(b.url_submission_quota.MonthlyQuota)} / month</dd></>}
                  {b.content_submission_quota && <><dt className="text-muted">Content submission quota</dt><dd>{fmtInt(b.content_submission_quota.DailyQuota)} / day · {fmtInt(b.content_submission_quota.MonthlyQuota)} / month</dd></>}
                  {settings && <>
                    <dt className="text-muted">Crawl boost</dt><dd>{settings.CrawlBoostEnabled ? "Enabled" : settings.CrawlBoostAvailable ? "Available, not enabled" : "Not available"}</dd>
                    <dt className="text-muted">Crawl rate by hour (UTC)</dt><dd className="font-mono text-xs">{settings.CrawlRate?.join(" ")}</dd>
                  </>}
                  <dt className="text-muted">Blocked URLs</dt><dd>{(b.blocked_urls ?? []).length ? (b.blocked_urls ?? []).map((u) => u.Url).join(", ") : "None"}</dd>
                  <dt className="text-muted">URL parameters ignored</dt><dd>{(b.query_parameters ?? []).length ? (b.query_parameters ?? []).map((q) => `${q.Parameter}${q.IsEnabled ? "" : " (off)"}`).join(", ") : "None"}</dd>
                  <dt className="text-muted">Other settings</dt>
                  <dd>{[["connected pages", b.connected_pages], ["country/region settings", b.country_region_settings], ["deep-link blocks", b.deep_link_blocks],
                    ["page-preview blocks", b.page_preview_blocks], ["fetched URLs", b.fetched_urls]].map(([l, v]) => `${(v as unknown[] | null)?.length ?? 0} ${l}`).join(" · ")}</dd>
                </dl>
              </section>
            </div>
          );
        })}
      </div>
    </>
  );
}
