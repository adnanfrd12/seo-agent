import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * City coordinates for the bubble maps. GA4 reports city names only, so each city is looked up once with
 * OpenStreetMap's geocoder (Nominatim: at most one request a second, results kept) and stored per client
 * in dfs_cache (endpoint "ga4x", key "geo"). Pages only read the stored coordinates.
 */
export type Coords = Record<string, [number, number] | null>;
export const cityKey = (city: string, region: string, country: string) => `${city}|${region}|${country}`;

export async function loadGeo(admin: SupabaseClient, clientId: string): Promise<Coords> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "ga4x").eq("params_hash", "geo").maybeSingle();
  return (data?.data as Coords | undefined) ?? {};
}

export async function geocodeCities(admin: SupabaseClient, clientId: string, cities: { city: string; region: string; country: string }[], max = 30): Promise<Coords> {
  const known = await loadGeo(admin, clientId);
  const todo = cities.filter((c) => c.city && c.city !== "(not set)" && !(cityKey(c.city, c.region, c.country) in known)).slice(0, max);
  for (const c of todo) {
    const q = new URLSearchParams({ city: c.city, ...(c.region && c.region !== "(not set)" ? { state: c.region } : {}), country: c.country, format: "json", limit: "1" });
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { "user-agent": "SEO-Insights-dashboard/1.0 (analytics maps)", accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      const j = r.ok ? ((await r.json()) as { lat?: string; lon?: string }[]) : [];
      known[cityKey(c.city, c.region, c.country)] = j[0]?.lat ? [Number(j[0].lat), Number(j[0].lon)] : null;
    } catch { /* try again on the next sync */ }
    await new Promise((res) => setTimeout(res, 1100));
  }
  if (todo.length) {
    await admin.from("dfs_cache").upsert(
      { client_id: clientId, endpoint: "ga4x", params_hash: "geo", params: { source: "nominatim" }, data: known, row_count: Object.keys(known).length, cost: 0, fetched_at: new Date().toISOString() },
      { onConflict: "client_id,endpoint,params_hash" },
    );
  }
  return known;
}
