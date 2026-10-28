-- DataForSEO spending settings, editable on the Integrations page (no environment variable needed).
-- One agency-wide row: the DataForSEO account (and its credit) is shared by every client.
create table public.dfs_settings (
  id int primary key default 1 check (id = 1),
  daily_budget numeric not null default 1.5 check (daily_budget >= 0.1 and daily_budget <= 100),
  auto_refresh boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.dfs_settings (id) values (1) on conflict do nothing;

alter table public.dfs_settings enable row level security;
revoke all on public.dfs_settings from anon;
revoke insert, update, delete, truncate on public.dfs_settings from authenticated;
grant select on public.dfs_settings to authenticated;
create policy dfs_settings_select on public.dfs_settings for select to authenticated using (true);
