/**
 * Setup guides for every integration in the registry (src/lib/org/registry.ts): what it's for, what account it
 * needs, numbered steps to create the account and each credential, APIs and OAuth scopes, the addresses to copy,
 * where each field goes in the app, how to test it, common errors, expiry and a checklist. The Integrations tab
 * shows them inline ("Setup instructions", guideFor) and /api/org/guides renders them as PDFs.
 *
 * Written for an organization owner without technical knowledge. Checked against each provider's documentation
 * on GUIDES_UPDATED; what couldn't be confirmed there is listed per guide (`unverified`).
 * No values here, only placeholders: {app} (product name), {org} (organization), {appUrl} and {appHost} (this
 * deployment), {redirectUri} (this deployment's OAuth callback for the integration). Client-safe: no server-only
 * imports.
 *
 * Text may use **bold** for labels on screen and `code` for values to copy; bare https:// links become links.
 */
import { COMPOSIO_REDIRECTS, platformById } from "@/config/platforms";
import { CATEGORIES, INTEGRATIONS, integrationById, type IntegrationCategory, type IntegrationDef } from "./registry";

export const GUIDES_VERSION = "1.0";
/** when the instructions were last checked against the providers' documentation (YYYY-MM-DD) */
export const GUIDES_UPDATED = "2026-11-27";

export interface GuideLink { label: string; url: string }
export interface GuideStep { text: string; sub?: string[] }
export interface GuidePart { title: string; intro?: string; steps: GuideStep[]; note?: string }
export interface GuideProblem { problem: string; fix: string }
export interface GuideScope { scope: string; why: string }
export interface GuideAddress { label: string; value: string; note?: string }
export interface GuideField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** where the value comes from */
  source: string;
}

export interface Guide {
  id: string;
  name: string;
  category: IntegrationCategory;
  categoryLabel: string;
  /** registry description */
  description: string;
  /** what in the app depends on it (registry) */
  features: string[];
  /** organization credentials, a per-client connection, or organization settings (custom variables) */
  scope: "organization" | "client" | "settings";
  testable: boolean;
  purpose: string;
  cost: string;
  time: string;
  requirements: string[];
  parts: GuidePart[];
  /** Google Cloud APIs to enable */
  apis: string[];
  scopes: GuideScope[];
  /** consent screen setup */
  consent: string[];
  /** addresses to copy into the provider's console (redirect and callback URLs) */
  addresses: GuideAddress[];
  /** every registry field with where its value comes from (empty for per-client integrations) */
  fields: GuideField[];
  /** where to enter (or connect) it in the app */
  enter: GuidePart;
  test: string[];
  problems: GuideProblem[];
  renewal: string[];
  checklist: string[];
  links: GuideLink[];
  /** what couldn't be confirmed in the provider's official documentation */
  unverified: string[];
}

export interface GuideContext {
  /** this deployment's address (NEXT_PUBLIC_APP_URL) */
  appUrl?: string;
  /** the product name shown to users (an organization's white-label name) */
  appName?: string;
  orgName?: string;
}

type GuideSource = Omit<Guide, "id" | "name" | "category" | "categoryLabel" | "description" | "features" | "scope" | "testable" | "fields" | "enter" | "apis" | "scopes" | "consent" | "addresses"> & {
  apis?: string[];
  scopes?: GuideScope[];
  consent?: string[];
  addresses?: GuideAddress[];
  /** registry key → where its value comes from */
  fields?: Record<string, string>;
  /** per-client integrations and custom variables: how it's set up in the app */
  enter?: GuidePart;
  /** extra lines for the generated "Enter it in the app" steps */
  enterNote?: string;
};

/* ------------------------------------------------------------------------------------------------ helpers */

/** Composio's OAuth callback (current API version) for your own developer apps */
export const COMPOSIO_CALLBACK = COMPOSIO_REDIRECTS.find((u) => u.includes("/api/v3/")) ?? COMPOSIO_REDIRECTS[0];

const hooks = (platformId: string): GuideAddress[] =>
  (platformById(platformId)?.webhooks ?? []).map((w) => ({ label: w.label, value: `{appUrl}${w.path}` }));
const scopesOf = (platformId: string): GuideScope[] =>
  (platformById(platformId)?.scopes ?? []).map((s) => ({ scope: s.scope, why: s.reason }));

const CLIENT_PICK = "Pick the client in the client switcher at the top of {app}.";
const CONNECTIONS = "Open **Integrations** in the sidebar and go to **Client connections**.";

/* ------------------------------------------------------------------------------------------------- guides */

const SOURCES: Record<string, GuideSource> = {
  anthropic: {
    purpose: "Claude is the AI behind Nova, the SEO roadmap, AI quick wins, insights and every other AI feature. {app} calls Anthropic with your organization's own API key, so the usage is billed to your Anthropic account.",
    cost: "Paid as you go from prepaid credits bought in the Claude Console. No subscription needed.",
    time: "About 10 minutes.",
    requirements: [
      "A Claude Console account for your organization at https://platform.claude.com (use a shared company email).",
      "The Admin or Billing role in that Console organization to buy credits.",
      "A payment card for the prepaid credits.",
    ],
    parts: [
      {
        title: "Create the Anthropic account",
        steps: [
          { text: "Go to https://platform.claude.com and sign up, or sign in if your company already has an account." },
          { text: "Fill in your organization's details and use case when the Console asks for them." },
        ],
      },
      {
        title: "Add credits",
        steps: [
          { text: "Open **Settings → Billing** (https://platform.claude.com/settings/billing) and click **Buy credits**. Enter an amount and confirm. Credits are available at once." },
          { text: "Recommended: in **Credit balance**, click **Set up auto-reload**, fill in “When credit balance reaches” and “Bring credit balance back up to”, then click **Turn on**. AI features stop when the balance reaches zero." },
        ],
      },
      {
        title: "Create the API key",
        steps: [
          { text: "Open **Settings → API keys** (https://platform.claude.com/settings/keys) and click **Create key**." },
          { text: "Name it, for example `{app}`. If the Console asks for a workspace, choose one (for example Default): {app} doesn't send a workspace with its requests, so the key must belong to one." },
          { text: "For the expiration, choose **Never**, or a long period and put a reminder in your calendar to replace it." },
          { text: "Copy the key straight away. It starts with `sk-ant-` and is shown only once; if you lose it, create a new one." },
        ],
        note: "If **Create key** is greyed out, your Console role isn't allowed to create keys. Ask an admin of the Console organization.",
      },
    ],
    fields: { ANTHROPIC_API_KEY: "Claude Console → Settings → API keys → Create key (starts with sk-ant-)." },
    test: [
      "Click **Test connection** on the **Anthropic Claude** card. {app} asks Anthropic for its model list (free) and shows “Connected” with an example model.",
      "Then open Nova for any client and ask a short question to confirm answers come back.",
    ],
    problems: [
      { problem: "“Anthropic rejected the API key” (401 authentication_error)", fix: "The key was mistyped, deleted or has expired. Create a new key and save it." },
      { problem: "“This API key is not scoped to a workspace…”", fix: "Create a new key and choose a workspace when creating it." },
      { problem: "“Credit balance is too low” or a billing error", fix: "Buy credits or turn on auto-reload in Settings → Billing." },
      { problem: "“You have reached your specified API usage limits”", fix: "A spend limit set in the Console was reached. Raise it in the Console's limits settings, or wait until the next month." },
      { problem: "“The key isn't allowed to use the API” (403 permission_error)", fix: "Check the key's workspace and organization in the Console, or create a new key." },
      { problem: "Rate limited (429) or “overloaded” (529)", fix: "Temporary: try again in a minute. If it happens often, your usage tier is too low; request a tier increase on the Console's limits page." },
    ],
    renewal: [
      "A key stops working only if you chose an expiration date or delete it. Replace it before it expires.",
      "Prepaid credits expire one year after purchase and can't be refunded.",
      "To replace a key: create a new one, save it in {app}, run Test connection, then delete the old key in the Console.",
    ],
    checklist: [
      "Claude Console account created with a company email",
      "Credits bought, auto-reload turned on",
      "API key created in a workspace and copied",
      "Key saved in {app} and Test connection is green",
    ],
    links: [
      { label: "Claude Console: API keys", url: "https://platform.claude.com/settings/keys" },
      { label: "Claude Console: Billing", url: "https://platform.claude.com/settings/billing" },
      { label: "Get an API key (Anthropic docs)", url: "https://platform.claude.com/docs/en/get-api-key" },
      { label: "API errors", url: "https://platform.claude.com/docs/en/api/errors" },
      { label: "How do I pay for my API usage?", url: "https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage" },
    ],
    unverified: [
      "The minimum credit purchase (no official page states one).",
      "The exact label of the workspace choice on the Create key screen.",
      "The exact wording of the low-balance error returned by the API.",
    ],
  },

  dataforseo: {
    purpose: "DataForSEO supplies backlinks, rankings, keyword research, competitors, site audits, Lighthouse, local SEO, reviews and AI visibility. {app} calls it with your API login and API password; every request is paid from your DataForSEO balance.",
    cost: "Pay per request, no subscription. New accounts get $1 of free credit; the minimum payment is $50 and the balance never expires.",
    time: "About 15 minutes.",
    requirements: [
      "A DataForSEO account with a verified email address (and phone number, if asked).",
      "A positive balance.",
    ],
    parts: [
      {
        title: "Create and verify the account",
        steps: [
          { text: "Register at https://app.dataforseo.com/register with a company email." },
          { text: "Finish the verification the dashboard asks for (email and, if asked, phone). Until then every request fails with error 40104." },
        ],
      },
      {
        title: "Add funds",
        steps: [
          { text: "Click **Add Funds** in the dashboard and pay at least $50." },
          { text: "Optional: turn on **Auto-Recharge** in Billing so requests don't stop when the balance runs out." },
          { text: "Optional safety net: set a cost limit at https://app.dataforseo.com/api-settings." },
        ],
      },
      {
        title: "Find the API login and API password",
        steps: [
          { text: "Open **API Access** (https://app.dataforseo.com/api-access) and copy the **API login** exactly as shown." },
          { text: "The **API password** is generated for you and is different from the password you sign in with. It's shown only during the first 24 hours after registering; after that click **Send by e-mail** to receive it." },
          { text: "Leave **IP Access** empty. {app} runs on servers without a fixed IP address, so an IP allow-list would block it (error 40207)." },
        ],
      },
    ],
    fields: {
      DATAFORSEO_LOGIN: "API Access → API login (copy it exactly; often your sign-up email).",
      DATAFORSEO_PASSWORD: "API Access → API password, or the “Send by e-mail” message. Not your account password.",
    },
    test: [
      "Click **Test connection** on the **DataForSEO** card. {app} reads your account details from DataForSEO (free) and shows your balance.",
      "A warning that the balance is $0.00 means the credentials work but you need to add funds.",
    ],
    problems: [
      { problem: "“DataForSEO rejected the login and API password” (401 / 40100)", fix: "Use the API password from API Access (or “Send by e-mail”), not your account password, and copy the API login exactly." },
      { problem: "Error 40104 “please verify your account”", fix: "Finish the email/phone verification in the DataForSEO dashboard." },
      { problem: "Error 40200 “payment required” or 40210 “insufficient funds”", fix: "Add funds (minimum $50) or turn on Auto-Recharge." },
      { problem: "Error 40207 “your ip is not whitelisted”", fix: "Remove every address under API Access → IP Access." },
      { problem: "Error 40203 “the cost limit has been exceeded”", fix: "Raise the cost limit at app.dataforseo.com/api-settings." },
      { problem: "Error 40202 rate limit or 40209 too many simultaneous queries", fix: "Temporary. {app} retries; avoid running many large research jobs at once." },
    ],
    renewal: [
      "The login and API password don't expire. **Reset password** or **Change API login** in API Access (confirmed by an emailed code) stops the old one at once: save the new value in {app} straight away.",
      "Keep the balance above zero; paid requests fail when it runs out.",
    ],
    checklist: [
      "Account registered and verified",
      "Funds added (Auto-Recharge on, cost limit set if wanted)",
      "IP Access left empty",
      "API login and API password saved in {app}",
      "Test connection shows your balance",
    ],
    links: [
      { label: "DataForSEO dashboard: API Access", url: "https://app.dataforseo.com/api-access" },
      { label: "Pricing", url: "https://dataforseo.com/pricing" },
      { label: "Authentication", url: "https://docs.dataforseo.com/v3/auth/" },
      { label: "Error codes", url: "https://docs.dataforseo.com/v3/appendix/errors/" },
      { label: "Account and API key security", url: "https://dataforseo.com/help-center/account-and-api-key-security" },
    ],
    unverified: [
      "DataForSEO's help articles disagree on whether the API login is always your sign-up email; copy exactly what API Access shows.",
    ],
  },

  google_oauth: {
    purpose: "Your own Google sign-in app. A client's Google account signs in through it and allows {app} to read their Business Profile: locations, performance, search keywords, reviews and posts. Google must approve your Google Cloud project for the Business Profile APIs before any data can be read.",
    cost: "Free. Google doesn't charge for the Business Profile APIs.",
    time: "About 30 minutes of setup, then up to 14 days for Google's approval. Start this one first.",
    requirements: [
      "A Google account to own the Google Cloud project (a shared company account, not a personal one).",
      "For Google's approval: a Business Profile that has been verified and active for 60+ days, a website for that business and a complete profile.",
      "An email address that is an owner or manager of that Business Profile (for the access request).",
      "A privacy policy page on your website, for the consent screen.",
    ],
    parts: [
      {
        title: "Create a Google Cloud project",
        steps: [
          { text: "Go to https://console.cloud.google.com and sign in with the account that will own the app." },
          { text: "Click the project picker at the top → **New project**. Name it, for example `{org} {app}`, click **Create** and select the new project." },
          { text: "Write down the **Project number** from the **Project info** card on the project's dashboard. Google's access request asks for it." },
        ],
      },
      {
        title: "Request Business Profile API access",
        intro: "Do this now: Google reviews requests within about 14 days, and nothing can be read before approval.",
        steps: [
          { text: "Open the GBP API contact form at https://support.google.com/business/contact/api_default and choose **Application for Basic API Access**." },
          { text: "Use an email that is an owner or manager of the Business Profile, enter your Project number and describe the use, for example: “Read our clients' Business Profile performance, search keywords and reviews to report on them in our SEO dashboard. Read-only.”" },
          { text: "Wait for Google's email. To check, open **IAM & Admin → Quotas & System Limits** (https://console.cloud.google.com/iam-admin/quotas) and filter by the Business Profile APIs: 0 requests per minute means not approved yet, 300 means approved." },
        ],
        note: "If the quota is 0, don't request a quota increase: the access application is the only way to get approved.",
      },
      {
        title: "Enable the APIs",
        steps: [
          { text: "Open **APIs & Services → Library** (https://console.cloud.google.com/apis/library) in the same project." },
          { text: "Search for each of these and click **Enable**: **My Business Account Management API**, **My Business Business Information API** and **Business Profile Performance API**." },
          { text: "After approval, also enable **Google My Business API** (reviews and posts). Google shows it in the Library only to approved projects." },
        ],
      },
      {
        title: "Set up the consent screen",
        intro: "This is the screen your clients see when they connect. In the Google Cloud console it's called **Google Auth Platform**.",
        steps: [
          { text: "Open https://console.cloud.google.com/auth/overview and click **Get started**." },
          { text: "App information: the **App name** clients will see (for example your agency's name) and a **User support email**. Audience: **External**. Contact information: your email. Agree to the Google API Services User Data Policy, then click **Continue** and **Create**." },
          { text: "**Branding**: optionally add your logo, then the **Application home page**, **Application privacy policy link** and **Application terms of service link**. Under **Authorized domains** add your website's domain and the main domain of `{appHost}` (for app.example.com that's example.com), then **Save**." },
          { text: "**Data Access** → **Add or remove scopes**: add the three scopes listed under “Permissions (OAuth scopes)” (paste `https://www.googleapis.com/auth/business.manage` under **Manually add scopes**), click **Update**, then **Save**." },
          { text: "**Audience**: while you test, add each Google account that will connect under **Test users** (up to 100). When it works, click **Publish app** to move it to **In production**." },
        ],
        note: "While the app is in Testing, Google ends every connection after 7 days, so publish it before connecting clients for real. If `{appHost}` isn't on a domain you own, Google can't verify your branding and the consent screen shows that domain instead of your app name.",
      },
      {
        title: "Create the OAuth client",
        steps: [
          { text: "In **Google Auth Platform → Clients**, click **Create client**. Application type: **Web application**. Name: `{app}`." },
          { text: "Under **Authorized redirect URIs**, click **Add URI** and paste exactly `{redirectUri}` (no extra slash at the end)." },
          { text: "Click **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret** (starts with `GOCSPX-`) straight away: Google shows the full secret only once. Download the JSON file too and keep it somewhere safe." },
        ],
        note: "Changes to redirect URIs can take from 5 minutes to a few hours to apply.",
      },
    ],
    apis: ["My Business Account Management API", "My Business Business Information API", "Business Profile Performance API", "Google My Business API (appears after approval)"],
    scopes: [
      { scope: "https://www.googleapis.com/auth/business.manage", why: "Read locations, performance, search keywords, reviews and posts. Google offers no read-only Business Profile permission; {app} only reads." },
      { scope: "openid", why: "Identify the Google account that connected, so disconnect and deletion requests can be matched." },
      { scope: "email", why: "Show which Google account is connected." },
    ],
    consent: [
      "User type: **External**.",
      "App name, user support email and developer contact email.",
      "Home page, privacy policy and terms of service links; authorized domains for your website and `{appHost}`.",
      "Scopes: business.manage, openid and email.",
      "Publishing status: **In production** before clients connect (Testing ends connections after 7 days).",
    ],
    addresses: [{ label: "Authorized redirect URI (on the OAuth client)", value: "{redirectUri}", note: "Must match exactly." }],
    fields: {
      GOOGLE_GBP_CLIENT_ID: "Google Auth Platform → Clients → your Web application client → Client ID (ends in .apps.googleusercontent.com).",
      GOOGLE_GBP_CLIENT_SECRET: "The same client's Client secret (starts with GOCSPX-), shown in full only when it's created.",
      GOOGLE_GBP_REDIRECT_URI: "Leave empty. Only fill it in if your platform operator gives you a different callback address; it must then be listed on the OAuth client exactly.",
    },
    enterNote: "The **Configure** dialog also shows the **Authorized redirect URI** with a copy button; it must be on the OAuth client.",
    test: [
      "Click **Test connection** on the **Google Cloud OAuth (Business Profile)** card. Google checks the client ID and secret without any user: “Google accepted the client ID and secret” means they're right.",
      "Then make a real connection: pick a client, open **Integrations → Client connections → Google Business Profile**, click **Connect Account**, sign in with a Google account that manages the profile and allow access. Choose the locations to track.",
      "If the connection works but data stays empty with a “not approved (quota 0)” message, Google hasn't approved the API access yet.",
    ],
    problems: [
      { problem: "Google shows “Error 400: redirect_uri_mismatch”", fix: "The redirect URI on the OAuth client isn't exactly `{redirectUri}`. Correct it in Google Auth Platform → Clients, wait a few minutes and try again." },
      { problem: "“Error 403: access_denied” or “has not completed the Google verification process”", fix: "While testing, add the Google account under Audience → Test users. For everyone else, publish the app; if Google still blocks it, submit it in **Verification Center**." },
      { problem: "“Google rejected the client ID or secret” (invalid_client)", fix: "Copy both again. If the secret is lost, open the client, click **Add secret**, save the new one in {app}, then disable the old one." },
      { problem: "“Business Profile API access isn't approved (quota 0)” or 429 errors", fix: "Wait for Google's approval email. Don't request a quota increase; send the access application (again) with the right Project number." },
      { problem: "“… API has not been used in project … or it is disabled” (403)", fix: "Enable the API named in the message in APIs & Services → Library, wait a few minutes, then sync again." },
      { problem: "Connections stop working after 7 days (invalid_grant)", fix: "The app is still in Testing. Publish it (Audience → Publish app), then reconnect each client." },
      { problem: "“This Google account cannot access the profile” (403)", fix: "Connect with a Google account that is an owner or manager of the Business Profile." },
    ],
    renewal: [
      "The client secret doesn't expire. Google deletes OAuth clients that haven't been used for 6 months (it emails 30 days before; a deleted client can be restored within 30 days).",
      "Client connections last until the person removes access, hasn't used it for 6 months, or the app is in Testing (7 days).",
      "To replace the secret: **Add secret**, save it in {app}, run Test connection, then disable and delete the old secret.",
    ],
    checklist: [
      "Google Cloud project created and Project number noted",
      "Business Profile API access requested, then approved (quota 300 per minute)",
      "APIs enabled (Google My Business API after approval)",
      "Consent screen: branding, authorized domains, scopes, published",
      "Web application client with the exact redirect URI",
      "Client ID and secret saved in {app}; Test connection is green",
      "One client connected and its locations chosen",
    ],
    links: [
      { label: "Business Profile API prerequisites", url: "https://developers.google.com/my-business/content/prereqs" },
      { label: "Business Profile API basic setup", url: "https://developers.google.com/my-business/content/basic-setup" },
      { label: "GBP API access request form", url: "https://support.google.com/business/contact/api_default" },
      { label: "Google Auth Platform (consent screen)", url: "https://console.cloud.google.com/auth/overview" },
      { label: "Manage OAuth clients", url: "https://support.google.com/cloud/answer/15549257" },
      { label: "OAuth 2.0 for web server applications", url: "https://developers.google.com/identity/protocols/oauth2/web-server" },
      { label: "Quotas & System Limits", url: "https://console.cloud.google.com/iam-admin/quotas" },
    ],
    unverified: [
      "Google's documentation doesn't say whether the business.manage scope is sensitive. Some developers report that unverified external apps are still blocked; if that happens, submit the app in Verification Center.",
      "The fields of the access request form (the form requires sign-in).",
      "The API names exactly as the console Library shows them (taken from Google's documentation).",
    ],
  },

  google_api: {
    purpose: "Optional keys for Google services that need no client sign-in: page speed and real-user data (PageSpeed Insights and Chrome UX Report) and YouTube channel statistics. The general Google API key also makes Business Profile requests count against your own Google Cloud project.",
    cost: "Free within Google's limits: Chrome UX Report 150 requests per minute per project, YouTube Data API 10,000 units per day, PageSpeed Insights a free daily quota.",
    time: "About 10 minutes.",
    requirements: [
      "A Google Cloud project (use the same one as your Business Profile OAuth client).",
      "Permission to create API keys in it (Owner, Editor or API Keys Admin).",
    ],
    parts: [
      {
        title: "Enable the APIs",
        steps: [
          { text: "Open **APIs & Services → Library** (https://console.cloud.google.com/apis/library) in your project." },
          { text: "Enable **Chrome UX Report API** and **PageSpeed Insights API** for speed data, and **YouTube Data API v3** for YouTube." },
        ],
      },
      {
        title: "Create the keys",
        steps: [
          { text: "Open **APIs & Services → Credentials** (https://console.cloud.google.com/apis/credentials) → **Create credentials** → **API key**." },
          {
            text: "Google requires at least one API restriction. Under **API restrictions**, select only the APIs the key needs:",
            sub: [
              "Google API key: the Business Profile APIs you enabled and the Chrome UX Report API.",
              "PageSpeed Insights key: PageSpeed Insights API and Chrome UX Report API.",
              "YouTube key: YouTube Data API v3.",
            ],
          },
          { text: "Leave **Authenticate API calls through a service account** unticked and don't add an application restriction: {app} calls Google from servers without a fixed IP address." },
          { text: "Click **Create** and copy the key (starts with `AIza`). You can see it again later with **Show key** on the Credentials page." },
          { text: "One key may fill all three fields if it allows all of these APIs." },
        ],
      },
    ],
    apis: ["Chrome UX Report API", "PageSpeed Insights API", "YouTube Data API v3", "Business Profile APIs (for the Google API key, see the Google Cloud OAuth guide)"],
    fields: {
      GOOGLE_API_KEY: "A key from the project that holds your Business Profile OAuth client, allowed for the Business Profile APIs and the Chrome UX Report API.",
      PAGESPEED_API_KEY: "A key allowed for the PageSpeed Insights API and Chrome UX Report API. If empty, the Google API key is used.",
      YOUTUBE_API_KEY: "A key allowed for the YouTube Data API v3.",
    },
    test: [
      "Click **Test connection** on the **Google API keys** card. Each saved key makes one free request (Chrome UX Report or YouTube) and the result is shown per key.",
      "Then refresh a client's page-speed (Core Web Vitals) data and check that real-user numbers appear.",
    ],
    problems: [
      { problem: "“Google says the key isn't valid”", fix: "The key was copied wrongly or deleted. Copy it again with **Show key**, or create a new one." },
      { problem: "“valid, but it can't call the … API” (403)", fix: "Enable that API in the project and add it to the key's API restrictions." },
      { problem: "Quota used up (429)", fix: "Wait for the reset (YouTube: midnight Pacific Time). Chrome UX Report allows 150 requests per minute and can't be raised." },
      { problem: "No real-user data for a site (404 from Chrome UX Report)", fix: "Normal for sites with few visitors: Google doesn't have enough data. It isn't a key problem." },
    ],
    renewal: [
      "API keys don't expire. A deleted key can be restored within 30 days.",
      "To replace a key: create a new one, save it in {app}, run Test connection, then delete the old key.",
      "Google plans to stop including Chrome UX Report data in the PageSpeed Insights API, so keep the Chrome UX Report API allowed on your key.",
    ],
    checklist: [
      "APIs enabled in the project",
      "Keys created, each restricted to its APIs",
      "Keys saved in {app}; Test connection is green for each",
    ],
    links: [
      { label: "Credentials page", url: "https://console.cloud.google.com/apis/credentials" },
      { label: "Manage API keys (Google Cloud)", url: "https://docs.cloud.google.com/docs/authentication/api-keys" },
      { label: "PageSpeed Insights API: get started", url: "https://developers.google.com/speed/docs/insights/v5/get-started" },
      { label: "Chrome UX Report API", url: "https://developer.chrome.com/docs/crux/api" },
      { label: "YouTube Data API: register an application", url: "https://developers.google.com/youtube/registering_an_application" },
      { label: "YouTube Data API quota costs", url: "https://developers.google.com/youtube/v3/determine_quota_cost" },
    ],
    unverified: [
      "PageSpeed Insights' free daily quota: Google publishes no current number; check the API's Quotas tab in the console.",
      "Whether PageSpeed Insights works without a key (Google recommends using your own).",
    ],
  },

  composio: {
    purpose: "Composio runs the Google and social media sign-ins for your clients and keeps their access tokens, so {app} can read Google Analytics, Search Console and social accounts. Your organization uses its own Composio project: its API key, plus one auth config per service.",
    cost: "Composio has a free plan; larger volumes need a paid plan (see composio.dev/pricing).",
    time: "About 20 minutes; longer if you add your own social media apps.",
    requirements: [
      "A Composio account at https://dashboard.composio.dev with a project for your organization.",
      "For X (Twitter), Threads and TikTok: your own developer app on that platform (see the Threads app and TikTok app guides).",
    ],
    parts: [
      {
        title: "Create the project and API key",
        steps: [
          { text: "Sign up at https://dashboard.composio.dev and create (or open) a project for {org}." },
          { text: "Open the project's **Settings → API Keys** (https://dashboard.composio.dev/~/project/settings/api-keys) and click **Create API Key**. Permissions are fixed once created: keep full access so {app} can manage auth configs, connections and tools." },
          { text: "Copy the key. It starts with `ak_` and works for this project only." },
        ],
      },
      {
        title: "Create the Google auth configs",
        steps: [
          { text: "Open **Auth Configs** (https://dashboard.composio.dev/~/project/auth-configs) → **Create Auth Config** and choose the **Google Analytics** toolkit (OAuth2)." },
          { text: "Keep only the read-only scope `https://www.googleapis.com/auth/analytics.readonly`." },
          { text: "Use Composio's managed app (quickest), or turn on **Use your own developer credentials** to show your own app name on Google's consent screen (see the note below)." },
          { text: "Create it and copy the auth config ID (starts with `ac_`)." },
          { text: "Repeat for the **Google Search Console** toolkit with the scope `https://www.googleapis.com/auth/webmasters.readonly`." },
        ],
        note: "Own Google app: in your Google Cloud project enable the Google Analytics Data API, Google Analytics Admin API and Google Search Console API, create a Web application client whose authorized redirect URI is the **Redirect URI** shown in the auth config (currently " + COMPOSIO_CALLBACK + "), and paste its client ID and secret into the auth config.",
      },
      {
        title: "Social media auth configs (optional)",
        steps: [
          { text: "Facebook, Instagram, LinkedIn, Pinterest and YouTube work without setup: on the first **Connect**, {app} uses an enabled auth config from your project or creates one with Composio's shared app. Create your own only to show your own app name and ask for read-only permissions." },
          { text: "X (Twitter), Threads and TikTok have no Composio shared app. Create your developer app (X: at https://console.x.com, type **Web App** with OAuth 2.0), add the auth config's **Redirect URI** (" + COMPOSIO_CALLBACK + ") to the app, then create an auth config for the **twitter**, **threads** or **tiktok** toolkit with **Use your own developer credentials** and the app's client ID and secret." },
          { text: "Copy each auth config ID into the matching field below (a field left empty uses the enabled auth config for that toolkit in your project). Ask only for the read-only permissions listed under “Permissions (OAuth scopes)”." },
        ],
      },
      {
        title: "Toolkit versions (optional)",
        steps: [
          { text: "Leave the two version fields empty to always use Composio's latest Google Analytics and Search Console tools." },
          { text: "If a Composio update ever breaks Analytics or Search Console data, pin the last working version: versions look like `20261116_00` and are listed under **All Toolkits** → the toolkit → the version list." },
        ],
      },
    ],
    scopes: [
      { scope: "https://www.googleapis.com/auth/analytics.readonly", why: "Google Analytics: read reports for the properties a client chooses." },
      { scope: "https://www.googleapis.com/auth/webmasters.readonly", why: "Search Console: read search performance, URL inspection and sitemaps." },
      ...(["facebook_pages", "instagram", "threads", "x", "tiktok", "pinterest", "linkedin", "youtube"] as const).flatMap((id) => {
        const p = platformById(id);
        return p ? [{ scope: p.scopes.map((s) => s.scope).join(", "), why: `${p.name}: read-only.` }] : [];
      }),
    ],
    addresses: COMPOSIO_REDIRECTS.map((u, i) => ({
      label: i === 0 ? "Composio callback (older auth configs)" : u === COMPOSIO_CALLBACK ? "Composio callback (current)" : "Composio callback (newer API version)",
      value: u,
      note: u === COMPOSIO_CALLBACK ? "Add to every developer app you use with Composio; adding all three is safest." : undefined,
    })),
    fields: {
      COMPOSIO_API_KEY: "Composio → project Settings → API Keys → Create API Key (starts with ak_).",
      COMPOSIO_AUTH_CONFIG_GA4: "Auth Configs → your Google Analytics auth config → its ID (starts with ac_).",
      COMPOSIO_AUTH_CONFIG_GSC: "Auth Configs → your Google Search Console auth config → its ID (starts with ac_).",
      COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS: "Optional. A version such as 20261116_00 from All Toolkits → Google Analytics. Empty = latest.",
      COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE: "Optional. A version from All Toolkits → Google Search Console. Empty = latest.",
      COMPOSIO_AUTH_CONFIG_FACEBOOK: "Optional. Your own Facebook auth config ID (ac_…); if empty, an enabled facebook auth config in the project, else Composio's shared app.",
      COMPOSIO_AUTH_CONFIG_INSTAGRAM: "Optional. Your own Instagram auth config ID (ac_…); if empty, an enabled instagram auth config in the project, else Composio's shared app.",
      COMPOSIO_AUTH_CONFIG_THREADS: "The auth config made with your Threads app (ac_…). If empty, the project's enabled threads auth config is used; without one, Threads can't be connected.",
      COMPOSIO_AUTH_CONFIG_TIKTOK: "The auth config made with your TikTok app (ac_…). If empty, the project's enabled tiktok auth config is used; without one, TikTok can't be connected.",
      COMPOSIO_AUTH_CONFIG_TWITTER: "The auth config made with your X app (ac_…). If empty, the project's enabled twitter auth config is used; without one, X can't be connected.",
      COMPOSIO_AUTH_CONFIG_LINKEDIN: "Optional. Your own LinkedIn auth config ID (ac_…); if empty, an enabled linkedin auth config in the project, else Composio's shared app.",
      COMPOSIO_AUTH_CONFIG_PINTEREST: "Optional. Your own Pinterest auth config ID (ac_…); if empty, an enabled pinterest auth config in the project, else Composio's shared app.",
      COMPOSIO_AUTH_CONFIG_YOUTUBE: "Optional. Your own YouTube auth config ID (ac_…); if empty, an enabled youtube auth config in the project, else Composio's shared app.",
    },
    test: [
      "Click **Test connection** on the **Composio** card. {app} lists your project's auth configs and checks that every ID you saved exists and is enabled.",
      "Then connect one client's Google Analytics under **Integrations → Client connections**.",
    ],
    problems: [
      { problem: "“Composio rejected the API key”", fix: "Copy the key again from the project's Settings → API Keys. It must come from the same project as the auth configs." },
      { problem: "“these auth config IDs aren't in its Composio project”", fix: "The auth config was made in another project or deleted. Create it in the API key's project and save the new ID." },
      { problem: "“these auth configs are disabled”", fix: "Enable them under Auth Configs." },
      { problem: "redirect_uri_mismatch on a consent screen (your own app)", fix: "Add the Redirect URI shown in the auth config (" + COMPOSIO_CALLBACK + ") to your developer app exactly." },
      { problem: "“… has no Composio-managed login” (X, Threads, TikTok)", fix: "Create that platform's auth config with your own app; its Connect button then appears automatically." },
      { problem: "Analytics or Search Console errors right after a Composio update", fix: "Pin the last working toolkit version in the version fields." },
    ],
    renewal: [
      "Composio documents no expiry for API keys. To replace one: create a new key, save it in {app}, run Test connection, then delete the old key.",
      "Client connections end when the person removes access or the platform expires the grant; reconnect them under Client connections.",
    ],
    checklist: [
      "Composio project and API key created",
      "Google Analytics and Search Console auth configs created (read-only scopes)",
      "Auth configs for X, Threads and TikTok, if you'll connect those",
      "IDs saved in {app}; Test connection is green",
      "One client connected to Google Analytics",
    ],
    links: [
      { label: "Composio dashboard", url: "https://dashboard.composio.dev" },
      { label: "Authenticating to Composio (API keys)", url: "https://docs.composio.dev/reference/authenticating-to-composio" },
      { label: "Custom auth configs (your own app)", url: "https://docs.composio.dev/docs/auth-configuration/custom-auth-configs" },
      { label: "Toolkit versioning", url: "https://docs.composio.dev/docs/tools-direct/toolkit-versioning" },
      { label: "White-labeling the sign-in (callback URL)", url: "https://docs.composio.dev/docs/white-labeling-authentication" },
    ],
    unverified: [
      "Composio's plan limits and prices.",
      "Whether the API key is shown only once, and the exact labels of the auth config form.",
    ],
  },

  ga4: {
    purpose: "Website traffic, engagement and leads for each client. Every client connects its own Google account through Composio; there are no organization credentials to enter.",
    cost: "Free (Google Analytics). Uses your Composio project.",
    time: "About 5 minutes per client.",
    requirements: [
      "Composio set up for {org} (API key and Google Analytics auth config).",
      "A Google account with at least **Viewer** access to the client's Google Analytics 4 property.",
      "Owner or admin access to the client in {app}.",
    ],
    parts: [
      {
        title: "Give a Google account access (if needed)",
        intro: "Done by an Administrator of the client's Google Analytics account.",
        steps: [
          { text: "In Google Analytics, open **Admin**, and under **Property** click **Property access management**." },
          { text: "Click **+** → **Add users**, enter the email of the Google account that will connect, choose **Viewer** (enough to read reports) and click **Add**." },
        ],
      },
    ],
    scopes: [{ scope: "https://www.googleapis.com/auth/analytics.readonly", why: "Read reports for the properties the client chooses." }],
    enter: {
      title: "Connect the client in {app}",
      steps: [
        { text: CLIENT_PICK },
        { text: CONNECTIONS + " On the **Google Analytics 4** card, click **Connect Account**, read what will be shared and continue." },
        { text: "Sign in with the Google account that has access to the property and allow access." },
        { text: "Back in {app}, choose the property to track and save. The first import starts automatically." },
      ],
    },
    test: [
      "The card shows **Connected** and the Google account's email.",
      "Data appears on the Analytics pages after the first sync (a few minutes); **Data freshness** on the Integrations page shows the last sync.",
    ],
    problems: [
      { problem: "No properties to choose from", fix: "The Google account has no access to a Google Analytics 4 property. Add it in Property access management, then click **Reconnect**." },
      { problem: "“Google authorization is still in progress”", fix: "Finish the Google consent screen, then click **Connect Account** again." },
      { problem: "“Google authorization wasn't completed or has expired”", fix: "Click **Reconnect** and finish the consent screen." },
      { problem: "“Composio could not find that auth config”", fix: "An owner should check the Google Analytics auth config ID on the Composio card (same project as the API key)." },
      { problem: "Sync errors after it worked before", fix: "The person removed access or lost access to the property. Reconnect with an account that still has access." },
    ],
    renewal: [
      "A connection lasts until the Google account removes access, loses access to the property or Google ends the session after a security event. Reconnect when the card shows an error.",
    ],
    checklist: [
      "Composio configured for {org}",
      "A Google account with Viewer access to the property",
      "Client connected and property chosen",
      "First sync finished",
    ],
    links: [
      { label: "Add users to Google Analytics", url: "https://support.google.com/analytics/answer/9305788" },
      { label: "Google Analytics roles", url: "https://support.google.com/analytics/answer/9305587" },
      { label: "Google Analytics 4 setup", url: "https://support.google.com/analytics/answer/9304153" },
    ],
    unverified: [],
  },

  gsc: {
    purpose: "Search clicks, queries, pages, indexing and sitemaps for each client. Every client connects its own Google account through Composio; there are no organization credentials to enter.",
    cost: "Free (Google Search Console). Uses your Composio project.",
    time: "About 5 minutes per client.",
    requirements: [
      "Composio set up for {org} (API key and Search Console auth config).",
      "A Google account that is a user of the client's Search Console property (**Full** recommended).",
      "Owner or admin access to the client in {app}.",
    ],
    parts: [
      {
        title: "Give a Google account access (if needed)",
        intro: "Done by an owner of the client's Search Console property.",
        steps: [
          { text: "In Search Console, open the property, then **Settings → Users and permissions**." },
          { text: "Click **Add user**, enter the Google account's email, choose **Full** and click **Add**. **Restricted** is enough for search performance, but page inspection (indexing) works best with Full." },
        ],
        note: "Each property is separate: a Domain property (sc-domain:example.com, covering every subdomain) and a URL-prefix property (https://www.example.com/) are different. Add the account to the property you want to report on.",
      },
    ],
    scopes: [{ scope: "https://www.googleapis.com/auth/webmasters.readonly", why: "Read search performance, URL inspection and sitemaps for the sites the client chooses." }],
    enter: {
      title: "Connect the client in {app}",
      steps: [
        { text: CLIENT_PICK },
        { text: CONNECTIONS + " On the **Google Search Console** card, click **Connect Account**, read what will be shared and continue." },
        { text: "Sign in with the Google account that has access to the property and allow access." },
        { text: "Back in {app}, choose the site to track and save. The first import starts automatically." },
      ],
    },
    test: [
      "The card shows **Connected** and the Google account's email.",
      "Search Console pages fill after the first sync. Search Console data is usually 2–3 days behind.",
    ],
    problems: [
      { problem: "The site isn't in the list", fix: "The Google account isn't a user of that exact property. Add it in Settings → Users and permissions, then click **Reconnect**." },
      { problem: "Indexing (page inspection) errors", fix: "Give the account **Full** permission. Google allows 2,000 inspections per site per day." },
      { problem: "“Google authorization wasn't completed or has expired”", fix: "Click **Reconnect** and finish the consent screen." },
      { problem: "“Composio could not find that auth config”", fix: "An owner should check the Search Console auth config ID on the Composio card." },
    ],
    renewal: [
      "A connection lasts until the Google account removes access or loses access to the property. Reconnect when the card shows an error.",
    ],
    checklist: [
      "Composio configured for {org}",
      "A Google account added to the right property (Full)",
      "Client connected and site chosen",
      "First sync finished",
    ],
    links: [
      { label: "Search Console: add users and permissions", url: "https://support.google.com/webmasters/answer/7687615" },
      { label: "Search Console: add a property", url: "https://support.google.com/webmasters/answer/34592" },
      { label: "Search Console setup", url: "https://support.google.com/webmasters/answer/9008080" },
    ],
    unverified: [
      "Whether Restricted users can use page inspection through the API (Full is recommended).",
    ],
  },

  lbm: {
    purpose: "Business Profile performance, search keywords, reviews and geogrid rankings for the locations your agency manages in Local Brand Manager, without connecting each client's Google account.",
    cost: "Needs a Local Brand Manager plan; location limits and credits depend on your plan.",
    time: "About 5 minutes.",
    requirements: [
      "A Local Brand Manager account with your clients' locations.",
      "Permission to create API tokens in that account.",
    ],
    parts: [
      {
        title: "Create the API token",
        steps: [
          { text: "Sign in at https://app.localbrandmanager.com and open **API tokens** (https://app.localbrandmanager.com/api_tokens)." },
          { text: "Create a new token, name it `{app}` and copy it." },
        ],
      },
    ],
    fields: { LOCAL_BRAND_MANAGER_API_TOKEN: "Local Brand Manager → API tokens (app.localbrandmanager.com/api_tokens)." },
    enterNote: "Then, for each client: pick the client, open **Integrations → Client connections → Local Brand Manager**, leave the token field empty to use the organization's token, click **Connect Local Brand Manager** and choose the client's locations. **Set up clients for all Local Brand Manager locations** on the same card creates a client for each location at once.",
    test: [
      "Click **Test connection** on the **Local Brand Manager** card: “Connected” means the token works.",
      "Then connect one client and check its Business Profile page after the first sync.",
    ],
    problems: [
      { problem: "“Local Brand Manager rejected the API token”", fix: "Create a new token in API tokens and save it. Clients connected with a copy of the old token need to reconnect." },
      { problem: "A location is missing", fix: "Add it to your Local Brand Manager account first; the list comes from there." },
      { problem: "Rate limited", fix: "Temporary; the sync retries." },
    ],
    renewal: [
      "Tokens work until you delete them in Local Brand Manager.",
      "Each client connection keeps its own copy of the token. After replacing the token, reconnect those clients.",
      "Only about 25 days of daily metrics are available, so history builds up with each daily sync.",
    ],
    checklist: [
      "API token created and saved in {app}",
      "Test connection is green",
      "Clients connected and locations chosen",
    ],
    links: [
      { label: "Local Brand Manager API tokens", url: "https://app.localbrandmanager.com/api_tokens" },
      { label: "Local Brand Manager API documentation", url: "https://developers.localbrandmanager.com" },
    ],
    unverified: [
      "The labels on the API tokens page and which plans include API access (the page requires sign-in).",
      "Rate limits (not documented).",
    ],
  },

  seosignalx: {
    purpose: "Shows the saved SEOSignalX audits (E-E-A-T, semantic, speed, robots.txt and crawl optimization) for each client whose website is a project in your SEOSignalX account. {app} reads them through SEOSignalX's read-only MCP server; nothing is changed there.",
    cost: "Needs a SEOSignalX account. Saved audits aren't part of the Free plan, so a paid plan is likely needed.",
    time: "About 5 minutes.",
    requirements: [
      "A SEOSignalX account with a project for each client's website (same domain as the client's site).",
      "Saved audits in those projects.",
    ],
    parts: [
      {
        title: "Generate the MCP token",
        steps: [
          { text: "Sign in at https://seosignalx.com and open the account menu → **MCP** (https://seosignalx.com/mcp) → **Connect** tab." },
          { text: "Under **Manual access credential**, click **Generate credential**, then **Copy token**. It starts with `ssxmcp_` and is shown only once." },
        ],
      },
      {
        title: "Match clients to projects",
        steps: [
          { text: "{app} links each client to the SEOSignalX project with the same domain as the client's website. Create a project for each client and save the audits you want to show." },
        ],
      },
    ],
    fields: { SEOSIGNALX_MCP_TOKEN: "SEOSignalX → MCP → Connect → Manual access credential → Generate credential (starts with ssxmcp_)." },
    test: [
      "Click **Test connection** on the **SEOSignalX** card: it shows how many projects the token can see.",
      "Then open the SEOSignalX page of a client whose website has a project.",
    ],
    problems: [
      { problem: "“SEOSignalX rejected the MCP token”", fix: "Generate a new credential (Regenerate revokes the old one) and save it." },
      { problem: "“Connected, but there are no projects in SEOSignalX yet”", fix: "Create a project for the client's website in SEOSignalX." },
      { problem: "A client shows no audits", fix: "The project's domain must match the client's website and the audit must be saved in SEOSignalX. Data refreshes every few hours." },
    ],
    renewal: [
      "The token works until you regenerate or revoke it. **Regenerate** stops the old token at once: save the new one straight away.",
    ],
    checklist: [
      "Projects exist for your clients' websites",
      "MCP token generated and saved in {app}",
      "Test connection lists your projects",
    ],
    links: [
      { label: "SEOSignalX", url: "https://seosignalx.com" },
      { label: "SEOSignalX MCP page", url: "https://seosignalx.com/mcp" },
    ],
    unverified: [
      "SEOSignalX has no public documentation; these steps follow the live app's MCP page.",
      "Which plan is required.",
    ],
  },

  bing: {
    purpose: "Bing search performance, keywords and crawl health. The organization's API key is the default for every client's Bing connection; a client can also connect with its own key.",
    cost: "Free.",
    time: "About 10 minutes, plus adding each site.",
    requirements: [
      "A Bing Webmaster Tools account (https://www.bing.com/webmasters).",
      "Each client's website added and verified in that account.",
    ],
    parts: [
      {
        title: "Add the sites",
        steps: [
          { text: "Sign in at https://www.bing.com/webmasters." },
          { text: "Add and verify each client's website (or import the sites from Google Search Console)." },
        ],
      },
      {
        title: "Generate the API key",
        steps: [
          { text: "Click **Settings** (top right) → **API Access**." },
          { text: "The first time, accept the terms and click **API Key**, then **Generate API Key**." },
          { text: "Copy the key. There's one key per Bing user, and it works for every verified site in that account." },
        ],
      },
    ],
    fields: { BING_WEBMASTER_API_KEY: "Bing Webmaster Tools → Settings → API Access → API Key." },
    enterNote: "Then, for each client: pick the client, open **Integrations → Client connections → Bing Webmaster Tools**, leave the key field empty to use the organization's key (or paste the client's own key), click **Connect Bing Webmaster Tools** and choose the client's site.",
    test: [
      "Click **Test connection** on the **Bing Webmaster Tools** card: it shows how many sites the account has and how many are verified.",
      "Then connect one client and open its Bing Webmaster page after the first sync.",
    ],
    problems: [
      { problem: "“Bing rejected the API key” (InvalidApiKey)", fix: "The key was regenerated or deleted. Generate a new one, save it, and reconnect the clients." },
      { problem: "A site isn't in the list", fix: "Add and verify it in Bing Webmaster Tools with the same Bing account." },
      { problem: "Rate limit (ThrottleUser)", fix: "Temporary; the sync retries." },
    ],
    renewal: [
      "Microsoft documents no expiry for the key. Regenerating it (**Delete**, then **Generate**) stops the old key at once.",
      "Each client connection keeps its own copy of the key: after replacing the key, reconnect every client.",
    ],
    checklist: [
      "Sites added and verified in Bing Webmaster Tools",
      "API key generated and saved in {app}",
      "Test connection is green",
      "Clients connected and sites chosen",
    ],
    links: [
      { label: "Bing Webmaster Tools", url: "https://www.bing.com/webmasters" },
      { label: "Getting access to the Bing Webmaster API", url: "https://learn.microsoft.com/en-us/bingwebmaster/getting-access" },
    ],
    unverified: [
      "Key expiry and daily request limits (not documented).",
      "Current menu labels (Microsoft's page was last updated in 2022).",
    ],
  },

  clarity: {
    purpose: "Sessions, rage clicks, dead clicks, scroll depth and JavaScript errors for each client's website. Each client connects with a token from its own Clarity project; there are no organization credentials.",
    cost: "Free.",
    time: "About 5 minutes per client.",
    requirements: [
      "Microsoft Clarity installed on the client's website (a Clarity project).",
      "The admin role on that Clarity project: only project admins can create tokens.",
      "Owner or admin access to the client in {app}.",
    ],
    parts: [
      {
        title: "Generate the token in Clarity",
        steps: [
          { text: "Sign in at https://clarity.microsoft.com and open the client's project." },
          { text: "Go to **Settings → Data Export** and click **Generate new API token**." },
          { text: "Name it (4–32 letters, digits, - _ or ., no spaces), for example `seo-insights`, and copy the token straight away." },
        ],
      },
    ],
    enter: {
      title: "Connect the client in {app}",
      steps: [
        { text: CLIENT_PICK },
        { text: CONNECTIONS + " On the **Microsoft Clarity** card, paste the token into **Clarity API token** and click **Connect Clarity**." },
      ],
    },
    test: [
      "The card shows **Connected**. Use **Sync now**, then open the client's Microsoft Clarity page.",
      "Clarity's API returns only the last 1–3 days and allows 10 requests per project per day, so history builds up with each daily sync.",
    ],
    problems: [
      { problem: "401 (token missing, invalid or expired)", fix: "Generate a new token in the project and connect again." },
      { problem: "403 (not allowed)", fix: "Create the token in the client's own project, as a project admin." },
      { problem: "429 “Exceeded daily limit”", fix: "Clarity allows 10 requests per project per day; data resumes the next day. Don't use the same token in other tools." },
      { problem: "No data yet", fix: "Normal for a new connection: only the last 1–3 days are available, and history grows daily." },
    ],
    renewal: [
      "Clarity documents no lifetime for tokens. Replace a token when someone with access leaves the project.",
      "Deleting the token in Clarity stops the data until a new token is connected.",
    ],
    checklist: [
      "Clarity installed on the client's site",
      "Token generated by a project admin",
      "Client connected; first sync finished",
    ],
    links: [
      { label: "Microsoft Clarity", url: "https://clarity.microsoft.com" },
      { label: "Clarity Data Export API", url: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api" },
    ],
    unverified: ["Whether a token can be viewed again after it's created."],
  },

  treg: {
    purpose: "Public follower and post numbers for social accounts that aren't connected (and for competitors), with nobody signing in.",
    cost: "Pay per call from a prepaid balance (fractions of a cent per profile), no subscription. New verified accounts get $1 of free credit.",
    time: "About 10 minutes.",
    requirements: [
      "A treg.to account (sign in with GitHub, Google or an emailed code).",
      "A positive balance.",
    ],
    parts: [
      {
        title: "Create the account and add a balance",
        steps: [
          { text: "Go to https://treg.to, click **Start free** and sign in." },
          { text: "Add balance under **Team → Billing**; automatic top-up is available." },
        ],
      },
      {
        title: "Create a team (agent) token",
        steps: [
          { text: "Create an API token for your team in the treg.to dashboard (see https://treg.to/docs). With treg's command-line tool, a developer can run `treg org agent-new seo-insights` instead; the token is shown once." },
          { text: "Use a team (agent) token: {app} sends only the token, and a personal token may also need a team to be named." },
        ],
      },
    ],
    fields: { TREG_API_KEY: "A treg.to team (agent) token." },
    test: [
      "There's no Test connection for treg.to. Open **Social media** for a client with a profile that isn't connected and refresh it: numbers appear when the token works.",
    ],
    problems: [
      { problem: "No numbers for profiles that aren't connected", fix: "Check the balance and that the token is a team (agent) token." },
      { problem: "Empty answers for some profiles", fix: "Private or blocked profiles return nothing; failed or empty answers aren't charged." },
    ],
    renewal: [
      "Tokens work until revoked. Keep the balance above zero.",
    ],
    checklist: [
      "treg.to account created with balance",
      "Team token created and saved in {app}",
      "A public profile refreshed successfully",
    ],
    links: [
      { label: "treg.to", url: "https://treg.to" },
      { label: "treg.to documentation", url: "https://treg.to/docs" },
    ],
    unverified: [
      "Where the API token is created in the treg.to web dashboard.",
      "Whether a personal token works without naming a team.",
    ],
  },

  meta: {
    purpose: "Only needed when your organization connects Facebook and Instagram through its own Meta app (instead of Composio's shared app). Meta then sends deauthorize and data-deletion notices to {app}, signed with your app secret; {app} uses the secret to check they're genuine.",
    cost: "Free.",
    time: "About 15 minutes (App Review and Business Verification take longer).",
    requirements: [
      "A Meta developer account at https://developers.facebook.com.",
      "A Meta app with **Facebook Login for Business** and/or **Instagram API with Instagram Login**.",
      "For clients without a role on your app: Business Verification and App Review (Advanced Access), then the app switched to Live.",
    ],
    parts: [
      {
        title: "Copy the Facebook app secret",
        steps: [
          { text: "Open https://developers.facebook.com/apps, choose your app and go to **App settings → Basic**." },
          { text: "Next to **App secret**, click **Show** (Meta may ask for your password) and copy it." },
        ],
      },
      {
        title: "Copy the Instagram app secret",
        steps: [
          { text: "In the same app, open **Use cases** → the Instagram use case → **Customize** → **API setup with Instagram login**." },
          { text: "Copy the **Instagram app secret** (it's different from the Facebook app secret)." },
        ],
      },
      {
        title: "Point Meta's callbacks to {app}",
        steps: [
          { text: "Facebook: set the **Deauthorize callback URL** and the data deletion callback (**App settings → Basic → User data deletion**) to the Facebook addresses listed under “Addresses to copy”." },
          { text: "Instagram: in **API setup with Instagram login → Business login settings**, set the **Deauthorize callback URL** and **Data deletion request URL** to the Instagram addresses listed there." },
          { text: "OAuth redirect URIs (Facebook Login for Business → Settings → **Valid OAuth Redirect URIs**, and Instagram's Business login settings) = the Composio callback " + COMPOSIO_CALLBACK + ", because the sign-in runs through Composio." },
          { text: "Create Composio auth configs for the **facebook** and **instagram** toolkits with your app's ID and secret (see the Composio guide)." },
        ],
      },
    ],
    scopes: [...scopesOf("facebook_pages"), ...scopesOf("instagram")],
    addresses: [...hooks("facebook_pages").map((a) => ({ ...a, label: `Facebook: ${a.label}` })), ...hooks("instagram").map((a) => ({ ...a, label: `Instagram: ${a.label}` }))],
    fields: {
      META_APP_SECRET: "Meta App Dashboard → App settings → Basic → App secret.",
      INSTAGRAM_APP_SECRET: "Instagram use case → API setup with Instagram login → Instagram app secret. If empty, the Facebook app secret is used for Instagram notices.",
    },
    test: [
      "There's no Test connection: the secrets are used only when Meta calls the callbacks. With a wrong secret, {app} rejects Meta's notices (“invalid signed_request”).",
      "To check the setup, connect a Facebook Page or Instagram account of someone with a role on your app under **Social media**.",
    ],
    problems: [
      { problem: "Meta reports that the data deletion callback fails", fix: "Check the callback addresses (exact, https) and that the saved secret is the current one; resetting the secret in Meta stops the old one." },
      { problem: "Clients can't connect (permission errors)", fix: "In Development mode only people with a role on the app can connect. Get Advanced Access through App Review (needs Business Verification) and switch the app to Live." },
    ],
    renewal: [
      "App secrets don't expire. If you reset one in App settings → Basic, save the new secret in {app} and in the Composio auth config at once.",
    ],
    checklist: [
      "Facebook and Instagram app secrets saved in {app}",
      "Deauthorize and data deletion callbacks point to {app}",
      "OAuth redirect URIs = the Composio callback",
      "Composio auth configs created with your app",
      "App Review and Business Verification done, app Live (for all clients)",
    ],
    links: [
      { label: "Meta apps", url: "https://developers.facebook.com/apps" },
      { label: "App Dashboard: basic settings", url: "https://developers.facebook.com/docs/development/create-an-app/app-dashboard/basic-settings" },
      { label: "Data deletion callback", url: "https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback" },
      { label: "Instagram business login", url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login" },
      { label: "App modes", url: "https://developers.facebook.com/docs/development/build-and-test/app-modes" },
      { label: "Access levels", url: "https://developers.facebook.com/docs/graph-api/overview/access-levels" },
    ],
    unverified: [
      "The **Show** button and password prompt for the app secret.",
      "Where the Deauthorize callback field sits for Facebook Login for Business.",
    ],
  },

  threads: {
    purpose: "Your Meta app's Threads credentials. The app secret lets {app} check Threads' deauthorize (uninstall) and data deletion notices; the app ID and secret also go into your Composio auth config for Threads, because Composio has no shared Threads app.",
    cost: "Free.",
    time: "About 15 minutes (App Review takes longer).",
    requirements: [
      "A Meta app with the **Access the Threads API** use case.",
      "Until App Review is approved: every connecting account added as a Threads Tester.",
    ],
    parts: [
      {
        title: "Add the Threads use case",
        steps: [
          { text: "At https://developers.facebook.com/apps, create an app (or open yours) with the use case **Access the Threads API**." },
          { text: "**Use cases → Access the Threads API → Customize → Permissions**: add `threads_basic` and `threads_manage_insights`." },
        ],
      },
      {
        title: "Copy the Threads app ID and secret",
        steps: [
          { text: "Open **Use cases → Access the Threads API → Settings** and copy the **Threads app ID** and **Threads app secret**. Each app has two ID and secret pairs: use the Threads pair." },
        ],
      },
      {
        title: "Set the addresses",
        steps: [
          { text: "Redirect callback URLs (valid OAuth redirect URIs): the Composio callback " + COMPOSIO_CALLBACK + "." },
          { text: "Uninstall (deauthorize) and delete (data deletion) callback URLs: the two {app} addresses under “Addresses to copy”." },
        ],
      },
      {
        title: "Add testers until App Review",
        steps: [
          { text: "**Settings → Add or Remove Threads Test Users** → **Add People** → **Threads Tester**, and enter the Threads username." },
          { text: "The person accepts in Threads under **Settings → Account → Website permissions**." },
          { text: "To open it to everyone, request Advanced Access for both permissions in App Review (needs Business Verification) and publish the app." },
        ],
      },
      {
        title: "Use the app with Composio",
        steps: [
          { text: "Create a Composio auth config for the **threads** toolkit with **Use your own developer credentials** (Threads app ID and secret), then save its ID in the Composio card's **Threads auth config ID**." },
        ],
      },
    ],
    scopes: scopesOf("threads"),
    addresses: hooks("threads"),
    fields: {
      THREADS_APP_ID: "Use cases → Access the Threads API → Settings → Threads app ID.",
      THREADS_APP_SECRET: "The same page → Threads app secret.",
    },
    test: [
      "There's no Test connection. Connect a tester's Threads account under **Social media** to confirm the sign-in works.",
    ],
    problems: [
      { problem: "A client can't connect", fix: "Add them as a Threads Tester (they must accept), or finish App Review and publish the app." },
      { problem: "Threads notices are rejected", fix: "The saved secret isn't the current Threads app secret. Copy it again." },
      { problem: "An older token-based Threads account stopped updating", fix: "Long-lived Threads tokens expire after 60 days without a refresh; sign in again for a new token, or connect through Composio." },
    ],
    renewal: [
      "Long-lived Threads tokens last 60 days and are refreshed automatically once they're a day old; a token not refreshed within 60 days can't be renewed.",
      "If you reset the app secret, save the new one in {app} and in the Composio auth config.",
    ],
    checklist: [
      "Threads use case with threads_basic and threads_manage_insights",
      "Threads app ID and secret saved in {app}",
      "Redirect and callback addresses set",
      "Composio auth config for threads created and its ID saved",
      "Testers added, or App Review approved",
    ],
    links: [
      { label: "Threads use case", url: "https://developers.facebook.com/docs/development/create-an-app/threads-use-case" },
      { label: "Threads API: get started", url: "https://developers.facebook.com/docs/threads/get-started" },
      { label: "Long-lived Threads tokens", url: "https://developers.facebook.com/docs/threads/get-started/long-lived-tokens" },
    ],
    unverified: [
      "The callback field labels: Meta's docs now say “Deauthorize callback URL” and “Data Deletion Requests URL”; older screens said “Uninstall” and “Delete”.",
    ],
  },

  tiktok: {
    purpose: "Your TikTok developer app. The client secret lets {app} check TikTok's notices (when someone removes access, their data is deleted). The client key and secret also go into your Composio auth config for TikTok, because Composio has no shared TikTok app.",
    cost: "Free.",
    time: "About 20 minutes, plus TikTok's app review.",
    requirements: [
      "A TikTok for Developers account at https://developers.tiktok.com.",
      "Your website's Terms of Service and Privacy Policy pages (TikTok verifies the URLs).",
      "App review for production, or a sandbox with up to 10 test accounts.",
    ],
    parts: [
      {
        title: "Create the app",
        steps: [
          { text: "On https://developers.tiktok.com, open your profile icon → **Manage apps** → **Connect an app**, choose the owner (an organization is recommended) and click **Confirm**." },
          { text: "In **App details**, add the icon (1024×1024), name, category and description; under **Platforms** choose **Web** and enter your website; add the Terms of Service and Privacy Policy URLs and verify them under **URL properties → Verify properties**." },
        ],
      },
      {
        title: "Add Login Kit, scopes and webhooks",
        steps: [
          { text: "**Products → Add products → Login Kit**, and add the Redirect URI " + COMPOSIO_CALLBACK + " (the sign-in runs through Composio; https, no query string)." },
          { text: "**Scopes → Add scopes**: `user.info.profile`, `user.info.stats` and `video.list` (`user.info.basic` is added automatically)." },
          { text: "**Add products → Webhooks**, and set the callback URL to the {app} address under “Addresses to copy”." },
        ],
      },
      {
        title: "Copy the credentials",
        steps: [
          { text: "Open **App details → Credentials** and copy the **Client key** and **Client secret**." },
          { text: "Create a Composio auth config for the **tiktok** toolkit with **Use your own developer credentials** (client key and secret) and save its ID in the Composio card's **TikTok auth config ID**." },
        ],
      },
      {
        title: "Review, or test with a sandbox",
        steps: [
          { text: "Production: in **App review**, explain each product and scope, upload 1–5 demo videos and click **Submit for review**." },
          { text: "Until approved: **Sandbox → Create Sandbox**, then **Sandbox settings → Target users → Add account** (up to 10 accounts)." },
        ],
      },
    ],
    scopes: scopesOf("tiktok"),
    addresses: hooks("tiktok"),
    fields: {
      TIKTOK_CLIENT_KEY: "App details → Credentials → Client key.",
      TIKTOK_CLIENT_SECRET: "App details → Credentials → Client secret.",
      TIKTOK_REFRESH_TOKEN: "Only for the older token setup: a refresh token from the account owner's TikTok sign-in. Leave empty when clients connect TikTok through Composio.",
    },
    test: [
      "There's no Test connection. Connect a sandbox target account under **Social media** to confirm the sign-in works.",
    ],
    problems: [
      { problem: "TikTok rejects the redirect URI", fix: "It must be exactly " + COMPOSIO_CALLBACK + ": https, no query string and no #." },
      { problem: "Only sandbox accounts can connect", fix: "App review isn't approved yet. Add accounts as sandbox target users meanwhile." },
      { problem: "“TikTok refused the refresh token” (older setup)", fix: "The token expired or was replaced. Sign in again for a new one, or connect the account through Composio." },
    ],
    renewal: [
      "TikTok access tokens last a few hours and refresh tokens about 180 days (changed in November 2026; earlier documentation said 24 hours and 365 days). Each refresh replaces the refresh token; {app} keeps the newest one.",
      "If you reset the client secret, save it in {app} and in the Composio auth config.",
    ],
    checklist: [
      "App created; website URLs verified",
      "Login Kit with the Composio redirect URI; scopes added",
      "Webhook callback set to {app}",
      "Client key and secret saved in {app}",
      "Composio auth config for tiktok created and its ID saved",
      "App review approved (or sandbox users added)",
    ],
    links: [
      { label: "Create a TikTok app", url: "https://developers.tiktok.com/doc/getting-started-create-an-app" },
      { label: "Login Kit for web", url: "https://developers.tiktok.com/doc/login-kit-web" },
      { label: "Scopes", url: "https://developers.tiktok.com/doc/scopes-overview" },
      { label: "Sandbox", url: "https://developers.tiktok.com/doc/add-a-sandbox" },
      { label: "Access token management", url: "https://developers.tiktok.com/doc/oauth-user-access-token-management" },
      { label: "Webhooks", url: "https://developers.tiktok.com/doc/webhooks-overview" },
    ],
    unverified: [
      "The webhook settings labels for standard apps.",
      "Token lifetimes: TikTok's text says 180 days, while its sample responses still show 365 days.",
    ],
  },

  social_tokens: {
    purpose: "Access tokens for the older, token-based social setup. Only needed for an account that isn't connected through Composio (**Social media → Connect**). Most organizations can leave these empty.",
    cost: "Free platform tokens, except X, whose API is paid per use.",
    time: "About 15 minutes per platform.",
    requirements: [
      "A developer app on the platform and the account owner's permission.",
      "For X: credits bought in the X developer console.",
    ],
    parts: [
      {
        title: "Facebook Page access token",
        steps: [
          { text: "In Graph API Explorer (https://developers.facebook.com/tools/explorer), choose your Meta app and get a user token with `pages_show_list`, `pages_read_engagement` and `read_insights` (add `instagram_basic` and `instagram_manage_insights` for Instagram)." },
          { text: "Make it long-lived: Access Token Debugger (https://developers.facebook.com/tools/debug/accesstoken/) → **Debug** → **Extend Access Token**." },
          { text: "With the long-lived token, request `me/accounts` in Graph API Explorer and copy the Page's `access_token`. A Page token made from a long-lived user token has no expiry date." },
        ],
      },
      {
        title: "Threads access token",
        steps: [
          { text: "From your Meta app's Threads use case, get a long-lived Threads token for the account owner with `threads_basic` and `threads_manage_insights` (valid 60 days; {app} refreshes it automatically)." },
        ],
      },
      {
        title: "X (Twitter) bearer token",
        steps: [
          { text: "At https://console.x.com open **Apps** → your app → **Keys and tokens** and copy the **Bearer Token** (shown once; **Regenerate** replaces it)." },
          { text: "X's API is pay per use: buy credits in the console. Reading a profile costs about $0.010 and a post $0.005." },
        ],
      },
      {
        title: "LinkedIn access token",
        steps: [
          { text: "A LinkedIn app with Community Management API access; an admin of the company page signs in and allows `r_organization_social` and `rw_organization_admin`. Copy the access token (valid 60 days)." },
        ],
      },
      {
        title: "Pinterest access token",
        steps: [
          { text: "A Pinterest app (https://developers.pinterest.com/apps); the business account owner signs in and allows `user_accounts:read`, `boards:read` and `pins:read`. Copy the access token (valid 30 days)." },
        ],
      },
    ],
    fields: {
      FACEBOOK_PAGE_ACCESS_TOKEN: "Graph API Explorer → me/accounts → the Page's access_token (from a long-lived user token). Also used for Instagram.",
      THREADS_ACCESS_TOKEN: "The account owner's long-lived Threads token.",
      X_BEARER_TOKEN: "console.x.com → Apps → your app → Keys and tokens → Bearer Token.",
      LINKEDIN_ACCESS_TOKEN: "Access token from a company page admin's sign-in to your LinkedIn app.",
      PINTEREST_ACCESS_TOKEN: "Access token from the business account owner's sign-in to your Pinterest app.",
    },
    test: [
      "There's no Test connection. Open **Social media** for a client with a profile on that platform and refresh it; an error names the problem.",
    ],
    problems: [
      { problem: "A token stopped working", fix: "It expired: LinkedIn tokens last 60 days, Pinterest 30 days, Facebook user tokens about 60 days. Create a new one, or connect the account through Composio." },
      { problem: "Permission errors", fix: "The token is missing one of the permissions listed above; create it again with all of them." },
      { problem: "X answers with a payment or credit error", fix: "Buy credits in the X developer console." },
    ],
    renewal: [
      "Facebook Page tokens from a long-lived user token don't expire, unless the person changes their password, logs out or removes the app.",
      "Threads tokens: 60 days, refreshed automatically by {app} while still valid.",
      "LinkedIn: 60 days. Pinterest: 30 days. Set a reminder to replace them.",
      "X bearer tokens work until regenerated.",
    ],
    checklist: [
      "Only the platforms that aren't connected through Composio",
      "Each token created with the permissions listed",
      "Tokens saved in {app}; a profile refreshed successfully",
      "Reminders set for tokens that expire",
    ],
    links: [
      { label: "Long-lived Facebook tokens", url: "https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived" },
      { label: "Access Token Debugger", url: "https://developers.facebook.com/tools/debug/accesstoken/" },
      { label: "Long-lived Threads tokens", url: "https://developers.facebook.com/docs/threads/get-started/long-lived-tokens" },
      { label: "X API pricing", url: "https://docs.x.com/x-api/getting-started/pricing" },
      { label: "LinkedIn authorization code flow", url: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow" },
      { label: "Pinterest authentication", url: "https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/" },
    ],
    unverified: [
      "Whether new X accounts can still choose the Basic or Pro plans instead of pay per use.",
      "Whether LinkedIn development-tier apps get refresh tokens.",
    ],
  },

  custom: {
    purpose: "Extra configuration values for {org}, such as a setting your platform operator asks you to add. They're stored encrypted like every credential and used only by the feature that reads them.",
    cost: "Free.",
    time: "A minute.",
    requirements: [
      "The organization owner role.",
      "The exact name and value you were asked to add.",
    ],
    parts: [],
    enter: {
      title: "Add a variable",
      steps: [
        { text: "Open **Integrations** → **Organization credentials** → the **Custom variables** card → **Add variable**." },
        { text: "**Name**: capital letters, digits and underscores, starting with a letter (2–81 characters), for example `MY_SETTING`." },
        { text: "**Value**: up to 8,000 characters." },
        { text: "**Secret** is on by default: only the last characters are shown after saving. Turn it off for plain settings such as an ID or a URL." },
        { text: "Click **Add variable**. Use the pencil icon to change a value and the bin icon to delete it." },
      ],
      note: "A name that belongs to an integration (for example ANTHROPIC_API_KEY) is saved with that integration. Platform settings (database, encryption, scheduler, app address and email sending) can't be stored here.",
    },
    test: ["There's nothing to test: a variable is read by the feature that needs it."],
    problems: [
      { problem: "“Names use capital letters, digits and underscores”", fix: "Use a name like MY_SETTING: capitals, digits and underscores, starting with a letter." },
      { problem: "“… is a platform setting and stays in the hosting environment”", fix: "That value is managed by the platform operator, not per organization." },
      { problem: "“That value is too long”", fix: "Values can be up to 8,000 characters." },
    ],
    renewal: ["Variables never expire. Change or delete them on the Custom variables card."],
    checklist: ["Name and value checked with whoever asked for them", "Secret switched off only for non-secret values"],
    links: [],
    unverified: [],
  },
};

/* ------------------------------------------------------------------------------------------------- public */

/** Every registry integration that has a guide (a test fails when one is missing). */
export const hasGuide = (id: string) => id in SOURCES && Boolean(integrationById(id));
export const guideIds = () => INTEGRATIONS.map((i) => i.id).filter(hasGuide);

/** What the guides don't cover yet: integrations without a guide, fields without a "where to find it", stray guides. */
export function guideCoverage() {
  return {
    missingGuides: INTEGRATIONS.filter((i) => !(i.id in SOURCES)).map((i) => i.id),
    missingFields: INTEGRATIONS.flatMap((i) => i.fields.filter((f) => !SOURCES[i.id]?.fields?.[f.key]?.trim()).map((f) => `${i.id}.${f.key}`)),
    unknownGuides: Object.keys(SOURCES).filter((id) => !integrationById(id)),
    unknownFields: Object.entries(SOURCES).flatMap(([id, s]) => Object.keys(s.fields ?? {}).filter((k) => !integrationById(id)?.fields.some((f) => f.key === k)).map((k) => `${id}.${k}`)),
  };
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

/** The placeholders a guide's text may use, filled from the context. */
function filler(def: IntegrationDef, ctx: GuideContext) {
  const appUrl = trimUrl(ctx.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "") || "https://your-app-address";
  let appHost = appUrl;
  try { appHost = new URL(appUrl).hostname; } catch { /* not a URL: shown as given */ }
  const vars: Record<string, string> = {
    app: ctx.appName?.trim() || "SEO Insights",
    org: ctx.orgName?.trim() || "your organization",
    appUrl,
    appHost,
    redirectUri: def.redirectPath ? `${appUrl}${def.redirectPath}` : appUrl,
  };
  return (s: string) => s.replace(/\{(app|org|appUrl|appHost|redirectUri)\}/g, (_, k: string) => vars[k]);
}

function deepFill<T>(v: T, fill: (s: string) => string): T {
  if (typeof v === "string") return fill(v) as T;
  if (Array.isArray(v)) return v.map((x) => deepFill(x, fill)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepFill(x, fill)])) as T;
  return v;
}

function enterPart(def: IntegrationDef, note?: string): GuidePart {
  return {
    title: "Enter it in {app}",
    steps: [
      { text: "In {app}, open **Integrations** in the sidebar and go to **Organization credentials**. Only organization owners can enter or change credentials." },
      { text: `On the **${def.name}** card, click **Configure** (it says **Edit** once something is saved).` },
      { text: `Fill in the fields listed below and click **${def.testable ? "Save and test" : "Save"}**. They're used for every client of {org}.` },
      { text: "Secrets are encrypted when saved and never shown again; only their last 4 characters appear. To change one, click **Edit** and type the new value (leave a secret empty to keep the saved one)." },
      ...(note ? [{ text: note }] : []),
    ],
  };
}

/**
 * The full setup guide for an integration, with this deployment's addresses and the product and organization
 * names filled in. null for an id that isn't in the registry (or has no guide).
 */
export function guideFor(id: string, ctx: GuideContext = {}): Guide | null {
  const def = integrationById(id);
  const src = SOURCES[id];
  if (!def || !src) return null;
  const scope: Guide["scope"] = def.id === "custom" ? "settings" : def.perClient ? "client" : "organization";
  const guide: Guide = {
    id: def.id,
    name: def.name,
    category: def.category,
    categoryLabel: CATEGORIES.find((c) => c.id === def.category)?.label ?? def.category,
    description: def.description,
    features: def.features,
    scope,
    testable: Boolean(def.testable),
    purpose: src.purpose,
    cost: src.cost,
    time: src.time,
    requirements: src.requirements,
    parts: src.parts,
    apis: src.apis ?? [],
    scopes: src.scopes ?? [],
    consent: src.consent ?? [],
    addresses: src.addresses ?? [],
    fields: def.fields.map((f) => ({
      key: f.key, label: f.label, secret: f.secret, required: f.required, placeholder: f.placeholder,
      source: src.fields?.[f.key] ?? f.help ?? "",
    })),
    enter: src.enter ?? enterPart(def, src.enterNote),
    test: src.test,
    problems: src.problems,
    renewal: src.renewal,
    checklist: src.checklist,
    links: src.links,
    unverified: src.unverified,
  };
  return deepFill(guide, filler(def, ctx));
}

/** Every guide, in registry order. */
export function allGuides(ctx: GuideContext = {}): Guide[] {
  return guideIds().map((id) => guideFor(id, ctx)!);
}

/** The introduction of the complete guide ("Before you start"). */
export function guideIntro(ctx: GuideContext = {}) {
  const fill = filler(INTEGRATIONS[0], ctx);
  return deepFill({
    title: "Before you start",
    summary: "{app} reads your clients' data from other services. Each service needs an account and, usually, a credential: an API key, a token, or an app ID and secret that you create in that service and paste into {app}. This guide walks through every one of them, in the same order as the Integrations page.",
    groups: [
      {
        title: "Who can do what",
        items: [
          "Organization **owners** add, change and delete credentials.",
          "**Admins** see which integrations are set up, run **Test connection** and download these guides, but never see or change credentials.",
          "An owner or admin of a client connects that client's own accounts (Google Analytics, Search Console, Business Profile, Bing, Local Brand Manager, Clarity).",
        ],
      },
      {
        title: "Where things go",
        items: [
          "Organization credentials: **Integrations** in the sidebar → **Organization credentials** → the integration's card → **Configure**. They're used for every client of {org}.",
          "Client connections: pick the client at the top, then **Integrations** → **Client connections**.",
          "Values are encrypted when saved and never shown again; secrets show only their last 4 characters.",
        ],
      },
      {
        title: "Suggested order",
        ordered: true,
        items: [
          "**Google Cloud OAuth (Business Profile)**: send Google's API access request first, because approval can take up to 14 days.",
          "**Anthropic Claude** and **DataForSEO**: most AI and SEO features depend on them.",
          "**Composio**: needed before any client can connect Google Analytics, Search Console or social accounts.",
          "Everything else when you need it.",
        ],
      },
      {
        title: "Keep credentials safe",
        items: [
          "Paste credentials straight into {app}; don't send them by email or chat.",
          "Create them with a shared company account rather than a personal one, so they survive staff changes.",
          "When someone who had access leaves, create new credentials and delete the old ones.",
          "Clients never need these credentials: they only sign in with their own accounts when connecting.",
        ],
      },
    ],
    appUrl: "{appUrl}",
  }, fill);
}

/* ------------------------------------------------------------------------------------------- inline text */

export type InlineToken = { kind: "text" | "strong" | "code" | "link"; text: string };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|(https:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)])/g;

/** Splits guide text into plain text, **bold** labels, `code` values and https:// links (rendered by the view and the PDF). */
export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else out.push({ kind: "link", text: m[3] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Guide text without markup (search, plain-text exports). */
export const plainText = (text: string) => inlineTokens(text).map((t) => t.text).join("");
