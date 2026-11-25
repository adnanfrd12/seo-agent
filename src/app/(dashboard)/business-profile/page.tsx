import { ShareDonut, StackedTimeBars } from "@/components/charts/analytics-charts";
import { AiScreenTools } from "@/components/aiqw/screen-tools";
import { MetricTrend } from "@/components/charts/metric-trend";
import { TrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { Highlights } from "@/components/dashboard/highlights";
import { TabHeader } from "@/components/dashboard/tab-header";
import { movement, pickHighlights } from "@/lib/overview/highlights";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { getSession } from "@/lib/analytics/client-context";
import { fmtInt, fmtPercent, toNum } from "@/lib/analytics/format";
import { resolveRange } from "@/lib/analytics/range";
import { resourceOptions, resourceScope } from "@/lib/analytics/resource-scope";
import { dailySeries, type TrendData } from "@/lib/analytics/trend";
import { first, type SearchParams } from "@/lib/analytics/url";
import { ExternalLink, MapPin } from "lucide-react";
import { shiftDays } from "@/lib/analytics/range";
import { LbmSections } from "./lbm-sections";
import { ViewsByWhere } from "./views-by-where";

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
        <TabHeader source="gbp" title={title} description="How customers find you on Search and Maps, and what they do." />
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
    // always with the previous period: the actions chart compares against it; the other charts only when asked
    supabase.rpc("get_analytics_trends", { ...args, p_provider: "gbp", p_granularity: "day", p_compare: true }),
    supabase.rpc("get_gbp_locations", args),
    supabase.from("integration_connections").select("last_synced_at, last_error, status").eq("client_id", client.id).in("provider", ["gbp", "lbm"])
      .eq("status", "connected").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);

  const lastSync = conn.data?.last_synced_at ? new Date(conn.data.last_synced_at).toLocaleString() : "never";
  const header = (
    <TabHeader source="gbp" title={title}
      description={`How customers find you on Search and Maps, and what they do. Location: ${scope.label(scope.gbp, scope.gbpPick)} · last synced ${lastSync}`}
      guide={[
          { term: "Profile views", text: "Times your Business Profile was shown on Google Search or Maps (unique viewers per day)." },
          { term: "Search vs Maps", text: "Whether people found you by searching Google, or by browsing the map." },
          { term: "Website clicks, calls, directions", text: "Customer actions taken from your profile. A call click is a tap on the button, not a completed call." },
          { term: "Search terms", text: "What people typed before seeing your profile. Google reports them monthly, and shows low counts only as a threshold." },
          { term: "Local rankings (grid)", text: "Your position on Google Maps at points around the business. Green = top 3, orange = 4-10, red = further down." },
          { term: "Delay", text: "Business Profile performance data arrives a few days late." },
        ]} />
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
  const tAll = trend.data as TrendData;
  // Google reports a few days late: charts stop at the last reported day instead of dropping to zero after it
  const lastDay = tAll.current.length ? tAll.current[tAll.current.length - 1].date : null;
  const shown = { start: range.start, end: lastDay && lastDay < range.end ? lastDay : range.end };
  const t: TrendData = compare ? tAll : { current: tAll.current, previous: [] };
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
  const mobileShare = (pick(cur, "impressions_mobile") ?? 0) / Math.max(1, impressions ?? 0);
  const hl = pickHighlights([
    movement("Profile views", pick(cur, "impressions"), pick(prev, "impressions"), { fmt: fmtInt, minBase: 100, actionWhenBad: "Check your categories, hours and recent photos, and keep posting updates.", action: "Keep your profile fresh with photos and posts to hold this." }),
    movement("Website clicks", pick(cur, "website_clicks"), pick(prev, "website_clicks"), { fmt: fmtInt, minBase: 10, actionWhenBad: "Make sure the website link and the call-to-action on your profile are current." }),
    movement("Call button clicks", pick(cur, "call_clicks"), pick(prev, "call_clicks"), { fmt: fmtInt, minBase: 5, actionWhenBad: "Check that the phone number is correct and that opening hours are accurate." }),
    movement("Direction requests", pick(cur, "direction_requests"), pick(prev, "direction_requests"), { fmt: fmtInt, minBase: 5 }),
    Boolean(impressions) && mobileShare >= 0.6 && { tone: "info" as const, title: `${Math.round(mobileShare * 100)}% of profile views are on phones`, detail: "Most of your local customers are on the move.", action: "Make sure the call button, hours and address are correct, and the website loads fast on mobile." },
  ]);
  // actions first (as the "Actions" card leads the row), then where the profile was seen
  const kpis: { label: string; k: string; hint?: string }[] = [
    { label: "Call button clicks", k: "call_clicks", hint: "Clicks on the call button. Not the same as completed calls." },
    { label: "Website clicks", k: "website_clicks" },
    { label: "Direction requests", k: "direction_requests" },
    { label: "Profile views", k: "impressions", hint: "Times the profile was shown on Google Search and Maps (unique viewers per day)." },
    { label: "Search views", k: "impressions_search" },
    { label: "Maps views", k: "impressions_maps" },
  ];
  const extras: { label: string; k: string; hint?: string }[] = [
    { label: "Bookings", k: "bookings" }, { label: "Messaging clicks", k: "messaging_clicks" }, { label: "Message conversations", k: "conversations" },
    { label: "Menu clicks", k: "food_menu_clicks" },
  ].filter((m) => pick(cur, m.k));
  const b = s.breakdown;
  const [web, calls, dirs] = ["website_clicks", "call_clicks", "direction_requests"].map((k) => dailySeries(t, k, shown));
  const actionDays = web.map((p, i) => ({ date: p.date, website_clicks: p.value ?? 0, call_clicks: calls[i]?.value ?? 0, direction_requests: dirs[i]?.value ?? 0 }));
  const dayCount = actionDays.length;
  // actions per day, current against previous, through the last day Google has reported
  const sumActions = (r: Record<string, unknown> | undefined) => r ? (toNum(r.website_clicks) ?? 0) + (toNum(r.call_clicks) ?? 0) + (toNum(r.direction_requests) ?? 0) : 0;
  const curBy = new Map(tAll.current.map((r) => [r.date, r])), prevBy = new Map(tAll.previous.map((r) => [r.date, r]));
  const actionsPerDay: TrendPoint[] = [];
  if (lastDay) for (let d = range.start; d <= lastDay && d <= range.end; d = shiftDays(d, 1)) {
    actionsPerDay.push({ date: d, value: sumActions(curBy.get(d)), previous: tAll.previous.length ? sumActions(prevBy.get(d)) : null });
  }
  const recentFrom = lastDay ? shiftDays(lastDay, -2) : null; // the latest three days
  const asOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const picked = s.locations.find((l) => l.id === scope.gbpPick?.id) ?? (s.locations.length === 1 ? s.locations[0] : null);

  return (
    <>
      {header}
      <RangeSelector path={PATH} sp={sp} range={range} />
      {filters}

      {(picked?.metadata?.address || lastDay) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[10px] border border-border bg-surface px-4 py-2.5 text-sm">
          {picked?.metadata?.address ? (
            <p className="flex min-w-0 items-center gap-2">
              <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{picked.metadata.address}</span>
              {picked.metadata.maps_uri?.startsWith("https://") && (
                <a href={picked.metadata.maps_uri} target="_blank" rel="noopener noreferrer" aria-label="Open on Google Maps" className="shrink-0 text-muted hover:text-foreground"><ExternalLink className="size-3.5" /></a>
              )}
              {picked.metadata.category && <span className="hidden shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary sm:inline">{picked.metadata.category}</span>}
            </p>
          ) : <span />}
          {lastDay && <p className="text-xs text-muted">Data through {asOf(lastDay)} · Google reports a few days late</p>}
        </div>
      )}

      <Highlights items={hl} />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Actions" source="GBP" format={fmtInt} hint="Website clicks, call button clicks and direction requests from the profile, added up."
          value={actions} previous={prev?.has_data ? (pick(prev, "call_clicks") ?? 0) + (pick(prev, "website_clicks") ?? 0) + (pick(prev, "direction_requests") ?? 0) : null} />
        {[...kpis, ...extras].map((m) => (
          <KpiCard key={m.k} label={m.label} hint={m.hint} source="GBP" format={fmtInt}
            value={pick(cur, m.k)} previous={pick(prev, m.k)} mom={pick(mom, m.k)} yoy={pick(yoy, m.k)} />
        ))}
      </section>
      <p className="mt-2 text-xs text-muted">
        Actions (website + call + directions): {fmtInt(actions)}
        {impressions ? ` · ${fmtPercent(actions / impressions, 2)} of profile views` : ""}
      </p>

      <div className="mt-6">
        <TrendChart title="Actions per day" source="GBP" seriesLabel="Actions" variant="line" color="var(--foreground)" data={actionsPerDay}
          marker={recentFrom ? { from: recentFrom, label: "Latest days, may still change" } : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MetricTrend title="Visibility" source="GBP" options={[
          { key: "impressions", label: "All views", data: dailySeries(t, "impressions", shown) },
          { key: "impressions_search", label: "Search", data: dailySeries(t, "impressions_search", shown) },
          { key: "impressions_maps", label: "Maps", data: dailySeries(t, "impressions_maps", shown) },
        ]} />
        <MetricTrend title="Customer actions" source="GBP" options={[
          { key: "website_clicks", label: "Website", data: dailySeries(t, "website_clicks", shown) },
          { key: "call_clicks", label: "Calls", data: dailySeries(t, "call_clicks", shown) },
          { key: "direction_requests", label: "Directions", data: dailySeries(t, "direction_requests", shown) },
        ]} />
      </div>

      <div className="mt-4">
        <StackedTimeBars title="Customer actions over time" valueLabel="Actions"
          bucket={dayCount > 45 ? "week" : "day"} keys={[{ key: "website_clicks", label: "Website" }, { key: "call_clicks", label: "Calls" }, { key: "direction_requests", label: "Directions" }]}
          data={actionDays} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ViewsByWhere split={{ mobile_maps: toNum(b?.mobile_maps) ?? 0, desktop_maps: toNum(b?.desktop_maps) ?? 0, mobile_search: toNum(b?.mobile_search) ?? 0, desktop_search: toNum(b?.desktop_search) ?? 0 }} />
        <ShareDonut title="What people did next" centerLabel="actions" keepOrder
          items={[{ label: "Website", value: pick(cur, "website_clicks") ?? 0 }, { label: "Calls", value: pick(cur, "call_clicks") ?? 0 }, { label: "Directions", value: pick(cur, "direction_requests") ?? 0 }]} />
      </div>

      {/* search terms beside the business card (both short lists); either one alone takes the full width */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
        <section className="rounded-[10px] border border-border bg-surface p-4" aria-label="Search keywords">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Searches that showed the profile</h2>
            <span className="text-xs text-muted" title="Reported per calendar month; every month overlapping the range is included. Google shows low counts only as a threshold.">Monthly · impressions</span>
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
        </section>
        {picked && (
          <section className="rounded-[10px] border border-border bg-surface p-4 text-sm" aria-label="Business information">
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
              <a href={picked.metadata.maps_uri} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Open on Google Maps →</a>
            )}
          </section>
        )}
      </div>

      {locs.length > 1 && (
        <section className="mt-6 overflow-x-auto rounded-[10px] border border-border bg-surface" aria-label="Location comparison">
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

      {more}
      <AiScreenTools screen="business-profile" />
    </>
  );
}
