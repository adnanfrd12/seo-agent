-- Fan-Out Queries (/fan-out-queries): every run and the sub-queries it produced, per client.
-- Written by the server (service role) after a run; members of the client can read them.
create table if not exists public.fanout_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('keywords', 'pages')),
  mode text not null default 'ai_mode',               -- ai_overview (simpler, ~10 queries) or ai_mode (deeper, ~20)
  method text not null,                              -- the generation method that produced it (e.g. qforia_claude)
  model text,
  inputs text[] not null default '{}',               -- the seed keywords or page URLs, in order
  query_count integer not null default 0,
  ai_cost_usd numeric(10, 5) not null default 0,
  volume_cost_usd numeric(10, 5) not null default 0,
  errors jsonb not null default '[]',                -- [{input, error}] for seeds that failed
  summaries jsonb not null default '[]',             -- pages: [{url, title, topic, covered, partial, missing}]
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fanout_runs_client_idx on public.fanout_runs (client_id, created_at desc);

create table if not exists public.fanout_queries (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.fanout_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  seed text not null,                                -- the keyword or page URL the query was fanned out from
  ord integer not null default 0,
  query text not null,
  type text not null,                                -- related, implicit, comparative, recent, personalised, reformulation, entity
  intent text,
  reasoning text,
  coverage text check (coverage in ('covered', 'partial', 'missing')),  -- pages only
  suggestion text,                                   -- pages only
  volume integer                                     -- monthly Google searches (DataForSEO), when asked for
);
create index if not exists fanout_queries_run_idx on public.fanout_queries (run_id, ord);
create index if not exists fanout_queries_client_idx on public.fanout_queries (client_id, query);

alter table public.fanout_runs enable row level security;
alter table public.fanout_queries enable row level security;
revoke all on public.fanout_runs from anon;
revoke all on public.fanout_queries from anon;
revoke insert, update, delete, truncate on public.fanout_runs from authenticated;
revoke insert, update, delete, truncate on public.fanout_queries from authenticated;
grant select on public.fanout_runs to authenticated;
grant select on public.fanout_queries to authenticated;

drop policy if exists fanout_runs_select on public.fanout_runs;
create policy fanout_runs_select on public.fanout_runs for select to authenticated using (public.is_client_member(client_id));
drop policy if exists fanout_queries_select on public.fanout_queries;
create policy fanout_queries_select on public.fanout_queries for select to authenticated using (public.is_client_member(client_id));
