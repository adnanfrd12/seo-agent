/**
 * Social metric vocabulary shared by the reader, the page and the charts (no secrets, no server code).
 *
 * `additive` metrics are counts that can be summed over days and across platforms (views, engagement,
 * clicks). Reach and engaged accounts are unique people: they are never summed over days or across
 * platforms, so they only appear per platform.
 */
export type MetricKey =
  | "followers" | "new_followers" | "unfollows" | "reach" | "engaged_accounts" | "impressions" | "views" | "video_views"
  | "watch_minutes" | "engagement" | "engagement_rate" | "likes" | "comments" | "shares" | "saves" | "quotes" | "clicks"
  | "outbound_clicks" | "link_taps" | "profile_views" | "monthly_views" | "lifetime_likes" | "lifetime_views";

export interface MetricInfo { label: string; additive: boolean; hint: string; format?: "int" | "percent" | "minutes" }

export const METRICS: Record<MetricKey, MetricInfo> = {
  followers: { label: "Followers", additive: false, hint: "Followers (subscribers on YouTube) at the end of the day." },
  new_followers: { label: "New followers", additive: true, hint: "Follows gained per day (on Instagram, the daily net change the API reports)." },
  unfollows: { label: "Unfollows", additive: true, hint: "Follows lost per day." },
  reach: { label: "Reach", additive: false, hint: "Unique accounts that saw the content. Unique people can't be added up across days or platforms." },
  engaged_accounts: { label: "Accounts engaged", additive: false, hint: "Unique accounts that interacted." },
  impressions: { label: "Impressions", additive: true, hint: "Times the content was shown." },
  views: { label: "Views", additive: true, hint: "Times the content was viewed (Meta's current measure that replaced impressions)." },
  video_views: { label: "Video views", additive: true, hint: "Video views as reported by the platform." },
  watch_minutes: { label: "Watch time", additive: true, hint: "Estimated minutes watched.", format: "minutes" },
  engagement: { label: "Engagement", additive: true, hint: "Interactions: likes or reactions, comments, shares, saves and similar, as the platform counts them." },
  engagement_rate: { label: "Engagement rate", additive: false, hint: "As reported by the platform.", format: "percent" },
  likes: { label: "Likes", additive: true, hint: "Likes or reactions." },
  comments: { label: "Comments", additive: true, hint: "Comments or replies." },
  shares: { label: "Shares", additive: true, hint: "Shares, reposts and quotes." },
  saves: { label: "Saves", additive: true, hint: "Saves." },
  quotes: { label: "Quotes", additive: true, hint: "Quote posts." },
  clicks: { label: "Clicks", additive: true, hint: "Clicks as the platform counts them (post, pin or call-to-action clicks)." },
  outbound_clicks: { label: "Outbound clicks", additive: true, hint: "Clicks to the website." },
  link_taps: { label: "Profile link taps", additive: true, hint: "Taps on links in the profile." },
  profile_views: { label: "Profile / page views", additive: true, hint: "Visits to the profile or page." },
  monthly_views: { label: "Monthly views", additive: false, hint: "Pinterest's monthly views figure." },
  lifetime_likes: { label: "Total likes", additive: false, hint: "All likes the account has received." },
  lifetime_views: { label: "Total views", additive: false, hint: "All views of the channel." },
};

export interface SocialPost {
  id: string; title: string; url: string | null; date: string | null; type?: string | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
}
export type SocialSeries = Partial<Record<MetricKey, { date: string; value: number }[]>>;
export interface SocialDemo { dimension: string; items: { label: string; value: number }[] }

/** The "content views" measure each platform reports, for the combined Views & impressions total. */
export const PRIMARY_VIEWS: Partial<Record<string, MetricKey>> = {
  facebook: "views", threads: "views", linkedin: "impressions", pinterest: "impressions", youtube: "video_views",
};

export const sumIn = (s: { date: string; value: number }[] | undefined, start: string, end: string): number | null => {
  const xs = (s ?? []).filter((p) => p.date >= start && p.date <= end);
  return xs.length ? xs.reduce((a, p) => a + p.value, 0) : null;
};
/** True when the series has data on or before `start` and on or after `end` (the whole period is covered). */
export const covers = (s: { date: string }[] | undefined, start: string, end: string) =>
  Boolean(s?.length) && s![0].date <= start && s!.at(-1)!.date >= end;
/** Value on the latest day at or before `date`. */
export const valueAt = (s: { date: string; value: number | null }[] | undefined, date: string): number | null => {
  let v: number | null = null;
  for (const p of s ?? []) { if (p.date > date) break; if (p.value != null) v = p.value; }
  return v;
};
export const postEngagement = (p: Pick<SocialPost, "likes" | "comments" | "shares">) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
