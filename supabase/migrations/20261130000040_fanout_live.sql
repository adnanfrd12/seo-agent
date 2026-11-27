-- Fan-Out Queries → Real AI search queries: what ChatGPT, Claude, Gemini, Grok and Perplexity actually searched the
-- web with when asked a keyword (read from each provider's API with web search on), with an excerpt of the answer
-- and the sources it cited. One row per batch, keyword, platform and repeat. The existing simulated fan-out tables
-- (fanout_runs, fanout_queries) are not changed. Written by the server (service role); client members read.
create table if not exists public.fanout_live (
  id bigint generated always as identity primary key,
  batch_id uuid not null,                            -- one press of "Get real queries" (several keywords x platforms)
  client_id uuid not null references public.clients(id) on delete cascade,
  seed text not null,                                -- the keyword asked
  platform text not null check (platform in ('chatgpt', 'claude', 'gemini', 'grok', 'perplexity')),
  run_no smallint not null default 1,                -- repeat number (fan-out varies run to run)
  model text,
  queries text[] not null default '{}',              -- the web searches the AI ran, in order
  queries_exposed boolean not null default true,     -- false when the provider doesn't return its searches
  answer text,                                       -- the start of the AI's answer
  citations jsonb not null default '[]',             -- [{url, title}] sources the answer used
  client_cited boolean not null default false,       -- the client's website is among the sources
  cost_usd numeric(10, 5) not null default 0,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fanout_live_client_idx on public.fanout_live (client_id, created_at desc);
create index if not exists fanout_live_batch_idx on public.fanout_live (batch_id);

alter table public.fanout_live enable row level security;
revoke all on public.fanout_live from anon;
revoke insert, update, delete, truncate on public.fanout_live from authenticated;
grant select on public.fanout_live to authenticated;
drop policy if exists fanout_live_select on public.fanout_live;
create policy fanout_live_select on public.fanout_live for select to authenticated using (public.is_client_member(client_id));

-- Rollback: drop table public.fanout_live;
