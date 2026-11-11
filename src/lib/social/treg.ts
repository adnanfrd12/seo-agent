import "server-only";
import { handleOf, type Platform } from "./platforms";

/**
 * treg.to: public profile numbers (followers, posts, recent post likes) for any account, no login needed.
 * One agency token (TREG_API_KEY). Calls cost fractions of a cent and failed/empty answers are free.
 * Used when a client hasn't connected an account through Composio, and for competitor profiles.
 */
export const tregConfigured = () => Boolean(process.env.TREG_API_KEY?.trim());

type Ep = { id: string; body: (handle: string, url: string) => Record<string, unknown>; usd: number; posts?: boolean };
const EP: Partial<Record<Platform, Ep>> = {
  instagram: { id: "crawl4ai.instagram.user.profile", body: (h) => ({ username: h }), usd: 0.0009 },
  tiktok: { id: "crawl4ai.tiktok.user.profile", body: (h) => ({ username: h }), usd: 0.00035 },
  facebook: { id: "crawl4ai.facebook.user.profile", body: (_h, url) => ({ profile: url }), usd: 0.00135 },
  x: { id: "crawl4ai.x.user.profile", body: (h) => ({ username: h }), usd: 0.0002 },
  threads: { id: "crawl4ai.threads.user.posts", body: (h) => ({ username: h, limit: 10 }), usd: 0.00165, posts: true },
  linkedin: { id: "crawl4ai.linkedin.company.profile", body: (_h, url) => ({ company: url }), usd: 0.0009 },
};
export const tregSupports = (p: Platform) => Boolean(EP[p]);
export const TREG_EST = 0.002;

export class TregError extends Error {}

/** Depth-first search for the first numeric value under any of the given keys (provider shapes vary). */
export function pick(v: unknown, keys: string[], depth = 0): number | null {
  if (!v || typeof v !== "object" || depth > 5) return null;
  const o = v as Record<string, unknown>;
  for (const k of keys) {
    const x = o[k];
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x === "string" && /^\d[\d,]*$/.test(x.trim())) return Number(x.replace(/,/g, ""));
  }
  for (const x of Object.values(o)) { if (x && typeof x === "object" && !Array.isArray(x)) { const r = pick(x, keys, depth + 1); if (r != null) return r; } }
  return null;
}
export function pickStr(v: unknown, keys: string[], depth = 0): string | null {
  if (!v || typeof v !== "object" || depth > 5) return null;
  const o = v as Record<string, unknown>;
  for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  for (const x of Object.values(o)) { if (x && typeof x === "object" && !Array.isArray(x)) { const r = pickStr(x, keys, depth + 1); if (r) return r; } }
  return null;
}
export function findArray(v: unknown, keys: string[], depth = 0): Record<string, unknown>[] {
  if (!v || typeof v !== "object" || depth > 4) return [];
  const o = v as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  for (const x of Object.values(o)) { if (x && typeof x === "object" && !Array.isArray(x)) { const r = findArray(x, keys, depth + 1); if (r.length) return r; } }
  return [];
}

export interface TregProfile {
  name: string | null; followers: number | null; following: number | null; posts: number | null; likes: number | null;
  recent: { id: string; title: string; url: string | null; date: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null }[];
  cost: number;
}

const FOLLOWERS = ["followers", "follower_count", "followers_count", "followerCount", "followersCount", "fans", "subscribers"];
const FOLLOWING = ["following", "following_count", "follows_count", "followingCount"];
const POSTS = ["posts_count", "post_count", "media_count", "video_count", "videoCount", "tweet_count", "statuses_count", "postsCount", "videos"];
const LIKES = ["likes", "like_count", "likes_count", "heart_count", "heartCount", "total_likes"];

export async function tregProfile(p: Platform, url: string): Promise<TregProfile> {
  const ep = EP[p];
  if (!ep) throw new TregError("No public-profile source for this platform.");
  const token = process.env.TREG_API_KEY?.trim();
  if (!token) throw new TregError("TREG_API_KEY isn't set.");
  const handle = (handleOf(url) ?? "").replace(/^@/, "");
  if (!handle) throw new TregError("The profile URL has no handle.");
  const r = await fetch(`https://treg.to/call/${ep.id}`, {
    method: "POST", headers: { "X-Treg-Token": token, "content-type": "application/json" },
    body: JSON.stringify(ep.body(handle, url.split("?")[0])), cache: "no-store", signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.status === 402) throw new TregError("The treg.to balance is empty. Top it up at treg.to.");
  if (r.status === 401 || r.status === 403) throw new TregError("treg.to refused the token (check TREG_API_KEY).");
  if (!r.ok || !j) throw new TregError(`Public profile read failed (HTTP ${r.status}).`);
  const micro = Number(r.headers.get("x-treg-cost-micro"));
  const posts = findArray(j, ["posts", "items", "threads", "videos", "tweets"]).slice(0, 20).map((x, i) => ({
    id: String(x.id ?? x.code ?? x.url ?? i),
    title: String(pickStr(x, ["text", "caption", "title", "description"]) ?? "").slice(0, 160),
    url: pickStr(x, ["url", "permalink", "link"]),
    date: (pickStr(x, ["time", "timestamp", "date", "created_at", "taken_at"]) ?? "").slice(0, 10) || null,
    views: pick(x, ["views", "plays", "play_count", "view_count"]),
    likes: pick(x, ["likes", "like_count", "reactions"]),
    comments: pick(x, ["comments", "replies", "comment_count", "reply_count"]),
    shares: pick(x, ["shares", "reposts", "share_count", "repost_count"]),
  }));
  const top = { ...j } as Record<string, unknown>;
  for (const k of ["posts", "items", "threads", "videos", "tweets"]) if (Array.isArray(top[k])) delete top[k];
  const followers = pick(top, FOLLOWERS);
  if (followers == null && !posts.length) throw new TregError("The public profile returned no numbers (check the profile URL).");
  return {
    name: pickStr(top, ["full_name", "name", "display_name", "displayName", "nickname", "username"]),
    followers, following: pick(top, FOLLOWING), posts: pick(top, POSTS), likes: pick(top, LIKES),
    recent: posts, cost: Number.isFinite(micro) && micro > 0 ? micro / 1e6 : ep.usd,
  };
}
