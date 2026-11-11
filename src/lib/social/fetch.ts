import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_UA } from "@/lib/blog/wordpress";
import { decryptSecret } from "@/lib/crypto";
import { assertBudget, BudgetError, recordSpend, type SpendSource } from "@/lib/dataforseo/budget";
import { dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { arr, num, obj, str } from "@/lib/dataforseo/research";
import { ProviderAuthError } from "@/lib/composio/client";
import { readComposioStats, socialConnections, type SocialConnection } from "./composio";
import { tregConfigured, tregProfile, tregSupports } from "./treg";
import { handleOf, PLATFORM_INFO, PLATFORMS, platformOf, type Platform, type SocialProfiles } from "./platforms";

/**
 * Social media stats, one dfs_cache row per platform (endpoint "social", params_hash = platform), so a client
 * never has more than 8 rows. Each row keeps its own snapshot history (one point per day, last 120) for trends.
 *  - YouTube: YouTube Data API v3 when a key is set (free quota), else DataForSEO YouTube SERP (≈$0.002 per
 *    search, ≈$0.006 per video_info) through the daily budget.
 *  - Facebook, Instagram, Threads, X, LinkedIn, Pinterest, TikTok: the platforms' own official APIs, which all
 *    need a token from the account owner; until one is added the row says exactly what is needed.
 * Nothing is scraped from the platforms themselves.
 */
export const SOCIAL_ENDPOINT = "social";
export const YT_SEARCH_EST = 0.0025;
export const YT_INFO_EST = 0.0065;
export const YT_INFO_MAX = 8;
export const YT_RANK_KEYWORDS = 5;
/** worst case of one YouTube refresh through DataForSEO */
export const SOCIAL_EST = YT_SEARCH_EST * (1 + YT_RANK_KEYWORDS) + YT_INFO_EST * YT_INFO_MAX;
const HISTORY_MAX = 120;

export interface SocialPost {
  id: string; title: string; url: string | null; date: string | null; type?: string | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
}
export interface SocialRanking { keyword: string; position: number | null; title: string | null; url: string | null; total: number }
export interface SocialPoint { date: string; followers: number | null; posts: number | null; views: number | null; engagement: number | null }
export interface SocialRow {
  platform: Platform; status: "ok" | "needs" | "no_profile" | "error"; source: string | null;
  url: string | null; needs?: string; error?: string; fetchedAt: string;
  profile: { name: string | null; followers: number | null; posts: number | null; views: number | null; likes: number | null; following?: number | null; impressions?: number | null; reach?: number | null; comments?: number | null };
  /** "connected" = the client's own account through Composio (private analytics); "public" = public numbers only */
  mode?: "connected" | "token" | "public";
  posts: SocialPost[]; rankings?: SocialRanking[]; history: SocialPoint[]; cost: number;
}

type Ctx = { admin: SupabaseClient; clientId: string; source: SpendSource };
type Fetched = Pick<SocialRow, "profile" | "posts" | "source"> & { rankings?: SocialRanking[]; cost?: number; newSecret?: string };

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

class NeedsError extends Error {}

async function getJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.status === 401 || r.status === 403) {
    const msg = str(obj(j?.error).message) ?? str(j?.detail) ?? str(j?.message) ?? `HTTP ${r.status}`;
    throw new NeedsError(`The token was refused (${msg.slice(0, 160)}). Add a fresh one.`);
  }
  if (!r.ok || !j) throw new Error(str(obj(j?.error).message) ?? str(j?.detail) ?? str(j?.message) ?? `HTTP ${r.status}`);
  return j;
}

/* ------------------------------------------------------------------ settings */
export async function clientSocial(admin: SupabaseClient, clientId: string): Promise<{ profiles: SocialProfiles; tokens: Partial<Record<Platform, string>>; settings: Record<string, unknown> }> {
  const { data } = await admin.from("clients").select("settings").eq("id", clientId).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  return { profiles: (settings.social_profiles ?? {}) as SocialProfiles, tokens: (settings.social_tokens ?? {}) as Partial<Record<Platform, string>>, settings };
}

/** The client's own token (decrypted), else the agency-wide env var. Instagram falls back to the Facebook Page token. */
function secretFor(p: Platform, tokens: Partial<Record<Platform, string>>): string | null {
  const own = (k: Platform) => { try { return tokens[k] ? decryptSecret(tokens[k]!) : null; } catch { return null; } };
  const env = (k: Platform) => process.env[PLATFORM_INFO[k].env]?.trim() || null;
  if (p === "instagram") return own("instagram") ?? own("facebook") ?? env("facebook");
  return own(p) ?? env(p);
}

/* ------------------------------------------------------------------ profile discovery (free) */
/** Reads the client's home, contact and about pages for profile links and schema.org sameAs (free, honest UA). */
export async function discoverProfiles(domain: string): Promise<SocialProfiles> {
  const found: SocialProfiles = {};
  for (const path of ["/", "/contact/", "/about/", "/about-us/"]) {
    let html = "";
    try {
      const r = await fetch(`https://${domain}${path}`, { headers: { "user-agent": BOT_UA }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      html = await r.text();
    } catch { continue; }
    const urls = new Set<string>();
    for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) urls.add(m[1]);
    for (const m of html.matchAll(/"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
      try { const v = JSON.parse(m[1]) as string | string[]; for (const u of Array.isArray(v) ? v : [v]) urls.add(u); } catch { /* skip */ }
    }
    for (const raw of urls) {
      const u = raw.replace(/\\\//g, "/").trim();
      if (!/^https?:\/\//i.test(u)) continue;
      const p = platformOf(u);
      if (p && !found[p] && handleOf(u)) found[p] = u.split("?")[0];
    }
  }
  return found;
}

/* ------------------------------------------------------------------ YouTube */
type YtVideo = { id: string; title: string; url: string; date: string | null; views: number | null; likes: number | null; comments: number | null; channelId: string | null };

async function youtubeDataApi(key: string, url: string, keywords: string[]): Promise<Fetched> {
  const base = "https://www.googleapis.com/youtube/v3";
  const h = handleOf(url);
  const byId = /\/channel\//.test(url) && h ? `id=${encodeURIComponent(h)}` : h ? `forHandle=${encodeURIComponent(h.startsWith("@") ? h : `@${h}`)}` : null;
  if (!byId) throw new Error("The YouTube URL has no channel handle.");
  let ch: Record<string, unknown>;
  try { ch = await getJson(`${base}/channels?part=snippet,statistics,contentDetails&${byId}&key=${key}`); }
  catch (e) { if (e instanceof NeedsError) throw new NeedsError("The Google API key can't call YouTube: enable \"YouTube Data API v3\" for it in Google Cloud (APIs & Services) and allow it in the key's API restrictions."); throw e; }
  const c = obj(arr(ch.items)[0]);
  if (!c.id) throw new Error("YouTube found no channel for that URL.");
  const stats = obj(c.statistics);
  const uploads = str(obj(obj(obj(c.contentDetails).relatedPlaylists)).uploads);
  const ids = uploads ? arr((await getJson(`${base}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&key=${key}`)).items).map((i) => str(obj(i.contentDetails).videoId)).filter((x): x is string => Boolean(x)) : [];
  const vids: YtVideo[] = ids.length ? arr((await getJson(`${base}/videos?part=snippet,statistics&id=${ids.join(",")}&key=${key}`)).items).map((v) => {
    const s = obj(v.statistics), sn = obj(v.snippet);
    return { id: String(v.id), title: str(sn.title) ?? "", url: `https://www.youtube.com/watch?v=${v.id}`, date: str(sn.publishedAt)?.slice(0, 10) ?? null, views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount), channelId: String(c.id) };
  }) : [];
  const rankings: SocialRanking[] = [];
  for (const kw of keywords) {
    const res = arr((await getJson(`${base}/search?part=snippet&type=video&maxResults=50&regionCode=US&q=${encodeURIComponent(kw)}&key=${key}`)).items);
    const idx = res.findIndex((r) => str(obj(r.snippet).channelId) === c.id);
    const hit = idx >= 0 ? obj(res[idx]) : null;
    const vid = hit ? str(obj(hit.id).videoId) : null;
    rankings.push({ keyword: kw, position: idx >= 0 ? idx + 1 : null, title: hit ? str(obj(hit.snippet).title) : null, url: vid ? `https://www.youtube.com/watch?v=${vid}` : null, total: res.length });
  }
  return {
    source: "YouTube Data API v3",
    profile: { name: str(obj(c.snippet).title), followers: stats.hiddenSubscriberCount ? null : n(stats.subscriberCount), posts: n(stats.videoCount), views: n(stats.viewCount), likes: sum(vids.map((v) => v.likes)) },
    posts: vids.map((v) => ({ id: v.id, title: v.title, url: v.url, date: v.date, views: v.views, likes: v.likes, comments: v.comments, shares: null })),
    rankings,
  };
}

async function dfsYoutube(ctx: Ctx, url: string, keywords: string[]): Promise<Fetched> {
  if (!dfsConfigured()) throw new NeedsError("DataForSEO isn't configured, and no YouTube Data API key is set.");
  let cost = 0;
  const search = async (keyword: string) => {
    await assertBudget(ctx.admin, ctx.clientId, YT_SEARCH_EST, ctx.source);
    const r = await dfsPost("/serp/youtube/organic/live/advanced", { keyword, location_code: 2840, language_code: "en" });
    cost += r.cost; await recordSpend(ctx.admin, ctx.clientId, "yt_organic", r.cost, ctx.source);
    return arr(r.result?.items);
  };
  const handle = handleOf(url) ?? "";
  // search for the channel handle: the channel card plus its videos
  const items = await search(handle.replace(/^@/, ""));
  const wantedUrl = (u: unknown) => typeof u === "string" && handleOf(u)?.toLowerCase() === handle.toLowerCase();
  const card = items.find((i) => i.type === "youtube_channel" && (wantedUrl(i.url) || i.channel_id === handle));
  const channelId = str(card?.channel_id) ?? str(items.find((i) => i.type === "youtube_video" && wantedUrl(i.channel_url))?.channel_id);
  if (!channelId) throw new Error(`YouTube search found no channel for ${handle}. Check the profile URL.`);
  const found = new Map<string, YtVideo>();
  for (const i of items) {
    if (i.type !== "youtube_video" || i.channel_id !== channelId || !str(i.video_id)) continue;
    found.set(String(i.video_id), { id: String(i.video_id), title: str(i.title) ?? "", url: `https://www.youtube.com/watch?v=${i.video_id}`, date: str(i.timestamp)?.slice(0, 10) ?? null, views: num(i.views_count), likes: null, comments: null, channelId });
  }
  // rankings for the client's tracked keywords
  const rankings: SocialRanking[] = [];
  try {
    for (const kw of keywords) {
      const res = (await search(kw)).filter((i) => i.type === "youtube_video");
      const idx = res.findIndex((i) => i.channel_id === channelId);
      const hit = idx >= 0 ? res[idx] : null;
      rankings.push({ keyword: kw, position: idx >= 0 ? idx + 1 : null, title: hit ? str(hit.title) : null, url: hit ? `https://www.youtube.com/watch?v=${hit.video_id}` : null, total: res.length });
      if (hit && str(hit.video_id) && !found.has(String(hit.video_id))) found.set(String(hit.video_id), { id: String(hit.video_id), title: str(hit.title) ?? "", url: `https://www.youtube.com/watch?v=${hit.video_id}`, date: str(hit.timestamp)?.slice(0, 10) ?? null, views: num(hit.views_count), likes: null, comments: null, channelId });
    }
  } catch (e) { if (!(e instanceof BudgetError)) throw e; }
  // likes, comments and the subscriber count for the newest videos
  let subscribers: number | null = null;
  const vids = [...found.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  try {
    for (const v of vids.slice(0, YT_INFO_MAX)) {
      await assertBudget(ctx.admin, ctx.clientId, YT_INFO_EST, ctx.source);
      const r = await dfsPost("/serp/youtube/video_info/live/advanced", { video_id: v.id, location_code: 2840, language_code: "en" });
      cost += r.cost; await recordSpend(ctx.admin, ctx.clientId, "yt_video_info", r.cost, ctx.source);
      const info = obj(arr(r.result?.items)[0]);
      v.views = num(info.views_count) ?? v.views; v.likes = num(info.likes_count); v.comments = num(info.comments_count);
      v.date = str(info.timestamp)?.slice(0, 10) ?? v.date;
      subscribers = num(obj(info.channel_subscribers_count).count) ?? subscribers;
    }
  } catch (e) { if (!(e instanceof BudgetError)) throw e; }
  return {
    source: "DataForSEO YouTube search",
    profile: { name: str(card?.name) ?? str(items.find((i) => i.channel_id === channelId)?.channel_name), followers: subscribers, posts: num(card?.video_count) || vids.length, views: sum(vids.map((v) => v.views)), likes: sum(vids.map((v) => v.likes)) },
    posts: vids.map((v) => ({ id: v.id, title: v.title, url: v.url, date: v.date, views: v.views, likes: v.likes, comments: v.comments, shares: null })),
    rankings, cost,
  };
}

/* ------------------------------------------------------------------ Meta: Facebook, Instagram, Threads */
const GRAPH = "https://graph.facebook.com/v23.0";

async function facebook(token: string): Promise<Fetched> {
  const t = encodeURIComponent(token);
  const page = await getJson(`${GRAPH}/me?fields=id,name,followers_count,fan_count,link&access_token=${t}`);
  const posts = arr((await getJson(`${GRAPH}/me/posts?fields=id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)&limit=25&access_token=${t}`)).data);
  return {
    source: "Facebook Graph API",
    profile: { name: str(page.name), followers: n(page.followers_count), posts: null, views: null, likes: n(page.fan_count) },
    posts: posts.map((p) => ({
      id: String(p.id), title: (str(p.message) ?? "").slice(0, 160), url: str(p.permalink_url), date: str(p.created_time)?.slice(0, 10) ?? null,
      views: null, likes: n(obj(obj(p.reactions).summary).total_count), comments: n(obj(obj(p.comments).summary).total_count), shares: n(obj(p.shares).count),
    })),
  };
}

async function instagram(token: string): Promise<Fetched> {
  const t = encodeURIComponent(token);
  const me = await getJson(`${GRAPH}/me?fields=instagram_business_account&access_token=${t}`);
  const igId = str(obj(me.instagram_business_account).id);
  if (!igId) throw new NeedsError("The Facebook Page has no linked Instagram Business/Creator account (or the token lacks instagram_basic).");
  const ig = await getJson(`${GRAPH}/${igId}?fields=username,followers_count,follows_count,media_count&access_token=${t}`);
  const media = arr((await getJson(`${GRAPH}/${igId}/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=25&access_token=${t}`)).data);
  return {
    source: "Instagram Graph API",
    profile: { name: str(ig.username), followers: n(ig.followers_count), following: n(ig.follows_count), posts: n(ig.media_count), views: null, likes: sum(media.map((m) => n(m.like_count))) },
    posts: media.map((m) => ({ id: String(m.id), title: (str(m.caption) ?? "").slice(0, 160), url: str(m.permalink), date: str(m.timestamp)?.slice(0, 10) ?? null, type: str(m.media_type), views: null, likes: n(m.like_count), comments: n(m.comments_count), shares: null })),
  };
}

async function threads(token: string): Promise<Fetched> {
  const base = "https://graph.threads.net/v1.0";
  // long-lived tokens last 60 days; refreshing one that is at least a day old extends it
  let tok = token, newSecret: string | undefined;
  try {
    const r = await getJson(`${base}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (str(r.access_token) && r.access_token !== token) { tok = String(r.access_token); newSecret = tok; }
  } catch { /* too new to refresh, or refused: use as is */ }
  const t = encodeURIComponent(tok);
  const me = await getJson(`${base}/me?fields=id,username&access_token=${t}`);
  const ins = arr((await getJson(`${base}/me/threads_insights?metric=followers_count,views,likes,replies,reposts&access_token=${t}`)).data);
  const metric = (name: string) => { const m = ins.find((x) => x.name === name); return n(obj(m?.total_value).value) ?? sum(arr(m?.values).map((v) => n(v.value))); };
  const list = arr((await getJson(`${base}/me/threads?fields=id,text,permalink,timestamp,media_type&limit=20&access_token=${t}`)).data);
  const posts: SocialPost[] = [];
  for (const p of list.slice(0, 10)) {
    let m: Record<string, unknown>[] = [];
    try { m = arr((await getJson(`${base}/${p.id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${t}`)).data); } catch { /* keep the post without numbers */ }
    const v = (k: string) => n(arr(m.find((x) => x.name === k)?.values)[0]?.value);
    posts.push({ id: String(p.id), title: (str(p.text) ?? "").slice(0, 160), url: str(p.permalink), date: str(p.timestamp)?.slice(0, 10) ?? null, type: str(p.media_type), views: v("views"), likes: v("likes"), comments: v("replies"), shares: (v("reposts") ?? 0) + (v("quotes") ?? 0) });
  }
  return { source: "Threads API", profile: { name: str(me.username), followers: metric("followers_count"), posts: list.length || null, views: metric("views"), likes: metric("likes") }, posts, newSecret };
}

/* ------------------------------------------------------------------ X, LinkedIn, Pinterest, TikTok */
async function xApi(token: string, url: string): Promise<Fetched> {
  const h = handleOf(url)?.replace(/^@/, "");
  if (!h) throw new Error("The X profile URL has no username.");
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const u = obj((await getJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(h)}?user.fields=public_metrics,name`, auth)).data);
  const pm = obj(u.public_metrics);
  const tw = arr((await getJson(`https://api.x.com/2/users/${u.id}/tweets?max_results=20&exclude=replies,retweets&tweet.fields=public_metrics,created_at`, auth)).data);
  return {
    source: "X API v2",
    profile: { name: str(u.name), followers: n(pm.followers_count), following: n(pm.following_count), posts: n(pm.tweet_count), views: sum(tw.map((t) => n(obj(t.public_metrics).impression_count))), likes: n(pm.like_count) },
    posts: tw.map((t) => { const m = obj(t.public_metrics); return { id: String(t.id), title: (str(t.text) ?? "").slice(0, 160), url: `https://x.com/${h}/status/${t.id}`, date: str(t.created_at)?.slice(0, 10) ?? null, views: n(m.impression_count), likes: n(m.like_count), comments: n(m.reply_count), shares: (n(m.retweet_count) ?? 0) + (n(m.quote_count) ?? 0) }; }),
  };
}

async function linkedin(token: string, url: string, orgId: string | null): Promise<Fetched> {
  const headers = { Authorization: `Bearer ${token}`, "LinkedIn-Version": "202510", "X-Restli-Protocol-Version": "2.0.0" };
  let id = orgId;
  if (!id) {
    const vanity = handleOf(url);
    if (!vanity) throw new Error("The LinkedIn page URL has no company name.");
    const r = await getJson(`https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(vanity)}`, { headers });
    id = String(obj(arr(r.elements)[0]).id ?? "");
    if (!id) throw new Error("LinkedIn found no company page for that URL.");
  }
  const urn = encodeURIComponent(`urn:li:organization:${id}`);
  const size = await getJson(`https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers });
  const stats = obj(obj(arr((await getJson(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}`, { headers })).elements)[0]).totalShareStatistics);
  const list = arr((await getJson(`https://api.linkedin.com/rest/posts?author=${urn}&q=author&count=20`, { headers })).elements);
  return {
    source: "LinkedIn Community Management API",
    profile: { name: null, followers: n(size.firstDegreeSize), posts: list.length || null, views: n(stats.impressionCount), likes: n(stats.likeCount) },
    posts: list.map((p) => ({ id: String(p.id), title: (str(p.commentary) ?? "").slice(0, 160), url: `https://www.linkedin.com/feed/update/${p.id}`, date: typeof p.publishedAt === "number" ? new Date(p.publishedAt).toISOString().slice(0, 10) : null, views: null, likes: null, comments: null, shares: null })),
  };
}

async function pinterest(token: string): Promise<Fetched> {
  const headers = { Authorization: `Bearer ${token}` };
  const u = await getJson("https://api.pinterest.com/v5/user_account", { headers });
  const pins = arr((await getJson("https://api.pinterest.com/v5/pins?page_size=25", { headers })).items);
  return {
    source: "Pinterest API v5",
    profile: { name: str(u.business_name) ?? str(u.username), followers: n(u.follower_count), following: n(u.following_count), posts: n(u.pin_count), views: n(u.monthly_views), likes: null },
    posts: pins.map((p) => ({ id: String(p.id), title: (str(p.title) ?? str(p.description) ?? "").slice(0, 160), url: `https://www.pinterest.com/pin/${p.id}/`, date: str(p.created_at)?.slice(0, 10) ?? null, views: null, likes: null, comments: null, shares: null })),
  };
}

async function tiktok(refreshToken: string): Promise<Fetched> {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim(), secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!key || !secret) throw new NeedsError("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (TikTok for Developers app) so the refresh token can be used.");
  const tok = await getJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  const access = str(tok.access_token);
  if (!access) throw new NeedsError(`TikTok refused the refresh token (${str(tok.error_description) ?? str(tok.error) ?? "unknown"}). Log in again to get a new one.`);
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
  const user = obj(obj((await getJson("https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,following_count,likes_count,video_count", { headers })).data).user);
  const vids = arr(obj((await getJson("https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count", { method: "POST", headers, body: JSON.stringify({ max_count: 20 }) })).data).videos);
  return {
    source: "TikTok Display API",
    profile: { name: str(user.display_name), followers: n(user.follower_count), following: n(user.following_count), posts: n(user.video_count), views: sum(vids.map((v) => n(v.view_count))), likes: n(user.likes_count) },
    posts: vids.map((v) => ({ id: String(v.id), title: (str(v.title) ?? str(v.video_description) ?? "").slice(0, 160), url: str(v.share_url), date: typeof v.create_time === "number" ? new Date(v.create_time * 1000).toISOString().slice(0, 10) : null, views: n(v.view_count), likes: n(v.like_count), comments: n(v.comment_count), shares: n(v.share_count) })),
    // TikTok rotates refresh tokens: keep the new one
    newSecret: str(tok.refresh_token) && tok.refresh_token !== refreshToken ? String(tok.refresh_token) : undefined,
  };
}

/* ------------------------------------------------------------------ refresh + storage */
async function trackedKeywords(admin: SupabaseClient, clientId: string): Promise<string[]> {
  const { data } = await admin.from("rank_keywords").select("keyword, created_at").eq("client_id", clientId).order("created_at", { ascending: true }).limit(100);
  return [...new Set((data ?? []).map((r) => String(r.keyword).toLowerCase()))].slice(0, YT_RANK_KEYWORDS);
}

export const engagementOf = (posts: SocialPost[]) => (posts.length ? sum(posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0))) : null);

async function previous(admin: SupabaseClient, clientId: string, p: Platform): Promise<SocialRow | null> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", SOCIAL_ENDPOINT).eq("params_hash", p).maybeSingle();
  return (data?.data as SocialRow | null) ?? null;
}

async function save(admin: SupabaseClient, clientId: string, row: SocialRow) {
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: SOCIAL_ENDPOINT, params_hash: row.platform, params: { platform: row.platform, url: row.url }, data: row, row_count: row.posts.length, cost: row.cost, fetched_at: row.fetchedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
}

/** The client's social accounts connected through Composio (empty when none or Composio is unreachable). */
export async function connectedAccounts(clientId: string): Promise<SocialConnection[]> {
  try { return (await socialConnections(clientId)).filter((c) => c.status === "ACTIVE"); } catch { return []; }
}

async function viaComposio(ctx: Ctx, p: Platform, acc: SocialConnection, url: string | null, linkedinOrgId: string | null): Promise<Fetched> {
  let st;
  try { st = await readComposioStats(ctx.clientId, p, acc.id, { url, linkedinOrgId }); }
  catch (e) { if (e instanceof ProviderAuthError) throw new NeedsError(`The ${PLATFORM_INFO[p].label} connection expired or was revoked. Press Connect to log in again.`); throw e; }
  return {
    source: "Composio (connected)",
    profile: { name: st.name, followers: st.followers, following: st.following, posts: st.posts, views: st.views ?? st.impressions, likes: st.likes, impressions: st.impressions, reach: st.reach, comments: st.comments },
    posts: st.recent,
  };
}

async function viaTreg(ctx: Ctx, p: Platform, url: string): Promise<Fetched> {
  const t = await tregProfile(p, url);
  await recordSpend(ctx.admin, ctx.clientId, `treg_${p}`, t.cost, ctx.source);
  return { source: "Public profile (treg.to)", profile: { name: t.name, followers: t.followers, following: t.following, posts: t.posts, views: null, likes: t.likes }, posts: t.recent, cost: t.cost };
}

/** Refreshes one platform and stores it (with the day's point appended to its history). */
export async function refreshPlatform(ctx: Ctx, p: Platform, social?: Awaited<ReturnType<typeof clientSocial>>, accounts?: SocialConnection[]): Promise<SocialRow> {
  const s = social ?? (await clientSocial(ctx.admin, ctx.clientId));
  const acc = (accounts ?? (await connectedAccounts(ctx.clientId))).find((a) => a.platform === p);
  const prev = await previous(ctx.admin, ctx.clientId, p);
  const url = s.profiles[p] ?? null;
  const now = new Date().toISOString();
  const base: SocialRow = { platform: p, status: "ok", source: null, url, fetchedAt: now, profile: prev?.profile ?? { name: null, followers: null, posts: null, views: null, likes: null }, posts: prev?.posts ?? [], rankings: prev?.rankings, history: prev?.history ?? [], cost: 0 };
  let row: SocialRow;
  if (!url && p !== "instagram" && !acc) row = { ...base, status: "no_profile" };
  else {
    const token = secretFor(p, s.tokens);
    let mode: SocialRow["mode"] = "token";
    try {
      let f: Fetched;
      // 1. the client's own account connected through Composio: private analytics
      if (acc) {
        mode = "connected";
        try { f = await viaComposio(ctx, p, acc, url, typeof s.settings.linkedin_org_id === "string" ? s.settings.linkedin_org_id : null); }
        catch (e) { if (url && tregConfigured() && tregSupports(p) && !token) { mode = "public"; f = await viaTreg(ctx, p, url); f.source = `${f.source}; connected analytics pending`; } else throw e; }
      }
      // 2. a pasted token (old setup) or YouTube's own path
      else if (p === "youtube") f = token ? await youtubeDataApi(token, url!, await trackedKeywords(ctx.admin, ctx.clientId)) : await dfsYoutube(ctx, url!, await trackedKeywords(ctx.admin, ctx.clientId));
      // 3. nothing connected: public numbers through treg.to
      else if (!token && url && tregConfigured() && tregSupports(p)) { mode = "public"; f = await viaTreg(ctx, p, url); }
      else if (!token) throw new NeedsError(`Press Connect and log in to ${PLATFORM_INFO[p].label} to read its analytics.`);
      else if (p === "facebook") f = await facebook(token);
      else if (p === "instagram") f = await instagram(token);
      else if (p === "threads") f = await threads(token);
      else if (p === "x") f = await xApi(token, url!);
      else if (p === "linkedin") f = await linkedin(token, url!, typeof s.settings.linkedin_org_id === "string" ? s.settings.linkedin_org_id : null);
      else if (p === "pinterest") f = await pinterest(token);
      else f = await tiktok(token);
      if (f.newSecret && s.tokens[p]) {
        const { encryptSecret } = await import("@/lib/crypto");
        const { settings } = await clientSocial(ctx.admin, ctx.clientId);
        await ctx.admin.from("clients").update({ settings: { ...settings, social_tokens: { ...((settings.social_tokens ?? {}) as object), [p]: encryptSecret(f.newSecret) } } }).eq("id", ctx.clientId);
      }
      const day = now.slice(0, 10);
      const point: SocialPoint = { date: day, followers: f.profile.followers, posts: f.profile.posts, views: f.profile.views, engagement: engagementOf(f.posts) };
      const history = [...base.history.filter((h) => h.date !== day), point].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_MAX);
      row = { ...base, status: "ok", mode, source: f.source, profile: f.profile, posts: f.posts.length || mode !== "connected" ? f.posts : base.posts, rankings: f.rankings ?? base.rankings, history, cost: Number((f.cost ?? 0).toFixed(4)) };
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      row = e instanceof NeedsError ? { ...base, status: "needs", needs: e.message } : { ...base, status: "error", error: (e instanceof Error ? e.message : "failed").slice(0, 300) };
      // keep the time of the last good read so the weekly schedule retries an error the next day
      if (row.status === "error" && prev?.status === "ok") row.fetchedAt = prev.fetchedAt;
    }
  }
  await save(ctx.admin, ctx.clientId, row);
  return row;
}

/** Every platform in turn. A budget stop leaves the rest for the next run. */
export async function refreshSocial(ctx: Ctx, only?: Platform[]): Promise<{ rows: SocialRow[]; cost: number; stoppedByBudget: boolean }> {
  const social = await clientSocial(ctx.admin, ctx.clientId);
  const accounts = await connectedAccounts(ctx.clientId);
  const rows: SocialRow[] = [];
  let stoppedByBudget = false;
  for (const p of only ?? PLATFORMS) {
    try { rows.push(await refreshPlatform(ctx, p, social, accounts)); }
    catch (e) { if (e instanceof BudgetError) { stoppedByBudget = true; break; } throw e; }
  }
  return { rows, cost: rows.reduce((a, r) => a + r.cost, 0), stoppedByBudget };
}

/** Reading only (no API calls). */
export async function loadSocial(supabase: SupabaseClient, clientId: string): Promise<Partial<Record<Platform, SocialRow>>> {
  const { data } = await supabase.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", SOCIAL_ENDPOINT).limit(20);
  const out: Partial<Record<Platform, SocialRow>> = {};
  for (const r of data ?? []) if (r.data && (PLATFORMS as readonly string[]).includes(String(r.params_hash))) out[r.params_hash as Platform] = r.data as SocialRow;
  return out;
}

/** Which platforms have a token configured (never the token itself). */
export function tokenState(tokens: Partial<Record<Platform, string>>): Record<Platform, "client" | "env" | null> {
  const out = {} as Record<Platform, "client" | "env" | null>;
  for (const p of PLATFORMS) {
    const env = p === "instagram" ? PLATFORM_INFO.facebook.env : PLATFORM_INFO[p].env;
    out[p] = tokens[p] || (p === "instagram" && tokens.facebook) ? "client" : process.env[env]?.trim() ? "env" : null;
  }
  return out;
}
