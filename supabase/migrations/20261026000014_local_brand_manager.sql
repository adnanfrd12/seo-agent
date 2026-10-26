-- Local Brand Manager (LBM) API integration.
-- LBM is connected to the Google Business Profiles it manages, so it can serve GBP performance
-- data without this app's own Google API approval. Its daily metrics and monthly keywords are
-- stored in the existing gbp_* tables (resources have provider 'gbp' and belong to the 'lbm'
-- connection), so the Business Profile page, report, PDF and AI work unchanged.
-- Reviews and geogrid (local rank) scans get their own tables.

alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity', 'lbm'));

create table public.gbp_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  remote_id text not null,
  rating smallint,
  text text,
  reviewer_name text,
  reviewer_photo_url text,
  reply_text text,
  replied_at timestamptz,
  reviewed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, remote_id)
);
create index gbp_reviews_client_idx on public.gbp_reviews (client_id, reviewed_at desc);

create table public.gbp_geogrids (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  remote_id text not null,
  search_term text not null,
  state text,
  scanned_at timestamptz,
  agr numeric,            -- average grid rank: average rank over points where the business ranked
  atgr numeric,           -- average total grid rank: unranked points counted as 21
  solv numeric,           -- share of local voice: % of points ranking in the top 3
  grid_size int,
  point_distance numeric,
  distance_measure text,
  ranks jsonb,            -- grid of ranks ("X" = not in the top 20)
  image_url text,
  public_url text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, remote_id)
);
create index gbp_geogrids_client_idx on public.gbp_geogrids (client_id, scanned_at desc);

do $$
declare t text;
begin
  foreach t in array array['gbp_reviews', 'gbp_geogrids'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;
create index if not exists gbp_reviews_resource_idx on public.gbp_reviews (resource_id);
create index if not exists gbp_geogrids_resource_idx on public.gbp_geogrids (resource_id);

-- totals now include message conversations (reported by Local Brand Manager)
create or replace function public._gbp_totals(
  p_client_id uuid, p_start date, p_end date, p_resource_id uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select case when count(*) = 0 then jsonb_build_object('has_data', false) else
    jsonb_build_object(
      'has_data', true,
      'impressions', nullif(
        coalesce(sum(impressions_desktop_maps), 0) + coalesce(sum(impressions_desktop_search), 0) +
        coalesce(sum(impressions_mobile_maps), 0) + coalesce(sum(impressions_mobile_search), 0), 0),
      'impressions_maps',
        nullif(coalesce(sum(impressions_desktop_maps), 0) + coalesce(sum(impressions_mobile_maps), 0), 0),
      'impressions_search',
        nullif(coalesce(sum(impressions_desktop_search), 0) + coalesce(sum(impressions_mobile_search), 0), 0),
      'impressions_desktop',
        nullif(coalesce(sum(impressions_desktop_maps), 0) + coalesce(sum(impressions_desktop_search), 0), 0),
      'impressions_mobile',
        nullif(coalesce(sum(impressions_mobile_maps), 0) + coalesce(sum(impressions_mobile_search), 0), 0),
      'call_clicks', sum(call_clicks),
      'website_clicks', sum(website_clicks),
      'direction_requests', sum(direction_requests),
      'bookings', sum(bookings),
      'messaging_clicks', sum(messaging_clicks),
      'food_menu_clicks', sum(food_menu_clicks),
      'conversations', sum(conversations)) end
  from public.gbp_daily_metrics d
  where d.client_id = p_client_id
    and d.metric_date between p_start and p_end
    and (p_resource_id is null or d.resource_id = p_resource_id)
    and d.resource_id in (select public._selected_resources(p_client_id, 'gbp'));
$$;
