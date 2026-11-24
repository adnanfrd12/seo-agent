import "server-only";
import { after } from "next/server";
import { getSession } from "@/lib/analytics/client-context";
import { resolveRange } from "@/lib/analytics/range";
import { first, type SearchParams } from "@/lib/analytics/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientNap } from "@/lib/reviews/listings";
import { addDays, G, type Period } from "./g";
import type { InventoryRow, SitemapInfo } from "./inventory";
import { pathOf, type GscSettings } from "./model";
import { gscQuickWins, type GscWin } from "./quickwins";
import { gscxTarget, isStale, loadCubes, loadOne, syncGscx, syncInventory, type GCube, type GscMeta, type InspState } from "./sync";

const ALL: GCube[] = ["totals", "q", "qp", "pg", "pd", "cd", "dev", "app", "hour", "qm"];
export const TYPES = [["web", "Web"], ["image", "Image"], ["video", "Video"], ["news", "News"], ["discover", "Discover"], ["googleNews", "Google News"]] as const;

export type GscView =
  | { state: "no_gsc"; clientName: string }
  | { state: "not_connected"; clientName: string; property: string | null }
  | { state: "error"; clientName: string; message: string }
  | { state: "ok"; clientName: string; clientId: string; g: G; wins: GscWin[]; period: Period; settingsSource: Record<keyof GscSettings, string>; ctx: NonNullable<Awaited<ReturnType<typeof gscxTarget>>>["ctx"] };

/** Default settings from what the portal already knows about the business; anything saved on the Brand / Local screens wins. */
async function settingsFor(admin: ReturnType<typeof createAdminClient>, clientId: string, inv: InventoryRow[], qRows: (string | number)[][]): Promise<{ s: GscSettings; src: Record<keyof GscSettings, string> }> {
  const [{ data: c }, nap, { data: gbp }] = await Promise.all([
    admin.from("clients").select("name, settings").eq("id", clientId).maybeSingle(),
    clientNap(admin, clientId).catch(() => null),
    admin.from("integration_resources").select("metadata").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle(),
  ]);
  const st = ((c?.settings ?? {}) as Record<string, unknown>);
  const saved = (st.gsc_settings ?? {}) as Partial<GscSettings>;
  const host = inv[0] ? new URL(inv[0].url).hostname.replace(/^www\./, "") : "";
  const label = host.split(".")[0];
  const name = nap?.name ?? "";
  const brand = saved.brand?.length ? saved.brand : [...new Set([name, name.replace(/\band\b/gi, "&"), name.replace(/&/g, "and"), label, name.replace(/\s+/g, "")].map((x) => x.trim().toLowerCase()).filter((x) => x.length > 2))];
  const places = ((((gbp?.metadata as Record<string, unknown> | null)?.lbm_location as Record<string, unknown> | undefined)?.service_area as { places?: { place_infos?: { name?: string }[] } } | undefined)?.places?.place_infos ?? [])
    .map((p) => String(p.name ?? "").split(",")[0].trim()).filter(Boolean);
  const ga4Area = Array.isArray(st.ga4_service_area) ? (st.ga4_service_area as string[]) : [];
  const cities = saved.cities?.length ? saved.cities : [...new Set([nap?.city, ...places, ...ga4Area].filter(Boolean).map((x) => String(x).toLowerCase()))];
  // services: two-word phrases people search (non-brand) that also name a page on the site, e.g. "channel letters" ↔ /houston-channel-letters
  const cityWords = new Set(cities.flatMap((x) => x.split(/\s+/)));
  const STOPW = /^(the|and|for|in|of|near|me|to|a|an|my|best|custom|cheap|top|how|what|why|is|are|can|do|does|with|on|at|by|tx|texas|usa|company|companies|services?|shop|store|business|led|lights)$/;
  const brandWords = new Set(brand.flatMap((b) => b.split(/\s+/)));
  const counts = new Map<string, number>();
  for (const r of qRows) {
    const ws = String(r[1]).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i < ws.length - 1; i++) {
      const a2 = ws[i], b2 = ws[i + 1];
      if (STOPW.test(a2) || STOPW.test(b2) || cityWords.has(a2) || cityWords.has(b2) || brandWords.has(a2) && brandWords.has(b2)) continue;
      counts.set(`${a2} ${b2}`, (counts.get(`${a2} ${b2}`) ?? 0) + Number(r[3]));
    }
  }
  const slugs = inv.map((r) => pathOf(r.url).toLowerCase());
  const ranked = [...counts].sort((a3, b3) => b3[1] - a3[1]).map(([k]) => k);
  const onSite = ranked.filter((k) => slugs.some((sl) => sl.includes(k.replace(/ /g, "-"))));
  const services = saved.services?.length ? saved.services : [...new Set([...onSite.slice(0, 20), ...ranked.slice(0, Math.max(0, 8 - onSite.length))])];
  const competitors = saved.competitors ?? [];
  return {
    s: { brand, cities, services, competitors },
    src: {
      brand: saved.brand?.length ? "Saved" : "From the business name and domain", cities: saved.cities?.length ? "Saved" : "Business city, Business Profile service area and the GA4 service area",
      services: saved.services?.length ? "Saved" : "Phrases people search that match a page on the site", competitors: saved.competitors?.length ? "Saved" : "Not set",
    },
  };
}

export async function gscPage(sp: SearchParams): Promise<GscView | null> {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const t = await gscxTarget(admin, client.id, first(sp.site));
  if (!t) return { state: "no_gsc", clientName: client.name };
  if (!t.ctx) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
  let meta = await loadOne<GscMeta>(admin, client.id, t.resource.id, "meta");
  if (!meta) {
    try { meta = await syncGscx(admin, client.id, t.resource.id, { inventory: false }); }
    catch (e) { return { state: "error", clientName: client.name, message: e instanceof Error ? e.message : "Search Console couldn't be read." }; }
    if (!meta) return { state: "not_connected", clientName: client.name, property: t.resource.display_name };
    const id = client.id, rid = t.resource.id, ctx = t.ctx;
    after(() => loadCubes(createAdminClient(), id, rid, ["pg"]).then((c) => syncInventory(createAdminClient(), id, rid, ctx, c.pg.rows)).then(() => undefined, () => undefined));
  } else if (isStale(meta)) {
    const id = client.id, rid = t.resource.id;
    after(() => syncGscx(createAdminClient(), id, rid).then(() => undefined, () => undefined));
  }
  // Search Console's default is the last 28 days; the dashboard's range picker (7 / 30 / 90 / custom) also applies
  const r = resolveRange({ range: first(sp.range), start: first(sp.start), end: first(sp.end) }, "America/Los_Angeles", client.defaultRangeDays);
  const end = r.end > meta.end ? meta.end : r.end;
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(r.start)) / 86_400_000) + 1);
  const start = r.preset === "custom" ? r.start : addDays(end, -(days - 1));
  const period: Period = { start, end, days, pstart: addDays(start, -days), pend: addDays(start, -1) };
  const [cubes, inv, insp, sitemaps] = await Promise.all([
    loadCubes(admin, client.id, t.resource.id, ALL), loadOne<InventoryRow[]>(admin, client.id, t.resource.id, "inventory"),
    loadOne<InspState>(admin, client.id, t.resource.id, "insp"), loadOne<SitemapInfo[]>(admin, client.id, t.resource.id, "sitemaps"),
  ]);
  const { s, src } = await settingsFor(admin, client.id, inv ?? [], cubes.q.rows);
  const type = TYPES.some(([k]) => k === first(sp.type)) ? String(first(sp.type)) : "web";
  const g = new G(meta, cubes, period, s, inv, insp, sitemaps ?? [], type);
  // quick wins always use the last 28 days vs the 28 before
  const p28: Period = { start: addDays(meta.end, -27), end: meta.end, days: 28, pstart: addDays(meta.end, -55), pend: addDays(meta.end, -28) };
  const wins = gscQuickWins(new G(meta, cubes, p28, s, inv, insp, sitemaps ?? []));
  return { state: "ok", clientName: client.name, clientId: client.id, g, wins, period, settingsSource: src, ctx: t.ctx };
}

/**
 * Session-free: the last 28 days of Search Console for one client (from the synced cubes) and its rule-based quick
 * wins. Used by the AI quick wins engine and the nightly run. Returns null when Search Console isn't connected.
 */
export async function gscWinsFor(admin: ReturnType<typeof createAdminClient>, clientId: string) {
  const t = await gscxTarget(admin, clientId, null);
  if (!t?.ctx) return null;
  let meta = await loadOne<GscMeta>(admin, clientId, t.resource.id, "meta");
  if (!meta || isStale(meta)) meta = (await syncGscx(admin, clientId, t.resource.id, { inventory: false }).catch(() => null)) ?? meta;
  if (!meta) return null;
  const [cubes, inv, insp, sitemaps] = await Promise.all([
    loadCubes(admin, clientId, t.resource.id, ALL), loadOne<InventoryRow[]>(admin, clientId, t.resource.id, "inventory"),
    loadOne<InspState>(admin, clientId, t.resource.id, "insp"), loadOne<SitemapInfo[]>(admin, clientId, t.resource.id, "sitemaps"),
  ]);
  const { s } = await settingsFor(admin, clientId, inv ?? [], cubes.q.rows);
  const p28: Period = { start: addDays(meta.end, -27), end: meta.end, days: 28, pstart: addDays(meta.end, -55), pend: addDays(meta.end, -28) };
  const g = new G(meta, cubes, p28, s, inv, insp, sitemaps ?? []);
  return { g, wins: gscQuickWins(g), inv: inv ?? [], site: t.resource.external_id, meta };
}
