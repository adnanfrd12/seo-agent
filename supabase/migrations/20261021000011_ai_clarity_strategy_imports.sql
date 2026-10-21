-- AI insights, 30-day strategy, Microsoft Clarity, and imported PDF reports.
-- All tables: RLS on, members can READ their client's rows; every WRITE goes through trusted
-- server code (service role) after an explicit membership/role check.

-- --------------------------------------------------- allow 'clarity' as a provider
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity'));
alter table public.integration_resources drop constraint if exists integration_resources_provider_check;
alter table public.integration_resources add constraint integration_resources_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity'));
alter table public.analytics_sync_jobs drop constraint if exists analytics_sync_jobs_provider_check;
alter table public.analytics_sync_jobs add constraint analytics_sync_jobs_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity'));
alter table public.integration_connections drop constraint if exists integration_connections_auth_method_check;
alter table public.integration_connections add constraint integration_connections_auth_method_check
  check (auth_method in ('composio', 'direct', 'api_token'));

-- -------------------------------------------------------------------- Clarity
-- Clarity's Data Export API returns aggregates for the last 1-3 days only; one row per
-- (day, dimension, value, metric). History accumulates from daily syncs. `raw` keeps the
-- API's original fields so nothing is lost to our normalisation.
create table public.clarity_behavior_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  dimension text not null check (dimension in ('total', 'url', 'device', 'browser')),
  value text not null default '',
  metric text not null,
  count numeric,
  sessions_pct numeric,
  sessions bigint,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, dimension, value, metric)
);
create index clarity_metrics_client_date_idx on public.clarity_behavior_metrics (client_id, metric_date);

-- Human review of session recordings (Clarity has no API to access recordings).
create table public.clarity_recording_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  page_url text not null check (char_length(page_url) <= 2000),
  recording_url text check (char_length(recording_url) <= 2000),
  device text check (device in ('desktop', 'mobile', 'tablet', 'unknown')),
  observed_on date,
  friction_type text not null check (friction_type in (
    'rage_clicks', 'dead_clicks', 'non_interactive_click', 'form_friction', 'confusing_navigation',
    'missed_cta', 'excessive_scroll', 'abandonment', 'mobile_usability', 'broken_cta', 'error', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  observation text not null check (char_length(observation) between 3 and 4000),
  reviewer uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index clarity_reviews_client_idx on public.clarity_recording_reviews (client_id, created_at desc);

-- ------------------------------------------------------------------- AI runs
create table public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('insights', 'strategy', 'import_extraction')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  range_start date,
  range_end date,
  model text,
  input_tokens bigint,
  output_tokens bigint,
  cost_usd numeric(10, 4),
  evidence jsonb,
  output jsonb,
  error text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_runs_client_idx on public.ai_analysis_runs (client_id, kind, created_at desc);
-- one generation of each kind at a time per client
create unique index ai_runs_one_running on public.ai_analysis_runs (client_id, kind) where status = 'running';

create table public.analytics_insights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.ai_analysis_runs(id) on delete cascade,
  category text not null,
  title text not null,
  summary text not null,
  supporting_metrics jsonb not null default '[]'::jsonb,
  evidence_references jsonb not null default '[]'::jsonb,
  target_url text,
  recommended_action text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  estimated_effort text not null check (estimated_effort in ('small', 'medium', 'large')),
  expected_impact_hypothesis text not null,
  success_metric text not null,
  implementation_status text not null default 'proposed'
    check (implementation_status in ('proposed', 'approved', 'implemented', 'dismissed')),
  status_changed_at timestamptz,
  created_at timestamptz not null default now()
);
create index insights_client_idx on public.analytics_insights (client_id, created_at desc);

-- ------------------------------------------------------------ 30-day strategy
create table public.seo_strategy_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.ai_analysis_runs(id) on delete set null,
  period_start date not null,
  period_end date not null,
  summary text,
  created_at timestamptz not null default now()
);
create index plans_client_idx on public.seo_strategy_plans (client_id, created_at desc);

create table public.seo_strategy_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.seo_strategy_plans(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  week int not null check (week between 1 and 4),
  sort int not null default 0,
  title text not null,
  category text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  target_url text,
  problem text,
  evidence_references jsonb not null default '[]'::jsonb,
  description text not null,
  steps jsonb not null default '[]'::jsonb,
  estimated_effort text not null check (estimated_effort in ('small', 'medium', 'large')),
  success_metric text not null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'skipped')),
  status_changed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_plan_idx on public.seo_strategy_tasks (plan_id, week, sort);

-- ------------------------------------------------------------ imported reports
-- Imported figures are kept apart from API data and never overwrite it.
create table public.imported_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'extracted', 'confirmed', 'failed')),
  period_start date,
  period_end date,
  extraction jsonb,
  error text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index imports_client_idx on public.imported_reports (client_id, created_at desc);

create table public.imported_report_metrics (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imported_reports(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  page_number int,
  source_name text,
  original_label text not null,
  normalized_metric text,
  value numeric,
  value_text text,
  unit text,
  period_start date,
  period_end date,
  confidence text check (confidence in ('high', 'medium', 'low')),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
create index import_metrics_import_idx on public.imported_report_metrics (import_id);

-- private bucket; only the server (service role) reads/writes it
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-imports', 'report-imports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- ------------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array[
    'clarity_behavior_metrics', 'clarity_recording_reviews', 'ai_analysis_runs', 'analytics_insights',
    'seo_strategy_plans', 'seo_strategy_tasks', 'imported_reports', 'imported_report_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;

create trigger clarity_behavior_metrics_set_updated_at before update on public.clarity_behavior_metrics
  for each row execute function public.set_updated_at();
