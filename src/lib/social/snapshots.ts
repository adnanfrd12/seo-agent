import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SocialRow } from "./fetch";
import type { Platform } from "./platforms";

/**
 * Daily snapshots of every social account the dashboard reads, for charts of day-to-day gains. Several platform
 * APIs only return current totals (followers, lifetime likes) and lifetime counts per post (TikTok's
 * user.info.stats and video.list, for example), so "gained per day" is today's snapshot minus yesterday's.
 * One account row and one row per returned post per day (UTC); a later read on the same day replaces that day.
 */

const A = "social_account_snapshots", P = "social_post_snapshots";

/** Saves today's snapshot of one platform after a successful read. Never throws (a snapshot must not fail a read). */
export async function saveSnapshot(admin: SupabaseClient, clientId: string, row: SocialRow): Promise<void> {
  if (row.status !== "ok") return;
  try {
    const day = row.fetchedAt.slice(0, 10);
    const pr = row.profile;
    const { error } = await admin.from(A).upsert({
      client_id: clientId, platform: row.platform, day, account: pr.handle ?? pr.name ?? null,
      followers: pr.followers, following: pr.following ?? null,
      // only real lifetime totals: profile.likes/views mean different things per platform (a 28-day total for
      // connected accounts, likes given on X), which would make "gained per day" wrong. Without a lifetime
      // total, likes gained come from the posts' own like counts instead.
      likes: row.totals?.lifetime_likes ?? null, posts: pr.posts,
      views: row.totals?.lifetime_views ?? null, captured_at: row.fetchedAt,
    }, { onConflict: "client_id,platform,day" });
    if (error) { if (!/does not exist|schema cache/i.test(error.message)) console.error(`social snapshot: ${error.message}`); return; }
    const posts = row.posts.filter((x) => x.id).slice(0, 200).map((x) => ({
      client_id: clientId, platform: row.platform, day, post_id: String(x.id), title: (x.title || x.text || "").slice(0, 200) || null, url: x.url,
      published: x.date ? x.date.slice(0, 10) : null, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares,
    }));
    if (posts.length) {
      const { error: e2 } = await admin.from(P).upsert(posts, { onConflict: "client_id,platform,day,post_id" });
      if (e2) console.error(`social post snapshot: ${e2.message}`);
    }
  } catch (e) { console.error("social snapshot", e); }
}

/** Deletes every snapshot of one platform (disconnect / revoked access). */
export async function deleteSnapshots(admin: SupabaseClient, clientId: string, platform: Platform): Promise<number> {
  const [a, p] = await Promise.all([
    admin.from(A).delete().eq("client_id", clientId).eq("platform", platform).select("day"),
    admin.from(P).delete().eq("client_id", clientId).eq("platform", platform).select("day"),
  ]);
  return (a.data?.length ?? 0) + (p.data?.length ?? 0);
}

/* ------------------------------------------------------------------ day-to-day gains */
export interface AccountSnap { platform: string; day: string; account: string | null; followers: number | null; likes: number | null }
export interface PostSnap { platform: string; day: string; post_id: string; title: string | null; url: string | null; published: string | null; views: number | null; likes: number | null }
export interface VideoGain { id: string; title: string; url: string | null; gains: (number | null)[]; total: number }
export interface DailyGrowth {
  /** first day a snapshot exists (gains start the day after) */
  firstDay: string | null;
  days: string[];
  followers: (number | null)[] | null;
  likes: (number | null)[] | null;
  /** "account": the account's lifetime likes total; "posts": likes on the returned posts (no account total) */
  likesFrom: "account" | "posts" | null;
  views: (number | null)[] | null;
  videos: VideoGain[];
}

const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const dayBefore = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => { const out: string[] = []; for (let d = a; d <= b;) { out.push(d); const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10); } return out; };
const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);

/**
 * Gains per day from consecutive snapshots: a day's value is that day's snapshot minus the previous day's, and
 * only when both exist (a missed day leaves a gap instead of a jump). Views gained = the change in each post's
 * views since yesterday, plus the views of posts published since yesterday; posts that only entered or left the
 * returned list (older posts) are not counted.
 */
export function dailyGrowth(acc: AccountSnap[], posts: PostSnap[], range: { start: string; end: string }): DailyGrowth {
  const byDay = new Map(acc.map((a) => [a.day, a]));
  const known = [...byDay.keys()].sort();
  const firstDay = known[0] ?? null;
  const empty: DailyGrowth = { firstDay, days: [], followers: null, likes: null, likesFrom: null, views: null, videos: [] };
  if (!firstDay) return empty;
  // the first gain is the day after the first snapshot
  const from = range.start > nextDay(firstDay) ? range.start : nextDay(firstDay);
  const to = known.at(-1)! < range.end ? known.at(-1)! : range.end;
  if (from > to) return empty;
  const days = daysBetween(from, to);

  // the same account on both days (a switched account starts a new series)
  const pair = (d: string) => { const t = byDay.get(d), y = byDay.get(dayBefore(d)); return t && y && (!t.account || !y.account || t.account === y.account) ? [t, y] as const : null; };
  const followers = days.map((d) => { const p = pair(d); return p ? diff(p[0].followers, p[1].followers) : null; });
  const accountLikes = days.map((d) => { const p = pair(d); return p ? diff(p[0].likes, p[1].likes) : null; });

  const postsByDay = new Map<string, Map<string, PostSnap>>();
  for (const x of posts) { let m = postsByDay.get(x.day); if (!m) postsByDay.set(x.day, (m = new Map())); m.set(x.post_id, x); }
  const perPost = new Map<string, VideoGain>();
  const views: (number | null)[] = [], postLikes: (number | null)[] = [];
  days.forEach((d, i) => {
    const t = postsByDay.get(d), y = postsByDay.get(dayBefore(d));
    if (!t || !y || !pair(d)) { views.push(null); postLikes.push(null); return; }
    let v: number | null = null, l: number | null = null;
    for (const [id, cur] of t) {
      const old = y.get(id);
      const isNew = !old && cur.published != null && cur.published >= dayBefore(d);
      const g = old ? diff(cur.views, old.views) : isNew ? cur.views : null;
      const lg = old ? diff(cur.likes, old.likes) : isNew ? cur.likes : null;
      if (g != null) v = (v ?? 0) + g;
      if (lg != null) l = (l ?? 0) + lg;
      if (g == null) continue;
      let pg = perPost.get(id);
      if (!pg) perPost.set(id, (pg = { id, title: cur.title || "(no title)", url: cur.url, gains: days.map(() => null), total: 0 }));
      pg.gains[i] = g; pg.total += g;
    }
    views.push(v); postLikes.push(l);
  });

  const has = (xs: (number | null)[]) => xs.some((x) => x != null);
  const likesFrom = has(accountLikes) ? "account" : has(postLikes) ? "posts" : null;
  return {
    firstDay, days,
    followers: has(followers) ? followers : null,
    likes: likesFrom === "account" ? accountLikes : likesFrom === "posts" ? postLikes : null, likesFrom,
    views: has(views) ? views : null,
    videos: [...perPost.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 25),
  };
}
/** Snapshots of the selected range (and the day before it) for every platform, read through RLS. */
export async function loadGrowth(db: SupabaseClient, clientId: string, range: { start: string; end: string }): Promise<Partial<Record<Platform, DailyGrowth>>> {
  const from = dayBefore(range.start);
  const { data: acc, error } = await db.from(A).select("platform, day, account, followers, likes").eq("client_id", clientId).gte("day", from).lte("day", range.end).order("day").limit(5000);
  if (error || !acc?.length) return {};
  // the first snapshot ever per platform ("tracking since" / when gains start), even when it's before the range
  const { data: firsts } = await db.from(A).select("platform, day").eq("client_id", clientId).order("day").limit(5000);
  const first = new Map<string, string>();
  for (const r of firsts ?? []) if (!first.has(r.platform)) first.set(r.platform, r.day);
  const posts: PostSnap[] = [];
  for (let page = 0; page < 60; page++) {
    const { data } = await db.from(P).select("platform, day, post_id, title, url, published, views, likes").eq("client_id", clientId).gte("day", from).lte("day", range.end)
      .order("day").order("platform").order("post_id").range(page * 1000, page * 1000 + 999);
    posts.push(...((data ?? []) as PostSnap[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  const out: Partial<Record<Platform, DailyGrowth>> = {};
  for (const p of new Set(acc.map((a) => a.platform))) {
    const g = dailyGrowth((acc as AccountSnap[]).filter((a) => a.platform === p), posts.filter((x) => x.platform === p), range);
    out[p as Platform] = { ...g, firstDay: first.get(p) ?? g.firstDay };
  }
  return out;
}
