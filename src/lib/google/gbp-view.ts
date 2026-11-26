import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read side of the Business Profile page: ONE source per location. A location can be tracked through the direct
 * Google API (resource accounts/{a}/locations/{l}, metadata.source "google") and through Local Brand Manager
 * (locations/{l}). The Google resource wins once it has data from the last 45 days (same rule as
 * _selected_resources in migration 20261128000033), otherwise LBM keeps serving the location.
 */
export type GbpResource = {
  id: string; external_id: string; display_name: string | null; metadata: Record<string, unknown>;
  source: "google" | "lbm"; locationId: string;
};

export const locationIdOf = (externalId: string) => externalId.replace(/^.*locations\//, "");

export async function effectiveResources(supabase: SupabaseClient, clientId: string) {
  const { data } = await supabase.from("integration_resources").select("id, external_id, display_name, metadata")
    .eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).order("display_name");
  const all: GbpResource[] = (data ?? []).map((r) => {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    return { ...r, metadata, source: metadata.source === "google" ? "google" : "lbm", locationId: locationIdOf(r.external_id) } as GbpResource;
  });
  const google = all.filter((r) => r.source === "google");
  const fresh = new Set<string>();
  if (google.length) {
    const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    for (const g of google) {
      const { data: hit } = await supabase.from("gbp_daily_metrics").select("resource_id").eq("resource_id", g.id).gte("metric_date", since).limit(1);
      if (hit?.length) fresh.add(g.id);
    }
  }
  /** LBM resource id -> the Google resource that replaces it */
  const shadowedBy = new Map<string, string>();
  for (const r of all) {
    if (r.source !== "lbm") continue;
    const twin = google.find((g) => g.locationId === r.locationId && fresh.has(g.id));
    if (twin) shadowedBy.set(r.id, twin.id);
  }
  const effective = all.filter((r) => !shadowedBy.has(r.id));
  return { all, effective, shadowedBy, googleFresh: fresh };
}

/** All rows of a query, 1000 at a time (PostgREST caps a response at 1000 rows). */
export async function allRows<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export const DAILY_COLS = [
  "impressions_desktop_maps", "impressions_desktop_search", "impressions_mobile_maps", "impressions_mobile_search",
  "website_clicks", "call_clicks", "direction_requests", "conversations", "messaging_clicks", "bookings", "food_orders", "food_menu_clicks",
] as const;
export type DailyCol = (typeof DAILY_COLS)[number];
export type DayTotals = Partial<Record<DailyCol, number>>;

/** date -> summed metrics over the given resources. A metric no row reported stays absent. */
export async function loadDaily(supabase: SupabaseClient, ids: string[], start: string, end: string): Promise<Map<string, DayTotals>> {
  const by = new Map<string, DayTotals>();
  if (!ids.length) return by;
  const cols: string = `metric_date, ${DAILY_COLS.join(", ")}`;
  const rows = await allRows<Record<string, unknown>>((a, b) => supabase.from("gbp_daily_metrics").select(cols)
    .in("resource_id", ids).gte("metric_date", start).lte("metric_date", end).order("metric_date").range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>);
  for (const r of rows) {
    const d = String(r.metric_date);
    const t = by.get(d) ?? {};
    for (const c of DAILY_COLS) if (r[c] != null) t[c] = (t[c] ?? 0) + Number(r[c]);
    by.set(d, t);
  }
  return by;
}

/** Derived per-day measures used by the charts. */
export function derived(t: DayTotals | undefined) {
  const v = (k: DailyCol) => t?.[k] ?? 0;
  const maps = v("impressions_desktop_maps") + v("impressions_mobile_maps");
  const search = v("impressions_desktop_search") + v("impressions_mobile_search");
  return {
    impressions: maps + search, impressions_maps: maps, impressions_search: search,
    impressions_desktop: v("impressions_desktop_maps") + v("impressions_desktop_search"),
    impressions_mobile: v("impressions_mobile_maps") + v("impressions_mobile_search"),
  };
}

/* ------------------------------------------------------------------ keywords */
export type KeywordMonth = { month: string; impressions: number | null; threshold: number | null };
export type KeywordTrend = {
  keyword: string; current: KeywordMonth | null; previous: KeywordMonth | null; inPrevious: boolean; months: KeywordMonth[];
};

/** Rank value of a month: the exact count, else the threshold ("< N") as an upper bound. */
export const kwValue = (m: KeywordMonth | null | undefined) => (m ? m.impressions ?? m.threshold ?? 0 : 0);

export function keywordTrends(rows: { month: string; keyword: string; impressions: number | null; impressions_threshold: number | null }[]) {
  const months = [...new Set(rows.map((r) => r.month.slice(0, 10)))].sort();
  const latest = months[months.length - 1] ?? null;
  const prev = months.length > 1 ? months[months.length - 2] : null;
  const by = new Map<string, Map<string, KeywordMonth>>();
  for (const r of rows) {
    const m = r.month.slice(0, 10);
    const k = r.keyword.trim().toLowerCase();
    const map = by.get(k) ?? new Map<string, KeywordMonth>();
    const cur = map.get(m);
    // several locations: add the exact counts; a threshold-only value stays a threshold
    const imp = r.impressions == null && cur?.impressions == null ? null : (cur?.impressions ?? 0) + (r.impressions ?? 0);
    map.set(m, { month: m, impressions: imp, threshold: imp == null ? Math.max(cur?.threshold ?? 0, r.impressions_threshold ?? 0) || null : null });
    by.set(k, map);
  }
  const list: KeywordTrend[] = [...by].map(([keyword, map]) => ({
    keyword,
    current: latest ? map.get(latest) ?? null : null,
    previous: prev ? map.get(prev) ?? null : null,
    inPrevious: prev ? map.has(prev) : false,
    months: months.map((m) => map.get(m) ?? { month: m, impressions: null, threshold: null }),
  }));
  list.sort((a, b) => kwValue(b.current) - kwValue(a.current) || kwValue(b.previous) - kwValue(a.previous) || a.keyword.localeCompare(b.keyword));
  return { months, latest, previous: prev, list };
}

/* ------------------------------------------------------------------ business information */
export type BizInfo = {
  source: "Google API" | "Local Brand Manager" | "Profile"; name: string | null; primaryCategory: string | null; additionalCategories: string[];
  phone: string | null; website: string | null; address: string | null; description: string | null; serviceArea: string[]; labels: string[];
  status: string | null; storeCode: string | null; mapsUri: string | null; hours: { day: string; open: string; close: string }[];
  completeness: { score: number; missing: string[] } | null; updatedAt: string | null;
};

const hhmm = (t: { hours?: number; minutes?: number } | undefined) => `${String(t?.hours ?? 0).padStart(2, "0")}:${String(t?.minutes ?? 0).padStart(2, "0")}`;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Business information from the Google record when synced, else Local Brand Manager's, else the basic fields. */
export function bizInfo(r: GbpResource): BizInfo {
  const md = r.metadata;
  const g = md.google_location as Record<string, unknown> | undefined;
  if (g) {
    const cats = (g.categories ?? {}) as { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
    const hours = ((g.regularHours as { periods?: { openDay?: string; openTime?: { hours?: number; minutes?: number }; closeTime?: { hours?: number; minutes?: number } }[] } | undefined)?.periods ?? [])
      .map((p) => ({ day: p.openDay ?? "", open: hhmm(p.openTime), close: hhmm(p.closeTime) === "00:00" ? "24:00" : hhmm(p.closeTime) }));
    const sa = (g.serviceArea ?? {}) as { places?: { placeInfos?: { placeName?: string }[] } };
    return {
      source: "Google API", name: str(g.title) ?? r.display_name, primaryCategory: cats.primaryCategory?.displayName ?? null,
      additionalCategories: (cats.additionalCategories ?? []).map((c) => c.displayName ?? "").filter(Boolean),
      phone: str(md.phone), website: str(md.website), address: str(md.address),
      description: str((g.profile as { description?: string } | undefined)?.description),
      serviceArea: (sa.places?.placeInfos ?? []).map((p) => p.placeName ?? "").filter(Boolean),
      labels: Array.isArray(g.labels) ? (g.labels as string[]) : [], status: str(md.open_status), storeCode: str(g.storeCode),
      mapsUri: str(md.maps_uri), hours, completeness: (md.completeness as BizInfo["completeness"]) ?? null, updatedAt: str(md.google_location_at),
    };
  }
  const l = md.lbm_location as Record<string, unknown> | undefined;
  const lhours = ((l?.regular_hours as { periods?: { open_day: string; open_time: string; close_time: string }[] } | undefined)?.periods ?? [])
    .map((p) => ({ day: p.open_day, open: p.open_time, close: p.close_time }));
  const areas = ((l?.service_area as { places?: { place_infos?: { name: string }[] } } | undefined)?.places?.place_infos ?? []).map((p) => p.name);
  return {
    source: l ? "Local Brand Manager" : "Profile", name: r.display_name, primaryCategory: str(md.category),
    additionalCategories: Array.isArray(l?.additional_categories) ? (l!.additional_categories as string[]) : [],
    phone: str(md.phone), website: str(md.website), address: str(md.address), description: str(md.description) ?? str(l?.description),
    serviceArea: areas, labels: Array.isArray(l?.labels) ? (l!.labels as string[]) : [], status: str(md.open_status),
    storeCode: str(l?.store_code), mapsUri: str(md.maps_uri), hours: lhours, completeness: null, updatedAt: null,
  };
}
