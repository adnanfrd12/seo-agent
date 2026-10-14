-- User profiles (name + avatar), avatar storage, and team management helpers.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  avatar_url text check (char_length(avatar_url) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;

-- you can read your own profile and profiles of people who share a client with you
create policy profiles_select on public.profiles for select to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.client_members a
    join public.client_members b on a.client_id = b.client_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.user_id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.profiles to authenticated;

-- Avatars: public-read images; each user may only write inside the folder named after their id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Team list with emails (auth.users is not readable by clients, hence security definer + membership check).
create or replace function public.get_client_members(p_client_id uuid)
returns table (user_id uuid, email text, full_name text, avatar_url text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_client_member(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, p.full_name, p.avatar_url, m.role, m.created_at
    from public.client_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.client_id = p_client_id
    order by m.created_at;
end $$;
revoke all on function public.get_client_members(uuid) from public, anon;
grant execute on function public.get_client_members(uuid) to authenticated;

-- Service-role only: look up an existing account so an admin can add it to a client.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
