-- Core schema for the SEO analytics dashboard.
-- Multi-tenant: every data row carries client_id. Writes to metric tables are
-- performed only by the trusted sync worker (service role); see 000002 for RLS.

create extension if not exists pg_trgm;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- tenancy
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'UTC',
  default_range_days int not null default 30 check (default_range_days in (7, 30, 90)),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_members (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

-- ------------------------------------------------------------ integrations
-- Composio holds the OAuth tokens. We store only Composio's connected-account
-- id, never a token. Tokens for the direct GBP adapter live in
-- integration_secrets, which has RLS enabled and NO policies (service role only).
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null check (provider in ('ga4', 'gsc', 'gbp')),
  auth_method text not null default 'composio' check (auth_method in ('composio', 'direct')),
  composio_connected_account_id text,
  composio_entity_id text,
  account_email text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'disconnected', 'error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider)
);

create table public.integration_secrets (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  refresh_token_encrypted text,
  updated_at timestamptz not null default now()
);

create table public.integration_resources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  provider text not null check (provider in ('ga4', 'gsc', 'gbp')),
  external_id text not null,            -- properties/123, sc-domain:x.com, locations/456
  display_name text,
  timezone text,                        -- GA4 property reporting time zone
  is_selected boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, external_id)
);
create index integration_resources_client_provider_idx
  on public.integration_resources (client_id, provider) where is_selected;

-- ------------------------------------------------------------------- GA4
-- Rates are stored as numerators/denominators so ranges aggregate correctly.
-- NOTE: summing daily active users over a range over-counts returning users;
-- GA4 does not allow distinct users to be derived from daily rows.
create table public.ga4_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  users bigint not null default 0,            -- activeUsers
  new_users bigint not null default 0,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds numeric not null default 0,  -- userEngagementDuration
  event_count bigint not null default 0,
  key_events numeric not null default 0,
  revenue numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date)
);
create index ga4_daily_client_date_idx on public.ga4_daily_metrics (client_id, metric_date);

create table public.ga4_traffic_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  channel_group text not null default '(not set)',
  source text not null default '(not set)',
  medium text not null default '(not set)',
  sessions bigint not null default 0,
  users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  key_events numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, channel_group, source, medium)
);
create index ga4_sources_client_date_idx on public.ga4_traffic_sources (client_id, metric_date);

create table public.ga4_page_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  page_path text not null,
  views bigint not null default 0,
  users bigint not null default 0,
  sessions bigint not null default 0,        -- landing-page sessions when is_landing
  engagement_seconds numeric not null default 0,
  key_events numeric not null default 0,
  is_landing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, page_path, is_landing)
);
create index ga4_pages_client_date_idx on public.ga4_page_metrics (client_id, metric_date);

-- device category, country and key event breakdowns
create table public.ga4_dimension_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  dimension text not null check (dimension in ('device', 'country', 'key_event')),
  value text not null,
  sessions bigint not null default 0,
  users bigint not null default 0,
  key_events numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, dimension, value)
);
create index ga4_dim_client_date_idx on public.ga4_dimension_metrics (client_id, dimension, metric_date);

-- ------------------------------------------------------------------- GSC
-- position_x_impressions = average position * impressions, so positions can be
-- re-weighted across any range: SUM(position_x_impressions) / SUM(impressions).
-- Search Console positions are 1-based; GSC's own report uses the same weighting.
create table public.gsc_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  search_type text not null default 'web',
  device text not null default '',
  country text not null default '',
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  position_x_impressions numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, search_type, device, country)
);
create index gsc_daily_client_date_idx on public.gsc_daily_metrics (client_id, metric_date);

-- Query rows exclude anonymized queries, so they will not sum to the daily totals.
create table public.gsc_query_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  search_type text not null default 'web',
  device text not null default '',
  country text not null default '',
  query text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  position_x_impressions numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, search_type, device, country, query)
);
create index gsc_query_client_date_idx on public.gsc_query_metrics (client_id, metric_date);
create index gsc_query_trgm_idx on public.gsc_query_metrics using gin (query gin_trgm_ops);

create table public.gsc_page_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  search_type text not null default 'web',
  device text not null default '',
  country text not null default '',
  page text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  position_x_impressions numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, search_type, device, country, page)
);
create index gsc_page_client_date_idx on public.gsc_page_metrics (client_id, metric_date);
create index gsc_page_trgm_idx on public.gsc_page_metrics using gin (page gin_trgm_ops);

-- ------------------------------------------------------------------- GBP
-- Business Profile Performance API daily metrics. Nullable columns are those
-- the API may not return for every location.
create table public.gbp_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  impressions_desktop_maps bigint,
  impressions_desktop_search bigint,
  impressions_mobile_maps bigint,
  impressions_mobile_search bigint,
  call_clicks bigint,
  website_clicks bigint,
  direction_requests bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date)
);
create index gbp_daily_client_date_idx on public.gbp_daily_metrics (client_id, metric_date);

-- Search keywords are reported monthly by the API.
create table public.gbp_keyword_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  month date not null,                         -- first day of month
  keyword text not null,
  impressions bigint,                          -- exact value when returned
  impressions_threshold bigint,                -- "less than N" bucket when value withheld
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, month, keyword)
);
create index gbp_keyword_client_month_idx on public.gbp_keyword_metrics (client_id, month);

-- ------------------------------------------------------------- sync queue
create table public.analytics_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete cascade,
  resource_id uuid references public.integration_resources(id) on delete cascade,
  provider text not null check (provider in ('ga4', 'gsc', 'gbp')),
  job_type text not null check (job_type in ('initial', 'daily', 'manual')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  range_start date,
  range_end date,
  attempts int not null default 0,
  max_attempts int not null default 4,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  stats jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sync_jobs_client_idx on public.analytics_sync_jobs (client_id, created_at desc);
create index sync_jobs_queue_idx on public.analytics_sync_jobs (run_after) where status = 'queued';
-- One active job per resource: prevents overlapping syncs.
create unique index sync_jobs_one_active_per_resource
  on public.analytics_sync_jobs (resource_id) where status in ('queued', 'running');

-- ------------------------------------------------------------ updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'clients','integration_connections','integration_secrets','integration_resources',
    'ga4_daily_metrics','ga4_traffic_sources','ga4_page_metrics','ga4_dimension_metrics',
    'gsc_daily_metrics','gsc_query_metrics','gsc_page_metrics',
    'gbp_daily_metrics','gbp_keyword_metrics','analytics_sync_jobs'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;
