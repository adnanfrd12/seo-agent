-- Let trusted server jobs (service role) read dashboard RPCs, so scheduled AI analyses can be
-- generated without a signed-in user. Signed-in users are still checked for membership exactly
-- as before; anon is still refused.
create or replace function public._assert_member(p_client_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '') = 'service_role' then
    return;
  end if;
  if not public.is_client_member(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
