-- GA4 metrics by date x channel x device x country, so channel/device/country filters can be
-- combined and apply to every per-day metric. (Revenue stays on the daily table only.)
create table public.ga4_cube_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  channel_group text not null default '(not set)',
  device text not null default '(not set)',
  country text not null default '(not set)',
  users bigint not null default 0,
  new_users bigint not null default 0,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_seconds numeric not null default 0,
  event_count bigint not null default 0,
  key_events numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, channel_group, device, country)
);
create index ga4_cube_client_date_idx on public.ga4_cube_metrics (client_id, metric_date);
create trigger ga4_cube_metrics_set_updated_at before update on public.ga4_cube_metrics
  for each row execute function public.set_updated_at();
alter table public.ga4_cube_metrics enable row level security;
revoke all on public.ga4_cube_metrics from anon;
revoke insert, update, delete, truncate on public.ga4_cube_metrics from authenticated;
create policy ga4_cube_metrics_select on public.ga4_cube_metrics
  for select to authenticated using (public.is_client_member(client_id));

create or replace function public._ga4_cube_totals(
  p_client_id uuid, p_start date, p_end date, p_channel text, p_device text, p_country text)
returns jsonb language sql stable set search_path = public as $$
  select case when count(*) = 0 then jsonb_build_object('has_data', false) else jsonb_build_object(
    'has_data', true, 'users', sum(users), 'new_users', sum(new_users), 'sessions', sum(sessions),
    'engaged_sessions', sum(engaged_sessions),
    'engagement_rate', sum(engaged_sessions)::numeric / nullif(sum(sessions), 0),
    'avg_engagement_seconds', sum(engagement_seconds) / nullif(sum(users), 0),
    'event_count', sum(event_count), 'key_events', sum(key_events)) end
  from public.ga4_cube_metrics t
  where t.client_id = p_client_id and t.metric_date between p_start and p_end
    and (p_channel is null or t.channel_group = p_channel)
    and (p_device is null or t.device = p_device)
    and (p_country is null or t.country = p_country)
    and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'));
$$;

create or replace function public._ga4_cube_series(
  p_client_id uuid, p_start date, p_end date, p_channel text, p_device text, p_country text, p_shift int default 0)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', d + p_shift, 'users', u, 'new_users', nu, 'sessions', se, 'engaged_sessions', es,
      'engagement_rate', es::numeric / nullif(se, 0), 'event_count', ev, 'key_events', ke) order by d), '[]')
  from (
    select t.metric_date d, sum(users) u, sum(new_users) nu, sum(sessions) se, sum(engaged_sessions) es,
           sum(event_count) ev, sum(key_events) ke
    from public.ga4_cube_metrics t
    where t.client_id = p_client_id and t.metric_date between p_start and p_end
      and (p_channel is null or t.channel_group = p_channel)
      and (p_device is null or t.device = p_device)
      and (p_country is null or t.country = p_country)
      and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
    group by 1) x;
$$;

-- breakdown of one dimension inside the other active filters
create or replace function public._ga4_cube_breakdown(
  p_client_id uuid, p_start date, p_end date, p_dim text, p_channel text, p_device text, p_country text, p_limit int)
returns jsonb language plpgsql stable set search_path = public as $$
declare v jsonb;
begin
  if p_dim not in ('channel_group', 'device', 'country') then raise exception 'invalid dim' using errcode = '22023'; end if;
  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object('value', v, 'sessions', se, 'users', u, 'key_events', ke) order by se desc, v), '[]')
    from (select %1$I as v, sum(sessions) se, sum(users) u, sum(key_events) ke
          from public.ga4_cube_metrics t
          where t.client_id = $1 and t.metric_date between $2 and $3
            and ($4::text is null or t.channel_group = $4)
            and ($5::text is null or t.device = $5)
            and ($6::text is null or t.country = $6)
            and t.resource_id in (select public._selected_resources($1, 'ga4'))
          group by 1 order by 2 desc, 1 limit $7) x
  $q$, p_dim) into v
  using p_client_id, p_start, p_end,
        case when p_dim = 'channel_group' then null else p_channel end,
        case when p_dim = 'device' then null else p_device end,
        case when p_dim = 'country' then null else p_country end, p_limit;
  return v;
end $$;

create or replace function public.get_ga4_filtered(
  p_client_id uuid, p_start date, p_end date,
  p_channel text default null, p_device text default null, p_country text default null, p_compare boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'current',  public._ga4_cube_totals(p_client_id, p_start, p_end, p_channel, p_device, p_country),
    'previous', public._ga4_cube_totals(p_client_id, p_start - v_len, p_end - v_len, p_channel, p_device, p_country),
    'mom', public._ga4_cube_totals(p_client_id, (p_start - interval '1 month')::date, (p_end - interval '1 month')::date, p_channel, p_device, p_country),
    'yoy', public._ga4_cube_totals(p_client_id, (p_start - interval '1 year')::date, (p_end - interval '1 year')::date, p_channel, p_device, p_country),
    'trend', jsonb_build_object(
      'current', public._ga4_cube_series(p_client_id, p_start, p_end, p_channel, p_device, p_country),
      'previous', case when p_compare
        then public._ga4_cube_series(p_client_id, p_start - v_len, p_end - v_len, p_channel, p_device, p_country, v_len)
        else '[]'::jsonb end),
    'channels', public._ga4_cube_breakdown(p_client_id, p_start, p_end, 'channel_group', p_channel, p_device, p_country, 20),
    'devices', public._ga4_cube_breakdown(p_client_id, p_start, p_end, 'device', p_channel, p_device, p_country, 10),
    'countries', public._ga4_cube_breakdown(p_client_id, p_start, p_end, 'country', p_channel, p_device, p_country, 250));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public._ga4_cube_totals(uuid,date,date,text,text,text)',
    'public._ga4_cube_series(uuid,date,date,text,text,text,int)',
    'public._ga4_cube_breakdown(uuid,date,date,text,text,text,text,int)',
    'public.get_ga4_filtered(uuid,date,date,text,text,text,boolean)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated, service_role';
  end loop;
end $$;
