/**
 * Platform registry: the single source of truth for every third-party platform SEO Insights connects to.
 * The public Privacy, Data Deletion and Platforms pages, the in-app Connect panels, the deletion engine and
 * docs/platform-console-values.md (scripts/gen-console-values.mts) all read from here. Adding a platform later
 * needs only a new entry plus its integration code. Shared by server and client code: no secrets here.
 *
 * `scopes` are the read-only permissions SEO Insights needs and asks for. Where a live auth config still
 * requests more (Composio-managed apps), `scopeNote` says so; see docs/platform-audit.md.
 */

export const SITE = {
  product: "SEO Insights",
  tagline: "an invite-only SEO, analytics and social media reporting platform",
  operator: "Waheed Zen LLC",
  operatorKind: "a Montana limited liability company",
  address: "1001 S Main St, Ste 500, Kalispell, MT 59901, United States",
  city: "Kalispell, Montana",
  email: "im@waheedzen.com",
  phone: "+1 (716) 356-9694",
  phoneHref: "tel:+17163569694",
  operatorSite: "https://www.waheedzen.com",
  operatorPrivacy: "https://www.waheedzen.com/legal/privacy/",
  appUrl: "https://seoinsights.waheedzen.com",
  appDomain: "waheedzen.com",
  legalUpdated: "November 23, 2026",
  /** where Disconnect lives in the app (audited) */
  disconnectPath: "Integrations for Google Analytics, Search Console, Business Profile, Bing Webmaster Tools and Microsoft Clarity, or Social media → Connect social accounts for social platforms",
  /** backups: Supabase daily backups kept 7 days on the Pro plan (PITR not enabled); logs: Vercel runtime logs */
  backupDays: 7,
  logDays: 30,
} as const;

export const accessMailto = `mailto:${SITE.email}?subject=${encodeURIComponent("SEO Insights access")}`;
export const deletionMailto = `mailto:${SITE.email}?subject=${encodeURIComponent("Data deletion request")}`;

export type PlatformStatus = "live" | "in_review" | "planned";
export type ConnectionKind = "composio" | "oauth" | "api_key";
export type DeletionNotification = "meta_signed_request" | "tiktok_webhook" | "token_revocation_only";

export interface PlatformScope { scope: string; reason: string }
export interface PolicyRef { label: string; url: string }

export interface PlatformEntry {
  id: string;
  name: string;
  provider: string;
  status: PlatformStatus;
  connection: ConnectionKind;
  /** how the connection is made, in plain words (shown on /platforms) */
  method: string;
  scopes: PlatformScope[];
  /** honest note when a live auth config requests more than `scopes` (flagged in the audit) */
  scopeNote?: string;
  dataAccessed: string[];
  purpose: string;
  readOnly: true;
  revokeSteps: string[];
  revokeUrl: string | null;
  deletionNotification: DeletionNotification;
  policyRefs: PolicyRef[];
  consoleNotes: string;
  /** Composio toolkit slug, when connected through Composio */
  composioToolkit?: string;
  /** social platform key used by the Social page (src/lib/social/platforms.ts) */
  socialKey?: string;
  /** integration_connections.provider for the Google/Microsoft data sources */
  providerKey?: string;
  /** webhook endpoints (paths under the app URL) this platform calls */
  webhooks?: { label: string; path: string }[];
}

const GOOGLE_POLICY: PolicyRef[] = [{ label: "Google API Services User Data Policy", url: "https://developers.google.com/terms/api-services-user-data-policy" }];
const META_POLICY: PolicyRef[] = [
  { label: "Meta Platform Terms", url: "https://developers.facebook.com/terms/" },
  { label: "Meta Developer Policies", url: "https://developers.facebook.com/devpolicy/" },
];
const MS_POLICY: PolicyRef[] = [{ label: "Microsoft APIs Terms of Use", url: "https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use" }];
const GOOGLE_REVOKE = ["Google Account → Security → Your connections to third-party apps & services (myaccount.google.com/connections) → SEO Insights → Delete all connections / Remove access"];
const GOOGLE_REVOKE_URL = "https://myaccount.google.com/connections";
const COMPOSIO_NOTE = "Connected through Composio. Redirect URIs = every Composio callback URL (see docs/platform-console-values.md).";

export const PLATFORMS: PlatformEntry[] = [
  {
    id: "google_signin", name: "Sign in with Google", provider: "Google", status: "live", connection: "oauth",
    method: "Google sign-in (OpenID Connect) through our authentication provider, Supabase Auth.",
    scopes: [
      { scope: "openid", reason: "Confirm who you are when you sign in." },
      { scope: "email", reason: "Match your Google email to the invitation for your SEO Insights account." },
      { scope: "profile", reason: "Show your name and picture in the app." },
    ],
    dataAccessed: ["Name, email address and profile picture, used only to sign you in"],
    purpose: "Let invited users sign in without a separate password.",
    readOnly: true, revokeSteps: GOOGLE_REVOKE, revokeUrl: GOOGLE_REVOKE_URL, deletionNotification: "token_revocation_only",
    policyRefs: GOOGLE_POLICY,
    consoleNotes: "Supabase Auth → Providers → Google. Authorized redirect URI in Google Cloud = https://<supabase-project>.supabase.co/auth/v1/callback.",
  },
  {
    id: "google_search_console", name: "Google Search Console", provider: "Google", status: "live", connection: "composio",
    method: "Google's official sign-in (OAuth 2.0), run by our connection partner Composio.",
    scopes: [{ scope: "https://www.googleapis.com/auth/webmasters.readonly", reason: "Read search queries, clicks, impressions, CTR, positions, page indexing (URL Inspection) and sitemaps for the sites you choose." }],
    scopeNote: "The current Composio-managed Search Console config also requests webmasters (read/write), userinfo.email and userinfo.profile. SEO Insights only uses read calls; switch to our own read-only auth config (see the audit).",
    dataAccessed: ["Search queries, clicks, impressions, CTR and average positions", "Page indexing status (URL Inspection) and sitemaps"],
    purpose: "Show the site owner how their website performs in Google Search, with history and alerts.",
    readOnly: true, revokeSteps: GOOGLE_REVOKE, revokeUrl: GOOGLE_REVOKE_URL, deletionNotification: "token_revocation_only",
    policyRefs: GOOGLE_POLICY, composioToolkit: "google_search_console", providerKey: "gsc",
    consoleNotes: `${COMPOSIO_NOTE} Google Cloud: enable the Search Console API; OAuth consent screen lists webmasters.readonly.`,
  },
  {
    id: "google_analytics", name: "Google Analytics 4", provider: "Google", status: "live", connection: "composio",
    method: "Google's official sign-in (OAuth 2.0), run by our connection partner Composio.",
    scopes: [{ scope: "https://www.googleapis.com/auth/analytics.readonly", reason: "Read aggregated reports (traffic, engagement, events, conversions, channels, devices, locations) for the properties you choose." }],
    scopeNote: "The current Composio-managed Analytics config also requests analytics (edit) and userinfo.profile. SEO Insights only runs reports; switch to our own read-only auth config (see the audit).",
    dataAccessed: ["Aggregated traffic, engagement, events and conversions", "Channels, landing pages, devices and locations (aggregated, no individual visitors)"],
    purpose: "Show the site owner their website traffic and leads in dashboards and reports.",
    readOnly: true, revokeSteps: GOOGLE_REVOKE, revokeUrl: GOOGLE_REVOKE_URL, deletionNotification: "token_revocation_only",
    policyRefs: GOOGLE_POLICY, composioToolkit: "google_analytics", providerKey: "ga4",
    consoleNotes: `${COMPOSIO_NOTE} Google Cloud: enable the Google Analytics Data API and Admin API; consent screen lists analytics.readonly.`,
  },
  {
    id: "google_business_profile", name: "Google Business Profile", provider: "Google", status: "live", connection: "oauth",
    method: "Google's official sign-in (OAuth 2.0) directly with SEO Insights' own Google OAuth client.",
    scopes: [
      { scope: "https://www.googleapis.com/auth/business.manage", reason: "Google offers no read-only Business Profile scope. SEO Insights only reads locations, performance, search keywords and reviews; it never edits a profile, replies or posts." },
      { scope: "openid", reason: "Identify the Google account that connected (account ID), so disconnect and deletion requests can be matched." },
      { scope: "email", reason: "Show which Google account is connected." },
    ],
    dataAccessed: ["Business locations and profile details", "Performance: searches, views, calls, direction requests, website clicks", "Search keywords and reviews"],
    purpose: "Show the business its local search performance and reviews.",
    readOnly: true, revokeSteps: GOOGLE_REVOKE, revokeUrl: GOOGLE_REVOKE_URL, deletionNotification: "token_revocation_only",
    policyRefs: GOOGLE_POLICY, providerKey: "gbp",
    consoleNotes: "Direct OAuth. Google Cloud OAuth client → Authorized redirect URI = https://seoinsights.waheedzen.com/api/integrations/gbp/callback (GOOGLE_GBP_REDIRECT_URI). Business Profile APIs need Google's GBP API access approval.",
  },
  {
    id: "youtube", name: "YouTube", provider: "Google", status: "live", connection: "composio",
    method: "Google's official sign-in (OAuth 2.0), run by our connection partner Composio.",
    scopes: [
      { scope: "https://www.googleapis.com/auth/youtube.readonly", reason: "Read the channel's details, statistics and video list." },
      { scope: "https://www.googleapis.com/auth/yt-analytics.readonly", reason: "Read channel analytics: views, watch time, subscribers gained and lost, top videos and audience." },
    ],
    scopeNote: "The current Composio-managed YouTube config requests write scopes (youtube, youtube.upload, youtube.force-ssl, youtubepartner…) and not yt-analytics.readonly. Switch to our own read-only auth config (see the audit).",
    dataAccessed: ["Channel details, subscriber, view and video counts", "Video list, views, watch time, likes, comments, shares", "Audience age, gender and country (aggregated)"],
    purpose: "Show the channel owner their YouTube growth and engagement.",
    readOnly: true, revokeSteps: GOOGLE_REVOKE, revokeUrl: GOOGLE_REVOKE_URL, deletionNotification: "token_revocation_only",
    policyRefs: [...GOOGLE_POLICY, { label: "YouTube API Services Terms of Service", url: "https://developers.google.com/youtube/terms/api-services-terms-of-service" }],
    composioToolkit: "youtube", socialKey: "youtube",
    consoleNotes: `${COMPOSIO_NOTE} Google Cloud: enable YouTube Data API v3 and YouTube Analytics API.`,
  },
  {
    id: "bing_webmaster", name: "Bing Webmaster Tools", provider: "Microsoft", status: "live", connection: "api_key",
    method: "An API key that the site owner creates in Bing Webmaster Tools and pastes into SEO Insights (stored encrypted).",
    scopes: [{ scope: "Bing Webmaster API key", reason: "Read search performance, queries, pages, crawl and index data for the sites you choose." }],
    dataAccessed: ["Bing clicks, impressions, queries, pages and positions", "Crawl statistics, crawl errors and sitemaps"],
    purpose: "Show the site owner how their website performs in Bing search.",
    readOnly: true, revokeSteps: ["Bing Webmaster Tools → Settings → API access → delete (regenerate) the API key"], revokeUrl: "https://www.bing.com/webmasters/",
    deletionNotification: "token_revocation_only", policyRefs: MS_POLICY, providerKey: "bing",
    consoleNotes: "API key entered in SEO Insights → Integrations. No console callback.",
  },
  {
    id: "microsoft_clarity", name: "Microsoft Clarity", provider: "Microsoft", status: "live", connection: "api_key",
    method: "A project API token (Data Export API) that the site owner creates in Clarity and pastes into SEO Insights (stored encrypted).",
    scopes: [{ scope: "Clarity Data Export API token", reason: "Read aggregated daily usage metrics for the project." }],
    dataAccessed: ["Aggregated website usage metrics: sessions, pages per session, scroll depth, rage and dead clicks, quick backs, by page, device, browser and country"],
    purpose: "Show the site owner how visitors use their website.",
    readOnly: true, revokeSteps: ["Microsoft Clarity → project → Settings → Data Export → delete the API token"], revokeUrl: "https://clarity.microsoft.com/projects",
    deletionNotification: "token_revocation_only", policyRefs: MS_POLICY, providerKey: "clarity",
    consoleNotes: "API token entered in SEO Insights → Integrations. No console callback.",
  },
  {
    id: "facebook_pages", name: "Facebook Pages", provider: "Meta", status: "live", connection: "composio",
    method: "Facebook Login (OAuth 2.0), run by our connection partner Composio.",
    scopes: [
      { scope: "public_profile", reason: "Identify the person who connected (app-scoped ID), so disconnect and deletion requests can be matched." },
      { scope: "pages_show_list", reason: "List the Pages you manage so the right business Page is reported." },
      { scope: "pages_read_engagement", reason: "Read the Page's followers, posts and post engagement." },
      { scope: "read_insights", reason: "Read Page insights such as views, reach and engagement over time." },
    ],
    scopeNote: "The current Composio-managed Facebook config also requests email, business_management, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_manage_metadata and pages_messaging. SEO Insights never uses them; switch to our own Meta app (see the audit).",
    dataAccessed: ["Page name, followers and likes", "Page posts with reactions, comments and shares", "Page insights: views, reach and engagement by day"],
    purpose: "Show the Page owner their Facebook growth and engagement.",
    readOnly: true,
    revokeSteps: ["Facebook → Settings & privacy → Settings → Business integrations (and Apps and websites) → SEO Insights → Remove"],
    revokeUrl: "https://www.facebook.com/settings?tab=business_tools",
    deletionNotification: "meta_signed_request", policyRefs: META_POLICY, composioToolkit: "facebook", socialKey: "facebook",
    webhooks: [
      { label: "Deauthorize callback URL", path: "/api/platform-webhooks/meta/facebook/deauthorize" },
      { label: "Data deletion request URL", path: "/api/platform-webhooks/meta/facebook/delete" },
    ],
    consoleNotes: "Meta app (Facebook Login for Business) → Settings: Valid OAuth Redirect URIs = Composio callbacks; Deauthorize and Data Deletion callbacks = ours (META_APP_SECRET).",
  },
  {
    id: "instagram", name: "Instagram", provider: "Meta", status: "live", connection: "composio",
    method: "Instagram Login for professional accounts (OAuth 2.0), run by our connection partner Composio.",
    scopes: [
      { scope: "instagram_business_basic", reason: "Read the professional account's profile, follower count and media list." },
      { scope: "instagram_business_manage_insights", reason: "Read account and media insights: reach, views, engagement and follower demographics." },
    ],
    scopeNote: "The current Composio-managed Instagram config also requests instagram_business_manage_messages, instagram_business_manage_comments and instagram_business_content_publish. SEO Insights never uses them; switch to our own Meta app (see the audit).",
    dataAccessed: ["Profile (username, name, followers, following, media count)", "Media with likes and comments", "Account insights: reach, views, interactions and follower demographics"],
    purpose: "Show the account owner their Instagram growth and engagement.",
    readOnly: true,
    revokeSteps: ["Instagram → Settings → Website permissions → Apps and websites → SEO Insights → Remove (or Facebook → Business integrations if connected through a Page)"],
    revokeUrl: "https://www.instagram.com/accounts/manage_access/",
    deletionNotification: "meta_signed_request", policyRefs: META_POLICY, composioToolkit: "instagram", socialKey: "instagram",
    webhooks: [
      { label: "Deauthorize callback URL", path: "/api/platform-webhooks/meta/instagram/deauthorize" },
      { label: "Data deletion request URL", path: "/api/platform-webhooks/meta/instagram/delete" },
    ],
    consoleNotes: "Meta app → Instagram API with Instagram Login → Business login settings: OAuth redirect URIs = Composio callbacks; Deauthorize and Data deletion URLs = ours (INSTAGRAM_APP_SECRET).",
  },
  {
    id: "threads", name: "Threads", provider: "Meta", status: "in_review", connection: "composio",
    method: "Threads sign-in (OAuth 2.0) with SEO Insights' own Meta app, run by our connection partner Composio.",
    scopes: [
      { scope: "threads_basic", reason: "Read the profile name, username and picture to label the account in your dashboard." },
      { scope: "threads_manage_insights", reason: "Read account and post insights: views, likes, replies, reposts, quotes, followers and demographics." },
    ],
    dataAccessed: ["Profile (username, name, picture, bio)", "Account and post insights: views, likes, replies, reposts, quotes, follower counts and demographics where available"],
    purpose: "Show the account owner their Threads growth and engagement in SEO Insights dashboards and reports.",
    readOnly: true,
    revokeSteps: ["Threads → Settings → Account → Website permissions → Apps and websites → Active → SEO Insights → Remove"],
    revokeUrl: "https://www.threads.com/settings/account",
    deletionNotification: "meta_signed_request", policyRefs: META_POLICY, composioToolkit: "threads", socialKey: "threads",
    webhooks: [
      { label: "Uninstall callback URL", path: "/api/platform-webhooks/meta/threads/uninstall" },
      { label: "Delete callback URL", path: "/api/platform-webhooks/meta/threads/delete" },
    ],
    consoleNotes: "Meta app → Use cases → Access the Threads API → Settings: Redirect Callback URLs = Composio callbacks; Uninstall/Delete callbacks = ours (THREADS_APP_SECRET); Threads Display Name = SEO Insights.",
  },
  {
    id: "x", name: "X (formerly Twitter)", provider: "X Corp.", status: "in_review", connection: "composio",
    method: "X sign-in (OAuth 2.0 with PKCE) with SEO Insights' own X app, run by our connection partner Composio.",
    scopes: [
      { scope: "tweet.read", reason: "Read the account's own posts and their public metrics." },
      { scope: "users.read", reason: "Read the profile and follower/following counts." },
      { scope: "follows.read", reason: "Read follower and following counts." },
      { scope: "offline.access", reason: "Keep the read connection working without asking you to sign in every two hours." },
    ],
    dataAccessed: ["Profile, follower and following counts", "The account's posts and their public metrics (impressions, likes, replies, reposts, quotes)"],
    purpose: "Show the account owner their X growth and engagement.",
    readOnly: true,
    revokeSteps: ["X → Settings and privacy → Security and account access → Apps and sessions → Connected apps → SEO Insights → Revoke app permissions"],
    revokeUrl: "https://x.com/settings/connected_apps",
    deletionNotification: "token_revocation_only",
    policyRefs: [{ label: "X Developer Agreement and Policy", url: "https://developer.x.com/en/developer-terms" }],
    composioToolkit: "twitter", socialKey: "x",
    consoleNotes: "X developer portal → app → User authentication settings: App permissions Read; Type Web App; Callback URI = Composio callbacks; Website, Terms and Privacy URLs = ours.",
  },
  {
    id: "tiktok", name: "TikTok", provider: "TikTok", status: "in_review", connection: "composio",
    method: "TikTok Login Kit (OAuth 2.0) with SEO Insights' own TikTok app, run by our connection partner Composio.",
    scopes: [
      { scope: "user.info.basic", reason: "Read the account's open ID, display name and avatar to label it." },
      { scope: "user.info.profile", reason: "Read the profile link and bio shown with the account." },
      { scope: "user.info.stats", reason: "Read follower, following, likes and video counts." },
      { scope: "video.list", reason: "Read the account's public videos and their view, like, comment and share counts." },
    ],
    dataAccessed: ["Basic and profile info (display name, avatar, profile link, bio)", "Follower, following, likes and video counts", "Public videos and their metrics"],
    purpose: "Show the account owner their TikTok growth and engagement.",
    readOnly: true,
    revokeSteps: ["TikTok → Profile → Menu → Settings and privacy → Security & permissions → Apps and services permissions → SEO Insights → Remove access"],
    revokeUrl: null,
    deletionNotification: "tiktok_webhook",
    policyRefs: [{ label: "TikTok Developer Terms of Service", url: "https://www.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en" }],
    composioToolkit: "tiktok", socialKey: "tiktok",
    webhooks: [{ label: "Webhook callback URL", path: "/api/platform-webhooks/tiktok" }],
    consoleNotes: "TikTok for Developers → app: Web platform, verified domain, Login Kit redirect URI = Composio callbacks; Webhooks callback URL = ours (TIKTOK_CLIENT_SECRET).",
  },
  {
    id: "pinterest", name: "Pinterest", provider: "Pinterest", status: "in_review", connection: "composio",
    method: "Pinterest sign-in (OAuth 2.0), run by our connection partner Composio.",
    scopes: [
      { scope: "user_accounts:read", reason: "Read the business profile and account analytics (impressions, saves, clicks, outbound clicks)." },
      { scope: "boards:read", reason: "Read the account's public boards." },
      { scope: "pins:read", reason: "Read the account's public Pins and their analytics." },
    ],
    scopeNote: "The current Composio-managed Pinterest config also requests boards:write, pins:write, user_accounts:write and secret-board scopes. SEO Insights never uses them; switch to our own Pinterest app (see the audit).",
    dataAccessed: ["Profile (username, business name, followers, monthly views)", "Boards and Pins", "Account and Pin analytics: impressions, engagements, saves, Pin clicks, outbound clicks"],
    purpose: "Show the account owner their Pinterest growth and engagement.",
    readOnly: true,
    revokeSteps: ["Pinterest → Settings → Security and logins (Apps) → SEO Insights → Revoke access"],
    revokeUrl: "https://www.pinterest.com/settings/security",
    deletionNotification: "token_revocation_only",
    policyRefs: [{ label: "Pinterest Developer Guidelines", url: "https://policy.pinterest.com/en/developer-guidelines" }],
    composioToolkit: "pinterest", socialKey: "pinterest",
    consoleNotes: "Pinterest developers → app: Redirect URIs = Composio callbacks; request Standard access with a demo video.",
  },
  {
    id: "linkedin", name: "LinkedIn Pages", provider: "LinkedIn", status: "live", connection: "composio",
    method: "LinkedIn sign-in (OAuth 2.0), run by our connection partner Composio.",
    scopes: [
      { scope: "r_organization_admin", reason: "Find the company pages you administer and read page statistics and follower counts." },
      { scope: "r_organization_social", reason: "Read the page's posts and their statistics (impressions, clicks, reactions, shares)." },
    ],
    scopeNote: "No LinkedIn auth config exists yet; the first Connect creates a Composio-managed one with Composio's default scopes. Create our own read-only LinkedIn app config first (see the audit).",
    dataAccessed: ["Company page name and follower count", "Post statistics by day: impressions, clicks, reactions, comments, shares", "Page views"],
    purpose: "Show the company page admin their LinkedIn page growth and engagement.",
    readOnly: true,
    revokeSteps: ["LinkedIn → Settings & Privacy → Data privacy → Other applications → Permitted services → SEO Insights → Remove"],
    revokeUrl: "https://www.linkedin.com/psettings/permitted-services",
    deletionNotification: "token_revocation_only",
    policyRefs: [{ label: "LinkedIn API Terms of Use", url: "https://www.linkedin.com/legal/l/api-terms-of-use" }],
    composioToolkit: "linkedin", socialKey: "linkedin",
    consoleNotes: "LinkedIn developer portal → app → Auth: Authorized redirect URLs = Composio callbacks; product Community Management API (read).",
  },
];

/** Entries shown publicly and in the app (planned ones are hidden everywhere). */
export const publicPlatforms = () => PLATFORMS.filter((p) => p.status !== "planned");
export const platformById = (id: string) => PLATFORMS.find((p) => p.id === id) ?? null;
export const platformBySocial = (key: string) => PLATFORMS.find((p) => p.socialKey === key) ?? null;
export const platformByProvider = (key: string) => PLATFORMS.find((p) => p.providerKey === key) ?? null;

/** Every OAuth redirect URL Composio uses; all must be allow-listed in each platform console. */
export const COMPOSIO_REDIRECTS = [
  "https://backend.composio.dev/api/v1/auth-apps/add",
  "https://backend.composio.dev/api/v3/toolkits/auth/callback",
  "https://backend.composio.dev/api/v3.1/toolkits/auth/callback",
] as const;

export interface Processor { name: string; purpose: string; data: string; url: string }

/** Service providers that process data for SEO Insights (audited; see docs/platform-audit.md). */
export const PROCESSORS: Processor[] = [
  { name: "Vercel", purpose: "Hosting, serverless functions, scheduled jobs and server logs", data: "All data in transit to and from the app; request logs (IP address, browser, pages, timestamps)", url: "https://vercel.com/legal/privacy-policy" },
  { name: "Supabase", purpose: "Database, file storage and user authentication", data: "Account details, workspace settings, encrypted tokens and keys, stored metrics and reports", url: "https://supabase.com/privacy" },
  { name: "Composio", purpose: "Runs the OAuth sign-in for connected platforms and stores their access tokens; executes read-only API calls", data: "Access tokens and the read-only data returned by connected Google and social accounts", url: "https://composio.dev/privacy" },
  { name: "DataForSEO", purpose: "Keyword, search result, backlink, competitor, business listing and site audit data", data: "Domains, URLs, keywords, business names and locations (no personal account data)", url: "https://dataforseo.com/privacy-policy" },
  { name: "Anthropic", purpose: "AI-generated insights, summaries, recommendations and PDF import", data: "Aggregated metrics, search queries, page URLs and titles, social account statistics and uploaded report text (no passwords, tokens or payment details)", url: "https://www.anthropic.com/legal/privacy" },
  { name: "Google (Sign in with Google)", purpose: "Optional sign-in", data: "Name, email address and profile picture", url: "https://policies.google.com/privacy" },
  { name: "Resend", purpose: "Optional alert emails to workspace owners and admins", data: "Recipient email address and alert text", url: "https://resend.com/legal/privacy-policy" },
  { name: "Local Brand Manager", purpose: "Business Profile metrics, keywords, reviews and geogrids for locations the agency manages there", data: "Location IDs and the metrics returned (no personal account data)", url: "https://localbrandmanager.com/" },
  { name: "SEOSignalX", purpose: "Saved SEO audits (E-E-A-T, semantic, speed, robots.txt, crawl) for the client's website", data: "The website's domain; audit results are read back", url: "https://seosignalx.com/" },
  { name: "Google PageSpeed Insights and Chrome UX Report", purpose: "Page speed and Core Web Vitals", data: "Public page URLs only", url: "https://policies.google.com/privacy" },
  { name: "OpenStreetMap Nominatim", purpose: "Turns city names from analytics into map coordinates", data: "City, region and country names only", url: "https://osmfoundation.org/wiki/Privacy_Policy" },
];
