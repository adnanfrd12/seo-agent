import { BarList } from "@/components/charts/bar-list";
import { MetricTrend } from "@/components/charts/metric-trend";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { getSession } from "@/lib/analytics/client-context";
import { fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { LbmSections } from "./lbm-sections";

const PATH = "/business-profile";

type Totals = { has_data: boolean } & Record<string, unknown>;
type Keyword = { keyword: string; impressions: number | null; has_threshold_only: boolean; impressions_threshold: number | null };
type Meta = { address?: string | null; website?: string | null; phone?: string | null; category?: string | null; maps_uri?: string | null; account_name?: string | null; open_status?: string | null };
type Summary = {
  current: Totals; previous: Totals; mom: Totals; yoy: Totals;
  breakdown: { desktop_maps: number | null; desktop_search: number | null; mobile_maps: number | null; mobile_search: number | null } | null;
  keywords: Keyword[];
  locations: { id: string; display_name: string | null; metadata: Meta }[];
};
type LocationRow = { id: string; display_name: string | null; metadata: Meta; current: Totals; previous: Totals };

const pick = (t: Totals | undefined, k: string) => (t?.has_data ? toNum(t[k]) : null);

export default async function BusinessProfilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const compare = first(sp.compare) === "1";
  const title = "Google Business Profile";

  const scope = await resourceScope(client.id, sp);
  if (scope.gbp.length === 0) {
    return (
      <>
        <PageHeader title={title} description="Local search visibility and customer actions." />
        <EmptyState
          title="Business Profile isn't connected"
          body="Connect the Google account that manages the Business Profile, then choose the locations to track."
          action={{ href: "/integrations", label: "Go to Integrations" }}
        />
      </>
    );
  }
  const supabase = scope.supabase;
  const args = { p_client_id: client.id, p_start: range.start, p_end: range.end };
  const [summary, trend, locations, conn] = await Promise.all([
    supabase.rpc("get_gbp_summary", { ...args, p_resource_id: scope.gbpPick?.id ?? null }),
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "gbp", p_granularity: "day", p_compare: compare }),
    supabase.rpc("get_gbp_locations", args),
    supabase.from("integration_connections").select("last_synced_at, last_error, status").eq("client_id", client.id).in("provider", ["gbp", "lbm"])
      .eq("status", "connected").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);

  const lastSync = conn.data?.last_synced_at ? new Date(conn.data.last_synced_at).toLocaleString() : "never";
  const header = (
    <PageHeader title={title}
      description={`Location: ${scope.label(scope.gbp, scope.gbpPick)} · last synced ${lastSync} · metrics arrive with a delay of a few days`} />
  );
  const locationOptions = resourceOptions(scope.gbp, "All locations (combined)");
  const filters = locationOptions && (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <FilterSelect label="Location" name="location" value={scope.gbpPick?.id ?? ""} path={PATH} sp={sp} options={locationOptions} />
    </div>
  );

  const more = <LbmSections supabase={supabase} resourceIds={(scope.gbpPick ? [scope.gbpPick] : scope.gbp).map((r) => r.id)} range={range} />;

  if ([summary, trend, locations].some((r) => r.error)) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-negative">Could not load Business Profile data. Please try again.</p>
      </>
    );
  }
  const s = summary.data as Summary;
  const t = trend.data as TrendData;
  const locs = (locations.data ?? []) as LocationRow[];

  if (!s.current.has_data) {
    return (
      <>
        {header}
        <RangeSelector path={PATH} sp={sp} range={range} />
        {filters}
        {conn.data?.last_error && <p role="alert" className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-negative">{conn.data.last_error}</p>}
        <EmptyState
          title="No Business Profile data for this period"
          body="Either the first import hasn't finished, Google hasn't approved API access for the project yet (see Integrations for the exact error), or this range has no data."
          action={{ href: "/integrations", label: "Open Integrations" }}
        />
        {more}
      </>
    );
  }

  const { current: cur, previous: prev, mom, yoy } = s;
  const actions = (pick(cur, "call_clicks") ?? 0) + (pick(cur, "website_clicks") ?? 0) + (pick(cur, "direction_requests") ?? 0);
  const impressions = pick(cur, "impressions");
  const kpis: { label: string; k: string; hint?: string }[] = [
    { label: "Profile views", k: "impressions", hint: "Times the profile was shown on Google Search and Maps (unique viewers per day)." },
    { label: "Search views", k: "impressions_search" },
    { label: "Maps views", k: "impressions_maps" },
    { label: "Website clicks", k: "website_clicks" },
    { label: "Call button clicks", k: "call_clicks", hint: "Clicks on the call button. Not the same as completed calls." },
    { label: "Direction requests", k: "direction_requests" },
  ];
  const extras: { label: string; k: string; hint?: string }[] = [
    { label: "Bookings", k: "bookings" }, { label: "Messaging clicks", k: "messaging_clicks" }, { label: "Message conversations", k: "conversations" },
    { label: "Menu clicks", k: "food_menu_clicks" },
  ].filter((m) => pick(cur, m.k));
  const b = s.breakdown;
  const split = [
    { label: "Mobile · Search", value: toNum(b?.mobile_search) ?? 0 },
    { label: "Mobile · Maps", value: toNum(b?.mobile_maps) ?? 0 },
    { label: "Desktop · Search", value: toNum(b?.desktop_search) ?? 0 },
    { label: "Desktop · Maps", value: toNum(b?.desktop_maps) ?? 0 },
  ].sort((x, y) => y.value - x.value);
  const totalSplit = split.reduce((a, x) => a + x.value, 0);
  const picked = s.locations.find((l) => l.id === scope.gbpPick?.id) ?? (s.locations.length === 1 ? s.locations[0] : null);

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />
      {filters}

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...kpis, ...extras].map((m) => (
          <KpiCard key={m.k} label={m.label} hint={m.hint} source="GBP" format={fmtInt}
            value={pick(cur, m.k)} previous={pick(prev, m.k)} mom={pick(mom, m.k)} yoy={pick(yoy, m.k)} />
        ))}
      </section>
      <p className="mt-2 text-xs text-muted">
        Actions (website + call + directions): {fmtInt(actions)}
        {impressions ? ` · ${fmtPercent(actions / impressions, 2)} of profile views` : ""}
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Visibility" source="GBP" options={[
          { key: "impressions", label: "All views", data: dailySeries(t, "impressions", range) },
          { key: "impressions_search", label: "Search", data: dailySeries(t, "impressions_search", range) },
          { key: "impressions_maps", label: "Maps", data: dailySeries(t, "impressions_maps", range) },
        ]} />
        <MetricTrend title="Customer actions" source="GBP" options={[
          { key: "website_clicks", label: "Website", data: dailySeries(t, "website_clicks", range) },
          { key: "call_clicks", label: "Calls", data: dailySeries(t, "call_clicks", range) },
          { key: "direction_requests", label: "Directions", data: dailySeries(t, "direction_requests", range) },
        ]} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BarList title="Where people saw the profile" valueLabel="Views"
          items={split.map((x) => ({ ...x, detail: totalSplit ? fmtPercent(x.value / totalSplit, 1) : undefined }))} />
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="Search keywords">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Searches that showed the profile</h2>
            <span className="text-xs text-muted">Monthly · impressions</span>
          </div>
          {s.keywords.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No keyword data for these months yet.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {s.keywords.map((k) => (
                <li key={k.keyword} className="flex justify-between gap-3 border-b border-border/60 py-1 last:border-0">
                  <span className="break-words">{k.keyword}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {k.impressions != null ? fmtInt(toNum(k.impressions)) : `< ${fmtInt(toNum(k.impressions_threshold))}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Keywords are reported per calendar month; every month overlapping the range is included. Low counts are shown by Google only as a threshold.</p>
        </section>
      </div>

      {locs.length > 1 && (
        <section className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface" aria-label="Location comparison">
          <h2 className="px-4 pt-4 text-sm font-semibold">Location comparison</h2>
          <table className="mt-2 w-full min-w-[40rem] text-sm">
            <thead><tr className="text-left text-xs text-muted">
              {["Location", "Views", "vs previous", "Website", "Calls", "Directions"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {locs.map((l) => {
                const v = pick(l.current, "impressions"), p = pick(l.previous, "impressions");
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2">{l.display_name}<div className="text-xs text-muted">{l.metadata?.address}</div></td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(v)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v != null && p ? fmtPercent((v - p) / p, 1) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(pick(l.current, "website_clicks"))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(pick(l.current, "call_clicks"))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(pick(l.current, "direction_requests"))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {picked && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm" aria-label="Business information">
          <h2 className="mb-2 text-sm font-semibold">Business information</h2>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
            {([
              ["Name", picked.display_name], ["Category", picked.metadata?.category], ["Address", picked.metadata?.address],
              ["Phone", picked.metadata?.phone], ["Website", picked.metadata?.website], ["Status", picked.metadata?.open_status],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-all">{v}</dd></div>
            ))}
          </dl>
          {picked.metadata?.maps_uri?.startsWith("https://") && (
            <a href={picked.metadata.maps_uri} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-accent hover:underline">Open on Google Maps →</a>
          )}
        </section>
      )}
      {more}
    </>
  );
}
