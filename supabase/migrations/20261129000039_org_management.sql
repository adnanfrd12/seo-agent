-- Organization management (Settings → Organization, the invitation page and the platform page).
--  - organizations.enabled_pages: which dashboard pages an organization may use, set by platform super-admins
--    (null = every page, including pages added later). Hrefs from the sidebar (src/lib/analytics/nav.ts); the
--    matching rules are in src/lib/org/pages.ts.
--  - one open invitation per email and organization (inviting again or "resend" refreshes that row).
--  - member and user directories with sign-in emails for the server (auth.users isn't readable by signed-in users).
--    Service role only: the server checks the caller's organization role before calling them.
-- Nothing is deleted or rewritten. Rollback: see the end of this file.

alter table public.organizations add column if not exists enabled_pages text[];
comment on column public.organizations.enabled_pages is 'Dashboard pages this organization may use (sidebar hrefs); null = every page. Set by platform super-admins.';

create unique index if not exists organization_invitations_open_email_idx
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create or replace function public.org_member_directory(p_org uuid)
returns table (user_id uuid, email text, full_name text, avatar_url text, role text, status text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, p.full_name, p.avatar_url, m.role, m.status, m.created_at, u.last_sign_in_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = p_org
  order by case m.role when 'owner' then 1 when 'admin' then 2 when 'member' then 3 else 4 end, m.created_at;
$$;
revoke all on function public.org_member_directory(uuid) from public, anon, authenticated;
grant execute on function public.org_member_directory(uuid) to service_role;

create or replace function public.user_directory(p_ids uuid[])
returns table (user_id uuid, email text, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, p.full_name, p.avatar_url
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = any (p_ids);
$$;
revoke all on function public.user_directory(uuid[]) from public, anon, authenticated;
grant execute on function public.user_directory(uuid[]) to service_role;

-- ------------------------------------------------------------ rollback (manual)
-- drop function public.user_directory(uuid[]); drop function public.org_member_directory(uuid);
-- drop index public.organization_invitations_open_email_idx;
-- alter table public.organizations drop column enabled_pages;
