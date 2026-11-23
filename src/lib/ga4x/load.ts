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
import { ga4xTarget, isStale, loadCubes, loadMeta, rangeUsers, syncGa4x } from "./sync";
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
export async function ga4xPage(sp: SearchParams, opts: { users?: boolean } = {}): Promise<Ga4xView | null> {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const t = await ga4xTarget(admin, client.id, first(sp.property));
  if (!t) return { state: "no_ga4", clientName: client.name };
  if (!t.ctx) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
  let meta = await loadMeta(admin, client.id, t.resource.id);
  if (!meta) {
    try { meta = await syncGa4x(admin, client.id, t.resource.id); }
    catch (e) { return { state: "error", clientName: client.name, message: e instanceof Error ? e.message : "GA4 couldn't be read." }; }
    if (!meta) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
  } else if (isStale(meta)) {
    const id = client.id, rid = t.resource.id;
    after(() => syncGa4x(createAdminClient(), id, rid).then(() => undefined, () => undefined));
  }
  const r = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, client.timezone, client.defaultRangeDays);
  const end = r.end > meta.end ? meta.end : r.end;
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(r.start)) / 86_400_000) + 1);
  const period: Period = { start: r.start, end, days, pstart: addDays(r.start, -days), pend: addDays(r.start, -1) };

  const [cubes, settings, nap] = await Promise.all([
    loadCubes(admin, client.id, t.resource.id, ALL),
    admin.from("clients").select("settings").eq("id", client.id).maybeSingle().then((x) => ((x.data?.settings ?? {}) as Record<string, unknown>)),
    clientNap(admin, client.id).catch(() => null),
  ]);
  const overrides = (settings.ga4_lead_map ?? {}) as Record<string, string>;
  // service area: the cities saved on Lead setup, else the business city and its Business Profile service area, else its state
  let area = Array.isArray(settings.ga4_service_area) ? (settings.ga4_service_area as string[]) : [];
  let areaSource = "Saved on Lead setup";
  if (!area.length) {
    const { data: gbp } = await admin.from("integration_resources").select("metadata").eq("client_id", client.id).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle();
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
  const qualified = first(sp.leads) !== "all";
  const users = opts.users ? await rangeUsers(admin, client.id, t.ctx, t.resource.id, period).catch(() => null) : null;
  const g = new G(meta, cubes, period, { overrides, qualified, serviceArea: area, users });
  // quick wins always use the last 30 days of qualified leads
  const p30: Period = { start: addDays(meta.end, -29), end: meta.end, days: 30, pstart: addDays(meta.end, -59), pend: addDays(meta.end, -30) };
  const wins = quickWins(new G(meta, cubes, p30, { overrides, qualified: true, serviceArea: area, users: null }));
  return { state: "ok", clientName: client.name, clientId: client.id, g, wins, period, qualified, preset: r.preset, areaSource, propertyChoices: t.choices.map((c) => ({ id: c.id, name: c.display_name ?? c.external_id })), ctx: t.ctx };
}
