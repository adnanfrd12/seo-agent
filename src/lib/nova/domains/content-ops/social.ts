import "server-only";
import { z } from "zod";
import { detectSocialProfiles, refreshSocialNow, saveSocialSettings } from "@/app/(dashboard)/social/actions";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { configForClient } from "@/lib/org/config";
import { clientSocial, connectedAccounts, loadSocial, SOCIAL_EST, type SocialRow } from "@/lib/social/fetch";
import { postEngagement, type SocialPost } from "@/lib/social/metrics";
import { combine, figures, previousOf, type Period, type PlatformFigures } from "@/lib/social/overview";
import { PLATFORM_INFO, PLATFORMS, platformOf, type Platform } from "@/lib/social/platforms";
import { TREG_EST, tregConfigured, tregSupports } from "@/lib/social/treg";
import { bullets, fromAction, read, ToolError, write, type NovaTool } from "../../kit";
import { ago, clip, compactObj, dfsLeftToday, fit, usd, websiteOf } from "./shared";

/**
 * Social (/social): stored platform reads (dfs_cache endpoint "social", one row per platform) and the page's owner
 * controls: refresh the stats, find profile links on the website, and the profile links / LinkedIn page id.
 * Connecting or disconnecting accounts and entering tokens stay on the Social page.
 */

const label = (p: Platform) => PLATFORM_INFO[p].label;
const POST_WORD: Partial<Record<Platform, string>> = { youtube: "videos", tiktok: "videos", pinterest: "pins" };

const postOut = (x: SocialPost) => compactObj({ date: x.date, text: clip(x.title || x.text || "(no text)", 80), type: x.type, url: x.url, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares, engagement: postEngagement(x) });

function platformOut(p: Platform, row: SocialRow | undefined, f: PlatformFigures | null, link: string | undefined, connected: boolean, full: boolean, postsN: number) {
  const byEng = (xs: SocialPost[]) => [...xs].sort((a, b) => postEngagement(b) - postEngagement(a));
  const shown = f?.postsIn.length ? byEng(f.postsIn) : row?.posts ?? [];
  return compactObj({
    platform: label(p), key: p, account_connected: connected,
    data_from: !row ? "nothing read yet" : row.mode === "connected" ? "the connected account (official API through Composio)" : row.mode === "public" ? "public profile numbers" : row.source ?? "token / public search",
    status: row?.status, problem: row?.status === "needs" ? row.needs : row?.status === "error" ? row.error : undefined,
    saved_profile_link: link, account: row?.profile.handle ? `@${row.profile.handle.replace(/^@/, "")}${row.profile.name ? ` (${row.profile.name})` : ""}` : row?.profile.name,
    last_read: row?.fetchedAt,
    followers: f?.followers, followers_previous: f?.followersPrev, follower_growth: f?.growth, follower_growth_previous: f?.growthPrev,
    views: f?.views, views_previous: f?.viewsPrev, views_measure: f?.viewsMetric,
    engagement: f?.engagement, engagement_previous: f?.engagementPrev, engagement_basis: f?.engagementBasis === "posts" ? "likes, comments and shares on posts published in the period" : f?.engagementBasis === "daily" ? "the platform's daily interactions" : undefined,
    [`${POST_WORD[p] ?? "posts"}_in_period`]: row?.posts.length ? f?.posts : undefined, [`${POST_WORD[p] ?? "posts"}_previous_period`]: row?.posts.length ? f?.postsPrev : undefined,
    ...(row?.totals && Object.keys(row.totals).length ? { platform_totals: row.totals, platform_totals_cover: p === "linkedin" ? "all time (reach: last 28 days)" : "the last 28 days (lifetime_* and monthly_views as named)" } : {}),
    all_time: row && (row.profile.posts != null || row.profile.likes != null) ? compactObj({ posts: row.profile.posts, likes: row.profile.likes, views: row.profile.views }) : undefined,
    [f?.postsIn.length ? "top_posts_in_period" : "latest_posts"]: shown.slice(0, postsN).map(postOut),
    youtube_rankings: full ? row?.rankings?.slice(0, 10) : undefined,
    demographics: full ? row?.demographics?.map((d) => ({ dimension: d.dimension, top: d.items.slice(0, 6) })) : undefined,
    not_available: full ? row?.notes : undefined,
  });
}

/** A profile link as the Social settings save it: https:// added, and it must be that platform's own URL. */
function normalLink(p: Platform, v: string): string {
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  if (platformOf(url) !== p) throw new ToolError(`That doesn't look like a ${label(p)} profile URL: ${clip(v, 120)}`);
  return url;
}

const link = z.string().trim().max(300).nullable().optional();
const profileSchema = z.object({
  youtube: link, facebook: link, instagram: link, tiktok: link, x: link, linkedin: link, threads: link, pinterest: link,
  linkedin_org_id: z.string().trim().max(40).nullable().optional().describe("LinkedIn company page id (digits); null removes it"),
});
type ProfileInput = z.output<typeof profileSchema>;

export const socialTools: NovaTool[] = [
  read({
    name: "get_social_media_stats",
    description: "Social media stats per platform (data source, followers and growth, views, engagement, posts and their stats, problems, last read) and combined totals, for the `days` ending yesterday against the period before. platform: one platform in full.",
    schema: z.object({ days: z.number().int().min(7).max(365).default(30), platform: z.enum(PLATFORMS).optional() }),
    async run(ctx, i) {
      const [rows, social, accounts] = await Promise.all([loadSocial(ctx.admin, ctx.client.id), clientSocial(ctx.admin, ctx.client.id), connectedAccounts(ctx.client.id)]);
      const active = new Set<Platform>(accounts.map((a) => a.platform));
      const end = shiftDays(todayIn(ctx.client.timezone), -1);
      const cur: Period = { start: shiftDays(end, -(i.days - 1)), end }, prev = previousOf(cur);
      const figs = new Map<Platform, PlatformFigures>();
      for (const p of PLATFORMS) { const r = rows[p]; if (r) figs.set(p, figures(r, active.has(p), cur, prev)); }
      const withData = [...figs.values()].filter((f) => f.row.status === "ok" || f.row.history.length > 0);
      const list = (i.platform ? [i.platform] : PLATFORMS.filter((p) => rows[p] || social.profiles[p] || active.has(p)));
      const out = {
        period: cur, compared_with: prev,
        combined: i.platform ? undefined : {
          followers: combine(withData, (f) => f.followers, (f) => f.followersPrev),
          follower_growth: combine(withData, (f) => f.growth, (f) => f.growthPrev),
          views_and_impressions: combine(withData, (f) => f.views, (f) => f.viewsPrev),
          engagement: combine(withData, (f) => f.engagement, (f) => f.engagementPrev),
          posts: combine(withData.filter((f) => f.row.posts.length), (f) => f.posts, (f) => f.postsPrev),
          note: "Only additive counts are combined; reach is per platform. previous is shown only when every platform included has it.",
        },
        platforms: [] as ReturnType<typeof platformOut>[],
        nothing_set_up: i.platform ? undefined : PLATFORMS.filter((p) => !rows[p] && !social.profiles[p] && !active.has(p)).map(label),
        linkedin_org_id: typeof social.settings.linkedin_org_id === "string" ? social.settings.linkedin_org_id : undefined,
      };
      let keep = i.platform ? 25 : 3;
      const fill = () => { out.platforms = list.map((p) => platformOut(p, rows[p], figs.get(p) ?? null, social.profiles[p], active.has(p), Boolean(i.platform), keep)); };
      fill();
      return fit(out, () => {
        if (keep <= 0) return false;
        keep = keep > 3 ? 3 : keep - 1;
        fill();
        return true;
      });
    },
    summary: (i) => (i.platform ? `Read ${label(i.platform)} stats` : "Read social media stats"),
  }),

  write({
    name: "refresh_social_stats",
    description: "Read every social platform's stats again now (the Social page's Refresh). Connected accounts are free; YouTube through DataForSEO up to about $0.07; public numbers about $0.002 a platform.",
    schema: z.object({}),
    async prepare(ctx) {
      const [rows, social, accounts] = await Promise.all([loadSocial(ctx.admin, ctx.client.id), clientSocial(ctx.admin, ctx.client.id), connectedAccounts(ctx.client.id)]);
      const active = new Set<Platform>(accounts.map((a) => a.platform));
      const read = new Map<string, string[]>(), unread = new Map<string, string[]>();
      const add = (m: Map<string, string[]>, k: string, p: Platform) => m.set(k, [...(m.get(k) ?? []), label(p)]);
      let worst = 0;
      // the organization's credentials decide the paths too (its tokens, DataForSEO account and treg.to key)
      const [cfg, dfsOn, tregOn] = await Promise.all([configForClient(ctx.client.id).catch(() => null), dfsConfigured(ctx.client.id), tregConfigured(ctx.client.id)]);
      // the path refreshPlatform() takes for each platform
      for (const p of PLATFORMS) {
        const url = social.profiles[p];
        const token = Boolean(social.tokens[p] || (p === "instagram" && social.tokens.facebook) || cfg?.get(PLATFORM_INFO[p].env));
        if (active.has(p) || rows[p]?.mode === "connected") add(read, "connected accounts (free)", p);
        else if (!url && p !== "instagram") add(unread, "no profile link and no connected account", p);
        else if (p === "youtube") {
          if (token) add(read, "YouTube Data API (free)", p);
          else if (dfsOn) { add(read, `public YouTube search through DataForSEO (up to about ${usd(SOCIAL_EST)})`, p); worst += SOCIAL_EST; }
          else add(unread, "no YouTube API key and DataForSEO isn't set up for this organization", p);
        } else if (token) add(read, "the platform's API with the saved token (free)", p);
        else if (url && tregOn && tregSupports(p)) { add(read, `public numbers through treg.to (about ${usd(TREG_EST)} each)`, p); worst += TREG_EST; }
        else add(unread, "not connected (connect on the Social page)", p);
      }
      const n = [...read.values()].reduce((s, ps) => s + ps.length, 0);
      if (!n) return { error: `No social platform can be read: ${[...unread].map(([why, ps]) => `${ps.join(", ")}: ${why}`).join("; ")}. Connect accounts on the Social page (or save profile links) first.` };
      const { left } = await dfsLeftToday(ctx.admin, ctx.client.id);
      return {
        title: `Refresh the social media stats (${n} platform${n === 1 ? "" : "s"})`,
        detail: bullets([
          ...[...read].map(([how, ps]) => `${ps.join(", ")}: ${how}`),
          ...[...unread].map(([why, ps]) => `${ps.join(", ")}: not read, ${why}`),
          worst > 0 ? `At most about ${usd(worst)} in total, within the daily API budget (${usd(left)} left today for this client).` : "No paid calls expected.",
          "Each platform's latest figures and posts are stored; history keeps one point a day.",
        ]),
        expectSeconds: Math.min(150, 15 + n * 12),
      };
    },
    async execute() {
      return fromAction(await refreshSocialNow(), "Social stats refreshed.", ["/social"]);
    },
  }),

  write({
    name: "find_social_profiles",
    description: "Look for the client's social profile links on its website (home, contact and about pages; free) and save the platforms that have no link yet. Existing links are kept.",
    schema: z.object({}),
    async prepare(ctx) {
      const [site, social] = await Promise.all([websiteOf(ctx.admin, ctx.client.id), clientSocial(ctx.admin, ctx.client.id)]);
      if (!site) return { error: "No website is known for this client yet: set the research target or connect Search Console, Bing or Business Profile first." };
      const missing = PLATFORMS.filter((p) => !social.profiles[p]);
      if (!missing.length) return { error: "Every platform already has a profile link saved. Change one with update_social_profiles." };
      return {
        title: `Find social profile links on ${site}`,
        detail: bullets([
          `Reads ${site}'s home, contact and about pages for profile links (free).`,
          `Adds links only for platforms without one: ${missing.map(label).join(", ")}. Saved links stay as they are.`,
        ]),
        expectSeconds: 20,
      };
    },
    async execute() {
      return fromAction(await detectSocialProfiles(), "Done.", ["/social"]);
    },
  }),

  write({
    name: "update_social_profiles",
    description: "Set or remove social profile links (a URL, or null to remove) and the LinkedIn company page id. Platforms not given keep their link. Tokens and account connections are not changed here.",
    schema: profileSchema,
    async prepare(ctx, i) {
      const social = await clientSocial(ctx.admin, ctx.client.id);
      const lines: string[] = [];
      const clean: ProfileInput = {};
      for (const p of PLATFORMS) {
        const v = i[p];
        if (v === undefined) continue;
        const old = social.profiles[p];
        if (v === null || v === "") {
          if (!old) continue;
          clean[p] = null;
          lines.push(`${label(p)}: remove ${old}`);
          continue;
        }
        const url = normalLink(p, v);
        if (url === old) continue;
        clean[p] = url;
        lines.push(`${label(p)}: ${old ? `${old} → ` : ""}${url}`);
      }
      const oldOrg = typeof social.settings.linkedin_org_id === "string" ? social.settings.linkedin_org_id : null;
      if (i.linkedin_org_id !== undefined) {
        const org = i.linkedin_org_id?.replace(/\D/g, "") || null;
        if (i.linkedin_org_id && !org) return { error: "The LinkedIn company page id is a number (it's in the page admin URL, linkedin.com/company/<id>/admin)." };
        if (org !== oldOrg) { clean.linkedin_org_id = org; lines.push(`LinkedIn company page id: ${oldOrg ?? "none"} → ${org ?? "none"}`); }
      }
      if (!lines.length) return { error: "Nothing to change: those links are already saved." };
      return {
        title: lines.length === 1 ? clip(`Social profiles: ${lines[0]}`, 150) : `Update ${lines.length} social profile settings`,
        detail: `${bullets(lines)}\nConnected accounts and tokens aren't touched. Refresh the stats afterwards to read the new profiles.`,
        input: clean,
      };
    },
    async execute(x, i) {
      // apply only the confirmed changes to the links saved now (saveSocialSettings replaces the whole list)
      const social = await clientSocial(x.admin, x.client.id);
      const profiles: Partial<Record<Platform, string>> = { ...social.profiles };
      for (const p of PLATFORMS) {
        if (i[p] === undefined) continue;
        if (i[p]) profiles[p] = i[p]!; else delete profiles[p];
      }
      const oldOrg = typeof social.settings.linkedin_org_id === "string" ? social.settings.linkedin_org_id : undefined;
      const r = await saveSocialSettings({ profiles, tokens: {}, linkedinOrgId: i.linkedin_org_id !== undefined ? (i.linkedin_org_id ?? undefined) : oldOrg });
      return fromAction(r.ok ? { ok: true, message: "Social profile settings saved. Refresh the stats to read them." } : r, "Saved.", ["/social"]);
    },
  }),
];

export const socialLastRead = (rows: Partial<Record<Platform, SocialRow>>) =>
  Object.fromEntries(PLATFORMS.filter((p) => rows[p]).map((p) => [label(p), `${rows[p]!.status}, read ${ago(rows[p]!.fetchedAt)}`]));
