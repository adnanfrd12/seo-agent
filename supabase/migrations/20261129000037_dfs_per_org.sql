-- DataForSEO per organization. Each organization uses its own DataForSEO account (credentials in
-- organization_credentials), so the daily spending limit and the automatic-refresh switch are per organization, and
-- the limit is checked against the organization's own spend (dfs_spend of its clients, joined through clients).
-- The first organization starts with the agency-wide settings it had: dfs_settings row 1 is copied, and kept as it is.
-- Keyword research answers (dfs_keyword_cache) were shared by every client; they now belong to the organization whose
-- account paid for them and only its members can read them.
-- Nothing is deleted. Rollback: see the end of this file.

-- ------------------------------------------------------------ spending settings per organization
create table if not exists public.organization_dfs_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  daily_budget numeric not null default 1.5 check (daily_budget >= 0.1 and daily_budget <= 100),
  auto_refresh boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.organization_dfs_settings (organization_id, daily_budget, auto_refresh, updated_at)
select o.id, s.daily_budget, s.auto_refresh, s.updated_at
from public.dfs_settings s
cross join lateral (select id from public.organizations order by created_at limit 1) o
where s.id = 1
on conflict (organization_id) do nothing;

alter table public.organization_dfs_settings enable row level security;
revoke all on public.organization_dfs_settings from anon;
revoke insert, update, delete, truncate on public.organization_dfs_settings from authenticated;
grant select on public.organization_dfs_settings to authenticated;
drop policy if exists organization_dfs_settings_select on public.organization_dfs_settings;
-- the organization's limit is shown to its owners and admins (the server reads it with the service role)
create policy organization_dfs_settings_select on public.organization_dfs_settings for select to authenticated
  using (public.is_org_member(organization_id, array['owner', 'admin']));

-- the former agency-wide row was readable by every signed-in user; only the server reads it now
revoke select on public.dfs_settings from authenticated;

-- "today's spend of an organization" reads dfs_spend by day and client
create index if not exists dfs_spend_day_client_idx on public.dfs_spend (day, client_id);

-- ------------------------------------------------------------ keyword research cache per organization
alter table public.dfs_keyword_cache add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
-- every existing answer was paid by the first organization's account
update public.dfs_keyword_cache set organization_id = (select id from public.organizations order by created_at limit 1)
  where organization_id is null;
create index if not exists dfs_keyword_cache_org_idx on public.dfs_keyword_cache (organization_id, endpoint, fetched_at desc);

drop policy if exists dfs_keyword_cache_select on public.dfs_keyword_cache;
create policy dfs_keyword_cache_select on public.dfs_keyword_cache for select to authenticated
  using (organization_id is not null and public.is_org_member(organization_id));

-- ------------------------------------------------------------ rollback (manual)
-- drop policy dfs_keyword_cache_select on public.dfs_keyword_cache;
-- create policy dfs_keyword_cache_select on public.dfs_keyword_cache for select to authenticated using (true);
-- alter table public.dfs_keyword_cache drop column organization_id;
-- grant select on public.dfs_settings to authenticated;
-- drop table public.organization_dfs_settings;
