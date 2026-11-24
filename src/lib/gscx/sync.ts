import "server-only";
import { cachedRows } from "@/lib/data-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn, shiftDays } from "@/lib/analytics/range";
import { sa, type GscCtx, type SaRow } from "./api";
import { crawlUrl, inspect, readSitemaps, type Crawl, type Inspection, type InventoryRow, type SitemapInfo } from "./inventory";

/**
 * Local copy of everything the Search Console screens show, per client and property, in dfs_cache
 * (endpoint "gscx"): performance cubes (one row per day and dimension combination; 16 months of daily totals
 * per search type and of monthly query totals, 180 days of query / page / device / country detail, recent
 * hourly data), sitemaps, the URL inventory with our crawl, and URL Inspection history.
 */
export const ENDPOINT = "gscx";
export const DETAIL_DAYS = 180;
export const MONTHS = 16;
const STALE_MS = 20 * 3600_000;
const INSPECT_PER_DAY = 1800; // Google allows about 2,000 per property per day
const TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;

export type GCube = "totals" | "q" | "qp" | "pg" | "pd" | "cd" | "dev" | "app" | "hour" | "qm";
export interface Cube { cols: string[]; rows: SaRow[]; error?: string }
export interface GscMeta {
  fetchedAt: string; site: string; resourceId: string; start: string; end: string; monthsStart: string; detailStart: string;
  types: string[]; appearances: string[]; errors: Record<string, string>; provisionalFrom: string | null;
}
export interface InspState { history: Record<string, Inspection[]>; quota: { date: string; used: number }; lastRun: string | null }

export async function gscxTarget(admin: SupabaseClient, clientId: string, resourceId?: string | null) {
  // the selected sites and the client's Search Console connection, in parallel
  const [{ data }, { data: conns }] = await Promise.all([
    admin.from("integration_resources").select("id, external_id, display_name, connection_id")
      .eq("client_id", clientId).eq("provider", "gsc").eq("is_selected", true).order("display_name"),
    admin.from("integration_connections").select("id, composio_entity_id, composio_connected_account_id").eq("client_id", clientId).eq("provider", "gsc"),
  ]);
  const list = (data ?? []) as { id: string; external_id: string; display_name: string | null; connection_id: string | null }[];
  if (!list.length) return null;
  const res = list.find((r) => r.id === resourceId) ?? list.find((r) => r.external_id.startsWith("sc-domain:")) ?? list[0];
  let conn: unknown = (conns ?? []).find((c) => c.id === res.connection_id) ?? null;
  if (!conn && res.connection_id) conn = (await admin.from("integration_connections").select("composio_entity_id, composio_connected_account_id").eq("id", res.connection_id).maybeSingle()).data;
  const cn = conn as { composio_entity_id?: string | null; composio_connected_account_id?: string | null } | null;
  const ctx: GscCtx | null = cn?.composio_connected_account_id && cn.composio_entity_id ? { userId: cn.composio_entity_id, connectedAccountId: cn.composio_connected_account_id, site: res.external_id } : null;
  return { resource: res, ctx, choices: list };
}

const k = (rid: string, name: string) => `${rid}:${name}`;
async function save(admin: SupabaseClient, clientId: string, hash: string, data: unknown, rows: number) {
  const { error } = await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: ENDPOINT, params_hash: hash, params: { module: "gscx" }, data, row_count: rows, cost: 0, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" });
  if (error) throw new Error(`save ${hash}: ${error.message}`);
}
export async function loadOne<T>(admin: SupabaseClient, clientId: string, rid: string, name: string): Promise<T | null> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", ENDPOINT).eq("params_hash", k(rid, name)).maybeSingle();
  return (data?.data as T | undefined) ?? null;
}
export async function loadCubes(admin: SupabaseClient, clientId: string, rid: string, names: readonly GCube[]): Promise<Record<GCube, Cube>> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", ENDPOINT).in("params_hash", names.map((n) => k(rid, `cube:${n}`)));
  const out = {} as Record<GCube, Cube>;
  for (const n of names) out[n] = { cols: [], rows: [] };
  for (const r of data ?? []) out[String(r.params_hash).split(":cube:")[1] as GCube] = r.data as Cube;
  return out;
}
export const isStale = (m: GscMeta | null) => !m || Date.now() - Date.parse(m.fetchedAt) > STALE_MS;

/**
 * Screen reads (read-only): cubes plus single rows (meta, inventory, inspections, sitemaps) in one go, through the
 * in-memory data cache, which re-downloads a row only when a sync has rewritten it (lib/data-cache). `version`
 * changes whenever any of the rows does. Sync code keeps using loadCubes / loadOne, which always read the database.
 */
export async function readGscx(admin: SupabaseClient, clientId: string, rid: string, names: readonly GCube[], ones: readonly string[]) {
  const hashes = [...names.map((n) => k(rid, `cube:${n}`)), ...ones.map((o) => k(rid, o))];
  const rows = await cachedRows(admin, clientId, ENDPOINT, hashes);
  const cubes = {} as Record<GCube, Cube>;
  for (const n of names) cubes[n] = (rows.get(k(rid, `cube:${n}`))?.data as Cube | undefined) ?? { cols: [], rows: [] };
  const one: Record<string, unknown> = {};
  for (const o of ones) one[o] = rows.get(k(rid, o))?.data ?? null;
  return { cubes, one, version: hashes.map((h) => rows.get(h)?.fetchedAt ?? "-").join("|") };
}

/** Search performance: every cube for the property. A report that fails is recorded; the rest still run. */
export async function syncGscx(admin: SupabaseClient, clientId: string, resourceId?: string | null, opts: { inventory?: boolean; inspectBudget?: number } = {}): Promise<GscMeta | null> {
  const t = await gscxTarget(admin, clientId, resourceId);
  if (!t?.ctx) return null;
  const ctx = t.ctx, rid = t.resource.id;
  // Search Console reports in Pacific time; the newest day is usually partial ("provisional")
  const end = shiftDays(todayIn("America/Los_Angeles"), -1);
  const detailStart = shiftDays(end, -(DETAIL_DAYS - 1));
  const monthsStart = shiftDays(end, -(MONTHS * 30 + 5));
  const errors: Record<string, string> = {};
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^GOOGLE_SEARCH_CONSOLE_[A-Z_]+:\s*/, "").slice(0, 300);
  const cubes: Partial<Record<GCube, Cube>> = {};
  const run = async (name: GCube, cols: string[], f: () => Promise<SaRow[]>) => {
    try { cubes[name] = { cols, rows: await f() }; } catch (e) { errors[name] = msg(e); cubes[name] = { cols, rows: [], error: errors[name] }; }
  };
  const M = ["clicks", "impressions", "posx"];

  // 16 months of true daily totals per search type (Discover and Google News have no query data)
  const totals: SaRow[] = [], types: string[] = [];
  await Promise.all(TYPES.map(async (type) => {
    try { const rows = await sa(ctx, { start: monthsStart, end, dimensions: ["date"], type }); if (rows.length) types.push(type); for (const r of rows) totals.push([r[0], type, r[1], r[2], r[3]]); }
    catch (e) { if (type === "web") errors.totals = msg(e); }
  }));
  cubes.totals = { cols: ["date", "type", ...M], rows: totals };
  await Promise.all([
    run("q", ["date", "query", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "query"] })),
    run("qp", ["date", "query", "page", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "query", "page"] })),
    // page totals from [date, page]: adding device makes Search Console drop many rows, so [page, device] is only used for device mix
    run("pg", ["date", "page", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "page"] })),
    run("pd", ["date", "page", "device", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "page", "device"] })),
  ]);
  await Promise.all([
    run("cd", ["date", "country", "device", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "country", "device"] })),
    run("dev", ["date", "device", ...M], () => sa(ctx, { start: detailStart, end, dimensions: ["date", "device"] })),
    run("hour", ["hour", ...M], () => sa(ctx, { start: shiftDays(end, -13), end: shiftDays(end, 1), dimensions: ["hour"], dataState: "hourly_all" })),
  ]);
  // search appearance can't be combined with other dimensions: list them, then one daily series per appearance
  const appearances: string[] = [];
  await run("app", ["date", "appearance", ...M], async () => {
    const list = await sa(ctx, { start: detailStart, end, dimensions: ["searchAppearance"] });
    const out: SaRow[] = [];
    for (const a of list) {
      const name = String(a[0]); appearances.push(name);
      for (const r of await sa(ctx, { start: detailStart, end, dimensions: ["date"], filters: [{ dimension: "searchAppearance", operator: "equals", expression: name }] })) out.push([r[0], name, r[1], r[2], r[3]]);
    }
    return out;
  });
  // monthly query totals for 16 months (query length by month, emerging questions, seasonal demand)
  await run("qm", ["month", "query", ...M], async () => {
    const out: SaRow[] = [];
    const months: [string, string][] = [];
    for (let d = new Date(`${monthsStart.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const s = d.toISOString().slice(0, 10), e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      months.push([s < monthsStart ? monthsStart : s, e > end ? end : e]);
    }
    for (let i = 0; i < months.length; i += 4) {
      const part = await Promise.all(months.slice(i, i + 4).map(([s, e]) => sa(ctx, { start: s, end: e, dimensions: ["query"], maxRows: 50_000 }).then((rows) => rows.map((r) => [s.slice(0, 7), ...r]))));
      out.push(...part.flat());
    }
    return out;
  });
  const web = totals.filter((r) => r[1] === "web").map((r) => String(r[0])).sort();
  const meta: GscMeta = {
    fetchedAt: new Date().toISOString(), site: ctx.site, resourceId: rid, start: web[0] ?? monthsStart, end: web.at(-1) ?? end, monthsStart, detailStart,
    types, appearances, errors, provisionalFrom: shiftDays(end, -2),
  };
  for (const [name, c] of Object.entries(cubes)) await save(admin, clientId, k(rid, `cube:${name}`), c, c!.rows.length);
  await save(admin, clientId, k(rid, "meta"), meta, Object.keys(cubes).length);
  if (opts.inventory !== false) await syncInventory(admin, clientId, rid, ctx, cubes.pg?.rows ?? [], { inspectBudget: opts.inspectBudget }).catch((e) => { meta.errors.inventory = msg(e); });
  return meta;
}

/**
 * Sitemaps, our crawl and the inspection queue. Crawls URLs not read in 7 days; inspects within the daily
 * quota (URLs never inspected first, then the oldest), so every URL is re-checked well within 30 days.
 */
export async function syncInventory(admin: SupabaseClient, clientId: string, rid: string, ctx: GscCtx, pd: SaRow[], opts: { inspectBudget?: number; crawlBudget?: number; deadline?: number } = {}) {
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const sitemaps: SitemapInfo[] = await readSitemaps(ctx).catch(() => (null as unknown as SitemapInfo[])) ?? (await loadOne<SitemapInfo[]>(admin, clientId, rid, "sitemaps")) ?? [];
  await save(admin, clientId, k(rid, "sitemaps"), sitemaps, sitemaps.length);
  const prev = (await loadOne<InventoryRow[]>(admin, clientId, rid, "inventory")) ?? [];
  const map = new Map(prev.map((r) => [r.url, { ...r, sources: [] as string[], sitemaps: [] as string[] }]));
  const add = (url: string, source: string, sitemap?: string) => { const r = map.get(url) ?? { url, sources: [], sitemaps: [], crawl: null }; if (!r.sources.includes(source)) r.sources.push(source); if (sitemap && !r.sitemaps.includes(sitemap)) r.sitemaps.push(sitemap); map.set(url, r); };
  for (const s of sitemaps) for (const u of s.urls) add(u, "sitemap", s.path);
  for (const r of pd) add(String(r[1]), "search console");
  const host = (() => { const any = [...map.keys()][0]; try { return new URL(any).hostname.replace(/^www\./, ""); } catch { return ctx.site.replace(/^sc-domain:|^https?:\/\/|\/$/g, "").replace(/^www\./, ""); } })();
  if (!map.size) add(`https://${host}/`, "home");
  // crawl: URLs never read or read more than 7 days ago (polite: 4 at a time)
  const due = [...map.values()].filter((r) => !r.crawl || Date.now() - Date.parse(r.crawl.at) > 7 * 86_400_000).slice(0, opts.crawlBudget ?? 500);
  for (let i = 0; i < due.length && Date.now() < deadline - 60_000; i += 4) {
    await Promise.all(due.slice(i, i + 4).map(async (r) => { r.crawl = await crawlUrl(r.url, host).catch(() => null) as Crawl | null; }));
    // links found on crawled pages join the inventory
    for (const r of due.slice(i, i + 4)) for (const l of r.crawl?.links ?? []) if (map.size < 3000 && !/\.(jpe?g|png|gif|webp|svg|pdf|xml)$|\/(wp-content|wp-json|feed|tag|author)\//i.test(l)) add(l, "crawl");
  }
  const inventory = [...map.values()];
  await save(admin, clientId, k(rid, "inventory"), inventory, inventory.length);

  // URL Inspection queue within the daily quota
  const st: InspState = (await loadOne<InspState>(admin, clientId, rid, "insp")) ?? { history: {}, quota: { date: "", used: 0 }, lastRun: null };
  const today = new Date().toISOString().slice(0, 10);
  if (st.quota.date !== today) st.quota = { date: today, used: 0 };
  const lastAt = (u: string) => st.history[u]?.[0]?.at ?? "";
  const queue = inventory.filter((r) => !r.crawl || (r.crawl.status ?? 0) < 400 || r.sources.includes("sitemap")).map((r) => r.url).sort((a, b) => lastAt(a).localeCompare(lastAt(b)));
  const budget = Math.min(opts.inspectBudget ?? 120, INSPECT_PER_DAY - st.quota.used);
  let done = 0;
  for (let i = 0; i < queue.length && done < budget && Date.now() < deadline; i += 3) {
    const batch = queue.slice(i, Math.min(i + 3, i + budget - done));
    const got = await Promise.all(batch.map((u) => inspect(ctx, u).then((x) => [u, x] as const, () => null)));
    for (const g of got) if (g) { (st.history[g[0]] ??= []).unshift(g[1]); st.history[g[0]] = st.history[g[0]].slice(0, 12); }
    done += batch.length; st.quota.used += batch.length;
  }
  st.lastRun = new Date().toISOString();
  await save(admin, clientId, k(rid, "insp"), st, Object.keys(st.history).length);
  return { sitemaps: sitemaps.length, inventory: inventory.length, inspected: done };
}
