import "server-only";
import { after } from "next/server";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientNap } from "@/lib/reviews/listings";
import { G } from "./g";
import { quickWins, type QuickWin } from "./quickwins";
import { addDays, STATES, type Period } from "./model";
import { ga4xTarget, isStale, rangeUsers, readGa4x, syncGa4x } from "./sync";
import { memo } from "@/lib/memo";
import type { CubeName } from "./types";

const ALL: CubeName[] = ["daily", "events", "links", "sessions", "leads", "leads2", "leads3", "hours", "geo", "res", "sessions2", "pages", "pageEvents", "search", "ads", "items", "ecom", "coupons", "refunds"];

export type Ga4xView =
  | { state: "no_ga4"; clientName: string }
  | { state: "not_connected"; clientName: string; property: string | null }
  | { state: "error"; clientName: string; message: string }
  | { state: "ok"; clientName: string; clientId: string; g: G; wins: QuickWin[]; period: Period; qualified: boolean; preset: string; areaSource: string; propertyChoices: { id: string; name: string }[]; ctx: NonNullable<Awaited<ReturnType<typeof ga4xTarget>>>["ctx"] };

/**
 * Data for one GA4 leads screen: the selected client's synced cubes for the date range in the URL.
 * The first visit syncs right away (about half a minute); after that a copy older than 20 hours is
 * refreshed in the background while the stored one is shown.
 */
type Sources = { settings: Record<string, unknown>; nap: Awaited<ReturnType<typeof clientNap>> | null; gbp: { metadata: unknown } | null };

/** Client settings, business address and Business Profile area: read in parallel with the cubes. */
async function sourcesFor(admin: ReturnType<typeof createAdminClient>, clientId: string): Promise<Sources> {
  const [settings, nap, { data: gbp }] = await Promise.all([
    admin.from("clients").select("settings").eq("id", clientId).maybeSingle().then((x) => ((x.data?.settings ?? {}) as Record<string, unknown>)),
    clientNap(admin, clientId).catch(() => null),
    admin.from("integration_resources").select("metadata").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle(),
  ]);
  return { settings, nap, gbp };
}

type Read = Awaited<ReturnType<typeof readGa4x<CubeName>>>;
/** The last 30 days of qualified leads (what the quick wins use). */
const g30Of = (read: Read, meta: NonNullable<Read["meta"]>, overrides: Record<string, string>, area: string[]) => {
  const p30: Period = { start: addDays(meta.end, -29), end: meta.end, days: 30, pstart: addDays(meta.end, -59), pend: addDays(meta.end, -30) };
  return new G(meta, read.cubes, p30, { overrides, qualified: true, serviceArea: area, users: null });
};
/** Rule-based quick wins depend only on the synced rows and the settings: the list is reused until either changes. */
const winsFor = (clientId: string, rid: string, read: Read, meta: NonNullable<Read["meta"]>, overrides: Record<string, string>, area: string[], g30?: G) =>
  memo(`ga4-wins|${clientId}|${rid}|${read.version}|${JSON.stringify([overrides, area])}`, 30 * 60_000, async () => quickWins(g30 ?? g30Of(read, meta, overrides, area)));

export async function ga4xPage(sp: SearchParams, opts: { users?: boolean } = {}): Promise<Ga4xView | null> {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const t = await ga4xTarget(admin, client.id, first(sp.property));
  if (!t) return { state: "no_ga4", clientName: client.name };
  if (!t.ctx) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
  const rid = t.resource.id;
  // the synced rows (from memory when unchanged) and the settings sources, in parallel
  const [first0, src] = await Promise.all([readGa4x(admin, client.id, rid, ALL), sourcesFor(admin, client.id)]);
  let read = first0;
  let meta = read.meta;
  if (!meta) {
    try { meta = await syncGa4x(admin, client.id, rid); }
    catch (e) { return { state: "error", clientName: client.name, message: e instanceof Error ? e.message : "GA4 couldn't be read." }; }
    if (!meta) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
    read = await readGa4x(admin, client.id, rid, ALL);
  } else if (isStale(meta)) {
    const id = client.id;
    after(() => syncGa4x(createAdminClient(), id, rid).then(() => undefined, () => undefined));
  }
  const r = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const end = r.end > meta.end ? meta.end : r.end;
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(r.start)) / 86_400_000) + 1);
  const period: Period = { start: r.start, end, days, pstart: addDays(r.start, -days), pend: addDays(r.start, -1) };

  const overrides = (src.settings.ga4_lead_map ?? {}) as Record<string, string>;
  const { area, areaSource } = serviceArea(src, read.cubes);
  const qualified = first(sp.leads) !== "all";
  const users = opts.users ? await rangeUsers(admin, client.id, t.ctx, rid, period).catch(() => null) : null;
  const g = new G(meta, read.cubes, period, { overrides, qualified, serviceArea: area, users });
  // quick wins always use the last 30 days of qualified leads
  const wins = await winsFor(client.id, rid, read, meta, overrides, area);
  return { state: "ok", clientName: client.name, clientId: client.id, g, wins, period, qualified, preset: r.preset, areaSource, propertyChoices: t.choices.map((c) => ({ id: c.id, name: c.display_name ?? c.external_id })), ctx: t.ctx };
}

/** The service area used for "local" leads: saved on Lead setup, else the business city, its Business Profile area and its state's cities. */
function serviceArea({ settings, nap, gbp }: Sources, cubes: Read["cubes"]) {
  // service area: the cities saved on Lead setup, else the business city and its Business Profile service area, else its state
  let area = Array.isArray(settings.ga4_service_area) ? (settings.ga4_service_area as string[]) : [];
  let areaSource = "Saved on Lead setup";
  if (!area.length) {
    const places = ((((gbp?.metadata as Record<string, unknown> | null)?.lbm_location as Record<string, unknown> | undefined)?.service_area as { places?: { place_infos?: { name?: string }[] } } | undefined)?.places?.place_infos ?? [])
      .map((p) => String(p.name ?? "").split(",")[0].trim()).filter(Boolean);
    area = [...new Set([nap?.city, ...places].filter(Boolean) as string[])];
    areaSource = places.length ? "Business city and its Google Business Profile service area" : nap?.city ? "Business city and the cities around it in the same state" : "Not set";
    if (nap?.state && STATES[nap.state]) {
      // a local business usually serves its state's nearby cities: every city in the business's state with sessions counts
      const state = STATES[nap.state];
      for (const row of cubes.geo.rows) if (row[2] === state && row[1] && row[1] !== "(not set)") area.push(String(row[1]));
      area = [...new Set(area)];
    }
  }
  return { area, areaSource };
}

/**
 * Session-free: the last 30 days of GA4 (qualified leads) for one client and its rule-based quick wins. Used by the
 * AI quick wins engine and the nightly run. Returns null when GA4 isn't connected.
 */
export async function ga4WinsFor(admin: ReturnType<typeof createAdminClient>, clientId: string) {
  const t = await ga4xTarget(admin, clientId, null);
  if (!t?.ctx) return null;
  const rid = t.resource.id;
  const [first0, src] = await Promise.all([readGa4x(admin, clientId, rid, ALL), sourcesFor(admin, clientId)]);
  let read = first0;
  let meta = read.meta;
  if (!meta || isStale(meta)) {
    const synced = await syncGa4x(admin, clientId, rid).catch(() => null);
    if (synced) { meta = synced; read = await readGa4x(admin, clientId, rid, ALL); }
  }
  if (!meta) return null;
  const overrides = (src.settings.ga4_lead_map ?? {}) as Record<string, string>;
  const { area } = serviceArea(src, read.cubes);
  const g30 = g30Of(read, meta, overrides, area);
  const wins = await winsFor(clientId, rid, read, meta, overrides, area, g30);
  return { g: g30, wins, meta };
}
