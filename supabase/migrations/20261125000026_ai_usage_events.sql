-- Claude spend for features that have no run table of their own (blog post reading, SEO Toolkit).
-- One row per run, written by the server (service role) after the run; members can read their client's rows.
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  feature text not null check (feature in ('blog_geo', 'toolkit_content', 'toolkit_brief', 'toolkit_comparison')),
  model text not null,
  calls integer not null default 1,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_client_idx on public.ai_usage_events (client_id, created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon;
revoke insert, update, delete, truncate on public.ai_usage_events from authenticated;
grant select on public.ai_usage_events to authenticated;
drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events for select to authenticated using (public.is_client_member(client_id));
