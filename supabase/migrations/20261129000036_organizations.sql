-- Organizations: the tenant above clients. Each client belongs to one organization; organization owners and
-- admins reach every client of their organization, team members and viewers only the clients they're given
-- (client_members, as before). Every existing row-level-security policy keeps working because access still goes
-- through public.is_client_member(), which now also honours organization roles and deactivated members.
--
-- Backfill: one organization "Waheed Zen LLC" holding every existing client. Nothing is deleted.
-- Rollback: see the end of this file.

-- ------------------------------------------------------------ platform super-admins (create organizations)
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ organizations
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  website text check (char_length(website) <= 300),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 60),
  address jsonb not null default '{}'::jsonb,            -- line1, line2, city, region, postal_code, country
  timezone text not null default 'UTC',
  language text not null default 'en',
  currency text not null default 'USD',
  branding jsonb not null default '{}'::jsonb,           -- logos, favicon, colours, display name, report header/footer…
  preferences jsonb not null default '{}'::jsonb,
  -- the first organization keeps reading credentials from the server environment until an owner imports them
  uses_env_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);
drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at before update on public.organization_members for each row execute function public.set_updated_at();

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (char_length(email) <= 200),
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  client_access jsonb not null default '[]'::jsonb,      -- [{ client_id, role }] for members and viewers
  token_hash text not null unique,                       -- sha256 of the invite token (the token itself is never stored)
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists organization_invitations_org_idx on public.organization_invitations (organization_id, created_at desc);

-- Encrypted credentials and configuration values per organization (AES-GCM with the master key held outside the
-- database). Never readable by signed-in users: the server decrypts them only when a feature needs them.
create table if not exists public.organization_credentials (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  integration text not null,                             -- registry id (anthropic, dataforseo, custom, …)
  value_encrypted text not null,
  is_secret boolean not null default true,
  hint text,                                             -- e.g. last 4 characters, shown masked
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

-- Who changed what (never secret values)
create table if not exists public.organization_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,                                  -- e.g. credential.update, member.role, branding.update
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists organization_audit_log_org_idx on public.organization_audit_log (organization_id, created_at desc);

-- ------------------------------------------------------------ clients belong to an organization
alter table public.clients add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.clients add column if not exists archived_at timestamptz;
create index if not exists clients_organization_idx on public.clients (organization_id);

-- ------------------------------------------------------------ backfill
do $$
declare v_org uuid; v_waheed uuid; v_analytics uuid; v_adnan uuid;
begin
  select id into v_org from public.organizations where name = 'Waheed Zen LLC' limit 1;
  if v_org is null then
    insert into public.organizations (name, website, uses_env_fallback) values ('Waheed Zen LLC', 'https://waheedzen.com', true) returning id into v_org;
  end if;
  update public.clients set organization_id = v_org where organization_id is null;

  select p.user_id into v_waheed from public.profiles p where p.full_name ilike 'Waheed Hussain%' limit 1;
  select p.user_id into v_analytics from public.profiles p where p.full_name ilike 'Analytics Data%' limit 1;
  select p.user_id into v_adnan from public.profiles p where p.full_name ilike 'Adnan Fareed%' limit 1;

  if v_waheed is not null then insert into public.organization_members (organization_id, user_id, role) values (v_org, v_waheed, 'owner') on conflict do nothing; insert into public.platform_admins (user_id) values (v_waheed) on conflict do nothing; end if;
  if v_analytics is not null then insert into public.organization_members (organization_id, user_id, role) values (v_org, v_analytics, 'owner') on conflict do nothing; insert into public.platform_admins (user_id) values (v_analytics) on conflict do nothing; end if;
  if v_adnan is not null then
    insert into public.organization_members (organization_id, user_id, role) values (v_org, v_adnan, 'admin') on conflict do nothing;
    insert into public.platform_admins (user_id) values (v_adnan) on conflict do nothing;
    -- an organization admin, not a per-client owner
    update public.client_members set role = 'admin' where user_id = v_adnan and role = 'owner';
  end if;

  -- anyone else with client access becomes a team member of the organization (their client access is unchanged)
  insert into public.organization_members (organization_id, user_id, role)
    select distinct v_org, m.user_id, 'member' from public.client_members m
    on conflict do nothing;
end $$;
alter table public.clients alter column organization_id set not null;

-- ------------------------------------------------------------ access helpers
create or replace function public.org_role(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.organization_members
  where organization_id = p_org and user_id = (select auth.uid()) and status = 'active';
$$;
revoke all on function public.org_role(uuid) from public, anon;
grant execute on function public.org_role(uuid) to authenticated, service_role;

create or replace function public.is_org_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  );
$$;
revoke all on function public.is_org_member(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid, text[]) to authenticated, service_role;

-- Client access: an active organization owner/admin reaches every client of the organization (as client owner /
-- admin); otherwise the client_members row decides, unless the user is deactivated in that organization.
create or replace function public.is_client_member(p_client_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
    join public.organization_members om on om.organization_id = c.organization_id
    where c.id = p_client_id and om.user_id = (select auth.uid()) and om.status = 'active' and om.role in ('owner', 'admin')
      and (p_roles is null or om.role = any (p_roles))
  ) or exists (
    select 1 from public.client_members m
    join public.clients c on c.id = m.client_id
    where m.client_id = p_client_id and m.user_id = (select auth.uid())
      and (p_roles is null or m.role = any (p_roles))
      and not exists (select 1 from public.organization_members om where om.organization_id = c.organization_id and om.user_id = m.user_id and om.status = 'deactivated')
  );
$$;

-- ------------------------------------------------------------ creating a client: always inside an organization
drop function if exists public.create_client(text, text);
create or replace function public.create_client(p_name text, p_timezone text default 'UTC', p_organization uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required' using errcode = '22023'; end if;
  -- the given organization if the user is an active owner/admin of it, else their first such organization
  select m.organization_id, m.role into v_org, v_role from public.organization_members m
    where m.user_id = (select auth.uid()) and m.status = 'active' and m.role in ('owner', 'admin')
      and (p_organization is null or m.organization_id = p_organization)
    order by m.created_at limit 1;
  if v_org is null then raise exception 'only organization owners and admins can create clients' using errcode = '42501'; end if;
  insert into public.clients (name, timezone, organization_id) values (btrim(p_name), p_timezone, v_org) returning id into v_id;
  insert into public.client_members (client_id, user_id, role) values (v_id, (select auth.uid()), v_role);
  return v_id;
end $$;
revoke all on function public.create_client(text, text, uuid) from public, anon;
grant execute on function public.create_client(text, text, uuid) to authenticated;

-- ------------------------------------------------------------ row level security
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_credentials enable row level security;
alter table public.organization_audit_log enable row level security;
revoke all on public.platform_admins, public.organizations, public.organization_members, public.organization_invitations, public.organization_credentials, public.organization_audit_log from anon;
revoke insert, update, delete, truncate on public.platform_admins, public.organizations, public.organization_members, public.organization_invitations, public.organization_audit_log from authenticated;
-- credentials: no access at all for signed-in users (service role only)
revoke all on public.organization_credentials from authenticated;

grant select on public.platform_admins to authenticated;
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = (select auth.uid()));

grant select on public.organizations to authenticated;
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated using (
  public.is_org_member(id) or exists (select 1 from public.clients c where c.organization_id = organizations.id and public.is_client_member(c.id))
);

grant select on public.organization_members to authenticated;
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select to authenticated using (
  user_id = (select auth.uid()) or public.is_org_member(organization_id, array['owner', 'admin'])
);

grant select on public.organization_invitations to authenticated;
drop policy if exists organization_invitations_select on public.organization_invitations;
create policy organization_invitations_select on public.organization_invitations for select to authenticated using (public.is_org_member(organization_id, array['owner', 'admin']));

grant select on public.organization_audit_log to authenticated;
drop policy if exists organization_audit_log_select on public.organization_audit_log;
create policy organization_audit_log_select on public.organization_audit_log for select to authenticated using (public.is_org_member(organization_id, array['owner', 'admin']));

-- ------------------------------------------------------------ branding assets (logos, favicon)
insert into storage.buckets (id, name, public) values ('org-assets', 'org-assets', true) on conflict (id) do nothing;
-- uploads go through the server (service role); the files are public so the login page and PDFs can show them

-- ------------------------------------------------------------ rollback (manual)
-- create or replace the previous public.is_client_member (supabase/migrations/20261014000002_rls.sql), then:
-- alter table public.clients drop column organization_id, drop column archived_at;
-- drop table public.organization_audit_log, public.organization_credentials, public.organization_invitations,
--   public.organization_members, public.organizations, public.platform_admins;
