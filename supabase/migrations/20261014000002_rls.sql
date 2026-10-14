-- Row Level Security: tenant isolation by client membership.
-- Metric / job / integration tables are READ-ONLY for authenticated users.
-- All writes come from the sync worker using the service role (bypasses RLS).

create or replace function public.is_client_member(p_client_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.client_members m
    where m.client_id = p_client_id
      and m.user_id = (select auth.uid())
      and (p_roles is null or m.role = any (p_roles))
  );
$$;
revoke all on function public.is_client_member(uuid, text[]) from public, anon;
grant execute on function public.is_client_member(uuid, text[]) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','client_members','integration_connections','integration_secrets',
    'integration_resources','ga4_daily_metrics','ga4_traffic_sources','ga4_page_metrics',
    'ga4_dimension_metrics','gsc_daily_metrics','gsc_query_metrics','gsc_page_metrics',
    'gbp_daily_metrics','gbp_keyword_metrics','analytics_sync_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- no direct writes from client roles on any table (policies below add reads only)
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- integration_secrets: RLS on, no policy, and no privileges at all for client roles.
revoke all on public.integration_secrets from authenticated;

create policy clients_select on public.clients
  for select to authenticated using (public.is_client_member(id));

-- settings the client may edit (name, timezone, default range); column-limited grant
grant update (name, timezone, default_range_days, settings) on public.clients to authenticated;
create policy clients_update on public.clients
  for update to authenticated
  using (public.is_client_member(id, array['owner', 'admin']))
  with check (public.is_client_member(id, array['owner', 'admin']));

create policy client_members_select on public.client_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_client_member(client_id));

do $$
declare t text;
begin
  foreach t in array array[
    'integration_connections','integration_resources','ga4_daily_metrics',
    'ga4_traffic_sources','ga4_page_metrics','ga4_dimension_metrics',
    'gsc_daily_metrics','gsc_query_metrics','gsc_page_metrics',
    'gbp_daily_metrics','gbp_keyword_metrics','analytics_sync_jobs'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))',
      t || '_select', t);
  end loop;
end $$;

-- Hide Composio account identifiers from the browser: expose only safe columns.
revoke select on public.integration_connections from authenticated;
grant select (id, client_id, provider, auth_method, account_email, status,
              last_error, last_synced_at, created_at, updated_at)
  on public.integration_connections to authenticated;

-- Selecting which discovered resource to track is a member-admin action.
grant update (is_selected) on public.integration_resources to authenticated;
create policy integration_resources_update on public.integration_resources
  for update to authenticated
  using (public.is_client_member(client_id, array['owner', 'admin']))
  with check (public.is_client_member(client_id, array['owner', 'admin']));

-- Bootstrap: a signed-in user creates a client and becomes its owner.
create or replace function public.create_client(p_name text, p_timezone text default 'UTC')
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'name required' using errcode = '22023';
  end if;
  insert into public.clients (name, timezone) values (btrim(p_name), p_timezone)
    returning id into v_id;
  insert into public.client_members (client_id, user_id, role)
    values (v_id, (select auth.uid()), 'owner');
  return v_id;
end $$;
revoke all on function public.create_client(text, text) from public, anon;
grant execute on function public.create_client(text, text) to authenticated;
