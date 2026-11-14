import "server-only";
import { executeTool, ProviderRateLimitError } from "@/lib/composio/client";
import { entityId } from "./composio";
import { handleOf, type Platform } from "./platforms";
import type { MetricKey, SocialDemo, SocialPost, SocialSeries } from "./metrics";
import { findArray, pick, pickStr } from "./treg";

/**
 * Reads one connected platform through Composio's read-only tools. Every number comes straight from the
 * platform's API; a metric the account or its permissions can't provide is left out (and named in `notes`),
 * never estimated. Daily series cover up to the last 90 days where the platform offers a daily breakdown.
 */
export interface ComposioRead {
  name: string | null; followers: number | null; following: number | null; posts: number | null;
  /** totals over the last 28 days, as returned by the platform (non-additive metrics like reach included) */
  totals: Partial<Record<MetricKey, number>>;
  series: SocialSeries;
  demographics: SocialDemo[];
  recent: SocialPost[];
  notes: string[];
}

const DAY_S = 86_400;
const unwrap = (d: unknown): unknown => (d && typeof d === "object" && "response_data" in d ? (d as { response_data: unknown }).response_data : d);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : typeof v === "number" ? iso(v > 1e12 ? v : v * 1000) : null);
/** Graph "end_time" marks the end of the day the value belongs to. */
const graphDay = (end: unknown) => (typeof end === "string" ? iso(Date.parse(end) - 1000) : null);
const add = (s: SocialSeries, k: MetricKey, date: string | null, v: number | null) => {
  if (!date || v == null) return;
  const arr = (s[k] ??= []);
  const hit = arr.find((x) => x.date === date);
  if (hit) hit.value = v; else arr.push({ date, value: v });
};
const sortSeries = (s: SocialSeries) => { for (const k of Object.keys(s) as MetricKey[]) s[k]!.sort((a, b) => a.date.localeCompare(b.date)); return s; };

/** Graph-style insights ({ data: [{ name, values: [{ value, end_time }], total_value }] }). */
function graphMetrics(data: unknown): { name: string; values: { date: string | null; value: number | null }[]; total: number | null; breakdown: Record<string, unknown>[] }[] {
  return findArray(data, ["data", "metrics", "insights"]).map((m) => ({
    name: String(m.name ?? m.metric ?? ""),
    values: (Array.isArray(m.values) ? (m.values as Record<string, unknown>[]) : []).map((v) => ({ date: graphDay(v.end_time), value: n(v.value) })),
    total: n((m.total_value as Record<string, unknown> | undefined)?.value),
    breakdown: findArray(m.total_value, ["breakdowns"]),
  }));
}

/** YouTube Analytics result table → rows keyed by column name. */
function ytRows(data: unknown): Record<string, unknown>[] {
  const heads = findArray(data, ["columnHeaders"]).map((h) => String(h.name));
  const rows = (data && typeof data === "object" ? ((data as Record<string, unknown>).rows ?? findArray(data, ["rows"])) : []) as unknown[];
  return Array.isArray(rows) ? rows.filter(Array.isArray).map((r) => Object.fromEntries(heads.map((h, i) => [h, (r as unknown[])[i]]))) : [];
}

export async function readComposio(clientId: string, p: Platform, connectedAccountId: string, ctx: { url: string | null; linkedinOrgId: string | null; knownPosts: SocialPost[] }): Promise<ComposioRead> {
  const notes: string[] = [];
  const run = async (slug: string, args: Record<string, unknown>) => unwrap(await executeTool({ slug, arguments: args, userId: entityId(clientId), connectedAccountId, timeoutMs: 60_000 }));
  /** an optional read: a refusal becomes a note, a rate limit stops the whole refresh (kept for the next run) */
  const soft = async (slug: string, args: Record<string, unknown>, what: string) => {
    try { return await run(slug, args); }
    catch (e) {
      if (e instanceof ProviderRateLimitError) throw e;
      notes.push(`${what} isn't available for this account (${(e instanceof Error ? e.message : "refused").replace(/^[A-Z_]+:\s*/, "").slice(0, 120)}).`);
      return null;
    }
  };
  const now = Math.floor(Date.now() / 1000);
  const out: ComposioRead = { name: null, followers: null, following: null, posts: null, totals: {}, series: {}, demographics: [], recent: [], notes };

  if (p === "facebook") {
    const pages = findArray(await run("FACEBOOK_LIST_MANAGED_PAGES", { fields: "id,name,username,link,followers_count,fan_count", limit: 100 }), ["data", "pages"]);
    if (!pages.length) throw new Error("The connected Facebook login manages no Pages. Log in with an admin of the business Page.");
    const h = (handleOf(ctx.url ?? "") ?? "").toLowerCase();
    const page = pages.find((x) => h && [x.username, x.id, String(x.link ?? "").split("/").filter(Boolean).pop()].some((v) => String(v ?? "").toLowerCase() === h)) ?? pages[0];
    const pageId = String(page.id);
    out.name = pickStr(page, ["name"]); out.followers = n(page.followers_count) ?? n(page.fan_count);
    const daily = await soft("FACEBOOK_GET_PAGE_INSIGHTS", { page_id: pageId, period: "day", since: String(now - 90 * DAY_S), until: String(now),
      metrics: "page_follows,page_daily_follows_unique,page_daily_unfollows_unique,page_media_view,page_post_engagements,page_video_views,page_total_actions" }, "Page insights");
    const map: Record<string, MetricKey> = { page_follows: "followers", page_daily_follows_unique: "new_followers", page_daily_unfollows_unique: "unfollows", page_media_view: "views", page_post_engagements: "engagement", page_video_views: "video_views", page_total_actions: "clicks" };
    for (const m of graphMetrics(daily)) { const k = map[m.name]; if (k) for (const v of m.values) add(out.series, k, v.date, v.value); }
    const reach = await soft("FACEBOOK_GET_PAGE_INSIGHTS", { page_id: pageId, period: "days_28", metrics: "page_total_media_view_unique" }, "28-day reach");
    const r = graphMetrics(reach).find((m) => m.name === "page_total_media_view_unique");
    const rv = r?.values.at(-1)?.value ?? r?.total ?? null;
    if (rv != null) out.totals.reach = rv;
    const posts = findArray(await soft("FACEBOOK_GET_PAGE_POSTS", { page_id: pageId, limit: 50, fields: "id,message,created_time,permalink_url,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }, "Page posts"), ["data", "posts"]);
    out.recent = posts.map((x) => ({ id: String(x.id), title: String(x.message ?? "").slice(0, 160), url: pickStr(x, ["permalink_url"]), date: day(x.created_time), type: pickStr(x, ["status_type"]),
      views: null, likes: pick(x.reactions, ["total_count"]), comments: pick(x.comments, ["total_count"]), shares: pick(x.shares, ["count"]) }));
  }

  else if (p === "instagram") {
    const me = (await run("INSTAGRAM_GET_USER_INFO", { ig_user_id: "me", fields: "id,username,name,followers_count,follows_count,media_count" })) as Record<string, unknown>;
    const ig = pickStr(me, ["id"]) ?? undefined;
    out.name = pickStr(me, ["username", "name"]); out.followers = pick(me, ["followers_count"]); out.following = pick(me, ["follows_count"]); out.posts = pick(me, ["media_count"]);
    // daily reach and follower change: Instagram serves at most 30 days per call
    for (let w = 0; w < 3; w++) {
      const until = now - w * 30 * DAY_S, since = until - 30 * DAY_S;
      const ts = await soft("INSTAGRAM_GET_USER_INSIGHTS", { ig_user_id: ig, metric: w === 0 ? ["reach", "follower_count"] : ["reach"], period: "day", metric_type: "time_series", since, until }, "Daily reach");
      if (!ts) break;
      for (const m of graphMetrics(ts)) for (const v of m.values) add(out.series, m.name === "follower_count" ? "new_followers" : "reach", v.date, v.value);
    }
    const tot = await soft("INSTAGRAM_GET_USER_INSIGHTS", { ig_user_id: ig, period: "day", metric_type: "total_value", since: now - 28 * DAY_S, until: now,
      metric: ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_views", "website_clicks", "profile_links_taps"] }, "28-day insights");
    const tmap: Record<string, MetricKey> = { reach: "reach", views: "views", accounts_engaged: "engaged_accounts", total_interactions: "engagement", likes: "likes", comments: "comments", shares: "shares", saves: "saves", profile_views: "profile_views", website_clicks: "clicks", profile_links_taps: "link_taps" };
    for (const m of graphMetrics(tot)) { const k = tmap[m.name]; if (k && m.total != null) out.totals[k] = m.total; }
    for (const [dim, label] of [["age", "Age"], ["gender", "Gender"], ["country", "Country"], ["city", "City"]] as const) {
      const d = await soft("INSTAGRAM_GET_USER_INSIGHTS", { ig_user_id: ig, metric: ["follower_demographics"], period: "lifetime", metric_type: "total_value", breakdown: dim, timeframe: "this_month" }, `Follower ${dim}`);
      const items = graphMetrics(d).flatMap((m) => m.breakdown.flatMap((b) => findArray(b, ["results"]))).map((r) => ({ label: String((r.dimension_values as unknown[] | undefined)?.[0] ?? ""), value: n(r.value) ?? 0 })).filter((i) => i.label && i.value > 0);
      if (items.length) out.demographics.push({ dimension: `Followers by ${label.toLowerCase()}`, items: items.sort((a, b) => b.value - a.value).slice(0, 12) });
      else if (dim === "age" && d) notes.push("Follower demographics appear once the account has 100 or more followers.");
      if (!items.length) break;
    }
    const media = findArray(await soft("INSTAGRAM_GET_IG_USER_MEDIA", { ig_user_id: "me", limit: 50, fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count" }, "Posts"), ["data", "media"]);
    out.recent = media.map((x) => ({ id: String(x.id), title: String(x.caption ?? "").slice(0, 160), url: pickStr(x, ["permalink"]), date: day(x.timestamp), type: pickStr(x, ["media_product_type", "media_type"]), views: null, likes: n(x.like_count), comments: n(x.comments_count), shares: null }));
  }

  else if (p === "threads") {
    const me = await run("THREADS_GET_MY_PROFILE", { user_id: "me" });
    out.name = pickStr(me, ["username", "name"]);
    const fol = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["followers_count"] }, "Follower count");
    const fm = graphMetrics(fol).find((m) => m.name === "followers_count");
    out.followers = fm?.total ?? fm?.values.at(-1)?.value ?? (fol ? pick(fol, ["followers_count"]) : null);
    const views = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["views"], since: now - 90 * DAY_S, until: now }, "Daily views");
    for (const m of graphMetrics(views)) if (m.name === "views") for (const v of m.values) add(out.series, "views", v.date, v.value);
    const tot = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["views", "likes", "replies", "reposts", "quotes", "clicks"], since: now - 28 * DAY_S, until: now }, "28-day insights");
    const tmap: Record<string, MetricKey> = { views: "views", likes: "likes", replies: "comments", reposts: "shares", quotes: "quotes", clicks: "clicks" };
    for (const m of graphMetrics(tot)) { const k = tmap[m.name]; const v = m.total ?? (m.values.length ? m.values.reduce((a, b) => a + (b.value ?? 0), 0) : null); if (k && v != null) out.totals[k] = v; }
    for (const dim of ["country", "age", "gender"] as const) {
      const d = await soft("THREADS_GET_PROFILE_INSIGHTS", { user_id: "me", metrics: ["follower_demographics"], breakdown: dim }, `Follower ${dim}`);
      const items = graphMetrics(d).flatMap((m) => m.breakdown.flatMap((b) => findArray(b, ["results"]))).map((r) => ({ label: String((r.dimension_values as unknown[] | undefined)?.[0] ?? ""), value: n(r.value) ?? 0 })).filter((i) => i.label && i.value > 0);
      if (!items.length) { if (d) notes.push("Threads follower demographics need at least 100 followers."); break; }
      out.demographics.push({ dimension: `Followers by ${dim}`, items: items.sort((a, b) => b.value - a.value).slice(0, 12) });
    }
    const posts = findArray(await soft("THREADS_LIST_MY_POSTS", { user_id: "me", limit: 25 }, "Posts"), ["data", "posts", "threads"]);
    out.recent = [];
    for (const x of posts.slice(0, 25)) {
      const ins = out.recent.length < 12 ? await soft("THREADS_GET_POST_INSIGHTS", { post_id: String(x.id), media_id: String(x.id), metrics: ["views", "likes", "replies", "reposts", "quotes"] }, "Post insights") : null;
      const g = (k: string) => { const m = graphMetrics(ins).find((y) => y.name === k); return m?.total ?? m?.values[0]?.value ?? null; };
      out.recent.push({ id: String(x.id), title: String(x.text ?? "").slice(0, 160), url: pickStr(x, ["permalink"]), date: day(x.timestamp), type: pickStr(x, ["media_type"]),
        views: g("views"), likes: g("likes"), comments: g("replies"), shares: ins ? (g("reposts") ?? 0) + (g("quotes") ?? 0) : null });
    }
    out.posts = posts.length || null;
  }

  else if (p === "x") {
    const me = await run("TWITTER_USER_LOOKUP_ME", { user_fields: ["public_metrics", "username", "name", "created_at"] });
    const u = (findArray({ w: [me] }, ["w"])[0] ?? {}) as Record<string, unknown>;
    const id = pickStr(u, ["id"]), username = pickStr(u, ["username"]);
    out.name = pickStr(u, ["name", "username"]); out.followers = pick(u, ["followers_count"]); out.following = pick(u, ["following_count"]); out.posts = pick(u, ["tweet_count"]);
    const tweets = id ? findArray(await soft("TWITTER_GET_USER_POSTS", { id, max_results: 50, exclude: ["replies", "retweets"], tweet_fields: ["public_metrics", "created_at"] }, "Posts"), ["data", "tweets"]) : [];
    out.recent = tweets.map((t) => ({ id: String(t.id), title: String(t.text ?? "").slice(0, 160), url: username ? `https://x.com/${username}/status/${t.id}` : null, date: day(t.created_at),
      views: pick(t, ["impression_count"]), likes: pick(t, ["like_count"]), comments: pick(t, ["reply_count"]), shares: (pick(t, ["retweet_count"]) ?? 0) + (pick(t, ["quote_count"]) ?? 0) }));
    if (tweets.length && tweets.every((t) => pick(t, ["impression_count"]) == null)) notes.push("X didn't return impression counts for these posts.");
  }

  else if (p === "linkedin") {
    let org = ctx.linkedinOrgId;
    if (!org) {
      const info = await run("LINKEDIN_GET_COMPANY_INFO", { role: "ADMINISTRATOR", state: "APPROVED", count: 10 });
      org = JSON.stringify(info).match(/urn:li:organization:(\d+)/)?.[1] ?? (pick(info, ["id"]) != null ? String(pick(info, ["id"])) : null);
      if (!org) throw new Error("The connected LinkedIn login isn't an admin of a company page.");
      out.name = pickStr(info, ["localizedName", "name", "vanityName"]);
    }
    const urn = `urn:li:organization:${org}`;
    const size = await soft("LINKEDIN_GET_NETWORK_SIZE", { organization_id: org, edgeType: "COMPANY_FOLLOWED_BY_MEMBER" }, "Follower count");
    out.followers = size ? pick(size, ["firstDegreeSize", "first_degree_size"]) : null;
    const startMs = (now - 90 * DAY_S) * 1000, endMs = now * 1000;
    const daily = await soft("LINKEDIN_GET_SHARE_STATS", { organizational_entity: urn, time_intervals: `(timeRange:(start:${startMs},end:${endMs}),timeGranularityType:DAY)` }, "Daily post statistics");
    for (const el of findArray(daily, ["elements"])) {
      const d = day(n((el.timeRange as Record<string, unknown> | undefined)?.start) ?? null);
      const s = (el.totalShareStatistics ?? {}) as Record<string, unknown>;
      add(out.series, "impressions", d, n(s.impressionCount)); add(out.series, "reach", d, n(s.uniqueImpressionsCount)); add(out.series, "clicks", d, n(s.clickCount));
      const e = (n(s.likeCount) ?? 0) + (n(s.commentCount) ?? 0) + (n(s.shareCount) ?? 0);
      if (s.likeCount != null || s.commentCount != null) add(out.series, "engagement", d, e);
    }
    const life = await soft("LINKEDIN_GET_SHARE_STATS", { organizational_entity: urn }, "Post statistics");
    if (life) { const s = (findArray(life, ["elements"])[0]?.totalShareStatistics ?? {}) as Record<string, unknown>;
      for (const [k, f] of [["impressions", "impressionCount"], ["likes", "likeCount"], ["comments", "commentCount"], ["shares", "shareCount"], ["clicks", "clickCount"]] as const) { const v = n(s[f]); if (v != null) out.totals[k] = v; }
      const er = n(s.engagement); if (er != null) out.totals.engagement_rate = er * 100;
      if (Object.keys(out.totals).length) notes.push("LinkedIn post totals are lifetime figures for the page.");
    }
    const pv = await soft("LINKEDIN_GET_ORG_PAGE_STATS", { organization: urn, timeRangeStart: startMs, timeRangeEnd: endMs, timeGranularityType: "DAY" }, "Page views");
    for (const el of findArray(pv, ["elements"])) add(out.series, "profile_views", day(n((el.timeRange as Record<string, unknown> | undefined)?.start) ?? null), pick(el, ["pageViews", "allPageViews"]));
  }

  else if (p === "tiktok") {
    const u = await run("TIKTOK_GET_USER_STATS", { fields: ["display_name", "follower_count", "following_count", "likes_count", "video_count"] });
    out.name = pickStr(u, ["display_name"]); out.followers = pick(u, ["follower_count"]); out.following = pick(u, ["following_count"]); out.posts = pick(u, ["video_count"]);
    const lt = pick(u, ["likes_count"]); if (lt != null) out.totals.lifetime_likes = lt;
    let cursor: unknown, pages = 0;
    do {
      const r = await soft("TIKTOK_LIST_VIDEOS", { max_count: 20, ...(cursor ? { cursor } : {}) }, "Videos");
      for (const v of findArray(r, ["videos"])) out.recent.push({ id: String(v.id), title: String(v.title ?? v.video_description ?? "").slice(0, 160), url: pickStr(v, ["share_url"]), date: day(v.create_time), type: "video", views: n(v.view_count), likes: n(v.like_count), comments: n(v.comment_count), shares: n(v.share_count) });
      cursor = r && pick(r, ["has_more"]) !== 0 && (r as Record<string, unknown>) ? pick(r, ["cursor"]) : null;
      if (r && JSON.stringify(r).includes('"has_more":false')) cursor = null;
    } while (cursor && ++pages < 3);
  }

  else if (p === "pinterest") {
    const prof = await run("PINTEREST_GET_PROFILE", {});
    out.name = pickStr(prof, ["business_name", "username"]); out.followers = pick(prof, ["follower_count"]); out.following = pick(prof, ["following_count"]); out.posts = pick(prof, ["pin_count"]);
    const mv = pick(prof, ["monthly_views"]); if (mv != null) out.totals.monthly_views = mv;
    const end = iso(Date.now() - 86_400_000), start = iso(Date.now() - 90 * 86_400_000);
    const an = await soft("PINTEREST_GET_ACCOUNT_ANALYTICS", { start_date: start, end_date: end, metric_types: ["IMPRESSION", "ENGAGEMENT", "PIN_CLICK", "OUTBOUND_CLICK", "SAVE"] }, "Account analytics");
    for (const d of findArray(an, ["daily_metrics"])) {
      if (d.data_status && d.data_status !== "READY") continue;
      const m = (d.metrics ?? {}) as Record<string, unknown>, dt = day(d.date);
      add(out.series, "impressions", dt, n(m.IMPRESSION)); add(out.series, "engagement", dt, n(m.ENGAGEMENT)); add(out.series, "saves", dt, n(m.SAVE));
      add(out.series, "clicks", dt, n(m.PIN_CLICK)); add(out.series, "outbound_clicks", dt, n(m.OUTBOUND_CLICK));
    }
    const pins = findArray(await soft("PINTEREST_LIST_PINS", { page_size: 50, include_metrics: true }, "Pins"), ["items", "pins", "data"]);
    out.recent = pins.map((x) => {
      const m = ((x.pin_metrics as Record<string, unknown> | undefined)?.["90d"] ?? (x.pin_metrics as Record<string, unknown> | undefined)?.lifetime_metrics ?? {}) as Record<string, unknown>;
      return { id: String(x.id), title: String(x.title ?? x.description ?? "").slice(0, 160), url: `https://www.pinterest.com/pin/${x.id}/`, date: day(x.created_at), type: pickStr(x, ["creative_type"]),
        views: n(m.impression), likes: n(m.save), comments: n(m.reaction) ?? n(m.comment), shares: n(m.outbound_click) ?? n(m.pin_click) };
    });
  }

  else {
    const ch = await run("YOUTUBE_GET_CHANNEL_STATISTICS", { mine: true, part: "snippet,statistics" });
    const item = findArray(ch, ["items", "channels"])[0] ?? (ch as Record<string, unknown>);
    out.name = pickStr(item, ["title"]); out.followers = pick(item, ["subscriberCount"]); out.posts = pick(item, ["videoCount"]);
    const lv = pick(item, ["viewCount"]); if (lv != null) out.totals.lifetime_views = lv;
    const startDate = iso(Date.now() - 90 * 86_400_000), endDate = iso(Date.now() - 86_400_000);
    const a = await soft("YOUTUBE_QUERY_ANALYTICS", { ids: "channel==MINE", startDate, endDate, dimensions: "day", sort: "day", metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares" }, "YouTube Analytics");
    for (const r of ytRows(a)) {
      const d = day(r.day);
      add(out.series, "video_views", d, n(r.views)); add(out.series, "watch_minutes", d, n(r.estimatedMinutesWatched));
      add(out.series, "new_followers", d, n(r.subscribersGained)); add(out.series, "unfollows", d, n(r.subscribersLost));
      const e = (n(r.likes) ?? 0) + (n(r.comments) ?? 0) + (n(r.shares) ?? 0); add(out.series, "engagement", d, e);
    }
    const ag = ytRows(await soft("YOUTUBE_QUERY_ANALYTICS", { ids: "channel==MINE", startDate, endDate, dimensions: "ageGroup", metrics: "viewerPercentage" }, "Viewer age"));
    if (ag.length) out.demographics.push({ dimension: "Viewers by age (%)", items: ag.map((r) => ({ label: String(r.ageGroup).replace("age", ""), value: n(r.viewerPercentage) ?? 0 })).filter((i) => i.value > 0) });
    const gd = ytRows(await soft("YOUTUBE_QUERY_ANALYTICS", { ids: "channel==MINE", startDate, endDate, dimensions: "gender", metrics: "viewerPercentage" }, "Viewer gender"));
    if (gd.length) out.demographics.push({ dimension: "Viewers by gender (%)", items: gd.map((r) => ({ label: String(r.gender), value: n(r.viewerPercentage) ?? 0 })).filter((i) => i.value > 0) });
    const co = ytRows(await soft("YOUTUBE_QUERY_ANALYTICS", { ids: "channel==MINE", startDate, endDate, dimensions: "country", metrics: "views", sort: "-views", maxResults: 12 }, "Views by country"));
    if (co.length) out.demographics.push({ dimension: "Views by country", items: co.map((r) => ({ label: String(r.country), value: n(r.views) ?? 0 })).filter((i) => i.value > 0) });
    const vids = ytRows(await soft("YOUTUBE_QUERY_ANALYTICS", { ids: "channel==MINE", startDate, endDate, dimensions: "video", metrics: "views,likes,comments,shares,estimatedMinutesWatched", sort: "-views", maxResults: 25 }, "Top videos"));
    const known = new Map(ctx.knownPosts.map((x) => [x.id, x]));
    out.recent = vids.map((r) => { const id = String(r.video); const k = known.get(id);
      return { id, title: k?.title || `Video ${id}`, url: `https://www.youtube.com/watch?v=${id}`, date: k?.date ?? null, type: "video", views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }; });
    if (vids.length) notes.push("Video numbers are for the last 90 days (YouTube Analytics).");
  }

  sortSeries(out.series);
  if (!out.recent.length && p !== "linkedin") notes.push("No posts were returned for this account.");
  out.recent = out.recent.filter((x) => x.id).slice(0, 60);
  return out;
}
