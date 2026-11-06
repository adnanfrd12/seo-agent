-- Blog content: every post on the client's website (WordPress REST API, or the sitemap when the site
-- isn't WordPress) with what a local-SEO blog review needs: featured image, word count, dates, geo
-- targeting (neighbourhood, ZIP, road crossings, landmarks), map link / Maps CID, internal links and
-- the service page each post supports. Written by the sync worker (service role); read by members.
-- Additive only; safe to run more than once.

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null default 'wordpress' check (source in ('wordpress', 'sitemap')),
  external_id text,                          -- WordPress post id
  url text not null,
  slug text,
  title text not null default '',
  excerpt text,
  published_at timestamptz,
  published_date date,                       -- in the site's own time zone: "released this month"
  modified_at timestamptz,
  categories text[] not null default '{}',
  tags text[] not null default '{}',
  featured_image jsonb,                      -- {url, alt, width, height}
  word_count int not null default 0,
  links jsonb not null default '[]',         -- [{url, path, anchor, internal, kind}] in content order
  internal_links int not null default 0,
  external_links int not null default 0,
  target_service jsonb,                      -- the service page the post links to: {url, title, anchor}
  suggested_service jsonb,                   -- best-matching service page by topic: {url, title, score}
  map jsonb,                                 -- {cid, matches_profile, embed, place_name, zip, lat, lng, feature_ids, cid_anchor}
  geo jsonb,                                 -- {neighborhood, city, zip, lat, lng, road_crossings, landmarks, neighborhoods}
  keywords jsonb,                            -- {target, secondary} read from the post
  content_hash text,
  geo_hash text,                             -- content_hash the geo/keywords were read from
  geo_cost numeric not null default 0,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, url)
);
create index if not exists blog_posts_client_date_idx on public.blog_posts (client_id, published_date desc);
drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at before update on public.blog_posts
  for each row execute function public.set_updated_at();
alter table public.blog_posts enable row level security;
revoke all on public.blog_posts from anon;
revoke insert, update, delete, truncate on public.blog_posts from authenticated;
drop policy if exists blog_posts_select on public.blog_posts;
create policy blog_posts_select on public.blog_posts
  for select to authenticated using (public.is_client_member(client_id));

-- Search Console and GA4 results per blog post for a period, keyed by path ("/my-post", no trailing
-- slash). GSC rows are full URLs and GA4 rows are paths, so both are reduced to the same form.
create or replace function public.get_blog_performance(p_client_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform public._assert_member(p_client_id);
  return (
    with posts as (
      select distinct rtrim(split_part(split_part(regexp_replace(url, '^https?://[^/]+', ''), '?', 1), '#', 1), '/') as path
      from public.blog_posts where client_id = p_client_id
    ),
    q as (
      select rtrim(split_part(split_part(regexp_replace(t.page, '^https?://[^/]+', ''), '?', 1), '#', 1), '/') as path,
             t.query, sum(t.clicks) as clicks, sum(t.impressions) as impressions, sum(t.position_x_impressions) as pxi
      from public.gsc_query_page_metrics t
      where t.client_id = p_client_id and t.metric_date between p_start and p_end
        and t.resource_id in (select public._selected_resources(p_client_id, 'gsc'))
      group by 1, 2
    ),
    qp as (select q.* from q join posts using (path)),
    ranked as (
      select qp.*, row_number() over (partition by path order by impressions desc, clicks desc, query) as rn from qp
    ),
    g as (
      select path, sum(clicks) as clicks, sum(impressions) as impressions, sum(pxi) as pxi, count(*) as queries
      from qp group by path
    ),
    a as (
      select rtrim(split_part(t.page_path, '?', 1), '/') as path,
             sum(t.views) filter (where not t.is_landing) as views,
             sum(t.users) filter (where not t.is_landing) as users,
             sum(t.sessions) filter (where t.is_landing) as sessions,
             sum(t.key_events) filter (where t.is_landing) as key_events
      from public.ga4_page_metrics t
      where t.client_id = p_client_id and t.metric_date between p_start and p_end
        and t.resource_id in (select public._selected_resources(p_client_id, 'ga4'))
      group by 1
    )
    select coalesce(jsonb_object_agg(p.path, jsonb_build_object(
      'clicks', coalesce(g.clicks, 0), 'impressions', coalesce(g.impressions, 0),
      'ctr', case when g.impressions > 0 then g.clicks::numeric / g.impressions end,
      'position', case when g.impressions > 0 then g.pxi / g.impressions end,
      'queries', coalesce(g.queries, 0),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('query', r.query, 'clicks', r.clicks, 'impressions', r.impressions,
                'position', case when r.impressions > 0 then r.pxi / r.impressions end) order by r.rn), '[]'::jsonb)
              from ranked r where r.path = p.path and r.rn <= 5),
      'views', coalesce(a.views, 0), 'users', coalesce(a.users, 0), 'sessions', coalesce(a.sessions, 0), 'key_events', coalesce(a.key_events, 0)
    )), '{}'::jsonb)
    from posts p left join g using (path) left join a using (path)
  );
end $$;
revoke all on function public.get_blog_performance(uuid, date, date) from public, anon;
grant execute on function public.get_blog_performance(uuid, date, date) to authenticated, service_role;
