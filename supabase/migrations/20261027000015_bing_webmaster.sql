-- Bing Webmaster Tools API integration (API key auth).
-- What the API serves, and how it is stored:
--   GetRankAndTrafficStats  daily clicks + impressions (~16 months)      -> bing_daily_metrics
--   GetQueryStats           weekly query clicks/impressions/positions   -> bing_query_metrics
--   GetPageStats            weekly page clicks/impressions/positions    -> bing_page_metrics
--   GetPageQueryStats       weekly queries for each top page            -> bing_page_query_metrics
--   GetCrawlStats           daily crawl / index / status-code counts    -> bing_crawl_metrics
--   sitemaps, crawl issues, crawl settings, quotas, index info, inbound links, blocked URLs,
--   URL parameters, keyword search volumes                              -> integration_resources.metadata

-- ------------------------------------------------------------- provider 'bing'
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity', 'lbm', 'bing'));
alter table public.integration_resources drop constraint if exists integration_resources_provider_check;
alter table public.integration_resources add constraint integration_resources_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity', 'bing'));
alter table public.analytics_sync_jobs drop constraint if exists analytics_sync_jobs_provider_check;
alter table public.analytics_sync_jobs add constraint analytics_sync_jobs_provider_check
  check (provider in ('ga4', 'gsc', 'gbp', 'clarity', 'bing'));

-- ------------------------------------------------------------------- tables
create table public.bing_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date)
);

-- Bing reports query/page stats in weekly buckets; `week` is the bucket date Bing returns.
-- Positions are Bing's averages for that bucket; -1 ("no clicks") is stored as null.
create table public.bing_query_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  week date not null,
  query text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  avg_click_position numeric,
  avg_impression_position numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, week, query)
);

create table public.bing_page_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  week date not null,
  page text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  avg_click_position numeric,
  avg_impression_position numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, week, page)
);

create table public.bing_page_query_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  week date not null,
  page text not null,
  query text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  avg_impression_position numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, week, page, query)
);

create table public.bing_crawl_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  crawled_pages bigint, crawl_errors bigint, in_index bigint, in_links bigint,
  code_2xx bigint, code_301 bigint, code_302 bigint, code_4xx bigint, code_5xx bigint, all_other_codes bigint,
  blocked_by_robots bigint, dns_failures bigint, connection_timeout bigint, contains_malware bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date)
);

create index bing_daily_client_idx on public.bing_daily_metrics (client_id, metric_date);
create index bing_query_client_idx on public.bing_query_metrics (client_id, week);
create index bing_page_client_idx on public.bing_page_metrics (client_id, week);
create index bing_page_query_client_idx on public.bing_page_query_metrics (client_id, week);
create index bing_crawl_client_idx on public.bing_crawl_metrics (client_id, metric_date);
create index bing_daily_resource_idx on public.bing_daily_metrics (resource_id);
create index bing_query_resource_idx on public.bing_query_metrics (resource_id);
create index bing_page_resource_idx on public.bing_page_metrics (resource_id);
create index bing_page_query_resource_idx on public.bing_page_query_metrics (resource_id);
create index bing_crawl_resource_idx on public.bing_crawl_metrics (resource_id);

do $$
declare t text;
begin
  foreach t in array array['bing_daily_metrics', 'bing_query_metrics', 'bing_page_metrics', 'bing_page_query_metrics', 'bing_crawl_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- ------------------------------------------------------------------- RPCs
-- Totals for a date range. Position = impression-weighted average of Bing's weekly query
-- positions in buckets that fall inside the range; CTR = clicks / impressions.
create or replace function public._bing_totals(p_client_id uuid, p_start date, p_end date)
returns jsonb language sql stable set search_path = public as $$
  with d as (
    select sum(clicks) clicks, sum(impressions) impressions, count(*) n
    from public.bing_daily_metrics
    where client_id = p_client_id and metric_date between p_start and p_end
      and resource_id in (select public._selected_resources(p_client_id, 'bing'))),
  q as (
    select sum(avg_impression_position * impressions) / nullif(sum(impressions), 0) pos
    from public.bing_query_metrics
    where client_id = p_client_id and week between p_start and p_end and avg_impression_position is not null
      and resource_id in (select public._selected_resources(p_client_id, 'bing')))
  select case when d.n = 0 then jsonb_build_object('has_data', false) else jsonb_build_object(
    'has_data', true, 'clicks', d.clicks, 'impressions', d.impressions,
    'ctr', d.clicks::numeric / nullif(d.impressions, 0), 'position', q.pos) end
  from d, q;
$$;

create or replace function public.get_bing_summary(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_len int := p_end - p_start + 1;
begin
  perform public._assert_member(p_client_id);
  return jsonb_build_object(
    'current',  public._bing_totals(p_client_id, p_start, p_end),
    'previous', public._bing_totals(p_client_id, p_start - v_len, p_end - v_len),
    'mom', public._bing_totals(p_client_id, (p_start - interval '1 month')::date, (p_end - interval '1 month')::date),
    'yoy', public._bing_totals(p_client_id, (p_start - interval '1 year')::date, (p_end - interval '1 year')::date),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', metric_date, 'clicks', c, 'impressions', i,
        'ctr', c::numeric / nullif(i, 0)) order by metric_date), '[]')
      from (select metric_date, sum(clicks) c, sum(impressions) i from public.bing_daily_metrics
            where client_id = p_client_id and metric_date between p_start and p_end
              and resource_id in (select public._selected_resources(p_client_id, 'bing'))
            group by metric_date) x),
    'daily_previous', (
      select coalesce(jsonb_agg(jsonb_build_object('date', metric_date + v_len, 'clicks', c, 'impressions', i,
        'ctr', c::numeric / nullif(i, 0)) order by metric_date), '[]')
      from (select metric_date, sum(clicks) c, sum(impressions) i from public.bing_daily_metrics
            where client_id = p_client_id and metric_date between p_start - v_len and p_end - v_len
              and resource_id in (select public._selected_resources(p_client_id, 'bing'))
            group by metric_date) x),
    'queries', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.clicks desc, t.impressions desc), '[]') from (
        select query, sum(clicks) clicks, sum(impressions) impressions,
          sum(clicks)::numeric / nullif(sum(impressions), 0) ctr,
          sum(avg_impression_position * impressions) / nullif(sum(impressions) filter (where avg_impression_position is not null), 0) position
        from public.bing_query_metrics
        where client_id = p_client_id and week between p_start and p_end
          and resource_id in (select public._selected_resources(p_client_id, 'bing'))
        group by query order by sum(clicks) desc, sum(impressions) desc limit 500) t),
    'pages', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.clicks desc, t.impressions desc), '[]') from (
        select page, sum(clicks) clicks, sum(impressions) impressions,
          sum(clicks)::numeric / nullif(sum(impressions), 0) ctr,
          sum(avg_impression_position * impressions) / nullif(sum(impressions) filter (where avg_impression_position is not null), 0) position
        from public.bing_page_metrics
        where client_id = p_client_id and week between p_start and p_end
          and resource_id in (select public._selected_resources(p_client_id, 'bing'))
        group by page order by sum(clicks) desc, sum(impressions) desc limit 500) t),
    'page_queries', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.page, t.impressions desc), '[]') from (
        select page, query, sum(clicks) clicks, sum(impressions) impressions,
          sum(avg_impression_position * impressions) / nullif(sum(impressions) filter (where avg_impression_position is not null), 0) position
        from public.bing_page_query_metrics
        where client_id = p_client_id and week between p_start and p_end
          and resource_id in (select public._selected_resources(p_client_id, 'bing'))
        group by page, query) t),
    'crawl', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.metric_date), '[]') from (
        select metric_date, sum(crawled_pages) crawled_pages, sum(crawl_errors) crawl_errors, sum(in_index) in_index,
          sum(in_links) in_links, sum(code_2xx) code_2xx, sum(code_301) code_301, sum(code_302) code_302, sum(code_4xx) code_4xx,
          sum(code_5xx) code_5xx, sum(all_other_codes) all_other_codes, sum(blocked_by_robots) blocked_by_robots,
          sum(dns_failures) dns_failures, sum(connection_timeout) connection_timeout, sum(contains_malware) contains_malware
        from public.bing_crawl_metrics
        where client_id = p_client_id and metric_date between p_start and p_end
          and resource_id in (select public._selected_resources(p_client_id, 'bing'))
        group by metric_date) c),
    'coverage', (
      select jsonb_build_object('first', min(metric_date), 'last', max(metric_date)) from public.bing_daily_metrics
      where client_id = p_client_id and resource_id in (select public._selected_resources(p_client_id, 'bing'))));
end $$;
revoke all on function public.get_bing_summary(uuid, date, date) from public, anon;
grant execute on function public.get_bing_summary(uuid, date, date) to authenticated, service_role;
