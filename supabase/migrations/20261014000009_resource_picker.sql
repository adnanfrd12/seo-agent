-- Property/site selector. Every dashboard RPC reads its data through _selected_resources(), so
-- narrowing it narrows everything. The app sends the chosen resource in a request header
-- (x-resource-ga4 / x-resource-gsc / x-resource-gbp), which PostgREST exposes as
-- request.headers. The header can only NARROW to a resource that is already selected for the
-- same client, so it cannot widen access. No header (e.g. the sync worker) = all selected.
create or replace function public._selected_resources(p_client_id uuid, p_provider text)
returns setof uuid language plpgsql stable set search_path = public as $$
declare v_pick text;
begin
  begin
    v_pick := current_setting('request.headers', true)::json ->> ('x-resource-' || p_provider);
  exception when others then
    v_pick := null;
  end;
  if v_pick ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return query
      select id from public.integration_resources
      where client_id = p_client_id and provider = p_provider and is_selected and id = v_pick::uuid;
  else
    return query
      select id from public.integration_resources
      where client_id = p_client_id and provider = p_provider and is_selected;
  end if;
end $$;
