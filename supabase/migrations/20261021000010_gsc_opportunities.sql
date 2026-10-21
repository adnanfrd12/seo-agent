-- Search Console opportunity engine (deterministic; no AI).
-- Needs query x page pairs (web search), which the other GSC tables don't carry.
create table public.gsc_query_page_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_id uuid not null references public.integration_resources(id) on delete cascade,
  metric_date date not null,
  query text not null,
  page text not null,
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  position_x_impressions numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, metric_date, query, page)
);
create index gsc_qp_client_date_idx on public.gsc_query_page_metrics (client_id, metric_date);
create trigger gsc_query_page_metrics_set_updated_at before update on public.gsc_query_page_metrics
  for each row execute function public.set_updated_at();
alter table public.gsc_query_page_metrics enable row level security;
revoke all on public.gsc_query_page_metrics from anon;
revoke insert, update, delete, truncate on public.gsc_query_page_metrics from authenticated;
create policy gsc_query_page_metrics_select on public.gsc_query_page_metrics
  for select to authenticated using (public.is_client_member(client_id));

/*
  get_gsc_opportunities: compares the selected range with the equal-length period before it
  (and the same range a year earlier where stored). All rates are re-weighted from sums.
  Thresholds are parameters so they can be tuned; results are capped per section.

  Sections:
    declining_keywords  avg position worsened by >= p_min_pos_change, with impressions in both periods
    improving_keywords  avg position improved by >= p_min_pos_change
    decaying_pages      clicks fell by >= p_decay_pct with >= p_min_clicks previously
    new_queries         queries with impressions now and none in the previous period, split into
                        newly observed vs newly clicked (only "new within stored GSC history")
    cannibalization     queries where 2+ pages each take >= 10% of the query's impressions
    quick_wins          positions 4-20 with impressions; score = impressions x (target_ctr - ctr),
                        target_ctr = 10% (an explicit, documented assumption, not a forecast)
*/
create or replace function public.get_gsc_opportunities(
  p_client_id uuid, p_start date, p_end date,
  p_min_impressions int default 10, p_min_pos_change numeric default 1,
  p_min_clicks int default 3, p_decay_pct numeric default 20, p_limit int default 25)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_len int := p_end - p_start + 1;
  v_ps date := p_start - (p_end - p_start + 1);
  v_pe date := p_start - 1;
  v_out jsonb;
begin
  perform public._assert_member(p_client_id);

  with res as (select public._selected_resources(p_client_id, 'gsc') as id),
  q as (
    select t.query,
      sum(t.clicks) filter (where t.metric_date >= p_start) as c_clicks,
      sum(t.impressions) filter (where t.metric_date >= p_start) as c_impr,
      sum(t.position_x_impressions) filter (where t.metric_date >= p_start) as c_pxi,
      sum(t.clicks) filter (where t.metric_date < p_start) as p_clicks,
      sum(t.impressions) filter (where t.metric_date < p_start) as p_impr,
      sum(t.position_x_impressions) filter (where t.metric_date < p_start) as p_pxi
    from public.gsc_query_metrics t
    where t.client_id = p_client_id and t.search_type = 'web'
      and t.metric_date between v_ps and p_end and t.resource_id in (select id from res)
    group by t.query
  ),
  qx as (
    select query, coalesce(c_clicks, 0) c_clicks, coalesce(c_impr, 0) c_impr, coalesce(p_clicks, 0) p_clicks, coalesce(p_impr, 0) p_impr,
      c_pxi / nullif(c_impr, 0) c_pos, p_pxi / nullif(p_impr, 0) p_pos,
      coalesce(c_clicks, 0)::numeric / nullif(c_impr, 0) c_ctr
    from q
  ),
  -- the page that earned most of a query's impressions this period (from query x page data)
  top_page as (
    select distinct on (query) query, page from (
      select query, page, sum(impressions) impr from public.gsc_query_page_metrics
      where client_id = p_client_id and metric_date between p_start and p_end and resource_id in (select id from res)
      group by 1, 2) z
    order by query, impr desc
  ),
  pg as (
    select t.page,
      coalesce(sum(t.clicks) filter (where t.metric_date >= p_start), 0) c_clicks,
      coalesce(sum(t.impressions) filter (where t.metric_date >= p_start), 0) c_impr,
      sum(t.position_x_impressions) filter (where t.metric_date >= p_start) c_pxi,
      coalesce(sum(t.clicks) filter (where t.metric_date < p_start), 0) p_clicks,
      coalesce(sum(t.impressions) filter (where t.metric_date < p_start), 0) p_impr,
      sum(t.position_x_impressions) filter (where t.metric_date < p_start) p_pxi
    from public.gsc_page_metrics t
    where t.client_id = p_client_id and t.search_type = 'web'
      and t.metric_date between v_ps and p_end and t.resource_id in (select id from res)
    group by t.page
  ),
  pg_yoy as (
    select t.page, sum(t.clicks) y_clicks from public.gsc_page_metrics t
    where t.client_id = p_client_id and t.search_type = 'web'
      and t.metric_date between (p_start - interval '1 year')::date and (p_end - interval '1 year')::date
      and t.resource_id in (select id from res)
    group by t.page
  ),
  qp as (
    select query, page, sum(clicks) clicks, sum(impressions) impr, sum(position_x_impressions) / nullif(sum(impressions), 0) pos
    from public.gsc_query_page_metrics
    where client_id = p_client_id and metric_date between p_start and p_end and resource_id in (select id from res)
    group by 1, 2
  ),
  qp_share as (
    select qp.*, impr::numeric / nullif(sum(impr) over (partition by query), 0) share,
           sum(impr) over (partition by query) q_impr
    from qp
  ),
  cannibal as (
    select query, max(q_impr) q_impr, count(*) pages,
      jsonb_agg(jsonb_build_object('page', page, 'clicks', clicks, 'impressions', impr, 'position', round(pos, 1), 'share', round(share, 3)) order by impr desc) detail
    from qp_share where share >= 0.10
    group by query having count(*) >= 2 and max(q_impr) >= p_min_impressions
  )
  select jsonb_build_object(
    'periods', jsonb_build_object('current', jsonb_build_object('start', p_start, 'end', p_end),
                                  'previous', jsonb_build_object('start', v_ps, 'end', v_pe)),
    'thresholds', jsonb_build_object('min_impressions', p_min_impressions, 'min_position_change', p_min_pos_change,
                                     'min_clicks', p_min_clicks, 'decay_pct', p_decay_pct, 'quick_win_target_ctr', 0.10),
    'declining_keywords', (select coalesce(jsonb_agg(x order by (x->>'position_change')::numeric desc), '[]') from (
        select jsonb_build_object('query', qx.query, 'page', tp.page, 'previous_position', round(p_pos, 1), 'current_position', round(c_pos, 1),
          'position_change', round(c_pos - p_pos, 1), 'clicks_change', c_clicks - p_clicks, 'impressions_change', c_impr - p_impr,
          'clicks', c_clicks, 'impressions', c_impr) x
        from qx left join top_page tp using (query)
        where c_impr >= p_min_impressions and p_impr >= p_min_impressions and c_pos - p_pos >= p_min_pos_change
        order by c_pos - p_pos desc limit p_limit) s),
    'improving_keywords', (select coalesce(jsonb_agg(x order by (x->>'position_change')::numeric desc), '[]') from (
        select jsonb_build_object('query', qx.query, 'page', tp.page, 'previous_position', round(p_pos, 1), 'current_position', round(c_pos, 1),
          'position_change', round(p_pos - c_pos, 1), 'clicks', c_clicks, 'impressions', c_impr) x
        from qx left join top_page tp using (query)
        where c_impr >= p_min_impressions and p_impr >= p_min_impressions and p_pos - c_pos >= p_min_pos_change
        order by p_pos - c_pos desc limit p_limit) s),
    'decaying_pages', (select coalesce(jsonb_agg(x order by (x->>'clicks_change_pct')::numeric), '[]') from (
        select jsonb_build_object('page', pg.page, 'previous_clicks', p_clicks, 'current_clicks', c_clicks,
          'clicks_change_pct', round((c_clicks - p_clicks)::numeric / nullif(p_clicks, 0) * 100, 1),
          'previous_impressions', p_impr, 'current_impressions', c_impr,
          'previous_ctr', round(p_clicks::numeric / nullif(p_impr, 0), 4), 'current_ctr', round(c_clicks::numeric / nullif(c_impr, 0), 4),
          'previous_position', round(p_pxi / nullif(p_impr, 0), 1), 'current_position', round(c_pxi / nullif(c_impr, 0), 1),
          'same_period_last_year_clicks', y.y_clicks) x
        from pg left join pg_yoy y using (page)
        where p_clicks >= p_min_clicks and (c_clicks - p_clicks)::numeric / nullif(p_clicks, 0) * 100 <= -p_decay_pct
        order by (c_clicks - p_clicks)::numeric / nullif(p_clicks, 0) limit p_limit) s),
    'new_queries', (select coalesce(jsonb_agg(x order by (x->>'impressions')::numeric desc), '[]') from (
        select jsonb_build_object('query', qx.query, 'page', tp.page, 'impressions', c_impr, 'clicks', c_clicks,
          'position', round(c_pos, 1), 'kind', case when c_clicks > 0 then 'newly_clicked' else 'newly_observed' end) x
        from qx left join top_page tp using (query)
        where c_impr > 0 and p_impr = 0
        order by c_impr desc limit p_limit) s),
    'newly_clicked_queries', (select count(*) from qx where c_clicks > 0 and p_clicks = 0),
    'cannibalization', (select coalesce(jsonb_agg(jsonb_build_object('query', query, 'impressions', q_impr, 'pages', pages, 'detail', detail)
        order by q_impr desc), '[]') from (select * from cannibal order by q_impr desc limit p_limit) s),
    'quick_wins', (select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc), '[]') from (
        select jsonb_build_object('query', qx.query, 'page', tp.page, 'impressions', c_impr, 'clicks', c_clicks,
          'ctr', round(c_ctr, 4), 'position', round(c_pos, 1),
          'score', round(c_impr * greatest(0, 0.10 - coalesce(c_ctr, 0)), 1)) x
        from qx left join top_page tp using (query)
        where c_impr >= p_min_impressions and c_pos between 4 and 20
        order by c_impr * greatest(0, 0.10 - coalesce(c_ctr, 0)) desc limit p_limit) s),
    'has_query_page_data', exists (select 1 from public.gsc_query_page_metrics where client_id = p_client_id limit 1)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.get_gsc_opportunities(uuid, date, date, int, numeric, int, numeric, int) from public, anon;
grant execute on function public.get_gsc_opportunities(uuid, date, date, int, numeric, int, numeric, int) to authenticated, service_role;
