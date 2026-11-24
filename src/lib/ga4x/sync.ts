import "server-only";
import { cachedRows } from "@/lib/data-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn, shiftDays } from "@/lib/analytics/range";
import { and, batch, exact, ga, inList, not, or, regex, report, type Filter, type Ga4xCtx } from "./api";
import { crawlLeadActions } from "./crawl";
import { geocodeCities } from "./geo";
import { FALLBACKS } from "./model";
import type { Cell, Cube, CubeName, Ga4xMeta, RangeUsers } from "./types";

/**
 * Keeps a local copy of the GA4 reports the leads module shows, per client (dfs_cache, endpoint "ga4x",
 * one row per report "cube:<name>" plus "meta"). Each cube holds one row per day and dimension combination
 * for the last DAYS days, so every screen can work out any date range (and the period before it) without
 * calling Google. Users aren't additive across days: they are read per date range (rangeUsers) and cached.
 */
export const ENDPOINT = "ga4x";
export const DAYS = 190;
const STALE_MS = 20 * 3600_000;

/** The client's GA4 property to read: the picked one, else the one whose name or stream matches the client, else the first. */
export async function ga4xTarget(admin: SupabaseClient, clientId: string, resourceId?: string | null) {
  // the selected properties, the client's name and its GA4 connection, in parallel
  const [{ data }, { data: c }, { data: conns }] = await Promise.all([
    admin.from("integration_resources").select("id, external_id, display_name, timezone, connection_id, is_selected")
      .eq("client_id", clientId).eq("provider", "ga4").eq("is_selected", true).order("display_name"),
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    admin.from("integration_connections").select("id, status, composio_entity_id, composio_connected_account_id").eq("client_id", clientId).eq("provider", "ga4"),
  ]);
  const list = (data ?? []) as { id: string; external_id: string; display_name: string | null; timezone: string | null; connection_id: string | null }[];
  if (!list.length) return null;
  const want = String((c as { name?: string } | null)?.name ?? "").toLowerCase();
  const res = list.find((r) => r.id === resourceId)
    ?? list.find((r) => want && (r.display_name ?? "").toLowerCase().includes(want.split(" ")[0]))
    ?? list.find((r) => !/firebase|default account/i.test(r.display_name ?? "")) ?? list[0];
  let conn: unknown = (conns ?? []).find((x) => x.id === res.connection_id) ?? null;
  if (!conn && res.connection_id) conn = (await admin.from("integration_connections").select("status, composio_entity_id, composio_connected_account_id").eq("id", res.connection_id).maybeSingle()).data;
  const cn = conn as { status?: string; composio_entity_id?: string | null; composio_connected_account_id?: string | null } | null;
  if (!cn?.composio_connected_account_id || !cn.composio_entity_id) return { resource: res, ctx: null as Ga4xCtx | null, choices: list };
  return { resource: res, ctx: { userId: cn.composio_entity_id, connectedAccountId: cn.composio_connected_account_id, property: res.external_id } as Ga4xCtx, choices: list };
}

const key = (resourceId: string, name: string) => `${resourceId}:${name}`;

async function save(admin: SupabaseClient, clientId: string, hash: string, data: unknown, rows: number) {
  const { error } = await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: ENDPOINT, params_hash: hash, params: { module: "ga4x" }, data, row_count: rows, cost: 0, fetched_at: new Date().toISOString() },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  if (error) throw new Error(`save ${hash}: ${error.message}`);
}

export async function loadMeta(admin: SupabaseClient, clientId: string, resourceId: string) {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", ENDPOINT).eq("params_hash", key(resourceId, "meta")).maybeSingle();
  return (data?.data as Ga4xMeta | undefined) ?? null;
}
export async function loadCubes<N extends CubeName>(admin: SupabaseClient, clientId: string, resourceId: string, names: readonly N[]): Promise<Record<N, Cube>> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", ENDPOINT).in("params_hash", names.map((n) => key(resourceId, `cube:${n}`)));
  const out = {} as Record<N, Cube>;
  for (const n of names) out[n] = { cols: [], rows: [] };
  for (const r of data ?? []) out[String(r.params_hash).split(":cube:")[1] as N] = r.data as Cube;
  return out;
}
export const isStale = (m: Ga4xMeta | null) => !m || Date.now() - Date.parse(m.fetchedAt) > STALE_MS;

/**
 * Screen reads (read-only): meta and cubes in one go through the in-memory data cache, which re-downloads a row only
 * when a sync has rewritten it (lib/data-cache). `version` changes whenever any of the rows does. Sync code keeps
 * using loadMeta / loadCubes, which always read the database.
 */
export async function readGa4x<N extends CubeName>(admin: SupabaseClient, clientId: string, resourceId: string, names: readonly N[]) {
  const hashes = [key(resourceId, "meta"), ...names.map((n) => key(resourceId, `cube:${n}`))];
  const rows = await cachedRows(admin, clientId, ENDPOINT, hashes);
  const cubes = {} as Record<N, Cube>;
  for (const n of names) cubes[n] = (rows.get(key(resourceId, `cube:${n}`))?.data as Cube | undefined) ?? { cols: [], rows: [] };
  return { meta: (rows.get(key(resourceId, "meta"))?.data as Ga4xMeta | undefined) ?? null, cubes, version: hashes.map((h) => rows.get(h)?.fetchedAt ?? "-").join("|") };
}

/* events GA4 sends on every page: too many to keep per landing page and city, and never leads */
const BULK = ["page_view", "session_start", "first_visit", "user_engagement", "scroll"];

/** Reads every report for the property and stores it. A report that fails is recorded; the rest still run. */
export async function syncGa4x(admin: SupabaseClient, clientId: string, resourceId?: string | null): Promise<Ga4xMeta | null> {
  const t = await ga4xTarget(admin, clientId, resourceId);
  if (!t?.ctx) return null;
  const ctx = t.ctx;
  const P = ctx.property;
  const tz = t.resource.timezone || "UTC";
  const end = shiftDays(todayIn(tz), -1), start = shiftDays(end, -(DAYS - 1));
  const errors: Record<string, string> = {};
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^GOOGLE_ANALYTICS_[A-Z_]+:\s*/, "").slice(0, 300);
  const soft = async <T,>(name: string, f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { errors[name] = msg(e); return null; } };

  // property settings (Admin API)
  const prop = await soft("property", () => ga(ctx, "GOOGLE_ANALYTICS_GET_PROPERTY", { name: P }));
  const [ret, sig, bq, ads, ke, cd, streams] = await Promise.all([
    soft("retention", () => ga(ctx, "GOOGLE_ANALYTICS_GET_DATA_RETENTION_SETTINGS", { name: `${P}/dataRetentionSettings` })),
    soft("signals", () => ga(ctx, "GOOGLE_ANALYTICS_GET_GOOGLE_SIGNALS_SETTINGS", { name: `${P}/googleSignalsSettings` })),
    soft("bigquery", () => ga(ctx, "GOOGLE_ANALYTICS_LIST_BIGQUERY_LINKS", { parent: P })),
    soft("googleAds", () => ga(ctx, "GOOGLE_ANALYTICS_LIST_GOOGLE_ADS_LINKS", { parent: P })),
    soft("keyEvents", () => ga(ctx, "GOOGLE_ANALYTICS_LIST_KEY_EVENTS", { parent: P, pageSize: 200 })),
    soft("customDimensions", () => ga(ctx, "GOOGLE_ANALYTICS_LIST_CUSTOM_DIMENSIONS", { parent: P, pageSize: 200 })),
    soft("streams", () => ga(ctx, "GOOGLE_ANALYTICS_LIST_DATA_STREAMS", { parent: P })),
  ]);
  // Search Console linked inside GA4: its organicGoogleSearch* metrics only work when the link exists
  const gscLinked = await ga(ctx, "GOOGLE_ANALYTICS_RUN_REPORT", { property: P, dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }], dimensions: [{ name: "landingPage" }], metrics: [{ name: "organicGoogleSearchClicks" }], limit: 1 })
    .then(() => true, () => false);
  const keyEvents = ((ke?.keyEvents as { eventName?: string }[] | undefined) ?? []).map((k) => k.eventName ?? "").filter(Boolean);
  const web = ((streams?.dataStreams as { webStreamData?: { defaultUri?: string; measurementId?: string } }[] | undefined) ?? []).find((s) => s.webStreamData?.defaultUri);
  const stream = web?.webStreamData?.defaultUri ?? null;
  const hasAds = ads ? (((ads.googleAdsLinks as unknown[] | undefined) ?? []).length > 0) : null;

  const cubes: Partial<Record<CubeName, Cube>> = {};
  const run = async (name: CubeName, dimensions: string[], metrics: string[], filter?: Filter, maxRows?: number) => {
    const c = await soft(name, () => report(ctx, { start, end, dimensions, metrics, filter, maxRows }));
    cubes[name] = c ?? { cols: [...dimensions, ...metrics], rows: [], error: errors[name] };
  };
  const notBulk = not(inList("eventName", BULK));

  await Promise.all([
    run("daily", ["date"], ["activeUsers", "newUsers", "sessions", "engagedSessions", "userEngagementDuration", "screenPageViews"]),
    run("events", ["date", "eventName", "isKeyEvent"], ["eventCount"]),
    run("links", ["date", "eventName", "linkUrl", "linkDomain", "outbound", "fileName"], ["eventCount"], or(inList("eventName", ["click", "file_download"]), regex("eventName", "click|phone|call|tel|mail|direction|map|whatsapp|sms"))),
    // no location dimensions here: GA4 counts a visit once per city / country it was seen from, so those
    // breakdowns add up to more than the real total. Places have their own report ("geo").
    run("sessions", ["date", "sessionDefaultChannelGroup", "sessionSourceMedium", "landingPagePlusQueryString", "deviceCategory", "browser", "newVsReturning"],
      ["sessions", "engagedSessions", "userEngagementDuration", "screenPageViews", "keyEvents", "newUsers", "eventCount"]),
    run("geo", ["date", "city", "region", "country", "browser", "sessionDefaultChannelGroup", "sessionSourceMedium", "deviceCategory"], ["sessions", "engagedSessions", "screenPageViews", "userEngagementDuration"]),
  ]);
  await Promise.all([
    run("leads", ["date", "eventName", "sessionDefaultChannelGroup", "sessionSourceMedium", "landingPagePlusQueryString", "deviceCategory", "city", "country", "browser"], ["eventCount"], notBulk),
    run("leads2", ["dateHour", "eventName", "pagePath", "region", "operatingSystem", "newVsReturning", "sessionCampaignName", "country", "browser"], ["eventCount"], notBulk),
    run("leads3", ["date", "eventName", "language", "screenResolution", "country", "browser"], ["eventCount"], notBulk),
    run("hours", ["dateHour", "deviceCategory"], ["sessions", "engagedSessions"]),
    run("sessions2", ["date", "sessionCampaignName", "operatingSystem", "language"], ["sessions", "engagedSessions", "screenPageViews", "userEngagementDuration"]),
    run("res", ["date", "screenResolution"], ["sessions", "engagedSessions"]),
  ]);
  await Promise.all([
    run("pages", ["date", "pagePath", "pageTitle", "hostName"], ["screenPageViews", "userEngagementDuration", "eventCount", "keyEvents"]),
    run("pageEvents", ["date", "pagePath", "eventName"], ["eventCount"], inList("eventName", ["page_view", "scroll", "form_start", "form_submit", "view_search_results", "file_download", "click"])),
    run("search", ["date", "searchTerm"], ["eventCount"], exact("eventName", "view_search_results")),
  ]);

  // link clicks and thank-you pages that act as leads when the site has no named event for them
  const fallbacks: string[] = [];
  const linkRows = cubes.links?.rows ?? [];
  const pageRows = cubes.pages?.rows ?? [];
  for (const f of FALLBACKS) {
    const present = f.kind === "link"
      ? linkRows.some((r) => r[1] === "click" && new RegExp(f.pattern, "i").test(String(r[2])))
      : pageRows.some((r) => new RegExp(f.pattern, "i").test(String(r[1])));
    if (!present) continue;
    const filter = f.kind === "link" ? and(exact("eventName", "click"), regex("linkUrl", f.pattern)) : and(exact("eventName", "page_view"), regex("pagePath", f.pattern));
    // the filter's field counts toward GA4's 9-dimension limit, so these leave out browser (stored as "")
    const dimsOf = (c: Cube) => c.cols.slice(0, -1).filter((d) => d !== "browser");
    const widen = (c: Cube, r: Cell[]) => { const out = [...r]; out.splice(c.cols.indexOf("browser"), 0, ""); out[1] = f.name; return out; };
    const [a, b, c3] = await Promise.all([
      soft(`fallback ${f.name}`, () => report(ctx, { start, end, filter, dimensions: dimsOf(cubes.leads!), metrics: ["eventCount"] })),
      soft(`fallback ${f.name} (pages)`, () => report(ctx, { start, end, filter, dimensions: dimsOf(cubes.leads2!), metrics: ["eventCount"] })),
      soft(`fallback ${f.name} (language)`, () => report(ctx, { start, end, filter, dimensions: cubes.leads3!.cols.slice(0, -1), metrics: ["eventCount"] })),
    ]);
    if (!a?.rows.length) continue;
    fallbacks.push(f.name);
    for (const r of a.rows) cubes.leads!.rows.push(widen(cubes.leads!, r));
    for (const r of b?.rows ?? []) cubes.leads2!.rows.push(widen(cubes.leads2!, r));
    for (const r of c3?.rows ?? []) { r[1] = f.name; cubes.leads3!.rows.push(r); }
  }

  if (hasAds) await run("ads", ["date", "sessionGoogleAdsCampaignName", "sessionGoogleAdsKeyword"], ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions", "sessions"]);
  const evNames = new Set((cubes.events?.rows ?? []).map((r) => String(r[1])));
  const ecommerce = ["view_item", "add_to_cart", "begin_checkout", "purchase"].some((e) => evNames.has(e));
  if (ecommerce) {
    await Promise.all([
      run("items", ["date", "itemName"], ["itemsViewed", "itemsAddedToCart", "itemsCheckedOut", "itemsPurchased", "itemRevenue"]),
      run("ecom", ["date", "sessionDefaultChannelGroup", "landingPagePlusQueryString"], ["purchaseRevenue", "ecommercePurchases", "transactions", "firstTimePurchasers"]),
      run("coupons", ["date", "orderCoupon"], ["transactions", "purchaseRevenue"]),
      run("refunds", ["date"], ["refundAmount", "shippingAmount", "taxAmount"]),
    ]);
  }

  const crawl = stream ? await crawlLeadActions(stream).catch((e) => ({ pages: [], findings: [], error: msg(e) })) : null;
  const p = prop as { displayName?: string; timeZone?: string; currencyCode?: string } | null;
  const meta: Ga4xMeta = {
    fetchedAt: new Date().toISOString(), property: P, propertyName: p?.displayName ?? t.resource.display_name, resourceId: t.resource.id,
    timezone: p?.timeZone ?? tz, currency: p?.currencyCode ?? null, start, end, streamUrl: stream, measurementId: web?.webStreamData?.measurementId ?? null, keyEvents,
    customDimensions: ((cd?.customDimensions as { parameterName?: string; displayName?: string; scope?: string }[] | undefined) ?? []).map((d) => ({ parameterName: d.parameterName ?? "", displayName: d.displayName ?? "", scope: d.scope ?? "" })),
    config: {
      retention: (ret?.eventDataRetention as string | undefined) ?? null,
      signals: (sig?.state as string | undefined) ?? null,
      bigquery: bq ? (((bq.bigqueryLinks as unknown[] | undefined) ?? []).length > 0) : null,
      googleAds: hasAds, searchConsole: gscLinked,
      customDimensionNames: ((cd?.customDimensions as { parameterName?: string }[] | undefined) ?? []).map((d) => d.parameterName ?? ""),
    },
    fallbacks, crawl, errors, ecommerce,
  };
  for (const [name, c] of Object.entries(cubes)) await save(admin, clientId, key(t.resource.id, `cube:${name}`), c, c!.rows.length);
  await save(admin, clientId, key(t.resource.id, "meta"), meta, Object.keys(cubes).length);
  // coordinates for the city maps: the busiest cities and every city with a lead
  const region = new Map<string, string>();
  const weight = new Map<string, number>();
  for (const r of cubes.geo?.rows ?? []) { const k = `${r[1]}|${r[3]}`; region.set(k, String(r[2])); weight.set(k, (weight.get(k) ?? 0) + Number(r[8])); }
  for (const r of cubes.leads?.rows ?? []) { const k = `${r[6]}|${r[7]}`; weight.set(k, (weight.get(k) ?? 0) + 1000); }
  const cities = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => { const [city, country] = k.split("|"); return { city, country, region: region.get(k) ?? "" }; });
  await geocodeCities(admin, clientId, cities, 30).catch(() => undefined);
  return meta;
}

/** Users for a date range and the period before it (live range query, cached a day). */
export async function rangeUsers(admin: SupabaseClient, clientId: string, ctx: Ga4xCtx, resourceId: string, r: { start: string; end: string; pstart: string; pend: string }): Promise<RangeUsers> {
  const hash = key(resourceId, `users:${r.start}:${r.end}`);
  const { data } = await admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", ENDPOINT).eq("params_hash", hash).maybeSingle();
  if (data && Date.now() - Date.parse(String(data.fetched_at)) < 24 * 3600_000) return data.data as RangeUsers;
  const cur = [{ startDate: r.start, endDate: r.end }];
  const blank = { activeUsers: 0, newUsers: 0, totalUsers: 0 };
  const out: RangeUsers = { fetchedAt: new Date().toISOString(), ...r, totals: { cur: { ...blank }, prev: { ...blank } }, byPage: {}, byCity: {}, byEvent: {}, ageGender: [] };
  try {
    const [tot, page, city, ev, demo] = await batch(ctx, [
      { dateRanges: [...cur, { startDate: r.pstart, endDate: r.pend }], dimensions: [], metrics: ["activeUsers", "newUsers", "totalUsers"] },
      { dateRanges: cur, dimensions: ["pagePath"], metrics: ["activeUsers"] },
      { dateRanges: cur, dimensions: ["city"], metrics: ["activeUsers"] },
      { dateRanges: cur, dimensions: ["eventName"], metrics: ["totalUsers"] },
      { dateRanges: cur, dimensions: ["userAgeBracket", "userGender"], metrics: ["activeUsers"] },
    ]);
    for (const x of tot?.rows ?? []) {
      const which = (x.d[0] ?? "date_range_0") === "date_range_1" ? "prev" : "cur";
      out.totals[which] = { activeUsers: x.m[0] ?? 0, newUsers: x.m[1] ?? 0, totalUsers: x.m[2] ?? 0 };
    }
    for (const x of page?.rows ?? []) out.byPage[x.d[0]] = x.m[0];
    for (const x of city?.rows ?? []) out.byCity[x.d[0]] = x.m[0];
    for (const x of ev?.rows ?? []) out.byEvent[x.d[0]] = x.m[0];
    out.ageGender = (demo?.rows ?? []).map((x) => ({ age: x.d[0], gender: x.d[1], users: x.m[0] }));
  } catch (e) { out.error = (e instanceof Error ? e.message : String(e)).slice(0, 300); }
  if (!out.error) await save(admin, clientId, hash, out, 1);
  return out;
}

/** A live-ish report cached for `hours` (funnels, cohorts). */
export async function cachedCall<T>(admin: SupabaseClient, clientId: string, resourceId: string, name: string, hours: number, f: () => Promise<T>): Promise<{ data: T | null; error?: string }> {
  const hash = key(resourceId, name);
  const { data } = await admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", ENDPOINT).eq("params_hash", hash).maybeSingle();
  if (data && Date.now() - Date.parse(String(data.fetched_at)) < hours * 3600_000) return { data: data.data as T };
  try { const v = await f(); await save(admin, clientId, hash, v, 1); return { data: v }; }
  catch (e) { return { data: (data?.data as T | undefined) ?? null, error: (e instanceof Error ? e.message : String(e)).replace(/^GOOGLE_ANALYTICS_[A-Z_]+:\s*/, "").slice(0, 300) }; }
}

