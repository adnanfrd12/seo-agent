import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, BudgetError, recordSpend } from "@/lib/dataforseo/budget";
import { DfsError, dfsGet, dfsTaskPost } from "@/lib/dataforseo/client";
import { localIdentity, REVIEWS_EST, startReviews, type Profile, type Reviews } from "@/lib/dataforseo/local";
import { arr, num, obj, str, type Ctx, type Json } from "@/lib/dataforseo/research";

/**
 * Reviews from every platform we can read without the client's credentials.
 *  - Google: the existing Business Profile review collection (dfs_cache "reviews" / "gbp_profile", key "self")
 *  - Trustpilot, Tripadvisor, Yelp: DataForSEO Business Data review tasks (task_post ≈ $0.0015 per 20 reviews,
 *    task_get free). Yelp is answered "temporarily unavailable" by DataForSEO (50304) as of Nov 2026; it is
 *    tried and reported, and works again on its own once DataForSEO re-enables it.
 *  - Facebook, Foursquare: official APIs that need the client's token / an API key (not stored yet)
 *  - BBB, Angi, Thumbtack, Houzz, Nextdoor, YellowPages, Bing Places: no public reviews API and their
 *    terms forbid scraping, so only the profile link is kept (rating can be typed in by hand later)
 * ONE dfs_cache row per platform (endpoint "reviews_platform", params_hash = platform).
 */
export const PLATFORM_ENDPOINT = "reviews_platform";
export const PLATFORM_DEPTH = 40;
export const PLATFORM_EST = 0.004;

export type PlatformKey =
  | "google" | "yelp" | "facebook" | "trustpilot" | "bbb" | "angi" | "thumbtack" | "houzz" | "tripadvisor" | "nextdoor" | "bing" | "foursquare" | "yellowpages";
export type Access = "api" | "credentials" | "none";

export const PLATFORMS: { key: PlatformKey; label: string; access: Access; host: RegExp; note: string; example: string }[] = [
  { key: "google", label: "Google Business Profile", access: "api", host: /(google\.[a-z.]+|goo\.gl|g\.page)$/, note: "Read through DataForSEO (no client login needed).", example: "https://maps.google.com/?cid=…" },
  { key: "trustpilot", label: "Trustpilot", access: "api", host: /trustpilot\.com$/, note: "Read through DataForSEO by the website's domain.", example: "https://www.trustpilot.com/review/example.com" },
  { key: "tripadvisor", label: "Tripadvisor", access: "api", host: /tripadvisor\.[a-z.]+$/, note: "Read through DataForSEO from the listing link.", example: "https://www.tripadvisor.com/Attraction_Review-…html" },
  { key: "yelp", label: "Yelp", access: "api", host: /yelp\.[a-z.]+$/, note: "DataForSEO's Yelp endpoint is temporarily unavailable (Nov 2026); tried on every refresh.", example: "https://www.yelp.com/biz/business-name-houston" },
  { key: "facebook", label: "Facebook", access: "credentials", host: /(facebook|fb)\.com$/, note: "Needs a Facebook Page access token with pages_read_user_content (and pages_read_engagement) from a Page admin.", example: "https://www.facebook.com/yourpage" },
  { key: "foursquare", label: "Foursquare", access: "credentials", host: /foursquare\.com$/, note: "Needs a Foursquare Places API key (ratings and tips only; Foursquare has no star reviews).", example: "https://foursquare.com/v/…" },
  { key: "bing", label: "Bing Places", access: "none", host: /bing\.com$/, note: "Bing shows reviews from other sites (Yelp, Tripadvisor…); no public reviews API.", example: "https://www.bing.com/maps?…" },
  { key: "bbb", label: "BBB", access: "none", host: /bbb\.org$/, note: "No public API; BBB's terms forbid scraping. Link kept for reference.", example: "https://www.bbb.org/us/tx/houston/profile/…" },
  { key: "angi", label: "Angi", access: "none", host: /(angi|angieslist|homeadvisor)\.com$/, note: "No public reviews API (partner API only); scraping is against the terms.", example: "https://www.angi.com/companylist/us/tx/houston/…" },
  { key: "thumbtack", label: "Thumbtack", access: "none", host: /thumbtack\.com$/, note: "No public reviews API; scraping is against the terms.", example: "https://www.thumbtack.com/tx/houston/…" },
  { key: "houzz", label: "Houzz", access: "none", host: /houzz\.[a-z.]+$/, note: "No public reviews API; scraping is against the terms.", example: "https://www.houzz.com/professionals/…" },
  { key: "nextdoor", label: "Nextdoor", access: "none", host: /nextdoor\.com$/, note: "No reviews API (recommendations are visible to members only).", example: "https://nextdoor.com/pages/…" },
  { key: "yellowpages", label: "YellowPages", access: "none", host: /(yellowpages|yp)\.com$/, note: "No public reviews API; scraping is against the terms.", example: "https://www.yellowpages.com/houston-tx/mip/…" },
];
export const platformOf = (k: string) => PLATFORMS.find((p) => p.key === k);

export type ReviewProfiles = Partial<Record<PlatformKey, string>>;

export interface PReview { id: string | null; rating: number | null; author: string | null; date: string | null; title: string | null; text: string | null; reply: string | null; replyDate: string | null; url: string | null }
export interface PlatformRow {
  platform: PlatformKey; url: string; taskId: string | null; postedAt: string | null; status: "pending" | "done" | "failed" | "none";
  error?: string; fetchedAt: string | null; rating: number | null; total: number | null; reviews: PReview[];
}
export interface PlatformView extends Omit<PlatformRow, "platform"> { platform: PlatformKey; label: string; access: Access; note: string; source: "live" | "link" | "missing" }

const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);

/* ------------------------------------------------------------------ profile links */
export async function getProfiles(admin: SupabaseClient, clientId: string): Promise<ReviewProfiles> {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  return ((data?.settings ?? {}) as { review_profiles?: ReviewProfiles }).review_profiles ?? {};
}

/** Validates and saves the profile links (an empty value removes one). */
export async function saveProfiles(admin: SupabaseClient, clientId: string, input: Record<string, string>): Promise<ReviewProfiles> {
  const out: ReviewProfiles = {};
  for (const p of PLATFORMS) {
    const raw = (input[p.key] ?? "").trim();
    if (!raw) continue;
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error(`${p.label}: that isn't a valid link.`); }
    if (!p.host.test(u.hostname.toLowerCase().replace(/^www\./, ""))) throw new Error(`${p.label}: the link should be on ${p.example.split("/")[2]}.`);
    out[p.key] = u.toString().slice(0, 500);
  }
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  const settings = { ...((data?.settings ?? {}) as Record<string, unknown>), review_profiles: out };
  const { error } = await admin.from("clients").update({ settings }).eq("id", clientId);
  if (error) throw new Error("Could not save the links.");
  return out;
}

/** Fills in what can be known for free: the Google listing (from the connected profile) and Trustpilot (by domain). */
export async function defaultProfiles(admin: SupabaseClient, clientId: string): Promise<ReviewProfiles> {
  const me = await localIdentity(admin, clientId);
  const { data: t } = await admin.from("research_targets").select("domain").eq("client_id", clientId).maybeSingle();
  const domain = (me?.domain ?? (t?.domain as string | undefined) ?? "").replace(/^www\./, "");
  return {
    ...(me?.cid ? { google: `https://maps.google.com/?cid=${me.cid}` } : {}),
    ...(domain ? { trustpilot: `https://www.trustpilot.com/review/${domain}` } : {}),
  };
}

/* ------------------------------------------------------------------ fetching */
function taskFor(platform: PlatformKey, url: string): { path: string; body: Json } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (platform === "trustpilot") {
    const domain = /\/review\/([^/?#]+)/.exec(u.pathname)?.[1];
    return domain ? { path: "/business_data/trustpilot/reviews/task_post", body: { domain, depth: PLATFORM_DEPTH, sort_by: "recency" } } : null;
  }
  if (platform === "tripadvisor") {
    return /\.html$/.test(u.pathname) ? { path: "/business_data/tripadvisor/reviews/task_post", body: { url_path: u.pathname, location_code: 2840, depth: PLATFORM_DEPTH } } : null;
  }
  if (platform === "yelp") {
    const alias = /\/biz\/([^/?#]+)/.exec(u.pathname)?.[1];
    return alias ? { path: "/business_data/yelp/reviews/task_post", body: { alias, depth: PLATFORM_DEPTH, sort_by: "newest" } } : null;
  }
  return null;
}
export const FETCHABLE: PlatformKey[] = ["trustpilot", "tripadvisor", "yelp"];

async function save(admin: SupabaseClient, clientId: string, row: PlatformRow, cost: number) {
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: PLATFORM_ENDPOINT, params_hash: row.platform, params: { url: row.url }, data: row, row_count: row.reviews.length, cost, fetched_at: new Date().toISOString() },
    { onConflict: "client_id,endpoint,params_hash" },
  );
}
async function previous(admin: SupabaseClient, clientId: string, platform: PlatformKey) {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", PLATFORM_ENDPOINT).eq("params_hash", platform).maybeSingle();
  return (data?.data ?? null) as PlatformRow | null;
}

/** Starts one platform's review collection. Earlier reviews stay visible until the new ones arrive. */
export async function startPlatform(ctx: Ctx, platform: PlatformKey, url: string): Promise<PlatformRow> {
  const t = taskFor(platform, url);
  const old = await previous(ctx.admin, ctx.clientId, platform);
  const base: PlatformRow = { platform, url, taskId: null, postedAt: new Date().toISOString(), status: "pending", fetchedAt: old?.fetchedAt ?? null, rating: old?.rating ?? null, total: old?.total ?? null, reviews: old?.reviews ?? [] };
  if (!t) { const row = { ...base, status: "failed" as const, error: "The link doesn't look like a listing page on this platform." }; await save(ctx.admin, ctx.clientId, row, 0); return row; }
  await assertBudget(ctx.admin, ctx.clientId, PLATFORM_EST, ctx.source);
  try {
    const { id, cost } = await dfsTaskPost(t.path, t.body);
    await recordSpend(ctx.admin, ctx.clientId, `reviews_${platform}`, cost, ctx.source);
    const row = { ...base, taskId: id };
    await save(ctx.admin, ctx.clientId, row, cost);
    return row;
  } catch (e) {
    if (!(e instanceof DfsError) || e.kind === "payment" || e.kind === "auth") throw e;
    const row = { ...base, status: "failed" as const, error: /unavailable|50304/i.test(e.message) ? "DataForSEO has this platform temporarily switched off; it is retried on the next refresh." : e.message };
    await save(ctx.admin, ctx.clientId, row, 0);
    return row;
  }
}

export function shapePlatform(result: Json | null): Pick<PlatformRow, "rating" | "total" | "reviews"> {
  return {
    rating: num(obj(result?.rating).value), total: num(result?.reviews_count),
    reviews: arr(result?.items).map((i) => {
      const resp = arr(i.responses)[0] ?? obj(i.owner_answer ? { review_text: i.owner_answer, timestamp: i.owner_timestamp } : {});
      return {
        id: str(i.review_id), rating: num(obj(i.rating).value), author: str(obj(i.user_profile).name) ?? str(i.profile_name),
        date: day(i.timestamp ?? i.date_of_visit), title: str(i.title), text: (str(i.review_text) ?? "").slice(0, 2000) || null,
        reply: (str(obj(resp).review_text) ?? str(obj(resp).text) ?? "").slice(0, 1500) || null, replyDate: day(obj(resp).timestamp), url: str(i.url) ?? str(i.review_url),
      };
    }),
  };
}

const GET_PATH: Partial<Record<PlatformKey, string>> = {
  trustpilot: "/business_data/trustpilot/reviews/task_get/", tripadvisor: "/business_data/tripadvisor/reviews/task_get/", yelp: "/business_data/yelp/reviews/task_get/",
};

/** Collects finished platform tasks (free). */
export async function pollPlatforms(admin: SupabaseClient, clientId: string): Promise<{ pending: number; done: number }> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", PLATFORM_ENDPOINT).limit(20);
  let pending = 0, done = 0;
  for (const r of data ?? []) {
    const t = r.data as PlatformRow;
    if (t.status !== "pending" || !t.taskId || !GET_PATH[t.platform]) continue;
    const { status, result } = await dfsGet(`${GET_PATH[t.platform]}${t.taskId}`);
    if (status === 20000) {
      const s = shapePlatform(result);
      await save(admin, clientId, { ...t, ...s, status: "done", error: undefined, fetchedAt: new Date().toISOString() }, 0);
      done++;
    } else if (status === 40102) {
      await save(admin, clientId, { ...t, status: "done", fetchedAt: new Date().toISOString(), rating: null, total: 0, reviews: [] }, 0);
      done++;
    } else if ((status >= 40000 && status !== 40601 && status !== 40602) || Date.now() - Date.parse(t.postedAt ?? "") > 6 * 3_600_000) {
      await save(admin, clientId, { ...t, status: "failed", error: `DataForSEO status ${status}` }, 0);
    } else pending++;
  }
  return { pending, done };
}

/** Everything a refresh would start: fetchable platforms with a link, plus Google reviews when older than `maxAgeDays`. */
export async function refreshAll(ctx: Ctx, opts: { maxAgeDays?: number } = {}): Promise<{ started: string[]; skipped: string[]; errors: string[] }> {
  const maxAge = (opts.maxAgeDays ?? 0) * 86_400_000;
  const profiles = { ...(await defaultProfiles(ctx.admin, ctx.clientId)), ...(await getProfiles(ctx.admin, ctx.clientId)) };
  const { data } = await ctx.admin.from("dfs_cache").select("params_hash, endpoint, data, fetched_at").eq("client_id", ctx.clientId)
    .in("endpoint", [PLATFORM_ENDPOINT, "reviews", "reviews_task"]).limit(60);
  const rows = data ?? [];
  const started: string[] = [], skipped: string[] = [], errors: string[] = [];
  const fresh = (at: string | null | undefined) => maxAge > 0 && at != null && Date.now() - Date.parse(at) < maxAge;

  // Google: the same collection the Local SEO tab uses (newest 100)
  const gTask = rows.find((r) => r.endpoint === "reviews_task" && r.params_hash === "self")?.data as { status?: string } | undefined;
  const gRev = rows.find((r) => r.endpoint === "reviews" && r.params_hash === "self");
  if (profiles.google) {
    if (gTask?.status === "pending" || fresh(gRev?.fetched_at as string | undefined)) skipped.push("google");
    else {
      const me = await localIdentity(ctx.admin, ctx.clientId);
      if (me) {
        try { await startReviews(ctx, { name: me.name, cid: me.cid, placeId: me.placeId }, "self"); started.push("google"); }
        catch (e) { errors.push(`Google: ${e instanceof Error ? e.message : "failed"}`); }
      }
    }
  }
  for (const p of FETCHABLE) {
    const url = profiles[p];
    if (!url) continue;
    const row = rows.find((r) => r.endpoint === PLATFORM_ENDPOINT && r.params_hash === p);
    const d = row?.data as PlatformRow | undefined;
    if (d?.status === "pending" || (d?.url === url && d.status === "done" && fresh(d.fetchedAt))) { skipped.push(p); continue; }
    try {
      const r = await startPlatform(ctx, p, url);
      if (r.status === "failed") errors.push(`${platformOf(p)?.label}: ${r.error}`); else started.push(p);
    } catch (e) { errors.push(`${platformOf(p)?.label}: ${e instanceof Error ? e.message : "failed"}`); if (e instanceof BudgetError) break; }
  }
  return { started, skipped, errors };
}
export const refreshEstimate = (n: number) => REVIEWS_EST + n * PLATFORM_EST;

/* ------------------------------------------------------------------ reading (free) */
export async function loadPlatformReviews(supabase: SupabaseClient, admin: SupabaseClient, clientId: string): Promise<{ profiles: ReviewProfiles; saved: ReviewProfiles; views: PlatformView[] }> {
  const [saved, defaults, { data }] = await Promise.all([
    getProfiles(admin, clientId), defaultProfiles(admin, clientId),
    supabase.from("dfs_cache").select("endpoint, params_hash, data, fetched_at").eq("client_id", clientId)
      .in("endpoint", [PLATFORM_ENDPOINT, "reviews", "reviews_task", "gbp_profile"]).order("fetched_at", { ascending: false }).limit(80),
  ]);
  const profiles = { ...defaults, ...saved };
  const rows = data ?? [];
  const views: PlatformView[] = PLATFORMS.map((p) => {
    const url = profiles[p.key] ?? "";
    const base = { platform: p.key, label: p.label, access: p.access, note: p.note, url, taskId: null, postedAt: null, fetchedAt: null, rating: null, total: null, reviews: [] as PReview[] };
    if (p.key === "google") {
      const rev = rows.find((r) => r.endpoint === "reviews" && r.params_hash === "self");
      const prof = rows.find((r) => r.endpoint === "gbp_profile" && r.params_hash === "self")?.data as Profile | null | undefined;
      const task = rows.find((r) => r.endpoint === "reviews_task" && r.params_hash === "self")?.data as { status?: PlatformRow["status"]; error?: string } | undefined;
      const g = rev?.data as Reviews | undefined;
      if (!g && !prof) return { ...base, status: task?.status ?? "none", source: url ? "link" : "missing" };
      return {
        ...base, status: task?.status === "pending" ? "pending" : "done", fetchedAt: (rev?.fetched_at as string | undefined) ?? null, source: "live",
        rating: prof?.rating ?? g?.rating ?? null, total: prof?.votes ?? g?.total ?? null,
        reviews: (g?.items ?? []).map((i) => ({ id: i.id, rating: i.rating, author: i.author, date: i.date, title: null, text: i.text, reply: i.reply, replyDate: i.replyDate, url: i.url })),
      };
    }
    const row = rows.find((r) => r.endpoint === PLATFORM_ENDPOINT && r.params_hash === p.key)?.data as PlatformRow | undefined;
    if (row && row.url === url) return { ...base, ...row, label: p.label, access: p.access, note: p.note, source: "live" };
    return { ...base, status: "none", source: url ? "link" : "missing" };
  });
  return { profiles, saved, views };
}
