/**
 * The integration registry: every organization-configurable credential the app reads, grouped by integration.
 * One source of truth for the Integrations tab (cards and credential fields), the credential service (which keys
 * an organization may store), runtime configuration (which keys features ask for) and the PDF setup guides
 * (src/lib/org/guides.ts adds the step-by-step docs per integration id).
 *
 * Keys are the names the app used as environment variables, so an organization's stored value simply replaces
 * the old Vercel variable. Platform infrastructure variables (database, encryption key, cron secret, app URL,
 * platform alerts) are NOT here: they stay in the hosting environment (PLATFORM_ENV below).
 *
 * No server-only code here: the client components render from this list too (it holds no values).
 */
export type IntegrationCategory = "ai" | "google" | "seo" | "analytics" | "social" | "other";

export const CATEGORIES: { id: IntegrationCategory; label: string }[] = [
  { id: "ai", label: "AI providers" },
  { id: "google", label: "Google services" },
  { id: "seo", label: "SEO and research" },
  { id: "analytics", label: "Website analytics" },
  { id: "social", label: "Social media" },
  { id: "other", label: "Other" },
];

export interface CredentialField {
  /** stored key = the former environment variable name */
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface IntegrationDef {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** what in SEO Insights stops working without it */
  features: string[];
  fields: CredentialField[];
  /** where to get the credentials */
  consoleUrl?: string;
  docsUrl?: string;
  /** OAuth redirect path on this deployment (shown with a copy button) */
  redirectPath?: string;
  /** connected per client (e.g. Google Analytics through Composio, Clarity token) rather than by credentials */
  perClient?: string;
  /** a connection test exists for it (src/lib/org/tests.ts) */
  testable?: boolean;
}

const f = (key: string, label: string, opts: Partial<CredentialField> = {}): CredentialField => ({ key, label, secret: true, required: true, ...opts });

/** Platform names as their owners write them (field labels of the Composio social auth configs). */
const SOCIAL_LABEL = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", THREADS: "Threads", TIKTOK: "TikTok", TWITTER: "X (Twitter)", LINKEDIN: "LinkedIn", PINTEREST: "Pinterest", YOUTUBE: "YouTube" } as const;

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "anthropic", name: "Anthropic Claude", category: "ai",
    description: "The AI behind Nova, the SEO roadmap, AI quick wins, insights, the SEO Coach, indexing diagnoses, site audit fixes, alt text, fan-out queries and security fix plans.",
    features: ["Nova chat", "SEO roadmap", "AI quick wins", "AI insights and 30-day strategy", "SEO Coach", "Indexing diagnosis", "Site audit AI fixes and alt text", "Fan-out queries", "Security fix plan", "Blog post reading", "SEO Toolkit AI tools", "PDF report import"],
    fields: [f("ANTHROPIC_API_KEY", "API key", { placeholder: "sk-ant-…", help: "Console → API keys → Create key." })],
    consoleUrl: "https://platform.claude.com/settings/keys", docsUrl: "https://docs.anthropic.com/en/api/getting-started", testable: true,
  },
  // the AI platforms Fan-Out Queries asks for their real web searches (Claude uses the Anthropic key above)
  {
    id: "openai", name: "OpenAI (ChatGPT)", category: "ai",
    description: "ChatGPT's real web searches for a keyword in Fan-Out Queries (OpenAI Responses API with web search).",
    features: ["Fan-out queries: ChatGPT"],
    fields: [
      f("OPENAI_API_KEY", "API key", { placeholder: "sk-…", help: "platform.openai.com → API keys → Create new secret key." }),
      f("OPENAI_SEARCH_MODEL", "Model", { secret: false, required: false, placeholder: "gpt-6.2-astra", help: "Leave empty for the default; any model that supports the web_search tool." }),
    ],
    consoleUrl: "https://platform.openai.com/api-keys", docsUrl: "https://platform.openai.com/docs/guides/tools-web-search",
  },
  {
    id: "gemini", name: "Google Gemini", category: "ai",
    description: "Gemini's real Google searches for a keyword in Fan-Out Queries (Gemini API grounding with Google Search).",
    features: ["Fan-out queries: Gemini"],
    fields: [
      f("GEMINI_API_KEY", "API key", { placeholder: "AIza…", help: "Google AI Studio → Get API key." }),
      f("GEMINI_SEARCH_MODEL", "Model", { secret: false, required: false, placeholder: "gemini-4-hydrogen", help: "Leave empty for the default; any model that supports Google Search grounding." }),
    ],
    consoleUrl: "https://aistudio.google.com/apikey", docsUrl: "https://ai.google.dev/gemini-api/docs/google-search",
  },
  {
    id: "xai", name: "xAI (Grok)", category: "ai",
    description: "Grok's answers and sources for a keyword in Fan-Out Queries (xAI API with web search; its searches show when xAI returns them).",
    features: ["Fan-out queries: Grok"],
    fields: [
      f("XAI_API_KEY", "API key", { placeholder: "xai-…", help: "console.x.ai → API keys → Create API key." }),
      f("XAI_SEARCH_MODEL", "Model", { secret: false, required: false, placeholder: "grok-4.7", help: "Leave empty for the default." }),
    ],
    consoleUrl: "https://console.x.ai", docsUrl: "https://docs.x.ai/docs/guides/tools/search-tools",
  },
  {
    id: "perplexity", name: "Perplexity", category: "ai",
    description: "Perplexity's real web searches and sources for a keyword in Fan-Out Queries (Perplexity Agent API with web search).",
    features: ["Fan-out queries: Perplexity"],
    fields: [
      f("PERPLEXITY_API_KEY", "API key", { placeholder: "pplx-…", help: "perplexity.ai → Settings → API → Generate key." }),
      f("PERPLEXITY_SEARCH_MODEL", "Model", { secret: false, required: false, placeholder: "openai/gpt-5.6-luna", help: "Leave empty for the default." }),
    ],
    consoleUrl: "https://www.perplexity.ai/settings/api", docsUrl: "https://docs.perplexity.ai",
  },
  {
    id: "dataforseo", name: "DataForSEO", category: "seo",
    description: "Backlinks, rankings, keyword research, competitors, site audits, Lighthouse, local SEO, reviews, AI visibility and search volumes. Paid per request.",
    features: ["Backlinks", "Organic keywords", "Keyword research", "Competitors", "Site audit and Lighthouse", "Rank tracking", "Local SEO and map grids", "Reviews on other platforms", "AI visibility (ChatGPT, Perplexity, Gemini)", "Search volumes"],
    fields: [f("DATAFORSEO_LOGIN", "API login (email)", { secret: false, placeholder: "you@company.com" }), f("DATAFORSEO_PASSWORD", "API password", { help: "Dashboard → API Access → API password (not your account password)." })],
    consoleUrl: "https://app.dataforseo.com/api-access", docsUrl: "https://docs.dataforseo.com/v3/", testable: true,
  },
  {
    id: "google_oauth", name: "Google Cloud OAuth (Business Profile)", category: "google",
    description: "Your Google Cloud OAuth app, used to connect Google Business Profile accounts and read profiles, reviews, posts and performance.",
    features: ["Google Business Profile metrics, keywords, reviews, replies and posts"],
    fields: [
      f("GOOGLE_GBP_CLIENT_ID", "OAuth client ID", { secret: false, placeholder: "1234-abc.apps.googleusercontent.com" }),
      f("GOOGLE_GBP_CLIENT_SECRET", "OAuth client secret", { placeholder: "GOCSPX-…" }),
      f("GOOGLE_GBP_REDIRECT_URI", "Redirect URI override", { secret: false, required: false, help: "Leave empty to use the redirect URI shown above." }),
    ],
    redirectPath: "/api/integrations/gbp/callback",
    consoleUrl: "https://console.cloud.google.com/apis/credentials", docsUrl: "https://developers.google.com/my-business/content/basic-setup", testable: true,
  },
  {
    id: "google_api", name: "Google API keys", category: "google",
    description: "Optional API keys for Google services called without a user login: PageSpeed Insights / Chrome UX Report and the YouTube Data API.",
    features: ["Lighthouse and real-user (CrUX) data", "YouTube channel statistics without DataForSEO"],
    fields: [
      f("GOOGLE_API_KEY", "Google API key", { required: false, help: "Used for Business Profile request quotas and Chrome UX Report." }),
      f("PAGESPEED_API_KEY", "PageSpeed Insights API key", { required: false }),
      f("YOUTUBE_API_KEY", "YouTube Data API key", { required: false }),
    ],
    consoleUrl: "https://console.cloud.google.com/apis/credentials", docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started", testable: true,
  },
  {
    id: "composio", name: "Composio", category: "google",
    description: "Handles the Google Analytics, Search Console and social media logins (OAuth) for each client, and reads their data.",
    features: ["Google Analytics 4", "Google Search Console", "Connected social accounts (Facebook, Instagram, Threads, TikTok, X, LinkedIn, Pinterest, YouTube)"],
    fields: [
      f("COMPOSIO_API_KEY", "API key"),
      f("COMPOSIO_AUTH_CONFIG_GA4", "Google Analytics auth config ID", { secret: false, placeholder: "ac_…" }),
      f("COMPOSIO_AUTH_CONFIG_GSC", "Search Console auth config ID", { secret: false, placeholder: "ac_…" }),
      f("COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS", "Google Analytics toolkit version", { secret: false, required: false }),
      f("COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE", "Search Console toolkit version", { secret: false, required: false }),
      ...(["FACEBOOK", "INSTAGRAM", "THREADS", "TIKTOK", "TWITTER", "LINKEDIN", "PINTEREST", "YOUTUBE"] as const).map((p) =>
        f(`COMPOSIO_AUTH_CONFIG_${p}`, `${SOCIAL_LABEL[p]} auth config ID`, { secret: false, required: false, placeholder: "ac_…" })),
    ],
    consoleUrl: "https://dashboard.composio.dev", docsUrl: "https://docs.composio.dev", testable: true,
  },
  { id: "ga4", name: "Google Analytics 4", category: "google", description: "Traffic, leads and engagement. Each client connects its own Google account through Composio.", features: ["Analytics screens", "Reports"], fields: [], perClient: "Connect per client under Integrations → Google Analytics 4 (needs Composio).", docsUrl: "https://support.google.com/analytics/answer/9304153" },
  { id: "gsc", name: "Google Search Console", category: "google", description: "Search clicks, queries, pages and indexing. Each client connects its own Google account through Composio.", features: ["Search Console screens", "Indexing", "Reports"], fields: [], perClient: "Connect per client under Integrations → Search Console (needs Composio).", docsUrl: "https://support.google.com/webmasters/answer/9008080" },
  {
    id: "lbm", name: "Local Brand Manager", category: "seo",
    description: "Business Profile performance, keywords, reviews and geogrid rankings for locations managed in Local Brand Manager.",
    features: ["Business Profile data via LBM", "Geogrid rankings"],
    fields: [f("LOCAL_BRAND_MANAGER_API_TOKEN", "API token")], docsUrl: "https://localbrandmanager.com", testable: true,
  },
  {
    id: "seosignalx", name: "SEOSignalX", category: "seo",
    description: "Audits, patches and on-page signals from SEOSignalX's MCP server.",
    features: ["SEOSignalX screens"],
    fields: [f("SEOSIGNALX_MCP_TOKEN", "MCP token")], docsUrl: "https://seosignalx.com", testable: true,
  },
  {
    id: "bing", name: "Bing Webmaster Tools", category: "analytics",
    description: "Bing search performance and crawl health.",
    features: ["Bing Webmaster screen", "Reports"],
    fields: [f("BING_WEBMASTER_API_KEY", "API key", { help: "Bing Webmaster Tools → Settings → API access → API key." })],
    consoleUrl: "https://www.bing.com/webmasters", docsUrl: "https://learn.microsoft.com/en-us/bingwebmaster/getting-access", testable: true,
  },
  { id: "clarity", name: "Microsoft Clarity", category: "analytics", description: "Rage clicks, dead clicks, JavaScript errors and session recordings. Each client connects its own Clarity project token.", features: ["Clarity screen", "Recordings and errors"], fields: [], perClient: "Connect per client under Integrations → Microsoft Clarity (project Settings → Data export → token).", docsUrl: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api" },
  {
    id: "meta", name: "Meta (Facebook / Instagram) app", category: "social",
    description: "Your Meta app secrets, used to verify Meta's data-deletion and deauthorize callbacks.",
    features: ["Meta deauthorize and data deletion callbacks"],
    fields: [f("META_APP_SECRET", "Facebook app secret", { required: false }), f("INSTAGRAM_APP_SECRET", "Instagram app secret", { required: false })],
    consoleUrl: "https://developers.facebook.com/apps", docsUrl: "https://developers.facebook.com/docs/development/create-an-app",
  },
  {
    id: "threads", name: "Threads app", category: "social",
    description: "Your Threads app secret, used to verify Threads' uninstall and data-deletion callbacks.",
    features: ["Threads uninstall and data deletion callbacks"],
    fields: [f("THREADS_APP_ID", "App ID (for reference, not used by the app)", { secret: false, required: false }), f("THREADS_APP_SECRET", "App secret", { required: false })],
    consoleUrl: "https://developers.facebook.com/apps", docsUrl: "https://developers.facebook.com/docs/threads",
  },
  {
    id: "tiktok", name: "TikTok app", category: "social",
    description: "TikTok app credentials for the older token setup (connected accounts use Composio).",
    features: ["TikTok (token setup)"],
    fields: [f("TIKTOK_CLIENT_KEY", "Client key", { secret: false, required: false }), f("TIKTOK_CLIENT_SECRET", "Client secret", { required: false }), f("TIKTOK_REFRESH_TOKEN", "Refresh token", { required: false })],
    consoleUrl: "https://developers.tiktok.com/apps", docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
  },
  {
    id: "social_tokens", name: "Social access tokens (legacy)", category: "social",
    description: "Access tokens for the older, token-based social setup. Connected accounts through Composio don't need these.",
    features: ["Social media (token setup)"],
    fields: [
      f("FACEBOOK_PAGE_ACCESS_TOKEN", "Facebook page access token", { required: false }),
      f("THREADS_ACCESS_TOKEN", "Threads access token", { required: false }),
      f("X_BEARER_TOKEN", "X (Twitter) bearer token", { required: false }),
      f("LINKEDIN_ACCESS_TOKEN", "LinkedIn access token", { required: false }),
      f("PINTEREST_ACCESS_TOKEN", "Pinterest access token", { required: false }),
    ],
  },
  { id: "custom", name: "Custom variables", category: "other", description: "Extra configuration values for this organization (uppercase names like MY_SETTING). Encrypted like every credential.", features: [], fields: [] },
];

export const integrationById = (id: string) => INTEGRATIONS.find((i) => i.id === id);
/** key → integration id, for every registered key */
export const KEY_OWNER: Record<string, string> = Object.fromEntries(INTEGRATIONS.flatMap((i) => i.fields.map((fl) => [fl.key, i.id])));
export const isRegisteredKey = (key: string) => key in KEY_OWNER;

/** Environment variables that stay in the hosting environment (platform infrastructure, not per organization). */
export const PLATFORM_ENV: { key: string; why: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", why: "Database address, needed before any organization is known." },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", why: "Public database key used by the browser and sign-in." },
  { key: "SUPABASE_SERVICE_ROLE_KEY", why: "Server database access, including reading encrypted credentials." },
  { key: "TOKEN_ENCRYPTION_KEY", why: "Master key that encrypts every stored credential; must stay outside the database." },
  { key: "CRON_SECRET", why: "Authenticates the scheduler's calls to the background jobs." },
  { key: "NEXT_PUBLIC_APP_URL", why: "This deployment's address (OAuth redirect URIs, links in emails)." },
  { key: "CHROME_EXECUTABLE_PATH", why: "Local PDF rendering only (not used on Vercel)." },
  { key: "RESEND_API_KEY", why: "The platform's own email sending (invitations and alerts)." },
  { key: "ALERT_EMAIL_FROM", why: "Sender address of platform emails." },
  { key: "ALERT_WEBHOOK_URL", why: "Platform operations alerts." },
];
