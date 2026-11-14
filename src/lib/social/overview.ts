import type { SocialRow } from "./fetch";
import { METRICS, postEngagement, PRIMARY_VIEWS, sumIn, valueAt, type MetricKey, type SocialPost } from "./metrics";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "./platforms";

/**
 * Turns the stored platform rows into the combined overview and the per-platform views for one date range.
 * Rules that keep the totals honest:
 *  - only additive counts are summed (views/impressions, engagement, posts, follower change);
 *  - reach and other unique-people metrics stay per platform;
 *  - a previous-period figure is shown only when the stored data covers that period;
 *  - every combined number lists the platforms it includes.
 */
export interface Period { start: string; end: string }
export interface PlatformFigures {
  platform: Platform; label: string; connected: boolean; mode: SocialRow["mode"]; row: SocialRow;
  followers: number | null; followersPrev: number | null;
  /** follower change in the period (null when not measurable) */
  growth: number | null; growthPrev: number | null;
  views: number | null; viewsPrev: number | null; viewsMetric: MetricKey | null;
  engagement: number | null; engagementPrev: number | null; engagementBasis: "daily" | "posts" | null;
  posts: number; postsPrev: number;
  postsIn: SocialPost[];
}

const DAY = 86_400_000;
export const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const previousOf = (p: Period): Period => {
  const days = Math.round((Date.parse(p.end) - Date.parse(p.start)) / DAY) + 1;
  return { start: shift(p.start, -days), end: shift(p.start, -1) };
};

/** Followers per day: the platform's own daily series where it has one, else our stored snapshots. */
export function followerSeries(row: SocialRow): { date: string; value: number }[] {
  const m = new Map<string, number>();
  for (const h of row.history) if (h.followers != null) m.set(h.date, h.followers);
  for (const s of row.series?.followers ?? []) m.set(s.date, s.value);
  return [...m].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Followers gained in the period, from follower counts at both ends, else from daily gains minus losses. */
function growthIn(row: SocialRow, p: Period): number | null {
  const fs = followerSeries(row);
  if (fs.length && fs[0].date < p.start && fs.at(-1)!.date >= p.end) {
    const a = valueAt(fs, shift(p.start, -1)), b = valueAt(fs, p.end);
    if (a != null && b != null) return b - a;
  }
  const gained = row.series?.new_followers, lost = row.series?.unfollows;
  if (gained?.length && gained[0].date <= p.start) {
    const g = sumIn(gained, p.start, p.end);
    if (g != null) return g - (sumIn(lost, p.start, p.end) ?? 0);
  }
  return null;
}

const inPeriod = (posts: SocialPost[], p: Period) => posts.filter((x) => x.date && x.date >= p.start && x.date <= p.end);
const coversStart = (s: { date: string }[] | undefined, p: Period) => Boolean(s?.length) && s![0].date <= p.start;

export function figures(row: SocialRow, connected: boolean, cur: Period, prev: Period): PlatformFigures {
  const p = row.platform;
  const fs = followerSeries(row);
  const vk = PRIMARY_VIEWS[p] ?? null;
  const vs = vk ? row.series?.[vk] : undefined;
  const es = row.series?.engagement;
  const posts = row.posts ?? [];
  const pc = inPeriod(posts, cur), pp = inPeriod(posts, prev);
  const daily = Boolean(es?.length);
  return {
    platform: p, label: PLATFORM_INFO[p].label, connected, mode: row.mode, row,
    followers: row.status === "ok" || row.history.length ? valueAt(fs, cur.end) ?? row.profile.followers : null,
    followersPrev: fs.length && fs[0].date <= prev.end ? valueAt(fs, prev.end) : null,
    growth: growthIn(row, cur), growthPrev: growthIn(row, prev),
    views: vs?.length ? sumIn(vs, cur.start, cur.end) ?? 0 : null,
    viewsPrev: vs?.length && coversStart(vs, prev) ? sumIn(vs, prev.start, prev.end) ?? 0 : null,
    viewsMetric: vs?.length ? vk : null,
    engagement: daily ? sumIn(es, cur.start, cur.end) ?? 0 : pc.length ? pc.reduce((a, x) => a + postEngagement(x), 0) : posts.length ? 0 : null,
    engagementPrev: daily ? (coversStart(es, prev) ? sumIn(es, prev.start, prev.end) ?? 0 : null) : posts.length && posts.some((x) => x.date && x.date < prev.start) ? pp.reduce((a, x) => a + postEngagement(x), 0) : null,
    engagementBasis: daily ? "daily" : posts.length ? "posts" : null,
    posts: pc.length, postsPrev: pp.length, postsIn: pc,
  };
}

/** Adds up a figure across platforms; null when no platform has it, plus which platforms were included. */
export function combine(list: PlatformFigures[], cur: (f: PlatformFigures) => number | null, prev: (f: PlatformFigures) => number | null) {
  const inc = list.filter((f) => cur(f) != null);
  const value = inc.length ? inc.reduce((a, f) => a + cur(f)!, 0) : null;
  // a previous total is only fair when every included platform has a previous figure
  const previous = inc.length && inc.every((f) => prev(f) != null) ? inc.reduce((a, f) => a + prev(f)!, 0) : undefined;
  return { value, previous, platforms: inc.map((f) => f.label) };
}

/** Daily series per platform for one metric, limited to the period. */
export function seriesBy(list: PlatformFigures[], pick: (f: PlatformFigures) => { date: string; value: number }[] | undefined, p: Period) {
  return list.map((f) => ({ f, data: (pick(f) ?? []).filter((x) => x.date >= p.start && x.date <= p.end) })).filter((x) => x.data.length);
}

/** Metrics a platform has a daily series for, in display order. */
export function dailyMetrics(row: SocialRow): MetricKey[] {
  const order: MetricKey[] = ["followers", "new_followers", "unfollows", "views", "impressions", "video_views", "reach", "engagement", "watch_minutes", "clicks", "outbound_clicks", "saves", "profile_views"];
  return order.filter((k) => (row.series?.[k]?.length ?? 0) > 0);
}

/** Current period points with the previous period aligned day by day (for the dashed comparison line). */
export function withPrevious(s: { date: string; value: number }[], cur: Period, prev: Period) {
  const m = new Map(s.map((x) => [x.date, x.value]));
  const out: { date: string; value: number | null; previous: number | null }[] = [];
  for (let d = cur.start, i = 0; d <= cur.end; d = shift(d, 1), i++) out.push({ date: d, value: m.get(d) ?? null, previous: m.get(shift(prev.start, i)) ?? null });
  // trim days before the first and after the last real value so the chart doesn't show an empty stretch
  const first = out.findIndex((x) => x.value != null), last = out.length - 1 - [...out].reverse().findIndex((x) => x.value != null);
  return first < 0 ? [] : out.slice(first, last + 1);
}

export const platformColor = (p: Platform) => `var(--cat-${PLATFORMS.indexOf(p) + 1})`;
export const metricLabel = (k: MetricKey) => METRICS[k].label;

/** Connected platforms whose stored read is missing, not from the connection, or older than `maxAgeMs`. */
export function staleConnected(rows: Partial<Record<Platform, SocialRow>>, connected: Set<Platform>, maxAgeMs: number): Platform[] {
  const now = Date.now();
  return [...connected].filter((p) => !rows[p] || rows[p]!.mode !== "connected" || now - Date.parse(rows[p]!.fetchedAt) > maxAgeMs);
}
