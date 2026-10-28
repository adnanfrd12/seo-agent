-- GA4 city / new-vs-returning breakdowns and a branded vs non-branded Search Console split.
-- Safe to run more than once.

-- 1. the GA4 dimension table accepts two more breakdowns
alter table public.ga4_dimension_metrics drop constraint if exists ga4_dimension_metrics_dimension_check;
alter table public.ga4_dimension_metrics add constraint ga4_dimension_metrics_dimension_check
  check (dimension in ('device', 'country', 'key_event', 'city', 'user_type'));

-- 2. read access for any of the breakdowns (members only; scoped to the selected GA4 property)
create or replace function public.get_ga4_dimension(p_client_id uuid, p_start date, p_end date, p_dim text, p_limit int default 15)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  if p_dim not in ('device', 'country', 'key_event', 'city', 'user_type') then
    raise exception 'unknown dimension' using errcode = '22023';
  end if;
  return public._ga4_dim(p_client_id, p_start, p_end, p_dim, least(greatest(p_limit, 1), 100));
end $$;
revoke all on function public.get_ga4_dimension(uuid, date, date, text, int) from public, anon;
grant execute on function public.get_ga4_dimension(uuid, date, date, text, int) to authenticated, service_role;

-- 3. branded vs non-branded split of query-level Search Console data.
--    p_terms are brand words with spaces removed and lower-cased; a query is "branded" when it contains
--    any of them once its own spaces are removed too. Only queries Google reports are included (it hides
--    rare "anonymised" queries), so shares describe the visible queries, not every click.
create or replace function public.get_gsc_brand_split(p_client_id uuid, p_start date, p_end date, p_terms text[])
returns jsonb language plpgsql stable set search_path = public as $$
declare v jsonb;
begin
  perform public._assert_member(p_client_id);
  if coalesce(array_length(p_terms, 1), 0) = 0 then
    return jsonb_build_object('has_data', false);
  end if;
  with q as (
    select query, sum(clicks) as clicks, sum(impressions) as impressions, sum(position_x_impressions) as pxi,
      exists (select 1 from unnest(p_terms) t where t <> '' and replace(lower(query), ' ', '') like '%' || t || '%') as branded
    from public.gsc_query_metrics
    where client_id = p_client_id and metric_date between p_start and p_end and search_type = 'web'
      and resource_id in (select public._selected_resources(p_client_id, 'gsc'))
    group by query)
  select jsonb_build_object(
    'has_data', count(*) > 0,
    'branded', jsonb_build_object('queries', count(*) filter (where branded), 'clicks', coalesce(sum(clicks) filter (where branded), 0),
      'impressions', coalesce(sum(impressions) filter (where branded), 0),
      'position', sum(pxi) filter (where branded) / nullif(sum(impressions) filter (where branded), 0)),
    'non_branded', jsonb_build_object('queries', count(*) filter (where not branded), 'clicks', coalesce(sum(clicks) filter (where not branded), 0),
      'impressions', coalesce(sum(impressions) filter (where not branded), 0),
      'position', sum(pxi) filter (where not branded) / nullif(sum(impressions) filter (where not branded), 0)),
    'top_branded', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (select query, clicks, impressions from q where branded order by clicks desc, impressions desc limit 8) t),
    'top_non_branded', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (select query, clicks, impressions from q where not branded order by clicks desc, impressions desc limit 8) t))
  into v from q;
  return coalesce(v, jsonb_build_object('has_data', false));
end $$;
revoke all on function public.get_gsc_brand_split(uuid, date, date, text[]) from public, anon;
grant execute on function public.get_gsc_brand_split(uuid, date, date, text[]) to authenticated, service_role;
