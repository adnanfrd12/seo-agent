# Platform, legal and data audit

Audited on November 24, 2026 against the code on `main`, `.env` variable names (values not read), `vercel.json`, the Supabase migrations and the live Composio auth configs (read with `scripts/composio-auth-configs.mjs`, read-only).

## 1. Hosting, database, auth

| Area | Provider | Where |
|---|---|---|
| Hosting, serverless functions, crons | **Vercel** (deploys from GitHub `main`; crons in `vercel.json`: sync 06:00, research 07:30, extras 08:15, AI 09:00 UTC) | `vercel.json` |
| Database, storage | **Supabase** Postgres + Storage (avatars; new private `compliance` bucket as a fallback, see §8) | `supabase/migrations/*` |
| Authentication | **Supabase Auth**: email + password, and Google sign-in (OAuth through Supabase's Google provider) | `src/app/login/login-form.tsx`, `src/app/auth/callback/route.ts` |
| Platform connections | **Composio** (`@composio/core`), one Composio entity per workspace: `client:<clientId>` | `src/lib/composio/client.ts`, `src/lib/integrations/service.ts`, `src/lib/social/composio.ts` |

## 2. Transactional email

- **Supabase Auth email**: password reset links (`resetPasswordForEmail`).
- **Resend** (optional): critical alert emails to workspace owners and admins when `RESEND_API_KEY` and `ALERT_EMAIL_FROM` are set (`src/lib/notify.ts`). These are not set in the local `.env`. Listed as a processor because the code uses it when configured.

## 3. Platforms

Live Composio auth configs (no secrets read):

| Toolkit | Auth config | Managed by | Scopes requested today | Redirect |
|---|---|---|---|---|
| google_analytics | ac_mkl9N3pxx7je | Composio | analytics.readonly, **analytics**, userinfo.profile | v1 auth-apps/add |
| google_search_console | ac_vQs456wHPMz5 | Composio | **webmasters**, webmasters.readonly, userinfo.profile, userinfo.email | v1 auth-apps/add |
| youtube | ac_q-PO_5jZcePi | Composio | **youtube, youtube.upload, youtube.force-ssl, youtubepartner, youtubepartner-channel-audit, youtube.channel-memberships.creator**, youtube.readonly (no yt-analytics.readonly) | v1 auth-apps/add |
| facebook | ac_kUcuXWmI-MWm | Composio | public_profile, **email, business_management, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_manage_metadata, pages_messaging**, pages_show_list, pages_read_engagement, read_insights | v1 auth-apps/add |
| instagram | ac_Nsh2nFi18Z8v | Composio | instagram_business_basic, instagram_business_manage_insights, **instagram_business_manage_messages, instagram_business_manage_comments, instagram_business_content_publish** | v1 auth-apps/add |
| pinterest | ac_pYimmCd9acVM | Composio | user_accounts:read, boards:read, pins:read, **boards:read_secret, boards:write, boards:write_secret, pins:read_secret, pins:write, pins:write_secret, user_accounts:write** | v1 auth-apps/add |
| threads | ac_NBPxq3QBvYng | **Our app** (THREADS_APP_ID) | threads_basic, threads_manage_insights | v1 auth-apps/add |
| twitter (X) | none | | | |
| tiktok | none | | | |
| linkedin | none (first Connect would create a Composio-managed one) | | | |

**Bold** = not needed for read-only reporting and never used by the code. The code only calls read tools; nothing posts or edits. Removing these needs a change in Composio, which I didn't make because it alters live consent screens. `scripts/composio-readonly-scopes.mjs` shows the change (dry run) and applies it with `--apply`. The durable fix is our own developer app per platform (custom auth config), which also puts **SEO Insights** instead of Composio on each consent screen. New managed configs created by the app now request only the registry's read-only scopes (`src/lib/social/composio.ts`).

Composio redirect URLs: every live config uses `https://backend.composio.dev/api/v1/auth-apps/add`. Composio's current docs give `https://backend.composio.dev/api/v3/toolkits/auth/callback`, and the v3.1 API uses `https://backend.composio.dev/api/v3.1/toolkits/auth/callback`. Allow-list all three.

| Registry id | Status | Connection | Code | Data stored | Disconnect (UI path) |
|---|---|---|---|---|---|
| google_signin | planned (button removed from sign-in page, Nov 24 2026) | Supabase Auth Google OAuth (openid, email, profile) | `login-form.tsx` | `auth.users`, `profiles` (name, avatar) | n/a (user account deletion) |
| google_search_console | live | Composio, managed | `src/lib/composio/gsc.ts`, `src/lib/sync/gsc.ts`, `src/lib/gscx/*` | `gsc_*_metrics`, `gsc_query_page_metrics` (via `integration_resources`), `dfs_cache` endpoint `gscx` | Integrations → Search Console → Disconnect |
| google_analytics | live | Composio, managed | `src/lib/composio/ga4.ts`, `src/lib/sync/ga4.ts`, `src/lib/ga4x/*` | `ga4_*_metrics`, `ga4_cube_metrics`, `dfs_cache` endpoint `ga4x` | Integrations → Google Analytics → Disconnect |
| google_business_profile | live | Direct OAuth with our Google client (business.manage, openid, email) | `src/lib/google/*`, `src/app/api/integrations/gbp/*` | `integration_secrets` (encrypted refresh token), `gbp_daily_metrics`, `gbp_keyword_metrics`, `gbp_reviews` | Integrations → Business Profile → Disconnect (revokes at Google) |
| youtube | live | Composio, managed | `src/lib/social/composio-read.ts` | `dfs_cache` endpoint `social`, key `youtube` | Social media → Connect social accounts → Disconnect |
| bing_webmaster | live | API key (encrypted in `integration_secrets`) | `src/lib/bing/*`, `src/lib/sync/bing.ts` | `bing_*_metrics` | Integrations → Bing Webmaster Tools → Disconnect |
| microsoft_clarity | live | Data Export API token (encrypted) | `src/lib/clarity/*`, `src/lib/sync/clarity.ts` | `clarity_behavior_metrics` | Integrations → Microsoft Clarity → Disconnect |
| facebook_pages | live | Composio, managed | `composio-read.ts` | `dfs_cache` social `facebook` | Social media → Disconnect |
| instagram | live | Composio, managed (Instagram Login) | `composio-read.ts` | `dfs_cache` social `instagram` | Social media → Disconnect |
| threads | in_review | Composio, our app | `composio-read.ts` | `dfs_cache` social `threads` | Social media → Disconnect |
| x | in_review | Composio, **no auth config yet** | `composio-read.ts` (code exists) | `dfs_cache` social `x` | Social media → Disconnect |
| tiktok | in_review | Composio, **no auth config yet** | `composio-read.ts` (code exists) | `dfs_cache` social `tiktok` | Social media → Disconnect |
| pinterest | in_review | Composio, managed | `composio-read.ts` | `dfs_cache` social `pinterest` | Social media → Disconnect |
| linkedin | live (code), never connected | Composio (managed on first connect) | `composio-read.ts` | `dfs_cache` social `linkedin` | Social media → Disconnect |

Other sources that are not platform connections: **Local Brand Manager** (agency API token, GBP metrics for locations the agency manages; Disconnect keeps its history as before), **DataForSEO**, **SEOSignalX** (domain only), **Google PageSpeed/CrUX** (public URLs), **OpenStreetMap Nominatim** (city names).

IDs before this change: `integration_connections.composio_connected_account_id` stored the Composio account for GA4/GSC only. No platform user IDs were stored anywhere. Now `clients.settings.platform_accounts[<registry id>]` keeps `user_id` (Meta app-scoped user ID, Instagram user ID, Threads user ID, X user ID, TikTok `open_id`, Pinterest account ID, Google `sub` for Business Profile), extra IDs (Facebook Page ID, YouTube channel ID, LinkedIn org ID) and the Composio connected-account ID. It's recorded on every successful read and on connect, so existing connections are backfilled by the next scheduled refresh.

Disconnect before this change: it removed Composio accounts or revoked the GBP grant, deleted tokens, and **kept all stored data**. Now it deletes everything received from the connection (`src/lib/compliance/deletion.ts`).

## 4. Third-party data and AI services

- **DataForSEO**: domains, URLs, keywords, business names and locations, competitor domains. No personal account data.
- **Anthropic (Claude)**, via `src/lib/ai/*`, `src/lib/toolkit/*`, `src/lib/blog/geo.ts`, `src/lib/gscx/labels.ts`: aggregated GA4, GSC, GBP, Bing and Clarity metrics, search queries, page URLs, titles and page text from the client's public website, social account statistics, Clarity reviewer notes, and the text of PDF reports a user uploads (`extract-report.ts`). Never tokens, passwords or payment data.
- **Composio**: OAuth tokens and the read-only API responses.

## 5. Cookies and scripts on public pages

- Supabase auth cookies (`sb-<ref>-auth-token*`), set only after sign-in.
- `seo_range`, which remembers the picked date range (app pages only).
- localStorage: "remember me" email and sidebar state (app).
- No analytics, tag manager, pixels or third-party scripts on any page. Google Fonts are self-hosted by `next/font`.

## 6. Backups and logs

- Supabase: there is no MCP access to the project, so the plan couldn't be read. The policy states **7 days**, which is Supabase Pro's daily-backup retention; PITR is not configured in code. **Owner: confirm the plan.** If PITR is on, the period is the PITR window; if it's above 7, change `SITE.backupDays`.
- Vercel runtime logs: retention depends on the plan (1 day on Pro, up to 30 days with Observability Plus). The policy states **up to 30 days** (`SITE.logDays`).

## 7. Where things live

| Thing | Path |
|---|---|
| Homepage `/` | `src/app/page.tsx` (was a redirect to `/overview`; now a public page with the description and sign-in box) |
| Sign-in | `src/app/login/page.tsx`, `src/app/login/login-form.tsx` |
| Privacy / Terms | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` (shell `src/components/legal/legal-page.tsx`) |
| Footer | `src/components/legal/site-footer.tsx` (public + muted in `src/components/layout/app-shell.tsx`) |
| Connect screens | Integrations `src/app/(dashboard)/integrations/page.tsx` + `src/components/integrations/integration-card.tsx`; Social `src/app/(dashboard)/social/page.tsx` + `src/components/research/social-controls.tsx` |
| Auth middleware | `src/proxy.ts` (Next 16 proxy) |

## 8. Earlier legal or callback work

- `/privacy` and `/terms` existed (Nov 15, 2026 text, contact fell back to `/login#contact` because `NEXT_PUBLIC_CONTACT_EMAIL` wasn't set; the "Contact sales" and "Create an account" mailto links were empty). Both are replaced.
- No `/data-deletion`, `/platforms` or `/api/meta/*` routes existed. Threads' Uninstall and Delete callbacks in the Meta console pointed to Composio; they must be changed to ours (see the console document).
- No `data_deletion_requests` table existed; added in `supabase/migrations/20261124000024_data_deletion.sql`. Until it's applied, requests and the audit log are written as JSON to the private Storage bucket `compliance`.
