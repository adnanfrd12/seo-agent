-- GA4 traffic-channel filter.
-- Channel-level numbers come from ga4_traffic_sources (date x channel x source x medium), which
-- carries users, sessions, engaged sessions and key events. Metrics that are only stored per day
-- (new users, event count, engagement time, revenue) cannot be split by channel and are omitted,
-- never estimated.

create or replace function public._ga4_channel_totals(
  p_client_id uuid, p_start date, p_end date, p_channel text)
returns jsonb language sql stable set search_path = public as $$
  select case when count(*) = 0 then jsonb_build_object('has_data', false) else
    jsonb_build_object(
      'has_data', true,
      'users', sum(users),
      'sessions', sum(sessions),
      'engaged_sessions', sum(engaged_sessions),
      'engagement_rate', sum(engaged_sessions)::numeric / nullif(sum(sessions), 0),
      'key_events', sum(key_events)) end
  from public.ga4_traffic_sources t
  where t.client_id = p_client_id
    and t.metric_date between p_start and p_end
    and t.channel_group = p_channel
    and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'));
$$;

create or replace function public._ga4_channel_series(
  p_client_id uuid, p_start date, p_end date, p_channel text, p_shift int default 0)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', d + p_shift, 'users', u, 'sessions', se, 'engaged_sessions', es,
      'engagement_rate', es::numeric / nullif(se, 0), 'key_events', ke) order by d), '[]')
  from (
    select t.metric_date as d, sum(t.users) as u, sum(t.sessions) as se,
           sum(t.engaged_sessions) as es, sum(t.key_events) as ke
    from public.ga4_traffic_sources t
    where t.client_id = p_client_id
      and t.metric_date between p_start and p_end
      and t.channel_group = p_channel
      and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
    group by t.metric_date
  ) x;
$$;

-- Same shape as get_ga4_summary's comparisons plus a trend in get_analytics_trends' shape.
create or replace function public.get_ga4_channel_summary(
  p_client_id uuid, p_start date, p_end date, p_channel text, p_compare boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'current',  public._ga4_channel_totals(p_client_id, p_start, p_end, p_channel),
    'previous', public._ga4_channel_totals(p_client_id, p_start - v_len, p_end - v_len, p_channel),
    'mom', public._ga4_channel_totals(p_client_id, (p_start - interval '1 month')::date,
             (p_end - interval '1 month')::date, p_channel),
    'yoy', public._ga4_channel_totals(p_client_id, (p_start - interval '1 year')::date,
             (p_end - interval '1 year')::date, p_channel),
    'trend', jsonb_build_object(
      'current', public._ga4_channel_series(p_client_id, p_start, p_end, p_channel),
      'previous', case when p_compare
        then public._ga4_channel_series(p_client_id, p_start - v_len, p_end - v_len, p_channel, v_len)
        else '[]'::jsonb end));
end $$;

-- Traffic sources gains an optional channel filter (drop + create: an overload would make
-- PostgREST's named-argument resolution ambiguous).
drop function if exists public.get_ga4_traffic_sources(uuid, date, date, text, text, text, int, int);
create function public.get_ga4_traffic_sources(
  p_client_id uuid, p_start date, p_end date, p_group_by text default 'source_medium',
  p_sort text default 'sessions', p_dir text default 'desc',
  p_limit int default 25, p_offset int default 0, p_channel text default null)
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
        and ($6::text is null or t.channel_group = $6)
        and t.resource_id in (select public._selected_resources($1, 'ga4'))
      group by 1, 2
    ), ranked as (
      select *, row_number() over (order by %3$s %4$s nulls last, source, medium) as rn from agg
    )
    select coalesce(jsonb_agg(to_jsonb(p) - 'rn' order by p.rn), '[]'), (select count(*) from agg)
    from (select * from ranked order by rn limit $4 offset $5) p
  $q$, v_src, v_med, v_sort, v_dir)
  into v_rows, v_total
  using p_client_id, p_start, p_end, least(greatest(p_limit, 1), 500), greatest(p_offset, 0), p_channel;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke all on function public._ga4_channel_totals(uuid, date, date, text) from public, anon;
revoke all on function public._ga4_channel_series(uuid, date, date, text, int) from public, anon;
revoke all on function public.get_ga4_channel_summary(uuid, date, date, text, boolean) from public, anon;
revoke all on function public.get_ga4_traffic_sources(uuid, date, date, text, text, text, int, int, text) from public, anon;
grant execute on function public._ga4_channel_totals(uuid, date, date, text) to authenticated, service_role;
grant execute on function public._ga4_channel_series(uuid, date, date, text, int) to authenticated, service_role;
grant execute on function public.get_ga4_channel_summary(uuid, date, date, text, boolean) to authenticated, service_role;
grant execute on function public.get_ga4_traffic_sources(uuid, date, date, text, text, text, int, int, text) to authenticated, service_role;
