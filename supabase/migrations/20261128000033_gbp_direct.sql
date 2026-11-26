-- Direct Google Business Profile integration (Google OAuth, no Local Brand Manager in between).
--  1. google_oauth_apps: each agency owner's own Google Cloud OAuth client (id + encrypted secret).
--     Service role only: signed-in users can never read the secret (server code returns only the client id).
--  2. integration_connections.oauth_app_owner: which saved app a Business Profile grant was made with, so
--     token refreshes use the same client id/secret (null = the GOOGLE_GBP_* environment app).
--  3. gbp_reviews: source + Google's review resource fields; replies written from the dashboard are attributed.
--  4. gbp_posts: Business Profile posts (v4 localPosts) with any per-post metrics Google returns.
--  5. _selected_resources('gbp'): one source of truth per location. Google API resources are stored as
--     accounts/{a}/locations/{l}; Local Brand Manager ones as locations/{l}. When the same location is
--     tracked both ways and the Google resource has data from the last 45 days, the LBM resource is left out
--     of totals (no double counting). Otherwise LBM keeps serving the location exactly as before.
-- Every sync only inserts/upserts: nothing here deletes stored history.

-- ------------------------------------------------------------------ 1. OAuth apps per owner
create table if not exists public.google_oauth_apps (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  google_client_id text not null check (char_length(google_client_id) between 10 and 300),
  client_secret_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_oauth_apps enable row level security;
revoke all on public.google_oauth_apps from anon, authenticated;
-- no policies: only the service role (trusted server code) reads or writes this table
drop trigger if exists google_oauth_apps_set_updated_at on public.google_oauth_apps;
create trigger google_oauth_apps_set_updated_at before update on public.google_oauth_apps
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ 2. connection -> app
alter table public.integration_connections
  add column if not exists oauth_app_owner uuid references auth.users(id) on delete set null;
-- (not added to the column grant for signed-in users: it is an internal reference)

-- ------------------------------------------------------------------ 3. reviews
alter table public.gbp_reviews
  add column if not exists source text,                 -- 'google' (Business Profile API) or 'lbm'
  add column if not exists review_updated_at timestamptz,
  add column if not exists reply_state text,            -- Google's reviewReply.reviewReplyState (PENDING / APPROVED / REJECTED)
  add column if not exists replied_by uuid references auth.users(id) on delete set null;

-- ------------------------------------------------------------------ 4. posts
create table if not exists public.gbp_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  remote_id text not null,              -- accounts/{a}/locations/{l}/localPosts/{p}
  topic_type text,                      -- STANDARD / EVENT / OFFER / ALERT
  state text,                           -- LIVE / PROCESSING / REJECTED
  summary text,
  language_code text,
  cta_type text,
  cta_url text,
  search_url text,
  media jsonb not null default '[]'::jsonb,
  event jsonb,
  offer jsonb,
  metrics jsonb,                        -- localPosts:reportInsights values, when Google returns them
  posted_at timestamptz,
  post_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, remote_id)
);
create index if not exists gbp_posts_client_idx on public.gbp_posts (client_id, posted_at desc);
create index if not exists gbp_posts_resource_idx on public.gbp_posts (resource_id);
alter table public.gbp_posts enable row level security;
revoke all on public.gbp_posts from anon;
revoke insert, update, delete, truncate on public.gbp_posts from authenticated;
grant select on public.gbp_posts to authenticated;
drop policy if exists gbp_posts_select on public.gbp_posts;
create policy gbp_posts_select on public.gbp_posts for select to authenticated using (public.is_client_member(client_id));
drop trigger if exists gbp_posts_set_updated_at on public.gbp_posts;
create trigger gbp_posts_set_updated_at before update on public.gbp_posts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ 5. one source per location
create or replace function public._selected_resources(p_client_id uuid, p_provider text)
returns setof uuid language plpgsql stable set search_path = public as $$
declare v_pick text;
begin
  begin
    v_pick := current_setting('request.headers', true)::json ->> ('x-resource-' || p_provider);
  exception when others then
    v_pick := null;
  end;
  if v_pick ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return query
      select id from public.integration_resources
      where client_id = p_client_id and provider = p_provider and is_selected and id = v_pick::uuid;
  elsif p_provider = 'gbp' then
    return query
      select r.id from public.integration_resources r
      where r.client_id = p_client_id and r.provider = 'gbp' and r.is_selected
        and not (
          coalesce(r.metadata ->> 'source', '') <> 'google'
          and exists (
            select 1 from public.integration_resources g
            where g.client_id = p_client_id and g.provider = 'gbp' and g.is_selected and g.id <> r.id
              and g.metadata ->> 'source' = 'google'
              and regexp_replace(g.external_id, '^.*locations/', '') = regexp_replace(r.external_id, '^.*locations/', '')
              and exists (
                select 1 from public.gbp_daily_metrics d
                where d.resource_id = g.id and d.metric_date >= current_date - 45)));
  else
    return query
      select id from public.integration_resources
      where client_id = p_client_id and provider = p_provider and is_selected;
  end if;
end $$;
revoke all on function public._selected_resources(uuid, text) from public, anon;
grant execute on function public._selected_resources(uuid, text) to authenticated, service_role;
