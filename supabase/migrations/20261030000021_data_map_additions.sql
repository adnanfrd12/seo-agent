-- Data-map additions: GA4 events, Search Console breakdowns, richer rank checks and multi-engine AI
-- visibility (ChatGPT, Perplexity, Gemini, Claude) with brands and sentiment. Additive only; safe to run
-- more than once.

-- ------------------------------------------------------------ 1. GA4: every event, not only key events
alter table public.ga4_dimension_metrics add column if not exists event_count numeric not null default 0;
alter table public.ga4_dimension_metrics add column if not exists revenue numeric not null default 0;
alter table public.ga4_dimension_metrics drop constraint if exists ga4_dimension_metrics_dimension_check;
alter table public.ga4_dimension_metrics add constraint ga4_dimension_metrics_dimension_check
  check (dimension in ('device', 'country', 'key_event', 'city', 'user_type', 'event'));

-- per event for the range. users are summed per day (GA4 counts a person once per day here), so they
-- can exceed the true unique count over a long range; the page says so.
create or replace function public.get_ga4_events(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.event_count desc, x.value), '[]')
    from (
      select value, sum(event_count) as event_count, sum(users) as users, sum(key_events) as key_events, sum(revenue) as revenue
      from public.ga4_dimension_metrics t
      where t.client_id = p_client_id and t.dimension = 'event'
        and t.metric_date between p_start and p_end
        and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
      group by value order by sum(event_count) desc, value limit 100
    ) x);
end $$;
revoke all on function public.get_ga4_events(uuid, date, date) from public, anon;
grant execute on function public.get_ga4_events(uuid, date, date) to authenticated, service_role;

-- ------------------------------------------------------------ 2. Search Console: device, country, new queries
-- new_queries: queries with impressions in the last 7 days of the range and none in the 28 days before.
create or replace function public.get_gsc_breakdowns(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_recent date := p_end - 6;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'devices', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.clicks desc), '[]') from (
        select device as value, sum(clicks) as clicks, sum(impressions) as impressions,
               case when sum(impressions) > 0 then sum(clicks)::numeric / sum(impressions) end as ctr,
               case when sum(impressions) > 0 then sum(position_x_impressions) / sum(impressions) end as position
        from public.gsc_daily_metrics d
        where d.client_id = p_client_id and d.metric_date between p_start and p_end and d.search_type = 'web' and d.device <> ''
          and d.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
        group by device) x),
    'countries', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.clicks desc, x.impressions desc), '[]') from (
        select country as value, sum(clicks) as clicks, sum(impressions) as impressions,
               case when sum(impressions) > 0 then sum(clicks)::numeric / sum(impressions) end as ctr,
               case when sum(impressions) > 0 then sum(position_x_impressions) / sum(impressions) end as position
        from public.gsc_daily_metrics d
        where d.client_id = p_client_id and d.metric_date between p_start and p_end and d.search_type = 'web' and d.country <> ''
          and d.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
        group by country order by sum(clicks) desc, sum(impressions) desc limit 15) x),
    'new_queries', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.impressions desc), '[]') from (
        select q.query, sum(q.clicks) as clicks, sum(q.impressions) as impressions,
               case when sum(q.impressions) > 0 then sum(q.position_x_impressions) / sum(q.impressions) end as position
        from public.gsc_query_metrics q
        where q.client_id = p_client_id and q.search_type = 'web' and q.metric_date between v_recent and p_end
          and q.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
          and not exists (
            select 1 from public.gsc_query_metrics o
            where o.client_id = p_client_id and o.query = q.query and o.search_type = 'web'
              and o.metric_date between v_recent - 28 and v_recent - 1 and o.impressions > 0)
        group by q.query having sum(q.impressions) > 0
        order by sum(q.impressions) desc limit 25) x),
    'recent_start', v_recent);
end $$;
revoke all on function public.get_gsc_breakdowns(uuid, date, date) from public, anon;
grant execute on function public.get_gsc_breakdowns(uuid, date, date) to authenticated, service_role;

-- ------------------------------------------------------------ 3. rank checks: what else is on the results page
-- serp: {features[], local_pack[], ads[], ai_overview[], featured_snippet} from the same SERP call
alter table public.rank_checks add column if not exists serp jsonb not null default '{}'::jsonb;
-- search volume, difficulty, CPC and intent (DataForSEO Labs keyword overview), refreshed monthly
alter table public.rank_keywords add column if not exists metrics jsonb;

-- ------------------------------------------------------------ 4. AI visibility: one row per engine per day
alter table public.ai_checks add column if not exists engine text not null default 'claude';
-- brands named in the answer, in order: [{name, domain, own, position, sentiment, cited}]
alter table public.ai_checks add column if not exists brands jsonb not null default '[]'::jsonb;
-- the client's own position among the brands named (1 = named first), null when not named
alter table public.ai_checks add column if not exists position int;
-- how the answer talks about the client, 0-100 (50 neutral), null when not named
alter table public.ai_checks add column if not exists sentiment numeric;
alter table public.ai_checks drop constraint if exists ai_checks_prompt_id_checked_on_key;
create unique index if not exists ai_checks_prompt_day_engine_key on public.ai_checks (prompt_id, checked_on, engine);
