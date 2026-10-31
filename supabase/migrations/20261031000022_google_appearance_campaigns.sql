-- Search Console "search appearance" (rich results, product snippets, videos...) and GA4 campaigns,
-- site search terms and ecommerce items. Additive only; safe to run more than once.

-- ------------------------------------------------------------ 1. Search Console search appearance
-- The API refuses to group searchAppearance with any other dimension ("Cannot group by search
-- appearance dimension together with another dimension"). The sync lists the appearance types for the
-- range, then asks for `date` filtered to each type, which gives exact per-day rows. Web search only.
create table if not exists public.gsc_search_appearance_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  appearance text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  position_x_impressions numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, appearance)
);
create index if not exists gsc_sa_client_date_idx on public.gsc_search_appearance_metrics (client_id, metric_date);
drop trigger if exists gsc_search_appearance_metrics_set_updated_at on public.gsc_search_appearance_metrics;
create trigger gsc_search_appearance_metrics_set_updated_at before update on public.gsc_search_appearance_metrics
  for each row execute function public.set_updated_at();
alter table public.gsc_search_appearance_metrics enable row level security;
revoke all on public.gsc_search_appearance_metrics from anon;
revoke insert, update, delete, truncate on public.gsc_search_appearance_metrics from authenticated;
drop policy if exists gsc_search_appearance_metrics_select on public.gsc_search_appearance_metrics;
create policy gsc_search_appearance_metrics_select on public.gsc_search_appearance_metrics
  for select to authenticated using (public.is_client_member(client_id));

-- per appearance type for the range, plus a daily series per type. Rates re-weighted from sums.
create or replace function public.get_gsc_search_appearance(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'types', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.impressions desc, x.appearance), '[]') from (
        select appearance, sum(clicks) as clicks, sum(impressions) as impressions,
               case when sum(impressions) > 0 then sum(clicks)::numeric / sum(impressions) end as ctr,
               case when sum(impressions) > 0 then sum(position_x_impressions) / sum(impressions) end as position,
               count(distinct metric_date) as days
        from public.gsc_search_appearance_metrics t
        where t.client_id = p_client_id and t.metric_date between p_start and p_end
          and t.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
        group by appearance) x),
    'series', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.date, x.appearance), '[]') from (
        select metric_date as date, appearance, sum(clicks) as clicks, sum(impressions) as impressions
        from public.gsc_search_appearance_metrics t
        where t.client_id = p_client_id and t.metric_date between p_start and p_end
          and t.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
        group by metric_date, appearance) x),
    'synced', exists (
      select 1 from public.gsc_search_appearance_metrics t
      where t.client_id = p_client_id and t.resource_id in (select public._selected_resources(p_client_id, 'gsc'))));
end $$;
revoke all on function public.get_gsc_search_appearance(uuid, date, date) from public, anon;
grant execute on function public.get_gsc_search_appearance(uuid, date, date) to authenticated, service_role;

-- ------------------------------------------------------------ 2. GA4 campaigns, site search, items
-- Column use per dimension in ga4_dimension_metrics (generic rows):
--   campaign    (sessionCampaignName): sessions, users = activeUsers, key_events
--   search_term (searchTerm):          event_count = eventCount, users = totalUsers
--   item        (itemName):            event_count = itemsViewed, sessions = itemsAddedToCart,
--                                      key_events = itemsPurchased, revenue = itemRevenue
alter table public.ga4_dimension_metrics drop constraint if exists ga4_dimension_metrics_dimension_check;
alter table public.ga4_dimension_metrics add constraint ga4_dimension_metrics_dimension_check
  check (dimension in ('device', 'country', 'key_event', 'city', 'user_type', 'event', 'campaign', 'search_term', 'item'));

-- every stored column summed for one of the new dimensions; get_ga4_dimension only returns
-- sessions/users/key_events.
create or replace function public.get_ga4_dimension_totals(p_client_id uuid, p_start date, p_end date, p_dim text, p_limit int default 50)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  if p_dim not in ('campaign', 'search_term', 'item') then
    raise exception 'unknown dimension' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.rank_value desc, x.value), '[]')
    from (
      select value, sum(sessions) as sessions, sum(users) as users, sum(key_events) as key_events,
             sum(event_count) as event_count, sum(revenue) as revenue,
             case when p_dim = 'campaign' then sum(sessions) else sum(event_count) end as rank_value
      from public.ga4_dimension_metrics t
      where t.client_id = p_client_id and t.dimension = p_dim
        and t.metric_date between p_start and p_end
        and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
      group by value
      order by 7 desc, value limit least(greatest(p_limit, 1), 200)
    ) x);
end $$;
revoke all on function public.get_ga4_dimension_totals(uuid, date, date, text, int) from public, anon;
grant execute on function public.get_ga4_dimension_totals(uuid, date, date, text, int) to authenticated, service_role;
