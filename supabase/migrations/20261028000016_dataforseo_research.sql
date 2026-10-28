-- DataForSEO research data: backlinks, organic keywords, keyword research.
-- Every API response is stored here; pages only ever read these tables, so viewing a page never
-- spends credit. All writes go through trusted server code (service role); members can READ.

-- ------------------------------------------------------------ target per client
create table public.research_targets (
  client_id uuid primary key references public.clients(id) on delete cascade,
  domain text not null check (char_length(domain) between 3 and 253),
  location_code int not null default 2840,   -- DataForSEO location (2840 = United States)
  language_code text not null default 'en',
  auto_refresh boolean not null default true,
  competitors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------- response cache (one row per call shape)
create table public.dfs_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  endpoint text not null,
  params_hash text not null,
  params jsonb not null default '{}'::jsonb,
  data jsonb not null,
  row_count int not null default 0,
  cost numeric not null default 0,
  fetched_at timestamptz not null default now(),
  unique (client_id, endpoint, params_hash)
);

-- weekly profile snapshots, so trends keep growing without extra calls
create table public.dfs_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  snapshot_date date not null,
  backlinks bigint, referring_domains bigint, referring_pages bigint, rank int, spam_score int,
  organic_keywords int, organic_traffic numeric,
  unique (client_id, snapshot_date)
);

-- every paid call, for the daily/per-client budget guard and the spend report
create table public.dfs_spend (
  id uuid primary key default gen_random_uuid(),
  day date not null default ((now() at time zone 'utc')::date),
  client_id uuid references public.clients(id) on delete cascade,
  endpoint text not null,
  cost numeric not null,
  source text not null check (source in ('auto', 'manual')),
  created_at timestamptz not null default now()
);

-- keyword research is generic market data, so it is cached once and shared across clients
create table public.dfs_keyword_cache (
  params_hash text primary key,
  endpoint text not null,
  params jsonb not null,
  data jsonb not null,
  row_count int not null default 0,
  cost numeric not null default 0,
  fetched_at timestamptz not null default now()
);

create index dfs_cache_client_idx on public.dfs_cache (client_id);
create index dfs_snapshots_client_idx on public.dfs_snapshots (client_id, snapshot_date);
create index dfs_spend_day_idx on public.dfs_spend (day);
create index dfs_spend_client_idx on public.dfs_spend (client_id);

create trigger research_targets_set_updated_at before update on public.research_targets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['research_targets', 'dfs_cache', 'dfs_snapshots', 'dfs_spend', 'dfs_keyword_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['research_targets', 'dfs_cache', 'dfs_snapshots', 'dfs_spend'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;
create policy dfs_keyword_cache_select on public.dfs_keyword_cache for select to authenticated using (true);
