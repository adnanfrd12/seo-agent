# SEO Analytics Dashboard

A multi-tenant dashboard that collects, stores and analyzes **Google Analytics 4**, **Google Search Console** and **Google Business Profile** data. Google data is fetched server-side through [Composio](https://composio.dev), stored in Supabase Postgres, and read by the UI exclusively through authorized Supabase RPCs.

> **Status: in progress.** Database, auth, app shell, the Composio connect flow, the **GA4 sync worker and GA4 page** are built and verified against real data. The Search Console and Business Profile syncs, their pages, and the overview/reports/history/settings pages are not. See [Project status](#project-status) for an honest breakdown. No page shows mock data: pages that aren't built show an empty state.

## Contents

- [Stack](#stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Integrations (Composio)](#integrations-composio)
- [Project structure](#project-structure)
- [Security model](#security-model)
- [Metric semantics](#metric-semantics)
- [Project status](#project-status)
- [Troubleshooting](#troubleshooting)

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict |
| Styling | Tailwind CSS 4, Lucide icons (shadcn-style hand-written components) |
| Database / auth | Supabase Postgres + Supabase Auth (`@supabase/ssr`) |
| Data access | Postgres RPC functions (security invoker + RLS) |
| Google access | Composio SDK (`@composio/core`) for GA4 and Search Console |
| Validation | Zod (env + every external API response) |
| Charts | Recharts (installed; charts not built yet) |

> **Next.js 16 note:** this project uses `src/proxy.ts` (the successor to `middleware.ts`). Cache Components are intentionally **off** in `next.config.ts`; every page is per-user and reads auth cookies. See `AGENTS.md` and `node_modules/next/dist/docs/`.

## Architecture

```
Browser ──► Next.js pages (server components) ──► Supabase RPCs (as the signed-in user, RLS applies)
   │
   └──► /api/integrations/* ──► Composio (OAuth + tool execution)   [server-side only, API key never in browser]
                          └──► Supabase (service role, trusted writes)

Sync worker ──► claim_next_sync_job() ──► Composio (GA4 ✔ / GSC ✘) / direct GBP adapter (✘) ──► upserts into metric tables
   ▲ started in the background (after the response) by Sync Now / saving a selection, and by /api/cron/sync
```

Principles:

- **Reads** go through RPCs that assert client membership and aggregate in SQL.
- **Writes to metric tables** are done only by the trusted server (service role). The browser role has no insert/update/delete on them.
- **Refresh Data** enqueues a job (`enqueue_sync_job`); it never runs an import inside a browser request.
- **Metrics stay attributed to their source.** GA4 users, GSC clicks and GBP impressions are never summed together.

## Getting started

### Prerequisites

- Node.js 20+ (developed on Node 24) and npm
- A Supabase project (this repo targets project ref `whkrbtlfnqniyiylktuz`, "seo-agent")
- A Composio account with auth configs for **Google Analytics** and **Google Search Console**

### Install and run

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npx tsc --noEmit   # typecheck
```

### First sign-in

1. In the Supabase dashboard: **Authentication → Users → Add user**, enter an email and password, and tick **Auto Confirm User**.
2. Open `/login` and sign in.
3. On first login you are asked to name your client. This calls the `create_client` RPC and makes you its **owner**.
4. Go to **Integrations** to connect Google accounts.

### Database setup

Migrations live in `supabase/migrations/` and are already applied to the `seo-agent` project. To apply them to a fresh project, run them in filename order via the Supabase CLI (`supabase link` then `supabase db push`) or the SQL editor.

## Environment variables

Copy `.env.example` to `.env.local`. **Secrets are server-only. Never prefix them with `NEXT_PUBLIC_`.**

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Public (publishable) key. Safe for the browser; RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key for trusted server writes. Bypasses RLS: keep secret |
| `COMPOSIO_API_KEY` | yes | Composio API key |
| `COMPOSIO_AUTH_CONFIG_GA4` | yes | Composio auth config id for Google Analytics |
| `COMPOSIO_AUTH_CONFIG_GSC` | yes | Composio auth config id for Google Search Console |
| `COMPOSIO_TOOLKIT_VERSION_GOOGLE_ANALYTICS` | recommended | Pin the toolkit version. If unset, calls skip Composio's version check |
| `COMPOSIO_TOOLKIT_VERSION_GOOGLE_SEARCH_CONSOLE` | recommended | Same, for Search Console |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL; used to build the OAuth callback URL |
| `CRON_SECRET` | yes (16+ chars) | Bearer secret for `GET/POST /api/cron/sync` |
| `GOOGLE_GBP_CLIENT_ID` / `GOOGLE_GBP_CLIENT_SECRET` | later | Direct Business Profile adapter (planned) |
| `TOKEN_ENCRYPTION_KEY` | later | 32-byte base64 key to encrypt stored GBP refresh tokens (planned) |

Server code validates its variables with Zod (`src/lib/env.ts`) and reports the **names** of missing variables, never values.

## Database

Five migrations, applied in order:

| File | Contents |
|---|---|
| `…000001_core_schema.sql` | 15 tables, unique keys for idempotent upserts, indexes, `updated_at` triggers |
| `…000002_rls.sql` | RLS on every table, membership helper, column-level grants, `create_client()` |
| `…000003_dashboard_rpcs.sql` | The 12 dashboard read RPCs and their helpers |
| `…000004_sync_queue.sql` | Job enqueue / claim / finish / requeue-stale functions |
| `…000005_advisor_fixes.sql` | Fixes from Supabase's security and performance advisors |

### Tables

- **Tenancy:** `clients`, `client_members` (roles: `owner`, `admin`, `viewer`)
- **Integrations:** `integration_connections`, `integration_resources` (properties / sites / locations, with `is_selected`), `integration_secrets` (service role only)
- **GA4:** `ga4_daily_metrics`, `ga4_traffic_sources`, `ga4_page_metrics`, `ga4_dimension_metrics` (device / country / key event)
- **GSC:** `gsc_daily_metrics`, `gsc_query_metrics`, `gsc_page_metrics`
- **GBP:** `gbp_daily_metrics`, `gbp_keyword_metrics`
- **Sync:** `analytics_sync_jobs`

### RPCs

`get_seo_overview`, `get_ga4_summary`, `get_ga4_traffic_sources`, `get_ga4_top_pages`, `get_gsc_summary`, `get_gsc_keywords`, `get_gsc_top_pages`, `get_gbp_summary`, `get_gbp_locations`, `get_analytics_trends`, `get_monthly_performance_comparison`, `get_integration_status`.

All take a `p_client_id` and date range, return JSON, paginate large lists (limit capped at 500), and whitelist sort columns. Callers who aren't members get error `42501`.

Queue functions: `enqueue_sync_job` (members), and `enqueue_daily_sync`, `claim_next_sync_job`, `requeue_stale_sync_jobs`, `finish_sync_job` (service role only).

### Comparison periods

| Name | Definition |
|---|---|
| `previous` | Equal-length range immediately before the selected range |
| `mom` | Selected range shifted back 1 calendar month |
| `yoy` | Selected range shifted back 1 calendar year |

A comparison with no stored rows returns `{"has_data": false}`. It never returns fabricated zeros.

## Integrations (Composio)

Verified against Composio's docs and the installed SDK (`@composio/core` 0.23):

| Source | Toolkit | Tools used |
|---|---|---|
| GA4 | Google Analytics | `GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES`, `GOOGLE_ANALYTICS_GET_PROPERTY`, `GOOGLE_ANALYTICS_RUN_REPORT` |
| Search Console | Google Search Console | `GOOGLE_SEARCH_CONSOLE_LIST_SITES`, `GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY` |
| Business Profile | **None found** | A direct Google adapter is required (see [status](#project-status)) |

### Connect flow

1. User clicks **Connect Account** → `POST /api/integrations/{provider}/connect`.
2. Server calls `composio.connectedAccounts.link(...)` using a per-client entity id (`client:<uuid>`), stores a *pending* connection, and returns Composio's redirect URL.
3. User completes Google OAuth; Composio redirects to `/api/integrations/{provider}/callback`.
4. Server verifies the account is `ACTIVE`, lists properties / sites, and saves them (a re-run never clears your selection).
5. User ticks the resources to track → `POST …/select` saves them and queues the initial 90-day import.
6. **Sync Now** → `POST …/sync` enqueues a job. **Disconnect** revokes the Composio account and stops syncing; stored history is kept.

Add `http://localhost:3000/api/integrations/ga4/callback` and `…/gsc/callback` (and your production equivalents) as allowed redirect URLs in your Composio auth configs.

## Sync worker

- **Queue:** `analytics_sync_jobs`. One active (queued/running) job per resource, enforced by a unique index.
- **Triggers:** Sync Now and saving a selection enqueue a job and return immediately; the worker then runs after the response via Next's `after()`. `GET/POST /api/cron/sync` (Bearer `CRON_SECRET`) enqueues daily jobs for every connected resource and drains the queue. Point any scheduler (e.g. Vercel Cron) at it once a day.
- **Ranges:** initial = 90 days, daily = last 7 days, manual = last 14 days, ending today in the GA4 property's time zone. Writes are idempotent upserts, so re-fetching recent days picks up late-arriving data.
- **Failure handling:** each GA4 report runs independently (a failing one gives a `partial` job). Transient and rate-limit errors retry with exponential backoff (60s × 2ⁿ, up to 4 attempts); auth errors mark the connection `error` so the UI shows **Reconnect**. Jobs stuck `running` for 15 minutes are re-queued.

## Project structure

```
src/
  app/
    (dashboard)/          overview, analytics, search-console, business-profile,
                          reports, history, integrations, settings
    api/integrations/[provider]/{connect,callback,select,sync,disconnect}/
    auth/callback/        Supabase auth code exchange
    login/
  components/
    layout/               app shell (collapsible sidebar, mobile drawer), header
    dashboard/            page header, empty state
    integrations/         integration card
  lib/
    composio/             client (typed errors, timeouts), GA4 + GSC adapters
    sync/                 job worker and the GA4 importer
    integrations/         providers, service (connect/select/sync/disconnect), http helpers
    supabase/             browser, server, and admin (service role) clients
    validation/           Zod schemas for GA4 and GSC responses
    analytics/            nav config, client context, shared types
    env.ts                validated server env
  proxy.ts                auth guard (redirects signed-out users to /login)
supabase/migrations/      SQL migrations
```

## Security model

- **RLS on all 15 tables.** Members can only read their own client's rows; metric, job and integration tables are read-only to browser roles.
- **No credentials in the browser.** `composio_connected_account_id` is column-revoked from the browser role; `integration_secrets` has no client access at all.
- **Privileged functions** (`claim_next_sync_job`, `finish_sync_job`, etc.) are executable only by the service role.
- **Admin-gated actions.** Connect, select, sync and disconnect require the `owner` or `admin` role; cross-origin posts are rejected.
- **Safe logging.** Route errors log only a message, never request bodies or tokens.

Verified with a rolled-back test transaction: cross-tenant RPC access, direct writes, secret reads, worker functions and anonymous calls were all denied.

The Supabase advisor still lists four `SECURITY DEFINER` functions callable by signed-in users (`create_client`, `enqueue_sync_job`, `is_client_member`, `_assert_member`) and `integration_secrets` having no policies. Both are intentional.

## Metric semantics

- **CTR** = Σ clicks / Σ impressions. **GSC position** = Σ(position × impressions) / Σ impressions. **GA4 engagement rate** = Σ engaged sessions / Σ sessions. Pre-aggregated rates are never averaged.
- **GA4 users over a range are a sum of daily active users**, which over-counts returning users. GA4 doesn't allow distinct users to be derived from daily rows. The UI should label this accordingly.
- **GSC query and page rows exclude anonymized queries**, so they won't sum to the daily totals. Data lags about 2–3 days and is kept roughly 16 months.
- **Position change** = previous average position − current average position (positive = moved up).
- **Time zones:** GA4 dates use the property's reporting time zone (stored on the resource); Search Console dates are Pacific Time. This difference is documented, not converted.

## Project status

**Built and verified**

- Schema, RLS and all RPCs applied to Supabase. Weighted-rate math, tenant isolation and privilege lockdown tested in a rolled-back transaction.
- Auth (login, route guard), dashboard shell with sidebar and mobile drawer, and all 8 routes.
- Composio connect flow and Integrations page. Typecheck, lint and production build pass. The dev server starts and `/login` renders.

**Verified against real services**

- Composio connect, callback and property discovery for GA4.
- GA4 sync worker: a real 90-day import wrote daily, traffic-source, page, landing-page, device and country rows. Composio returns the GA4 report directly as `data` (dates as `YYYYMMDD`, days without data omitted).
- GA4 RPCs against that data as the signed-in user under RLS.
- Search Console sync: a real 90-day import (daily totals for every search type, plus web query and page detail), the Search Console page's RPCs including device/country/search-type filters, and the connect flow's recovery from duplicate/expired Composio links.

**Built but not yet verified**

- The GA4 page UI was typechecked and linted but not viewed in a browser by the author.
- Search Console connect/discovery and the GSC adapter code (a connection can show `INITIALIZING` if the callback runs before Google consent finishes; reconnect to fix).
- The connected account's email may not be available, so the card can show "email not provided".

**Not built yet**

- Business Profile **sync** (its queued jobs fail with "not implemented yet").
- Overview and Business Profile pages.
- Monthly Reports (print / PDF), Historical Performance, and Settings.
- Header date-range selector and Refresh button.
- Google Business Profile integration. Composio has no toolkit for it, so this needs a direct Google adapter and approval of the Business Profile APIs for your Google Cloud project. That approval is outside this codebase.

## AI, Clarity, reports and imports

| Feature | Where | Needs |
|---|---|---|
| Executive report Overview (chapters 01–07) | `/overview` | GA4 / GSC connected |
| Report-only layout (no sidebar) | `/report?month=YYYY-MM&type=full|executive` | — |
| Server-side PDF | `/api/report/pdf?...` (same params) | Chromium: bundled on Vercel; local Chrome or `CHROME_EXECUTABLE_PATH` |
| SEO opportunity engine | `/opportunities` (RPC `get_gsc_opportunities`) | migration 10 + a GSC re-sync |
| AI SEO Insights | `/insights` | `ANTHROPIC_API_KEY`, migration 11 |
| 30-Day Strategy + task tracking | `/strategy` | `ANTHROPIC_API_KEY`, migration 11 |
| Microsoft Clarity + recording reviews | `/clarity` | Clarity API token, `TOKEN_ENCRYPTION_KEY`, migration 11 |
| PDF report import | `/imports` | `ANTHROPIC_API_KEY`, migration 11 |

**AI pipeline.** Stored data → deterministic calculations (SQL/TypeScript) → an evidence package where every fact has a stable id → Claude (`claude-opus-5-5`, structured outputs, server-side refusal fallback) → Zod validation → recommendations citing unknown evidence ids are discarded → stored with model, tokens and estimated cost. One run per kind per client at a time. The AI interprets; it never calculates metrics.

**Clarity limits (Microsoft's).** The Data Export API returns only the last 1–3 days, 10 requests per project per day, 1,000 rows, no pagination. Each sync uses 3 requests and stores "yesterday"; history accumulates daily. There is **no API for session recordings**, so recordings are reviewed by a person in Clarity and logged as structured observations, which the AI cites as human observations.

**Imports.** PDFs upload straight to a private bucket via a signed URL, Claude extracts the figures (including image-only pages), a reviewer accepts or rejects each one, and only accepted figures become evidence, always labelled "imported" and never merged with API data.

**Tests.** `npm test` runs unit tests (encryption, Clarity parsing, period maths, wins and declines, gap filling, CSV safety, AI schemas).

## Deploying to Vercel

The Vercel project is linked to GitHub (`adnanfrd12/seo-agent`, branch `main`): every push to `main` deploys to production.

1. **Set the environment variables first.** Vercel → Project → Settings → Environment Variables. Add every variable from the table above for **Production** (and Preview if you use it). Tip: the page accepts a pasted `.env` file. Without them the app now answers `503 Server is not configured. Missing environment variables: …` instead of a blank 500.
2. Set `NEXT_PUBLIC_APP_URL` to the production URL (e.g. `https://seo-agent-brown.vercel.app`). It builds the OAuth callback URL.
3. In each Composio auth config, allow `<NEXT_PUBLIC_APP_URL>/api/integrations/ga4/callback` and `…/gsc/callback`.
4. **Redeploy** after changing variables (Deployments → ⋯ → Redeploy). Variables are read at runtime start, not retroactively.
5. **Daily sync:** `vercel.json` schedules `/api/cron/sync` once a day (06:00 UTC). Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set, which is what the endpoint checks.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing or invalid environment variables: …` (HTTP 503 from an integration route) | Fill in the named variables in `.env.local` and restart `npm run dev` |
| Production shows `Internal Server Error` / `503 Server is not configured` | Environment variables are missing on Vercel; see [Deploying to Vercel](#deploying-to-vercel) |
| Redirected to `/login` on every page | Not signed in, or the Supabase URL / publishable key is wrong |
| "Create your client" screen after sign-in | Expected on first login; this creates your client |
| Connect redirects back with an error | Callback URL not allowed in the Composio auth config, or Google consent was cancelled |
| Sync Now is disabled | No resource selected yet, or a sync is already queued or running |
| Jobs stay `queued` | Click **Sync Now** (starts the worker), or call the cron endpoint: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync` |
| GBP job fails "not implemented yet" | Business Profile import isn't built yet |
| Production build fails with "uncached or runtime data during prerendering" | Cache Components were turned back on in `next.config.ts` |
