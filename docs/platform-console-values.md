# Platform console values

Generated from `src/config/platforms.ts` by `scripts/gen-console-values.mts`. Do not edit by hand; edit the registry and re-run.

## Values for every console

| Field | Value |
|---|---|
| App name / display name | **SEO Insights** (also Meta's "Threads Display Name") |
| Company | Waheed Zen LLC |
| Contact email | im@waheedzen.com |
| Website / homepage | https://seoinsights.waheedzen.com |
| App domain (Meta) / verified domain (Google authorized domain, TikTok, Pinterest) | waheedzen.com (TikTok and Pinterest: verify seoinsights.waheedzen.com) |
| Privacy policy URL | https://seoinsights.waheedzen.com/privacy |
| Terms URL | https://seoinsights.waheedzen.com/terms |
| Data deletion URL (instructions) | https://seoinsights.waheedzen.com/data-deletion |
| Permissions page | https://seoinsights.waheedzen.com/platforms |

### Composio OAuth redirect URLs

Add **every** URL below to the redirect / callback allow-list of each Composio-connected platform. The live auth configs currently use the first one; Composio's current docs show the second; the third is the newer API version.

- `https://backend.composio.dev/api/v1/auth-apps/add`
- `https://backend.composio.dev/api/v3/toolkits/auth/callback`
- `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`

Deauthorize, delete, uninstall and webhook URLs must point to **SEO Insights**, never to Composio.

## Google

- OAuth consent screen: App name SEO Insights; user support and developer contact im@waheedzen.com; logo; App home page, Privacy policy and Terms links below.
- Authorized domain: waheedzen.com (verify it in Google Search Console under the same Google account).
- Scopes: list exactly the scopes below. Demo video: sign in at the homepage, open Integrations, show the consent panel, connect, and show each scope's data in use (Search Console pages, Analytics pages, Business Profile page, Social → YouTube).

### Google Search Console (`google_search_console`, live)

- Connection: Google's official sign-in (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Google OAuth Client ID → Composio "Client id"; Client secret → "Client secret" (Composio toolkit google_search_console, auth config type: custom / your own app).
- Console notes: Connected through Composio. Redirect URIs = every Composio callback URL (see docs/platform-console-values.md). Google Cloud: enable the Search Console API; OAuth consent screen lists webmasters.readonly.
- Scopes to request (reviewer justification):
  - `https://www.googleapis.com/auth/webmasters.readonly`: Read search queries, clicks, impressions, CTR, positions, page indexing (URL Inspection) and sitemaps for the sites you choose.
- **Flag:** The current Composio-managed Search Console config also requests webmasters (read/write), userinfo.email and userinfo.profile. SEO Insights only uses read calls; switch to our own read-only auth config (see the audit).
- Revoke steps shown to users: Google Account → Security → Your connections to third-party apps & services (myaccount.google.com/connections) → SEO Insights → Delete all connections / Remove access

### Google Analytics 4 (`google_analytics`, live)

- Connection: Google's official sign-in (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Google OAuth Client ID → Composio "Client id"; Client secret → "Client secret" (toolkit google_analytics).
- Console notes: Connected through Composio. Redirect URIs = every Composio callback URL (see docs/platform-console-values.md). Google Cloud: enable the Google Analytics Data API and Admin API; consent screen lists analytics.readonly.
- Scopes to request (reviewer justification):
  - `https://www.googleapis.com/auth/analytics.readonly`: Read aggregated reports (traffic, engagement, events, conversions, channels, devices, locations) for the properties you choose.
- **Flag:** The current Composio-managed Analytics config also requests analytics (edit) and userinfo.profile. SEO Insights only runs reports; switch to our own read-only auth config (see the audit).
- Revoke steps shown to users: Google Account → Security → Your connections to third-party apps & services (myaccount.google.com/connections) → SEO Insights → Delete all connections / Remove access

### Google Business Profile (`google_business_profile`, live)

- Connection: Google's official sign-in (OAuth 2.0) directly with SEO Insights' own Google OAuth client.
- Redirect URI (our own OAuth callback): `https://seoinsights.waheedzen.com/api/integrations/gbp/callback`
- Console notes: Direct OAuth. Google Cloud OAuth client → Authorized redirect URI = https://seoinsights.waheedzen.com/api/integrations/gbp/callback (GOOGLE_GBP_REDIRECT_URI). Business Profile APIs need Google's GBP API access approval.
- Scopes to request (reviewer justification):
  - `https://www.googleapis.com/auth/business.manage`: Google offers no read-only Business Profile scope. SEO Insights only reads locations, performance, search keywords and reviews; it never edits a profile, replies or posts.
  - `openid`: Identify the Google account that connected (account ID), so disconnect and deletion requests can be matched.
  - `email`: Show which Google account is connected.
- Revoke steps shown to users: Google Account → Security → Your connections to third-party apps & services (myaccount.google.com/connections) → SEO Insights → Delete all connections / Remove access

### YouTube (`youtube`, live)

- Connection: Google's official sign-in (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Google OAuth Client ID → Composio "Client id"; Client secret → "Client secret" (toolkit youtube).
- Console notes: Connected through Composio. Redirect URIs = every Composio callback URL (see docs/platform-console-values.md). Google Cloud: enable YouTube Data API v3 and YouTube Analytics API.
- Scopes to request (reviewer justification):
  - `https://www.googleapis.com/auth/youtube.readonly`: Read the channel's details, statistics and video list.
  - `https://www.googleapis.com/auth/yt-analytics.readonly`: Read channel analytics: views, watch time, subscribers gained and lost, top videos and audience.
- **Flag:** The current Composio-managed YouTube config requests write scopes (youtube, youtube.upload, youtube.force-ssl, youtubepartner…) and not yt-analytics.readonly. Switch to our own read-only auth config (see the audit).
- Revoke steps shown to users: Google Account → Security → Your connections to third-party apps & services (myaccount.google.com/connections) → SEO Insights → Delete all connections / Remove access

## Microsoft

- No developer console: the site owner creates the key/token and pastes it into Integrations. Nothing to register.

### Bing Webmaster Tools (`bing_webmaster`, live)

- Connection: An API key that the site owner creates in Bing Webmaster Tools and pastes into SEO Insights (stored encrypted).
- Console notes: API key entered in SEO Insights → Integrations. No console callback.
- Scopes to request (reviewer justification):
  - `Bing Webmaster API key`: Read search performance, queries, pages, crawl and index data for the sites you choose.
- Revoke steps shown to users: Bing Webmaster Tools → Settings → API access → delete (regenerate) the API key

### Microsoft Clarity (`microsoft_clarity`, live)

- Connection: A project API token (Data Export API) that the site owner creates in Clarity and pastes into SEO Insights (stored encrypted).
- Console notes: API token entered in SEO Insights → Integrations. No console callback.
- Scopes to request (reviewer justification):
  - `Clarity Data Export API token`: Read aggregated daily usage metrics for the project.
- Revoke steps shown to users: Microsoft Clarity → project → Settings → Data Export → delete the API token

## Meta

- App Dashboard → Settings → Basic: Display name SEO Insights, App domains waheedzen.com, Privacy Policy URL, Terms of Service URL, User data deletion → Data deletion callback URL (below), category Business, contact email im@waheedzen.com.
- Use cases: add only the permissions below; complete Data Use Checkup; App Review needs a screencast of the Connect flow and a reviewer test login (see Reviewer test account).
- Business verification: Waheed Zen LLC (already verified).

### Facebook Pages (`facebook_pages`, live)

- Connection: Facebook Login (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Meta App ID → Composio "Client id"; Meta App Secret → "Client secret" (toolkit facebook). The same App Secret goes in META_APP_SECRET.
- Deauthorize callback URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/facebook/deauthorize`
- Data deletion request URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/facebook/delete`
- Console notes: Meta app (Facebook Login for Business) → Settings: Valid OAuth Redirect URIs = Composio callbacks; Deauthorize and Data Deletion callbacks = ours (META_APP_SECRET).
- Scopes to request (reviewer justification):
  - `public_profile`: Identify the person who connected (app-scoped ID), so disconnect and deletion requests can be matched.
  - `pages_show_list`: List the Pages you manage so the right business Page is reported.
  - `pages_read_engagement`: Read the Page's followers, posts and post engagement.
  - `read_insights`: Read Page insights such as views, reach and engagement over time.
- **Flag:** The current Composio-managed Facebook config also requests email, business_management, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_manage_metadata and pages_messaging. SEO Insights never uses them; switch to our own Meta app (see the audit).
- Revoke steps shown to users: Facebook → Settings & privacy → Settings → Business integrations (and Apps and websites) → SEO Insights → Remove

### Instagram (`instagram`, live)

- Connection: Instagram Login for professional accounts (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Instagram App ID (Instagram API with Instagram Login) → Composio "Client id"; Instagram App Secret → "Client secret" (toolkit instagram). The same secret goes in INSTAGRAM_APP_SECRET.
- Deauthorize callback URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/instagram/deauthorize`
- Data deletion request URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/instagram/delete`
- Console notes: Meta app → Instagram API with Instagram Login → Business login settings: OAuth redirect URIs = Composio callbacks; Deauthorize and Data deletion URLs = ours (INSTAGRAM_APP_SECRET).
- Scopes to request (reviewer justification):
  - `instagram_business_basic`: Read the professional account's profile, follower count and media list.
  - `instagram_business_manage_insights`: Read account and media insights: reach, views, engagement and follower demographics.
- **Flag:** The current Composio-managed Instagram config also requests instagram_business_manage_messages, instagram_business_manage_comments and instagram_business_content_publish. SEO Insights never uses them; switch to our own Meta app (see the audit).
- Revoke steps shown to users: Instagram → Settings → Website permissions → Apps and websites → SEO Insights → Remove (or Facebook → Business integrations if connected through a Page)

### Threads (`threads`, in review)

- Connection: Threads sign-in (OAuth 2.0) with SEO Insights' own Meta app, run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Threads App ID → Composio "Client id"; Threads App Secret → "Client secret" (toolkit threads). The same secret goes in THREADS_APP_SECRET.
- Uninstall callback URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/threads/uninstall`
- Delete callback URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/meta/threads/delete`
- Console notes: Meta app → Use cases → Access the Threads API → Settings: Redirect Callback URLs = Composio callbacks; Uninstall/Delete callbacks = ours (THREADS_APP_SECRET); Threads Display Name = SEO Insights.
- Scopes to request (reviewer justification):
  - `threads_basic`: Read the profile name, username and picture to label the account in your dashboard.
  - `threads_manage_insights`: Read account and post insights: views, likes, replies, reposts, quotes, followers and demographics.
- Revoke steps shown to users: Threads → Settings → Account → Website permissions → Apps and websites → Active → SEO Insights → Remove

## X Corp.

- User authentication settings: App permissions Read; Type of App Web App, Automated App or Bot; Callback URI / Redirect URL = each Composio URL below; Website URL = homepage; Terms of service and Privacy policy URLs below.

### X (formerly Twitter) (`x`, in review)

- Connection: X sign-in (OAuth 2.0 with PKCE) with SEO Insights' own X app, run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: X OAuth 2.0 Client ID → Composio "Client id"; OAuth 2.0 Client Secret → "Client secret" (toolkit twitter). Put the auth config id in COMPOSIO_AUTH_CONFIG_TWITTER (optional).
- Console notes: X developer portal → app → User authentication settings: App permissions Read; Type Web App; Callback URI = Composio callbacks; Website, Terms and Privacy URLs = ours.
- Scopes to request (reviewer justification):
  - `tweet.read`: Read the account's own posts and their public metrics.
  - `users.read`: Read the profile and follower/following counts.
  - `follows.read`: Read follower and following counts.
  - `offline.access`: Keep the read connection working without asking you to sign in every two hours.
- Revoke steps shown to users: X → Settings and privacy → Security and account access → Apps and sessions → Connected apps → SEO Insights → Revoke app permissions

## TikTok

- Platform: Web. Verify the domain seoinsights.waheedzen.com (URL prefix) in the TikTok developer portal. Login Kit: Redirect URI = each Composio URL below. Webhooks: Callback URL below. Demo video recorded on the verified domain showing Connect and the TikTok stats.

### TikTok (`tiktok`, in review)

- Connection: TikTok Login Kit (OAuth 2.0) with SEO Insights' own TikTok app, run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: TikTok Client Key → Composio "Client id"; Client Secret → "Client secret" (toolkit tiktok). The same secret goes in TIKTOK_CLIENT_SECRET.
- Webhook callback URL: `https://seoinsights.waheedzen.com/api/platform-webhooks/tiktok`
- Console notes: TikTok for Developers → app: Web platform, verified domain, Login Kit redirect URI = Composio callbacks; Webhooks callback URL = ours (TIKTOK_CLIENT_SECRET).
- Scopes to request (reviewer justification):
  - `user.info.basic`: Read the account's open ID, display name and avatar to label it.
  - `user.info.profile`: Read the profile link and bio shown with the account.
  - `user.info.stats`: Read follower, following, likes and video counts.
  - `video.list`: Read the account's public videos and their view, like, comment and share counts.
- Revoke steps shown to users: TikTok → Profile → Menu → Settings and privacy → Security & permissions → Apps and services permissions → SEO Insights → Remove access

## Pinterest

- Redirect URIs = each Composio URL below. Start in Trial access, then request Standard access with a demo video of Connect and the Pinterest stats.

### Pinterest (`pinterest`, in review)

- Connection: Pinterest sign-in (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: Pinterest App ID → Composio "Client id"; App secret key → "Client secret" (toolkit pinterest).
- Console notes: Pinterest developers → app: Redirect URIs = Composio callbacks; request Standard access with a demo video.
- Scopes to request (reviewer justification):
  - `user_accounts:read`: Read the business profile and account analytics (impressions, saves, clicks, outbound clicks).
  - `boards:read`: Read the account's public boards.
  - `pins:read`: Read the account's public Pins and their analytics.
- **Flag:** The current Composio-managed Pinterest config also requests boards:write, pins:write, user_accounts:write and secret-board scopes. SEO Insights never uses them; switch to our own Pinterest app (see the audit).
- Revoke steps shown to users: Pinterest → Settings → Security and logins (Apps) → SEO Insights → Revoke access

## LinkedIn

- Products: Community Management API (read). Auth → Authorized redirect URLs = each Composio URL below. Privacy policy URL below.

### LinkedIn Pages (`linkedin`, live)

- Connection: LinkedIn sign-in (OAuth 2.0), run by our connection partner Composio.
- Redirect URIs: `https://backend.composio.dev/api/v1/auth-apps/add`, `https://backend.composio.dev/api/v3/toolkits/auth/callback`, `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`
- Composio auth config: LinkedIn Client ID → Composio "Client id"; Client Secret → "Client secret" (toolkit linkedin).
- Console notes: LinkedIn developer portal → app → Auth: Authorized redirect URLs = Composio callbacks; product Community Management API (read).
- Scopes to request (reviewer justification):
  - `r_organization_admin`: Find the company pages you administer and read page statistics and follower counts.
  - `r_organization_social`: Read the page's posts and their statistics (impressions, clicks, reactions, shares).
- **Flag:** No LinkedIn auth config exists yet; the first Connect creates a Composio-managed one with Composio's default scopes. Create our own read-only LinkedIn app config first (see the audit).
- Revoke steps shown to users: LinkedIn → Settings & Privacy → Data privacy → Other applications → Permitted services → SEO Insights → Remove

## Reviewer test account

1. In Supabase Auth, create a user for the reviewer (email `reviewer@waheedzen.com` or the address the platform asks for). Do not commit the password; store it in the password manager and paste it only into the review form.
2. Create a demo workspace (client) named "SEO Insights Demo" and add the reviewer as a member with role `admin`, so the Integrations and Social pages show Connect and Disconnect.
3. Connect a demo Search Console property, GA4 property and the social test accounts the platform provides (Meta and TikTok give test users), so every screen shows sample data.
4. Fill in for each review:

| Field | Value |
|---|---|
| Login URL | https://seoinsights.waheedzen.com/login |
| Username | `<REVIEWER_EMAIL>` |
| Password | `<REVIEWER_PASSWORD>` (from the password manager; never committed) |
| Steps | Sign in → Integrations or Social media → Connect → read the consent panel → Continue → approve → see the data → Disconnect |
