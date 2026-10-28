-- Automation, observability, alerts and daily competitor intelligence.
-- Writes happen in trusted server code (service role); members can READ their own client's rows.

-- ------------------------------------------------------------ scheduled job log
-- One row per scheduled run (sync, research, ai ...) so the app can show "last run / next run / errors".
-- No client policy on purpose: only the server reads it (admin client), tenants never see it.
create table public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb not null default '{}'::jsonb,
  error text
);
create index cron_runs_job_idx on public.cron_runs (job, started_at desc);
alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from anon, authenticated;

-- ------------------------------------------------------------ client activity
-- Which clients are actually used: daily competitor analysis and weekly AI refreshes are
-- prioritised for clients opened in the last 14 days, so the API budget goes where it matters.
create table public.client_activity (
  client_id uuid primary key references public.clients(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.client_activity enable row level security;
revoke all on public.client_activity from anon, authenticated;

-- ------------------------------------------------------------ alerts
create table public.client_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'positive')),
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (client_id, dedupe_key)
);
create index client_alerts_client_idx on public.client_alerts (client_id, created_at desc);

-- ------------------------------------------------------------ competitor history
-- One row per domain per day (the client's own domain has is_self = true), so visibility trends
-- and "emerging threat" detection come from our own history, not extra API calls.
create table public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null,
  is_self boolean not null default false,
  snapshot_date date not null,
  keywords int, traffic numeric, traffic_value numeric,
  top3 int, top10 int, new_kw int, up_kw int, down_kw int, lost_kw int,
  shared_keywords int, avg_position numeric,
  created_at timestamptz not null default now(),
  unique (client_id, domain, snapshot_date)
);
create index competitor_snapshots_client_idx on public.competitor_snapshots (client_id, snapshot_date desc);

-- competitor management: how competitors are chosen, and which are hidden or pinned
alter table public.research_targets
  add column if not exists competitor_mode text not null default 'auto' check (competitor_mode in ('auto', 'manual')),
  add column if not exists competitors_excluded text[] not null default '{}';

do $$
declare t text;
begin
  foreach t in array array['client_alerts', 'competitor_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;
