import "server-only";
import { composio, executeTool } from "@/lib/composio/client";
import { findArray, pick, pickStr } from "./treg";
import { handleOf, PLATFORM_INFO, type Platform } from "./platforms";

/**
 * Social analytics through Composio (the same account and per-client entity "client:<id>" used for GA4 and
 * Search Console). The client presses Connect, logs in on the platform's own page (official OAuth), and the
 * stats are read with Composio's read-only tools. Nothing is posted.
 *
 * Composio provides its own OAuth app ("managed auth") for Facebook, Instagram, LinkedIn, Pinterest and
 * YouTube, so those work without any setup. Threads, X and TikTok need an auth config made in the Composio
 * dashboard with the agency's own developer app; its id goes in COMPOSIO_AUTH_CONFIG_<PLATFORM>.
 */
export const TOOLKIT: Record<Platform, string> = {
  youtube: "youtube", facebook: "facebook", instagram: "instagram", tiktok: "tiktok",
  x: "twitter", linkedin: "linkedin", threads: "threads", pinterest: "pinterest",
};
const PLATFORM_OF = Object.fromEntries(Object.entries(TOOLKIT).map(([p, t]) => [t, p])) as Record<string, Platform>;
const MANAGED = new Set<Platform>(["facebook", "instagram", "linkedin", "pinterest", "youtube"]);
const envKey = (p: Platform) => `COMPOSIO_AUTH_CONFIG_${p === "x" ? "TWITTER" : p.toUpperCase()}`;

export const entityId = (clientId: string) => `client:${clientId}`;
export class SetupNeeded extends Error {}

/** True when Connect can work for this platform (managed auth, or an auth config is set). */
export function composioReady(p: Platform): boolean {
  return MANAGED.has(p) || Boolean(process.env[envKey(p)]?.trim());
}
export const setupNote = (p: Platform) =>
  `${PLATFORM_INFO[p].label} has no Composio-managed login. Create a ${PLATFORM_INFO[p].label} developer app, add it as an auth config for the "${TOOLKIT[p]}" toolkit in the Composio dashboard, and set ${envKey(p)} to its id (ac_...).`;

/** The auth config for a platform: env override, else an existing enabled one, else a new Composio-managed one. */
async function authConfigFor(p: Platform): Promise<string> {
  const fromEnv = process.env[envKey(p)]?.trim();
  if (fromEnv) return fromEnv;
  const list = await composio().authConfigs.list({ toolkit: TOOLKIT[p], limit: 20 });
  const found = list.items.find((a) => a.status === "ENABLED" && (a.toolkit?.slug ?? TOOLKIT[p]) === TOOLKIT[p]);
  if (found) return found.id;
  if (!MANAGED.has(p)) throw new SetupNeeded(setupNote(p));
  const created = await composio().authConfigs.create(TOOLKIT[p], { type: "use_composio_managed_auth", name: `${TOOLKIT[p]}-social-analytics` });
  return created.id;
}

/** Starts the platform's login; returns the URL to send the browser to. */
export async function startSocialConnect(clientId: string, p: Platform, callbackUrl: string): Promise<string> {
  const req = await composio().connectedAccounts.link(entityId(clientId), await authConfigFor(p), { callbackUrl });
  if (!req.redirectUrl) throw new Error("Composio didn't return a login link.");
  return req.redirectUrl;
}

export interface SocialConnection { platform: Platform; id: string; status: string; createdAt: string }

/** The client's Composio social accounts (newest per platform; ACTIVE preferred). */
export async function socialConnections(clientId: string): Promise<SocialConnection[]> {
  const res = await composio().connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: Object.values(TOOLKIT), limit: 100 });
  const best = new Map<Platform, SocialConnection>();
  for (const a of [...res.items].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
    const p = PLATFORM_OF[a.toolkit?.slug ?? ""];
    if (!p) continue;
    const cur = best.get(p);
    if (!cur || (cur.status !== "ACTIVE" && a.status === "ACTIVE")) best.set(p, { platform: p, id: a.id, status: a.status, createdAt: a.createdAt });
  }
  return [...best.values()];
}

/** Waits briefly for a just-finished login to turn ACTIVE (the redirect can beat Composio's status update). */
export async function settleConnection(clientId: string, p: Platform): Promise<SocialConnection | null> {
  let c = (await socialConnections(clientId)).find((x) => x.platform === p) ?? null;
  if (c && c.status !== "ACTIVE" && (c.status === "INITIATED" || c.status === "INITIALIZING")) {
    try { await composio().connectedAccounts.waitForConnection(c.id, 20_000); } catch { /* checked below */ }
    c = (await socialConnections(clientId)).find((x) => x.platform === p) ?? null;
  }
  return c;
}

/** Removes every Composio account of this platform for the client. */
export async function disconnectSocialAccount(clientId: string, p: Platform) {
  const res = await composio().connectedAccounts.list({ userIds: [entityId(clientId)], toolkitSlugs: [TOOLKIT[p]], limit: 50 });
  await Promise.all(res.items.map((a) => composio().connectedAccounts.delete(a.id)));
}

/* ------------------------------------------------------------------ reading the stats */
export interface ComposioStats {
  name: string | null; followers: number | null; following: number | null; posts: number | null;
  views: number | null; impressions: number | null; reach: number | null; likes: number | null; comments: number | null;
  recent: { id: string; title: string; url: string | null; date: string | null; type?: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null }[];
}

const unwrap = (d: unknown): unknown => (d && typeof d === "object" && "response_data" in d ? (d as { response_data: unknown }).response_data : d);
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000).toISOString().slice(0, 10) : null) || null;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const DAYS = 28;

/** Sum of an insights metric (total_value or the values of a time series) in a Graph-style response. */
function metricTotal(data: unknown, name: string): number | null {
  for (const m of findArray(data, ["data", "metrics", "insights"])) {
    if (m.name !== name && m.metric !== name) continue;
    const tv = n((m.total_value as Record<string, unknown> | undefined)?.value);
    if (tv != null) return tv;
    const vals = Array.isArray(m.values) ? (m.values as Record<string, unknown>[]).map((v) => n(v.value)).filter((x): x is number => x != null) : [];
    if (vals.length) return vals.reduce((a, b) => a + b, 0);
  }
  return null;
}
function lastValue(data: unknown, name: string): number | null {
  for (const m of findArray(data, ["data", "metrics", "insights"])) {
    if (m.name !== name && m.metric !== name) continue;
    const tv = n((m.total_value as Record<string, unknown> | undefined)?.value);
    if (tv != null) return tv;
    const vals = Array.isArray(m.values) ? (m.values as Record<string, unknown>[]).map((v) => n(v.value)).filter((x): x is number => x != null) : [];
    if (vals.length) return vals.at(-1)!;
  }
  return null;
}

export async function readComposioStats(clientId: string, p: Platform, connectedAccountId: string, ctx: { url: string | null; linkedinOrgId: string | null }): Promise<ComposioStats> {
  const run = async (slug: string, args: Record<string, unknown>) => unwrap(await executeTool({ slug, arguments: args, userId: entityId(clientId), connectedAccountId, timeoutMs: 60_000 }));
  const soft = async (slug: string, args: Record<string, unknown>) => { try { return await run(slug, args); } catch { return null; } };
  const now = Math.floor(Date.now() / 1000), since = now - DAYS * 86_400;
  const empty: ComposioStats = { name: null, followers: null, following: null, posts: null, views: null, impressions: null, reach: null, likes: null, comments: null, recent: [] };

  if (p === "facebook") {
    const pages = findArray(await run("FACEBOOK_LIST_MANAGED_PAGES", { fields: "id,name,username,link,followers_count,fan_count", limit: 50 }), ["data", "pages"]);
    if (!pages.length) throw new Error("The connected Facebook login manages no Pages. Log in with a Page admin.");
    const h = (handleOf(ctx.url ?? "") ?? "").toLowerCase();
    const page = pages.find((x) => h && [x.username, x.id, String(x.link ?? "").split("/").filter(Boolean).pop()].some((v) => String(v ?? "").toLowerCase() === h)) ?? pages[0];
    const pageId = String(page.id);
    const ins = await soft("FACEBOOK_GET_PAGE_INSIGHTS", { page_id: pageId, metrics: "page_impressions_unique,page_media_view,page_post_engagements,page_views_total", period: "day", since: String(since), until: String(now) });
    const posts = findArray(await soft("FACEBOOK_GET_PAGE_POSTS", { page_id: pageId, limit: 25, fields: "id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }), ["data", "posts"]);
    return {
      ...empty, name: pickStr(page, ["name"]), followers: n(page.followers_count) ?? n(page.fan_count),
      views: ins ? metricTotal(ins, "page_media_view") : null, reach: ins ? metricTotal(ins, "page_impressions_unique") : null,
      likes: ins ? metricTotal(ins, "page_post_engagements") : null,
      recent: posts.map((x) => ({ id: String(x.id), title: String(x.message ?? "").slice(0, 160), url: pickStr(x, ["permalink_url"]), date: day(x.created_time), views: null,
        likes: pick(x.reactions, ["total_count"]), comments: pick(x.comments, ["total_count"]), shares: pick(x.shares, ["count"]) })),
    };
  }

  if (p === "instagram") {
    const me = (await run("INSTAGRAM_GET_USER_INFO", { ig_user_id: "me", fields: "id,username,name,followers_count,follows_count,media_count" })) as Record<string, unknown>;
    const ins = await soft("INSTAGRAM_GET_USER_INSIGHTS", { ig_user_id: pickStr(me, ["id"]) ?? undefined, metric: ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments"], period: "day", metric_type: "total_value", since, until: now });
    const media = findArray(await soft("INSTAGRAM_GET_IG_USER_MEDIA", { ig_user_id: "me", limit: 25, fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count" }), ["data", "media"]);
    return {
      ...empty, name: pickStr(me, ["username", "name"]), followers: pick(me, ["followers_count"]), following: pick(me, ["follows_count"]), posts: pick(me, ["media_count"]),
      reach: ins ? metricTotal(ins, "reach") : null, views: ins ? metricTotal(ins, "views") : null,
      likes: ins ? metricTotal(ins, "likes") ?? metricTotal(ins, "total_interactions") : null, comments: ins ? metricTotal(ins, "comments") : null,
      recent: media.map((x) => ({ id: String(x.id), title: String(x.caption ?? "").slice(0, 160), url: pickStr(x, ["permalink"]), date: day(x.timestamp), type: pickStr(x, ["media_type"]), views: null, likes: n(x.like_count), comments: n(x.comments_count), shares: null })),
    };
  }

  if (p === "threads") {
    const me = await run("THREADS_GET_MY_PROFILE", { user_id: "me" });
    const fol = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["followers_count"] });
    const ins = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["views", "likes", "replies", "reposts"], since, until: now });
    const posts = findArray(await soft("THREADS_LIST_MY_POSTS", { user_id: "me", limit: 20 }), ["data", "posts", "threads"]);
    return {
      ...empty, name: pickStr(me, ["username", "name"]), followers: fol ? lastValue(fol, "followers_count") ?? pick(fol, ["followers_count"]) : null,
      views: ins ? metricTotal(ins, "views") : null, likes: ins ? metricTotal(ins, "likes") : null, comments: ins ? metricTotal(ins, "replies") : null, posts: posts.length || null,
      recent: posts.map((x) => ({ id: String(x.id), title: String(x.text ?? "").slice(0, 160), url: pickStr(x, ["permalink"]), date: day(x.timestamp), type: pickStr(x, ["media_type"]), views: null, likes: null, comments: null, shares: null })),
    };
  }

  if (p === "x") {
    const me = await run("TWITTER_USER_LOOKUP_ME", { user_fields: ["public_metrics", "username", "name"] });
    const u = (findArray({ w: [me] }, ["w"])[0] ?? {}) as Record<string, unknown>;
    const id = pickStr(u, ["id"]);
    const tweets = id ? findArray(await soft("TWITTER_GET_USER_POSTS", { id, max_results: 20, exclude: ["replies", "retweets"], tweet_fields: ["public_metrics", "created_at"] }), ["data", "tweets"]) : [];
    const username = pickStr(u, ["username"]);
    const views = tweets.map((t) => pick(t, ["impression_count"])).filter((x): x is number => x != null);
    return {
      ...empty, name: pickStr(u, ["name", "username"]), followers: pick(u, ["followers_count"]), following: pick(u, ["following_count"]), posts: pick(u, ["tweet_count"]), likes: pick(u, ["like_count"]),
      impressions: views.length ? views.reduce((a, b) => a + b, 0) : null,
      recent: tweets.map((t) => ({ id: String(t.id), title: String(t.text ?? "").slice(0, 160), url: username ? `https://x.com/${username}/status/${t.id}` : null, date: day(t.created_at),
        views: pick(t, ["impression_count"]), likes: pick(t, ["like_count"]), comments: pick(t, ["reply_count"]), shares: (pick(t, ["retweet_count"]) ?? 0) + (pick(t, ["quote_count"]) ?? 0) })),
    };
  }

  if (p === "linkedin") {
    let org = ctx.linkedinOrgId;
    if (!org) {
      const info = await run("LINKEDIN_GET_COMPANY_INFO", { role: "ADMINISTRATOR", state: "APPROVED", count: 10 });
      org = JSON.stringify(info).match(/urn:li:organization:(\d+)/)?.[1] ?? (pick(info, ["id"]) != null ? String(pick(info, ["id"])) : null);
      if (!org) throw new Error("The connected LinkedIn login isn't an admin of any company page.");
    }
    const urn = `urn:li:organization:${org}`;
    const size = await soft("LINKEDIN_GET_NETWORK_SIZE", { organization_id: org, edgeType: "COMPANY_FOLLOWED_BY_MEMBER" });
    const share = await soft("LINKEDIN_GET_SHARE_STATS", { organizational_entity: urn });
    const views = await soft("LINKEDIN_GET_ORG_PAGE_STATS", { organization: urn });
    return {
      ...empty, followers: size ? pick(size, ["firstDegreeSize", "first_degree_size"]) : null,
      impressions: share ? pick(share, ["impressionCount"]) : null, reach: share ? pick(share, ["uniqueImpressionsCount"]) : null,
      likes: share ? pick(share, ["likeCount"]) : null, comments: share ? pick(share, ["commentCount"]) : null,
      views: views ? pick(views, ["pageViews", "allPageViews"]) : null,
    };
  }

  if (p === "tiktok") {
    const u = await run("TIKTOK_GET_USER_STATS", { fields: ["display_name", "follower_count", "following_count", "likes_count", "video_count"] });
    const vids = findArray(await soft("TIKTOK_LIST_VIDEOS", { max_count: 20 }), ["videos", "data"]);
    const views = vids.map((v) => n(v.view_count)).filter((x): x is number => x != null);
    return {
      ...empty, name: pickStr(u, ["display_name"]), followers: pick(u, ["follower_count"]), following: pick(u, ["following_count"]), posts: pick(u, ["video_count"]), likes: pick(u, ["likes_count"]),
      views: views.length ? views.reduce((a, b) => a + b, 0) : null,
      recent: vids.map((v) => ({ id: String(v.id), title: String(v.title ?? v.video_description ?? "").slice(0, 160), url: pickStr(v, ["share_url"]), date: day(v.create_time), views: n(v.view_count), likes: n(v.like_count), comments: n(v.comment_count), shares: n(v.share_count) })),
    };
  }

  if (p === "pinterest") {
    const prof = await run("PINTEREST_GET_PROFILE", {});
    const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), start = new Date(Date.now() - (DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    const an = await soft("PINTEREST_GET_ACCOUNT_ANALYTICS", { start_date: start, end_date: end, metric_types: ["IMPRESSION", "ENGAGEMENT", "PIN_CLICK", "OUTBOUND_CLICK", "SAVE"] });
    const pins = findArray(await soft("PINTEREST_LIST_PINS", { page_size: 25, include_metrics: true }), ["items", "pins", "data"]);
    return {
      ...empty, name: pickStr(prof, ["business_name", "username"]), followers: pick(prof, ["follower_count"]), following: pick(prof, ["following_count"]), posts: pick(prof, ["pin_count"]),
      views: pick(prof, ["monthly_views"]), impressions: an ? pick(an, ["IMPRESSION"]) : null, likes: an ? pick(an, ["SAVE", "ENGAGEMENT"]) : null,
      recent: pins.map((x) => ({ id: String(x.id), title: String(x.title ?? x.description ?? "").slice(0, 160), url: `https://www.pinterest.com/pin/${x.id}/`, date: day(x.created_at),
        views: pick(x, ["IMPRESSION", "impression"]), likes: pick(x, ["SAVE", "save"]), comments: null, shares: pick(x, ["OUTBOUND_CLICK", "PIN_CLICK"]) })),
    };
  }

  // YouTube
  const ch = await run("YOUTUBE_GET_CHANNEL_STATISTICS", { mine: true, part: "snippet,statistics" });
  const item = findArray(ch, ["items", "channels"])[0] ?? (ch as Record<string, unknown>);
  return { ...empty, name: pickStr(item, ["title"]), followers: pick(item, ["subscriberCount"]), posts: pick(item, ["videoCount"]), views: pick(item, ["viewCount"]) };
}
