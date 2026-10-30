import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, recordSpend } from "./budget";
import { dfsGet, dfsPost, dfsTaskPost } from "./client";
import { arr, num, obj, str, type Ctx } from "./research";

/**
 * Local visibility from DataForSEO Business Data and Google Maps:
 *   profile  -> my_business_info/live for the client's Google Business Profile (~$0.0054)
 *   reviews  -> reviews/task_post (newest first, ~$0.0075 per 100 reviews), collected later with a free task_get
 *   grid     -> one Google Maps search per point around the business (~$0.002 each; 3x3 = 9 searches)
 *   rivals   -> the same profile + reviews for nearby competitors ("people also search" or named ones)
 * Everything is stored in dfs_cache and read from there; opening a page never spends anything.
 */
export const REVIEW_DEPTH = 100;
export const GRID_POINT_EST = 0.0025;
export const PROFILE_EST = 0.006;
export const REVIEWS_EST = 0.008;

type Json = Record<string, unknown>;

export interface Identity { name: string; cid: string | null; placeId: string | null; lat: number | null; lng: number | null; city: string | null; domain: string | null }

/** Who the client is on Google Maps, from the connected Business Profile. */
export async function localIdentity(admin: SupabaseClient, clientId: string): Promise<Identity | null> {
  const { data } = await admin.from("integration_resources").select("display_name, external_id, metadata").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle();
  if (!data) return null;
  const m = obj(data.metadata), loc = obj(m.lbm_location);
  const cid = /cid=(\d+)/.exec(String(m.maps_uri ?? loc.gmb_url ?? ""))?.[1] ?? null;
  let domain: string | null = null;
  try { domain = m.website ? new URL(String(m.website)).hostname.replace(/^www\./, "") : null; } catch { /* no website */ }
  return {
    name: String(loc.name ?? data.display_name ?? ""), cid, placeId: str(m.place_id) ?? str(loc.place_id),
    lat: num(loc.lat), lng: num(loc.lng), city: str(loc.city), domain,
  };
}

/* ------------------------------------------------------------------ business profile */
export interface Profile {
  title: string | null; category: string | null; additional: string[]; rating: number | null; votes: number | null;
  distribution: Record<string, number>; address: string | null; phone: string | null; url: string | null; domain: string | null;
  claimed: boolean | null; photos: number | null; hours: { day: string; open: string }[]; status: string | null;
  attributes: string[]; cid: string | null; placeId: string | null; lat: number | null; lng: number | null;
  priceLevel: string | null; description: string | null; alsoSearch: { title: string; cid: string | null; rating: number | null; votes: number | null }[];
  checkUrl: string | null;
  /** what reviewers talk about, with how many reviews mention it (Google "place topics") */
  topics: { topic: string; count: number }[];
  questions: number | null; services: string[];
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const hm = (t: Json) => `${String(num(t.hour) ?? 0).padStart(2, "0")}:${String(num(t.minute) ?? 0).padStart(2, "0")}`;

export function shapeProfile(r: Json | null): Profile | null {
  const it = arr(r?.items)[0];
  if (!it) return null;
  const rating = obj(it.rating), tt = obj(obj(obj(it.work_time).work_hours).timetable);
  const attrs = obj(obj(it.attributes).available_attributes);
  return {
    title: str(it.title), category: str(it.category), additional: arr(it.additional_categories).map(String).filter(Boolean),
    rating: num(rating.value), votes: num(rating.votes_count),
    distribution: Object.fromEntries(Object.entries(obj(it.rating_distribution)).map(([k, v]) => [k, Number(v) || 0])),
    address: str(it.address), phone: str(it.phone), url: str(it.url), domain: str(it.domain), claimed: typeof it.is_claimed === "boolean" ? it.is_claimed : null,
    photos: num(it.total_photos), status: str(obj(obj(it.work_time).work_hours).current_status),
    hours: DAYS.map((d) => ({ day: d, open: arr(tt[d]).map((x) => `${hm(obj(x.open))}–${hm(obj(x.close))}`).join(", ") || "Closed" })).filter(() => Object.keys(tt).length > 0),
    attributes: Object.values(attrs).flatMap((v) => (Array.isArray(v) ? v.map(String) : [])).map((a) => a.replace(/^has_|^is_/, "").replace(/_/g, " ")).slice(0, 30),
    cid: str(it.cid), placeId: str(it.place_id), lat: num(it.latitude), lng: num(it.longitude),
    priceLevel: str(it.price_level), description: str(it.description)?.slice(0, 750) ?? null,
    alsoSearch: arr(obj(it.people_also_search).items ?? it.people_also_search).slice(0, 10).map((p) => ({
      title: String(p.title ?? ""), cid: str(p.cid), rating: num(obj(p.rating).value), votes: num(obj(p.rating).votes_count),
    })).filter((p) => p.title),
    checkUrl: str(r?.check_url),
    topics: Object.entries(obj(it.place_topics)).map(([topic, n]) => ({ topic, count: Number(n) || 0 })).sort((a, b) => b.count - a.count).slice(0, 20),
    questions: num(it.questions_and_answers_count),
    services: arr(it.services).map((s) => String(s.service_name ?? s.name ?? s.title ?? "")).filter(Boolean).slice(0, 30),
  };
}

/** Businesses that outrank the client on its latest map grids, most frequent first: natural competitors to compare. */
export function gridRivals(grids: Grid[], selfName: string): { name: string; cid: string | null }[] {
  const n = new Map<string, { name: string; cid: string | null; count: number }>();
  const me = selfName.toLowerCase();
  for (const g of grids) for (const p of g.points) p.top.forEach((t, i) => {
    if (!t || t.toLowerCase() === me) return;
    const x = n.get(t) ?? { name: t, cid: p.topCids?.[i] ?? null, count: 0 };
    x.count++; n.set(t, x);
  });
  return [...n.values()].sort((a, b) => b.count - a.count).slice(0, 6).map(({ name, cid }) => ({ name, cid }));
}

async function save(admin: SupabaseClient, clientId: string, endpoint: string, key: string, data: unknown, cost: number, params: Json = {}) {
  const at = new Date().toISOString();
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint, params_hash: key, params, data, row_count: Array.isArray(data) ? data.length : 1, cost, fetched_at: at },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return at;
}

const bizKeyword = (who: { cid?: string | null; placeId?: string | null; name: string }) => (who.cid ? `cid:${who.cid}` : who.placeId ? `place_id:${who.placeId}` : who.name);

/**
 * One business profile read. `key` = "self" for the client, else the competitor's cid / name. A lookup by
 * name searches around `near` (the client's location), which finds local businesses a country-wide search misses.
 */
export async function fetchProfile(ctx: Ctx, who: { cid?: string | null; placeId?: string | null; name: string }, key = "self", near?: { lat: number | null; lng: number | null }): Promise<Profile | null> {
  await assertBudget(ctx.admin, ctx.clientId, PROFILE_EST, ctx.source);
  const where = !who.cid && !who.placeId && near?.lat != null && near.lng != null ? { location_coordinate: `${near.lat},${near.lng},20000` } : { location_code: 2840 };
  const { result, cost } = await dfsPost("/business_data/google/my_business_info/live", { keyword: bizKeyword(who), ...where, language_code: "en" });
  await recordSpend(ctx.admin, ctx.clientId, "gbp_profile", cost, ctx.source);
  const p = shapeProfile(result);
  await save(ctx.admin, ctx.clientId, "gbp_profile", key, p, cost, { name: who.name, cid: who.cid ?? null });
  return p;
}

/* ------------------------------------------------------------------ reviews */
export interface Review {
  id: string | null; rating: number | null; author: string | null; authorUrl: string | null; localGuide: boolean; date: string | null; ago: string | null;
  text: string | null; reply: string | null; replyDate: string | null; images: number; url: string | null;
}
export interface Reviews {
  key: string; name: string; fetchedAt: string; total: number | null; rating: number | null; items: Review[];
}
export interface ReviewTask { id: string; key: string; name: string; postedAt: string; status: "pending" | "done" | "failed"; error?: string }

const isoDay = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);

export function shapeReviews(r: Json | null, key: string, name: string): Reviews {
  return {
    key, name, fetchedAt: new Date().toISOString(), total: num(r?.reviews_count), rating: num(obj(r?.rating).value),
    items: arr(r?.items).map((i) => ({
      id: str(i.review_id), rating: num(obj(i.rating).value), author: str(i.profile_name), authorUrl: str(i.profile_url), localGuide: i.local_guide === true,
      date: isoDay(i.timestamp), ago: str(i.time_ago), text: str(i.review_text)?.slice(0, 2000) ?? null,
      reply: str(i.owner_answer)?.slice(0, 1500) ?? null, replyDate: isoDay(i.owner_timestamp), images: arr(i.images).length, url: str(i.review_url),
    })),
  };
}

/** Starts a review collection (newest first). The result is collected by pollReviews. */
export async function startReviews(ctx: Ctx, who: { cid?: string | null; placeId?: string | null; name: string }, key = "self", depth = REVIEW_DEPTH) {
  await assertBudget(ctx.admin, ctx.clientId, REVIEWS_EST * (depth / 100), ctx.source);
  const { id, cost } = await dfsTaskPost("/business_data/google/reviews/task_post", {
    keyword: bizKeyword(who), location_code: 2840, language_code: "en", depth, sort_by: "newest",
  });
  await recordSpend(ctx.admin, ctx.clientId, "gbp_reviews", cost, ctx.source);
  const task: ReviewTask = { id, key, name: who.name, postedAt: new Date().toISOString(), status: "pending" };
  await save(ctx.admin, ctx.clientId, "reviews_task", key, task, cost);
  return task;
}

/** Collects every finished review task for the client (free). Returns how many are still pending. */
export async function pollReviews(admin: SupabaseClient, clientId: string): Promise<{ pending: number; done: number }> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", "reviews_task");
  let pending = 0, done = 0;
  for (const row of data ?? []) {
    const t = row.data as ReviewTask;
    if (t.status !== "pending") continue;
    const { status, result } = await dfsGet(`/business_data/google/reviews/task_get/${t.id}`);
    if (status === 20000 && result) {
      await save(admin, clientId, "reviews", t.key, shapeReviews(result, t.key, t.name), 0, { name: t.name });
      await save(admin, clientId, "reviews_task", t.key, { ...t, status: "done" }, 0);
      done++;
    } else if (status === 40102 || (status >= 40000 && status !== 40601 && status !== 40602) || Date.now() - Date.parse(t.postedAt) > 6 * 3_600_000) {
      // 40601/40602 = still queued / in progress; anything else (or 6 hours) means it won't arrive
      await save(admin, clientId, "reviews_task", t.key, { ...t, status: "failed", error: status === 40102 ? "No reviews found." : `DataForSEO status ${status}` }, 0);
    } else pending++;
  }
  return { pending, done };
}

/* ------------------------------------------------------------------ Google Maps rank grid */
export interface GridPoint { row: number; col: number; lat: number; lng: number; rank: number | null; top: string[]; topCids?: (string | null)[] }
export interface Grid {
  keyword: string; size: number; spacingKm: number; center: { lat: number; lng: number }; points: GridPoint[]; checkedAt: string; cost: number;
  summary: { searched: number; found: number; average: number | null; top3: number; top10: number };
}

/** Points on a size x size square around the centre, `spacingKm` apart. */
export function gridPoints(lat: number, lng: number, size: number, spacingKm: number) {
  const half = (size - 1) / 2, dLat = spacingKm / 111.32, dLng = spacingKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const out: { row: number; col: number; lat: number; lng: number }[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out.push({ row: r, col: c, lat: Number((lat + (half - r) * dLat).toFixed(6)), lng: Number((lng + (c - half) * dLng).toFixed(6)) });
  return out;
}

/** Runs one Maps search per grid point and records where the business appears (top 20). */
export async function runGrid(ctx: Ctx, me: Identity, keyword: string, size: 3 | 5, spacingKm: number): Promise<Grid> {
  if (me.lat == null || me.lng == null) throw new Error("The business location isn't known (connect Business Profile first).");
  const pts = gridPoints(me.lat, me.lng, size, spacingKm);
  await assertBudget(ctx.admin, ctx.clientId, pts.length * GRID_POINT_EST, ctx.source);
  let cost = 0;
  const points: GridPoint[] = [];
  const match = (i: Json) => (me.cid && str(i.cid) === me.cid) || (me.placeId && str(i.place_id) === me.placeId) || (me.domain && (str(i.domain) ?? "").replace(/^www\./, "") === me.domain);
  // a few at a time keeps well inside DataForSEO's concurrency limit
  for (let i = 0; i < pts.length; i += 5) {
    const batch = await Promise.all(pts.slice(i, i + 5).map(async (p) => {
      const r = await dfsPost("/serp/google/maps/live/advanced", { keyword, location_coordinate: `${p.lat},${p.lng},15z`, language_code: "en", depth: 20 });
      return { p, r };
    }));
    for (const { p, r } of batch) {
      cost += r.cost;
      const items = arr(r.result?.items).filter((x) => x.type === "maps_search");
      const mine = items.find(match);
      points.push({ ...p, rank: mine ? num(mine.rank_group) : null, top: items.slice(0, 3).map((x) => String(x.title ?? "")), topCids: items.slice(0, 3).map((x) => str(x.cid)) });
    }
  }
  await recordSpend(ctx.admin, ctx.clientId, "maps_grid", cost, ctx.source);
  const found = points.filter((p) => p.rank != null).map((p) => p.rank as number);
  const grid: Grid = {
    keyword, size, spacingKm, center: { lat: me.lat, lng: me.lng }, points, checkedAt: new Date().toISOString(), cost,
    summary: { searched: points.length, found: found.length, average: found.length ? Number((found.reduce((a, b) => a + b, 0) / found.length).toFixed(1)) : null, top3: found.filter((r) => r <= 3).length, top10: found.filter((r) => r <= 10).length },
  };
  // history is kept: one row per keyword per day
  await save(ctx.admin, ctx.clientId, "maps_grid", `${keyword.toLowerCase()}|${size}|${grid.checkedAt.slice(0, 10)}`, grid, cost, { keyword: keyword.toLowerCase(), size });
  return grid;
}

/* ------------------------------------------------------------------ reading (no API calls) */
export interface LocalData {
  identity: Identity | null;
  profile: { data: Profile; fetchedAt: string } | null;
  reviews: Reviews | null;
  reviewTask: ReviewTask | null;
  rivals: { key: string; profile: Profile | null; reviews: Reviews | null; task: ReviewTask | null }[];
  grids: Grid[];
}

export async function loadLocal(supabase: SupabaseClient, admin: SupabaseClient, clientId: string): Promise<LocalData> {
  const [{ data: rows }, identity] = await Promise.all([
    supabase.from("dfs_cache").select("endpoint, params_hash, data, fetched_at").eq("client_id", clientId)
      .in("endpoint", ["gbp_profile", "reviews", "reviews_task", "maps_grid"]).order("fetched_at", { ascending: false }).limit(300),
    localIdentity(admin, clientId),
  ]);
  const list = rows ?? [];
  const pick = (endpoint: string, key: string) => list.find((r) => r.endpoint === endpoint && r.params_hash === key);
  const self = pick("gbp_profile", "self");
  const rivalKeys = [...new Set(list.filter((r) => ["gbp_profile", "reviews", "reviews_task"].includes(r.endpoint) && r.params_hash !== "self").map((r) => r.params_hash as string))];
  return {
    identity,
    profile: self?.data ? { data: self.data as Profile, fetchedAt: self.fetched_at as string } : null,
    reviews: (pick("reviews", "self")?.data as Reviews | undefined) ?? null,
    reviewTask: (pick("reviews_task", "self")?.data as ReviewTask | undefined) ?? null,
    rivals: rivalKeys.map((k) => ({
      key: k, profile: (pick("gbp_profile", k)?.data as Profile | undefined) ?? null,
      reviews: (pick("reviews", k)?.data as Reviews | undefined) ?? null, task: (pick("reviews_task", k)?.data as ReviewTask | undefined) ?? null,
    })),
    grids: list.filter((r) => r.endpoint === "maps_grid").map((r) => r.data as Grid),
  };
}

/** Reply rate, rating mix, monthly velocity and star-based sentiment for a set of reviews. */
export function reviewStats(items: Review[]) {
  const replied = items.filter((r) => r.reply).length;
  const dist = [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: items.filter((r) => r.rating === s).length }));
  const months = new Map<string, number>();
  for (const r of items) if (r.date) months.set(r.date.slice(0, 7), (months.get(r.date.slice(0, 7)) ?? 0) + 1);
  const rated = items.filter((r) => r.rating != null);
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const replyDays = items.filter((r) => r.reply && r.replyDate && r.date).map((r) => (Date.parse(r.replyDate!) - Date.parse(r.date!)) / 86_400_000).filter((d) => d >= 0);
  return {
    loaded: items.length, replied, notReplied: items.length - replied, replyRate: items.length ? replied / items.length : null,
    unansweredNegative: items.filter((r) => !r.reply && (r.rating ?? 5) <= 3).length,
    average: rated.length ? rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length : null,
    distribution: dist, positive: rated.filter((r) => (r.rating as number) >= 4).length, neutral: rated.filter((r) => r.rating === 3).length,
    negative: rated.filter((r) => (r.rating as number) <= 2).length, last90: items.filter((r) => (r.date ?? "") >= since90).length,
    medianReplyDays: replyDays.length ? replyDays.sort((a, b) => a - b)[Math.floor(replyDays.length / 2)] : null,
    monthly: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
  };
}
