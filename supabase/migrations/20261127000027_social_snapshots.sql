-- Daily snapshots of every social account the dashboard reads (connected, token or public), so day-to-day
-- gains can be charted even where a platform's API only returns current or lifetime totals (e.g. TikTok's
-- user.info.stats and video.list). One account row and one row per returned post/video per day; a later read on
-- the same day replaces that day's values. Written by the server (service role); members read their client's rows.

create table if not exists public.social_account_snapshots (
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null,
  day date not null,
  account text,               -- handle or id the numbers belong to (a different account starts a new series)
  followers bigint,
  following bigint,
  likes bigint,               -- lifetime likes the account has received (where the platform reports it)
  posts bigint,               -- posts / videos / pins on the account
  views bigint,               -- lifetime views (where reported)
  captured_at timestamptz not null default now(),
  primary key (client_id, platform, day)
);

create table if not exists public.social_post_snapshots (
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null,
  day date not null,
  post_id text not null,
  title text,
  url text,
  published date,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  primary key (client_id, platform, day, post_id)
);
create index if not exists social_post_snapshots_post_idx on public.social_post_snapshots (client_id, platform, post_id, day);

do $$
declare t text;
begin
  foreach t in array array['social_account_snapshots', 'social_post_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;
