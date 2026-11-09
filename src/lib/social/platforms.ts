/**
 * Social platforms shown on the Social page. Shared by server and client code (no secrets here).
 * Profile URLs live in clients.settings.social_profiles ({ youtube: "https://...", ... });
 * optional per-client tokens live encrypted in clients.settings.social_tokens (same keys).
 */
export const PLATFORMS = ["youtube", "facebook", "instagram", "tiktok", "x", "linkedin", "threads", "pinterest"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PlatformInfo {
  label: string;
  host: RegExp;
  /** env var read when the client has no token of its own */
  env: string;
  /** what the owner must provide before real numbers can be read */
  needs: string;
  /** what the token field on the Social page expects */
  tokenLabel: string;
  /** a public number we can read without the owner's credentials */
  free: boolean;
}

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  youtube: {
    label: "YouTube", host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, env: "YOUTUBE_API_KEY", free: true,
    needs: "Nothing: read from public YouTube search results through DataForSEO. Optional: a Google Cloud API key with \"YouTube Data API v3\" enabled (YOUTUBE_API_KEY, free 10,000 units/day) for exact channel totals and every upload.",
    tokenLabel: "YouTube Data API v3 key (optional)",
  },
  facebook: {
    label: "Facebook", host: /(^|\.)facebook\.com$|(^|\.)fb\.com$/, env: "FACEBOOK_PAGE_ACCESS_TOKEN", free: false,
    needs: "A long-lived Facebook Page access token from a Meta app (Graph API), with pages_read_engagement and pages_show_list, created by a Page admin.",
    tokenLabel: "Facebook Page access token",
  },
  instagram: {
    label: "Instagram", host: /(^|\.)instagram\.com$/, env: "FACEBOOK_PAGE_ACCESS_TOKEN", free: false,
    needs: "An Instagram Business or Creator account linked to the Facebook Page, and the Page access token above with instagram_basic and instagram_manage_insights.",
    tokenLabel: "Page access token (leave empty to reuse the Facebook one)",
  },
  tiktok: {
    label: "TikTok", host: /(^|\.)tiktok\.com$/, env: "TIKTOK_REFRESH_TOKEN", free: false,
    needs: "A TikTok for Developers app with Login Kit + Display API (scopes user.info.basic, user.info.stats, video.list), TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET, and a refresh token from the account owner's OAuth login.",
    tokenLabel: "TikTok OAuth refresh token",
  },
  x: {
    label: "X (Twitter)", host: /(^|\.)(x|twitter)\.com$/, env: "X_BEARER_TOKEN", free: false,
    needs: "An X developer account on the paid pay-per-use API (credits bought in the X developer console) and its app Bearer token. Each refresh reads 1 user + up to 20 posts.",
    tokenLabel: "X API Bearer token",
  },
  linkedin: {
    label: "LinkedIn page", host: /(^|\.)linkedin\.com$/, env: "LINKEDIN_ACCESS_TOKEN", free: false,
    needs: "A LinkedIn app approved for the Community Management API, and an access token (scopes r_organization_social, rw_organization_admin) from an admin of the company page.",
    tokenLabel: "LinkedIn organization admin access token",
  },
  threads: {
    label: "Threads", host: /(^|\.)threads\.(net|com)$/, env: "THREADS_ACCESS_TOKEN", free: false,
    needs: "A Meta app with the Threads API use case and a long-lived Threads user token (threads_basic, threads_manage_insights) from the account owner (valid 60 days, refreshed automatically).",
    tokenLabel: "Threads long-lived access token",
  },
  pinterest: {
    label: "Pinterest", host: /(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, env: "PINTEREST_ACCESS_TOKEN", free: false,
    needs: "A Pinterest developer app (API v5) and an OAuth access token from the business account owner (scopes user_accounts:read, pins:read, boards:read).",
    tokenLabel: "Pinterest API v5 access token",
  },
};

/** Which platform a profile URL belongs to (null for anything else). */
export function platformOf(url: string): Platform | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  // a share or intent link is not a profile
  if (/sharer|share\.php|intent\/|\/share\b|dialog\//i.test(url)) return null;
  for (const p of PLATFORMS) if (PLATFORM_INFO[p].host.test(host)) return p;
  return null;
}

/** The handle / username in a profile URL (e.g. "@ledlightsandsigns" for YouTube). */
export function handleOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    if (["company", "school", "showcase", "in", "channel", "c", "user", "p"].includes(parts[0]) && parts[1]) return decodeURIComponent(parts[1]);
    return decodeURIComponent(parts[0]);
  } catch { return null; }
}

export type SocialProfiles = Partial<Record<Platform, string>>;
