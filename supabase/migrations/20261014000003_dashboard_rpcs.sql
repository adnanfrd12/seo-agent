-- Dashboard read RPCs. All are SECURITY INVOKER, so RLS also applies, and each
-- one asserts client membership explicitly so failures are loud (42501).
--
-- Aggregation rules:
--   * CTR            = SUM(clicks) / SUM(impressions)
--   * GSC position   = SUM(position*impressions) / SUM(impressions)
--   * GA4 eng. rate  = SUM(engaged_sessions) / SUM(sessions)
--   * GA4 avg engagement time = SUM(engagement_seconds) / SUM(active users)
-- Comparison periods:
--   previous = equal-length range immediately before the selected range
--   mom      = selected range shifted back 1 calendar month
--   yoy      = selected range shifted back 1 calendar year
-- A comparison with no stored rows returns {"has_data": false} (never zeros).

create or replace function public._assert_member(p_client_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_client_member(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public._selected_resources(p_client_id uuid, p_provider text)
returns setof uuid language sql stable set search_path = public as $$
  select id from public.integration_resources
  where client_id = p_client_id and provider = p_provider and is_selected;
$$;

-- ------------------------------------------------------------ totals helpers
create or replace function public._ga4_totals(p_client_id uuid, p_start date, p_end date)
returns jsonb language sql stable set search_path = public as $$
  select case when count(*) = 0 then jsonb_build_object('has_data', false) else
    jsonb_build_object(
      'has_data', true,
      'users', sum(users),
      'new_users', sum(new_users),
      'sessions', sum(sessions),
      'engaged_sessions', sum(engaged_sessions),
      'engagement_rate', sum(engaged_sessions)::numeric / nullif(sum(sessions), 0),
      'avg_engagement_seconds', sum(engagement_seconds) / nullif(sum(users), 0),
      'event_count', sum(event_count),
      'key_events', sum(key_events),
      'revenue', sum(revenue)) end
  from public.ga4_daily_metrics d
  where d.client_id = p_client_id
    and d.metric_date between p_start and p_end
    and d.resource_id in (select public._selected_resources(p_client_id, 'ga4'));
$$;

create or replace function public._gsc_totals(
  p_client_id uuid, p_start date, p_end date,
  p_search_type text default null, p_device text default null, p_country text default null)
returns jsonb language sql stable set search_path = public as $$
  select case when count(*) = 0 then jsonb_build_object('has_data', false) else
    jsonb_build_object(
      'has_data', true,
      'clicks', sum(clicks),
      'impressions', sum(impressions),
      'ctr', sum(clicks)::numeric / nullif(sum(impressions), 0),
      'position', sum(position_x_impressions) / nullif(sum(impressions), 0)) end
  from public.gsc_daily_metrics d
  where d.client_id = p_client_id
    and d.metric_date between p_start and p_end
    and (p_search_type is null or d.search_type = p_search_type)
    and (p_device is null or d.device = p_device)
    and (p_country is null or d.country = p_country)
    and d.resource_id in (select public._selected_resources(p_client_id, 'gsc'));
$$;

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
      'call_clicks', sum(call_clicks),
      'website_clicks', sum(website_clicks),
      'direction_requests', sum(direction_requests)) end
  from public.gbp_daily_metrics d
  where d.client_id = p_client_id
    and d.metric_date between p_start and p_end
    and (p_resource_id is null or d.resource_id = p_resource_id)
    and d.resource_id in (select public._selected_resources(p_client_id, 'gbp'));
$$;

create or replace function public._source_totals(
  p_provider text, p_client_id uuid, p_start date, p_end date,
  p_search_type text default null, p_device text default null, p_country text default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  return case p_provider
    when 'ga4' then public._ga4_totals(p_client_id, p_start, p_end)
    when 'gsc' then public._gsc_totals(p_client_id, p_start, p_end, p_search_type, p_device, p_country)
    when 'gbp' then public._gbp_totals(p_client_id, p_start, p_end)
    else null end;
end $$;

create or replace function public._compared(
  p_provider text, p_client_id uuid, p_start date, p_end date,
  p_search_type text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  return jsonb_build_object(
    'current',  public._source_totals(p_provider, p_client_id, p_start, p_end, p_search_type),
    'previous', public._source_totals(p_provider, p_client_id, p_start - v_len, p_end - v_len, p_search_type),
    'mom', public._source_totals(p_provider, p_client_id,
             (p_start - interval '1 month')::date, (p_end - interval '1 month')::date, p_search_type),
    'yoy', public._source_totals(p_provider, p_client_id,
             (p_start - interval '1 year')::date, (p_end - interval '1 year')::date, p_search_type));
end $$;

-- ------------------------------------------------------------- series helper
create or replace function public._source_series(
  p_provider text, p_client_id uuid, p_start date, p_end date, p_granularity text,
  p_search_type text default null, p_device text default null, p_country text default null)
returns table (bucket date, m jsonb) language plpgsql stable set search_path = public as $$
begin
  if p_granularity not in ('day', 'week', 'month') then
    raise exception 'invalid granularity' using errcode = '22023';
  end if;
  if p_provider = 'ga4' then
    return query
    select date_trunc(p_granularity, d.metric_date)::date,
      jsonb_build_object(
        'users', sum(d.users), 'new_users', sum(d.new_users), 'sessions', sum(d.sessions),
        'engaged_sessions', sum(d.engaged_sessions),
        'engagement_rate', sum(d.engaged_sessions)::numeric / nullif(sum(d.sessions), 0),
        'event_count', sum(d.event_count), 'key_events', sum(d.key_events))
    from public.ga4_daily_metrics d
    where d.client_id = p_client_id and d.metric_date between p_start and p_end
      and d.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
    group by 1 order by 1;
  elsif p_provider = 'gsc' then
    return query
    select date_trunc(p_granularity, d.metric_date)::date,
      jsonb_build_object(
        'clicks', sum(d.clicks), 'impressions', sum(d.impressions),
        'ctr', sum(d.clicks)::numeric / nullif(sum(d.impressions), 0),
        'position', sum(d.position_x_impressions) / nullif(sum(d.impressions), 0))
    from public.gsc_daily_metrics d
    where d.client_id = p_client_id and d.metric_date between p_start and p_end
      and (p_search_type is null or d.search_type = p_search_type)
      and (p_device is null or d.device = p_device)
      and (p_country is null or d.country = p_country)
      and d.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
    group by 1 order by 1;
  elsif p_provider = 'gbp' then
    return query
    select date_trunc(p_granularity, d.metric_date)::date,
      jsonb_build_object(
        'impressions',
          coalesce(sum(d.impressions_desktop_maps), 0) + coalesce(sum(d.impressions_desktop_search), 0) +
          coalesce(sum(d.impressions_mobile_maps), 0) + coalesce(sum(d.impressions_mobile_search), 0),
        'impressions_maps', coalesce(sum(d.impressions_desktop_maps), 0) + coalesce(sum(d.impressions_mobile_maps), 0),
        'impressions_search', coalesce(sum(d.impressions_desktop_search), 0) + coalesce(sum(d.impressions_mobile_search), 0),
        'call_clicks', sum(d.call_clicks), 'website_clicks', sum(d.website_clicks),
        'direction_requests', sum(d.direction_requests))
    from public.gbp_daily_metrics d
    where d.client_id = p_client_id and d.metric_date between p_start and p_end
      and d.resource_id in (select public._selected_resources(p_client_id, 'gbp'))
    group by 1 order by 1;
  else
    raise exception 'unknown provider' using errcode = '22023';
  end if;
end $$;

-- ================================================================ PUBLIC RPCs
create or replace function public.get_seo_overview(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'connected', jsonb_build_object(
      'ga4', exists (select 1 from public._selected_resources(p_client_id, 'ga4')),
      'gsc', exists (select 1 from public._selected_resources(p_client_id, 'gsc')),
      'gbp', exists (select 1 from public._selected_resources(p_client_id, 'gbp'))),
    'ga4', public._compared('ga4', p_client_id, p_start, p_end),
    'gsc', public._compared('gsc', p_client_id, p_start, p_end, 'web'),
    'gbp', public._compared('gbp', p_client_id, p_start, p_end));
end $$;

create or replace function public.get_analytics_trends(
  p_client_id uuid, p_provider text, p_start date, p_end date,
  p_granularity text default 'day', p_compare boolean default false,
  p_search_type text default null, p_device text default null, p_country text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_shift int := p_end - p_start + 1;
  v_cur jsonb; v_prev jsonb := '[]'::jsonb;
begin
  perform public._assert_member(p_client_id);
  select coalesce(jsonb_agg(m || jsonb_build_object('date', bucket) order by bucket), '[]')
    into v_cur
    from public._source_series(p_provider, p_client_id, p_start, p_end, p_granularity,
                               p_search_type, p_device, p_country);
  if p_compare then
    -- previous-period buckets are re-labelled onto the current period's dates
    select coalesce(jsonb_agg(m || jsonb_build_object('date', bucket + v_shift) order by bucket), '[]')
      into v_prev
      from public._source_series(p_provider, p_client_id, p_start - v_shift, p_end - v_shift,
                                 p_granularity, p_search_type, p_device, p_country);
  end if;
  return jsonb_build_object('current', v_cur, 'previous', v_prev);
end $$;

create or replace function public._ga4_dim(
  p_client_id uuid, p_start date, p_end date, p_dim text, p_limit int)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sessions desc, x.value), '[]')
  from (
    select value, sum(sessions) as sessions, sum(users) as users, sum(key_events) as key_events
    from public.ga4_dimension_metrics t
    where t.client_id = p_client_id and t.dimension = p_dim
      and t.metric_date between p_start and p_end
      and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
    group by value order by sum(sessions) desc, value limit p_limit
  ) x;
$$;

create or replace function public.get_ga4_summary(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return public._compared('ga4', p_client_id, p_start, p_end) || jsonb_build_object(
    'devices',    public._ga4_dim(p_client_id, p_start, p_end, 'device', 10),
    'countries',  public._ga4_dim(p_client_id, p_start, p_end, 'country', 15),
    'key_events', public._ga4_dim(p_client_id, p_start, p_end, 'key_event', 20),
    'channels', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.sessions desc), '[]') from (
        select channel_group, sum(sessions) as sessions, sum(users) as users
        from public.ga4_traffic_sources t
        where t.client_id = p_client_id and t.metric_date between p_start and p_end
          and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
        group by channel_group) x));
end $$;

create or replace function public.get_ga4_traffic_sources(
  p_client_id uuid, p_start date, p_end date, p_group_by text default 'source_medium',
  p_sort text default 'sessions', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_dir text; v_sort text; v_src text; v_med text;
begin
  perform public._assert_member(p_client_id);
  v_dir := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  if p_sort not in ('source', 'medium', 'sessions', 'users', 'engagement_rate', 'key_events') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  v_sort := quote_ident(p_sort);
  if p_group_by = 'channel' then v_src := 'channel_group'; v_med := 'null::text';
  elsif p_group_by = 'source_medium' then v_src := 'source'; v_med := 'medium';
  else raise exception 'invalid group_by' using errcode = '22023'; end if;

  execute format($q$
    with agg as (
      select %1$s as source, %2$s as medium, sum(sessions) as sessions, sum(users) as users,
             sum(key_events) as key_events,
             sum(engaged_sessions)::numeric / nullif(sum(sessions), 0) as engagement_rate
      from public.ga4_traffic_sources t
      where t.client_id = $1 and t.metric_date between $2 and $3
        and t.resource_id in (select public._selected_resources($1, 'ga4'))
      group by 1, 2
    ), ranked as (
      select *, row_number() over (order by %3$s %4$s nulls last, source, medium) as rn from agg
    )
    select coalesce(jsonb_agg(to_jsonb(p) - 'rn' order by p.rn), '[]'), (select count(*) from agg)
    from (select * from ranked order by rn limit $4 offset $5) p
  $q$, v_src, v_med, v_sort, v_dir)
  into v_rows, v_total
  using p_client_id, p_start, p_end, least(greatest(p_limit, 1), 500), greatest(p_offset, 0);

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.get_ga4_top_pages(
  p_client_id uuid, p_start date, p_end date, p_kind text default 'views',
  p_sort text default 'views', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_dir text;
begin
  perform public._assert_member(p_client_id);
  v_dir := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  if p_kind not in ('views', 'landing') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_sort not in ('page_path', 'views', 'users', 'sessions', 'avg_engagement_seconds', 'key_events') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;

  execute format($q$
    with agg as (
      select page_path, sum(views) as views, sum(users) as users, sum(sessions) as sessions,
             sum(engagement_seconds) / nullif(sum(users), 0) as avg_engagement_seconds,
             sum(key_events) as key_events
      from public.ga4_page_metrics t
      where t.client_id = $1 and t.metric_date between $2 and $3
        and t.is_landing = ($6 = 'landing')
        and t.resource_id in (select public._selected_resources($1, 'ga4'))
      group by page_path
    ), ranked as (
      select *, row_number() over (order by %1$I %2$s nulls last, page_path) as rn from agg
    )
    select coalesce(jsonb_agg(to_jsonb(p) - 'rn' order by p.rn), '[]'), (select count(*) from agg)
    from (select * from ranked order by rn limit $4 offset $5) p
  $q$, p_sort, v_dir)
  into v_rows, v_total
  using p_client_id, p_start, p_end, least(greatest(p_limit, 1), 500), greatest(p_offset, 0), p_kind;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.get_gsc_summary(
  p_client_id uuid, p_start date, p_end date,
  p_search_type text default 'web', p_device text default null, p_country text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'current',  public._gsc_totals(p_client_id, p_start, p_end, p_search_type, p_device, p_country),
    'previous', public._gsc_totals(p_client_id, p_start - v_len, p_end - v_len, p_search_type, p_device, p_country),
    'mom', public._gsc_totals(p_client_id, (p_start - interval '1 month')::date,
             (p_end - interval '1 month')::date, p_search_type, p_device, p_country),
    'yoy', public._gsc_totals(p_client_id, (p_start - interval '1 year')::date,
             (p_end - interval '1 year')::date, p_search_type, p_device, p_country),
    'devices', (select coalesce(jsonb_agg(distinct device), '[]') from public.gsc_daily_metrics
                where client_id = p_client_id and device <> ''),
    'countries', (select coalesce(jsonb_agg(c order by c), '[]') from (
                    select distinct country as c from public.gsc_daily_metrics
                    where client_id = p_client_id and country <> '') s));
end $$;

-- position_change = previous avg position - current avg position
-- (positive = moved up the results page = improvement); null if no prior data.
create or replace function public.get_gsc_keywords(
  p_client_id uuid, p_start date, p_end date,
  p_search text default null, p_search_type text default 'web',
  p_device text default null, p_country text default null,
  p_sort text default 'clicks', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_dir text; v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  v_dir := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  if p_sort not in ('query', 'clicks', 'impressions', 'ctr', 'position', 'position_change') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;

  execute format($q$
    with base as (
      select query, metric_date, clicks, impressions, position_x_impressions
      from public.gsc_query_metrics t
      where t.client_id = $1
        and t.metric_date between $2 - $9 and $3
        and ($4 is null or strpos(lower(t.query), lower($4)) > 0)
        and ($5 is null or t.search_type = $5)
        and ($6 is null or t.device = $6)
        and ($7 is null or t.country = $7)
        and t.resource_id in (select public._selected_resources($1, 'gsc'))
    ), cur as (
      select query, sum(clicks) as clicks, sum(impressions) as impressions,
             sum(position_x_impressions) as pxi
      from base where metric_date >= $2 group by query
    ), prev as (
      select query, sum(position_x_impressions) / nullif(sum(impressions), 0) as position
      from base where metric_date < $2 group by query
    ), agg as (
      select c.query, c.clicks, c.impressions,
             c.clicks::numeric / nullif(c.impressions, 0) as ctr,
             c.pxi / nullif(c.impressions, 0) as position,
             p.position - (c.pxi / nullif(c.impressions, 0)) as position_change
      from cur c left join prev p using (query)
    ), ranked as (
      select *, row_number() over (order by %1$I %2$s nulls last, query) as rn from agg
    )
    select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.rn), '[]'), (select count(*) from agg)
    from (select * from ranked order by rn limit $10 offset $11) r
  $q$, p_sort, v_dir)
  into v_rows, v_total
  using p_client_id, p_start, p_end, nullif(btrim(p_search), ''), p_search_type, p_device, p_country,
        null::int, v_len, least(greatest(p_limit, 1), 500), greatest(p_offset, 0);

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.get_gsc_top_pages(
  p_client_id uuid, p_start date, p_end date,
  p_search text default null, p_search_type text default 'web',
  p_device text default null, p_country text default null,
  p_sort text default 'clicks', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_dir text;
begin
  perform public._assert_member(p_client_id);
  v_dir := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  if p_sort not in ('page', 'clicks', 'impressions', 'ctr', 'position') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;

  execute format($q$
    with agg as (
      select page, sum(clicks) as clicks, sum(impressions) as impressions,
             sum(clicks)::numeric / nullif(sum(impressions), 0) as ctr,
             sum(position_x_impressions) / nullif(sum(impressions), 0) as position
      from public.gsc_page_metrics t
      where t.client_id = $1 and t.metric_date between $2 and $3
        and ($4 is null or strpos(lower(t.page), lower($4)) > 0)
        and ($5 is null or t.search_type = $5)
        and ($6 is null or t.device = $6)
        and ($7 is null or t.country = $7)
        and t.resource_id in (select public._selected_resources($1, 'gsc'))
      group by page
    ), ranked as (
      select *, row_number() over (order by %1$I %2$s nulls last, page) as rn from agg
    )
    select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.rn), '[]'), (select count(*) from agg)
    from (select * from ranked order by rn limit $8 offset $9) r
  $q$, p_sort, v_dir)
  into v_rows, v_total
  using p_client_id, p_start, p_end, nullif(btrim(p_search), ''), p_search_type, p_device, p_country,
        least(greatest(p_limit, 1), 500), greatest(p_offset, 0);

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.get_gbp_locations(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'external_id', r.external_id, 'display_name', r.display_name,
      'metadata', r.metadata,
      'current',  public._gbp_totals(p_client_id, p_start, p_end, r.id),
      'previous', public._gbp_totals(p_client_id, p_start - v_len, p_end - v_len, r.id)
    ) order by r.display_name), '[]')
    from public.integration_resources r
    where r.client_id = p_client_id and r.provider = 'gbp' and r.is_selected);
end $$;

create or replace function public.get_gbp_summary(
  p_client_id uuid, p_start date, p_end date, p_resource_id uuid default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'current',  public._gbp_totals(p_client_id, p_start, p_end, p_resource_id),
    'previous', public._gbp_totals(p_client_id, p_start - v_len, p_end - v_len, p_resource_id),
    'mom', public._gbp_totals(p_client_id, (p_start - interval '1 month')::date,
             (p_end - interval '1 month')::date, p_resource_id),
    'yoy', public._gbp_totals(p_client_id, (p_start - interval '1 year')::date,
             (p_end - interval '1 year')::date, p_resource_id),
    -- device/surface split; only surfaces the API actually returned
    'breakdown', (
      select jsonb_build_object(
        'desktop_maps', sum(impressions_desktop_maps), 'desktop_search', sum(impressions_desktop_search),
        'mobile_maps', sum(impressions_mobile_maps), 'mobile_search', sum(impressions_mobile_search))
      from public.gbp_daily_metrics d
      where d.client_id = p_client_id and d.metric_date between p_start and p_end
        and (p_resource_id is null or d.resource_id = p_resource_id)
        and d.resource_id in (select public._selected_resources(p_client_id, 'gbp'))),
    -- keywords are monthly: every month overlapping the range is included
    'keywords', (
      select coalesce(jsonb_agg(to_jsonb(k) order by k.impressions desc nulls last, k.keyword), '[]')
      from (
        select keyword, sum(impressions) as impressions,
               bool_or(impressions is null) as has_threshold_only,
               max(impressions_threshold) as impressions_threshold
        from public.gbp_keyword_metrics t
        where t.client_id = p_client_id
          and t.month between date_trunc('month', p_start)::date and p_end
          and (p_resource_id is null or t.resource_id = p_resource_id)
          and t.resource_id in (select public._selected_resources(p_client_id, 'gbp'))
        group by keyword order by sum(impressions) desc nulls last, keyword limit 50) k),
    'locations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'display_name', r.display_name, 'metadata', r.metadata) order by r.display_name), '[]')
      from public.integration_resources r
      where r.client_id = p_client_id and r.provider = 'gbp' and r.is_selected));
end $$;

create or replace function public.get_monthly_performance_comparison(p_client_id uuid, p_month date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_pstart date := (v_start - interval '1 month')::date;
  v_pend date := (v_start - interval '1 day')::date;
  v_ystart date := (v_start - interval '1 year')::date;
  v_yend date := ((v_start - interval '1 year') + interval '1 month - 1 day')::date;
  v_out jsonb := '{}'::jsonb; v_p text;
begin
  perform public._assert_member(p_client_id);
  foreach v_p in array array['ga4', 'gsc', 'gbp'] loop
    v_out := v_out || jsonb_build_object(v_p, jsonb_build_object(
      'current',  public._source_totals(v_p, p_client_id, v_start, v_end, case when v_p = 'gsc' then 'web' end),
      'mom',      public._source_totals(v_p, p_client_id, v_pstart, v_pend, case when v_p = 'gsc' then 'web' end),
      'yoy',      public._source_totals(v_p, p_client_id, v_ystart, v_yend, case when v_p = 'gsc' then 'web' end)));
  end loop;
  return v_out || jsonb_build_object(
    'month', v_start, 'month_end', v_end,
    'client_name', (select name from public.clients where id = p_client_id),
    'top_keywords', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from (
        select query, sum(clicks) as clicks, sum(impressions) as impressions
        from public.gsc_query_metrics t
        where t.client_id = p_client_id and t.metric_date between v_start and v_end
          and t.search_type = 'web'
          and t.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
        group by query order by sum(clicks) desc, query limit 10) k));
end $$;

create or replace function public.get_integration_status(p_client_id uuid)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return (
    select jsonb_object_agg(p.provider, jsonb_build_object(
      'connection', (
        select to_jsonb(c) from (
          select id, status, account_email, last_error, last_synced_at, auth_method
          from public.integration_connections
          where client_id = p_client_id and provider = p.provider) c),
      'resources', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'external_id', r.external_id, 'display_name', r.display_name,
          'timezone', r.timezone, 'is_selected', r.is_selected) order by r.display_name), '[]')
        from public.integration_resources r
        where r.client_id = p_client_id and r.provider = p.provider),
      'last_job', (
        select to_jsonb(j) from (
          select id, status, job_type, error, started_at, finished_at, created_at, stats
          from public.analytics_sync_jobs
          where client_id = p_client_id and provider = p.provider
          order by created_at desc limit 1) j),
      'syncing', exists (
        select 1 from public.analytics_sync_jobs
        where client_id = p_client_id and provider = p.provider
          and status in ('queued', 'running'))))
    from (values ('ga4'), ('gsc'), ('gbp')) as p(provider));
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'get\_%' or p.proname like '\_%')
      and p.proname not like '\_\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
