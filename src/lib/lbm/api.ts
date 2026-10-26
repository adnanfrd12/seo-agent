import "server-only";

/**
 * Local Brand Manager REST API (https://developers.localbrandmanager.com, OpenAPI at /openapi.json).
 *   Base: https://api.localbrandmanager.com   Auth: `Authorization: Token <api token>`
 * Read-only endpoints used here:
 *   GET /locations                                   paginated (page, per <= 50)
 *   GET /gmb/locations/{gbp_id}/performance_metrics  daily GBP Performance metrics (recent ~25 days)
 *   GET /gmb/locations/{gbp_id}/search_impressions   monthly search keywords
 *   GET /gmb/reviews?by_location_id=                 paginated (page, per <= 100)
 *   GET /geogrids?by_location_id=                    paginated (page, per_page <= 100, Has-More header)
 *   GET /reports                                     agency report links
 */
const BASE = "https://api.localbrandmanager.com";

export class LbmError extends Error {
  constructor(message: string, public kind: "auth" | "not_found" | "rate_limit" | "other", public status = 0) { super(message); }
}

/** Env/stored tokens are trimmed: a stray space makes LBM answer 401. */
export const cleanToken = (t: string) => t.replace(/^Token\s+/i, "").trim();

async function call<T>(token: string, path: string): Promise<{ body: T; headers: Headers }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Token ${cleanToken(token)}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (res.ok) return { body: (await res.json()) as T, headers: res.headers };
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new LbmError("Local Brand Manager rejected the API token. Create a new one at app.localbrandmanager.com/api_tokens.", "auth", res.status);
    if (res.status === 404) throw new LbmError("Local Brand Manager has no data for this location.", "not_found", 404);
    if (res.status === 429) throw new LbmError("Local Brand Manager rate limit reached. The sync will retry.", "rate_limit", 429);
    throw new LbmError(`Local Brand Manager API error ${res.status}.`, "other", res.status);
  }
}

export type LbmLocation = {
  id: string; gbp_id: string | null; place_id: string | null; name: string; address: string | null; enabled: boolean; states: string[];
  city?: string | null; phone_number?: string | null; primary_category?: string | null; website_url?: string | null;
  gmb_url?: string | null; description?: string | null; lat?: number | null; lng?: number | null; store_code?: string | null;
};

export async function listLocations(token: string): Promise<LbmLocation[]> {
  const out: LbmLocation[] = [];
  for (let page = 1; page <= 40; page++) {
    const { body } = await call<LbmLocation[]>(token, `/locations?per=50&page=${page}`);
    out.push(...body);
    if (body.length < 50) break;
  }
  return out;
}

export const getLocation = async (token: string, id: string) => (await call<LbmLocation>(token, `/locations/${encodeURIComponent(id)}`)).body;

export type LbmDailyMetric = {
  timestamp: string;
  business_impressions_desktop_maps?: number | null; business_impressions_desktop_search?: number | null;
  business_impressions_mobile_maps?: number | null; business_impressions_mobile_search?: number | null;
  business_conversations?: number | null; business_direction_requests?: number | null;
  call_clicks?: number | null; website_clicks?: number | null;
};
export const performanceMetrics = async (token: string, gbpId: string) =>
  (await call<LbmDailyMetric[]>(token, `/gmb/locations/${encodeURIComponent(gbpId)}/performance_metrics`)).body;

export type LbmKeyword = { search_keyword: string; insights_value: number | null; less_threshold: boolean; month: string };
export const searchImpressions = async (token: string, gbpId: string) =>
  (await call<LbmKeyword[]>(token, `/gmb/locations/${encodeURIComponent(gbpId)}/search_impressions`)).body;

export type LbmReview = {
  remote_id: string; rating: number | null; text: string | null; reply: string | { comment?: string; update_time?: string } | null;
  reviewer?: { display_name?: string; profile_photo_url?: string }; created_at?: string; updated_at?: string;
};
export async function reviews(token: string, locationId: string): Promise<LbmReview[]> {
  const out: LbmReview[] = [];
  for (let page = 1; page <= 50; page++) {
    const { body, headers } = await call<LbmReview[]>(token, `/gmb/reviews?by_location_id=${encodeURIComponent(locationId)}&per=100&page=${page}`);
    out.push(...body);
    const pages = Number(headers.get("total-pages") ?? 0);
    if (body.length < 100 || (pages && page >= pages)) break;
  }
  return out;
}

export type LbmGeogrid = {
  id: string; state: string; search_term: string; created_at: string; finished_at: string | null;
  agr: number | null; atgr: number | null; solv: number | null; grid_size: number | null; grid_point_distance: number | null;
  grid_distance_measure: string | null; ranks: (number | string)[][] | null; image_url: string | null; public_url: string | null;
};
/** Newest first. The first import pages through every scan; later syncs pass `since`. */
export async function geogrids(token: string, locationId: string, since?: string, maxPages = 200): Promise<LbmGeogrid[]> {
  const out: LbmGeogrid[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const q = `by_location_id=${encodeURIComponent(locationId)}&per_page=100&page=${page}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    const { body, headers } = await call<LbmGeogrid[]>(token, `/geogrids?${q}`);
    out.push(...body);
    if (headers.get("has-more") !== "true" || body.length === 0) break;
  }
  return out;
}

export type LbmReport = { id: string; created_at: string; locations: { name: string; address: string | null }[]; configuration_name: string; periods: string[]; report_url: string };
export const reportsList = async (token: string) => (await call<LbmReport[]>(token, "/reports")).body;

export type LbmGeogridConfig = {
  id: string; period: string | null; month_day: number | null; day_number: number | null; hour: number | null; time_zone: string | null;
  scheduled_at: string | null; processed_at: string | null; last_geogrid_created_at: string | null; note: string | null;
  search_terms: { id: string; active: boolean; text: string; geogrids_count: number | null; processed_at: string | null; gif_url: string | null }[];
};
export async function geogridConfigs(token: string, locationId: string): Promise<LbmGeogridConfig[]> {
  const out: LbmGeogridConfig[] = [];
  for (let page = 1; page <= 20; page++) {
    const { body, headers } = await call<LbmGeogridConfig[]>(token, `/geogrid_configs?by_location_id=${encodeURIComponent(locationId)}&page=${page}`);
    out.push(...body);
    const pages = Number(headers.get("total-pages") ?? 0);
    if (!pages || page >= pages) break;
  }
  return out;
}

/** Legacy (v4) Insights history; Google retired it, so most values are null. Only non-empty rows are kept. */
export async function legacyInsights(token: string, gbpId: string): Promise<Record<string, unknown>[]> {
  const { body } = await call<Record<string, unknown>[]>(token, `/gmb/locations/${encodeURIComponent(gbpId)}/insights`);
  return body.filter((r) => Object.entries(r).some(([k, v]) => k !== "timestamp" && v != null));
}
