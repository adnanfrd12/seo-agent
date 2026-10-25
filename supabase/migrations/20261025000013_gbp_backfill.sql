-- Google Business Profile (direct Google OAuth) + long-history backfill.
--  * extra Performance API daily metrics (nullable: not every business has them)
--  * job_type 'backfill': older date chunks queued one after another by the worker, so
--    "fetch as much history as the API allows" never needs one huge, timeout-prone job.

alter table public.gbp_daily_metrics
  add column if not exists conversations bigint,
  add column if not exists bookings bigint,
  add column if not exists food_orders bigint,
  add column if not exists food_menu_clicks bigint,
  add column if not exists messaging_clicks bigint;

alter table public.analytics_sync_jobs drop constraint if exists analytics_sync_jobs_job_type_check;
alter table public.analytics_sync_jobs add constraint analytics_sync_jobs_job_type_check
  check (job_type in ('initial', 'daily', 'manual', 'backfill'));

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
      'food_menu_clicks', sum(food_menu_clicks)) end
  from public.gbp_daily_metrics d
  where d.client_id = p_client_id
    and d.metric_date between p_start and p_end
    and (p_resource_id is null or d.resource_id = p_resource_id)
    and d.resource_id in (select public._selected_resources(p_client_id, 'gbp'));
$$;
