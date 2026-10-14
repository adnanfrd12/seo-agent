-- Sync queue functions.
--  * enqueue_sync_job : callable by signed-in members (Refresh / Sync Now buttons)
--  * everything else  : service_role only (the trusted sync worker / cron route)

create or replace function public.enqueue_sync_job(
  p_client_id uuid, p_provider text default null, p_job_type text default 'manual')
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_client_member(p_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_job_type not in ('manual', 'initial') then
    raise exception 'invalid job type' using errcode = '22023';
  end if;

  with ins as (
    insert into public.analytics_sync_jobs
      (client_id, connection_id, resource_id, provider, job_type, requested_by)
    select r.client_id, r.connection_id, r.id, r.provider, p_job_type, (select auth.uid())
    from public.integration_resources r
    join public.integration_connections c on c.id = r.connection_id
    where r.client_id = p_client_id and r.is_selected and c.status = 'connected'
      and (p_provider is null or r.provider = p_provider)
    on conflict (resource_id) where status in ('queued', 'running') do nothing
    returning 1)
  select count(*) into v_count from ins;
  return v_count;
end $$;
revoke all on function public.enqueue_sync_job(uuid, text, text) from public, anon;
grant execute on function public.enqueue_sync_job(uuid, text, text) to authenticated, service_role;

-- Called by the daily cron route.
create or replace function public.enqueue_daily_sync() returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with ins as (
    insert into public.analytics_sync_jobs (client_id, connection_id, resource_id, provider, job_type)
    select r.client_id, r.connection_id, r.id, r.provider, 'daily'
    from public.integration_resources r
    join public.integration_connections c on c.id = r.connection_id
    where r.is_selected and c.status = 'connected'
    on conflict (resource_id) where status in ('queued', 'running') do nothing
    returning 1)
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- Atomically claim one due job. SKIP LOCKED lets several workers run safely.
create or replace function public.claim_next_sync_job()
returns setof public.analytics_sync_jobs
language sql security definer set search_path = public as $$
  update public.analytics_sync_jobs j
     set status = 'running', started_at = now(), locked_at = now(), attempts = j.attempts + 1
   where j.id = (
     select id from public.analytics_sync_jobs
     where status = 'queued' and run_after <= now()
     order by run_after
     for update skip locked
     limit 1)
  returning j.*;
$$;

-- Jobs whose worker died (running longer than p_minutes) go back to the queue
-- or are failed once attempts are exhausted.
create or replace function public.requeue_stale_sync_jobs(p_minutes int default 15) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with u as (
    update public.analytics_sync_jobs
       set status = case when attempts < max_attempts then 'queued' else 'failed' end,
           error = coalesce(error, 'worker timed out'),
           finished_at = case when attempts < max_attempts then null else now() end
     where status = 'running' and locked_at < now() - make_interval(mins => p_minutes)
    returning 1)
  select count(*) into v_count from u;
  return v_count;
end $$;

-- outcome: succeeded | partial | retry | failed
-- 'retry' backs off exponentially (60s * 2^(attempt-1)) until max_attempts.
-- p_auth_error marks the connection as errored so the UI shows "Reconnect".
create or replace function public.finish_sync_job(
  p_job_id uuid, p_outcome text, p_error text default null,
  p_stats jsonb default '{}'::jsonb, p_auth_error boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare j public.analytics_sync_jobs;
begin
  select * into j from public.analytics_sync_jobs where id = p_job_id for update;
  if not found then return; end if;

  if p_outcome = 'retry' and j.attempts < j.max_attempts and not p_auth_error then
    update public.analytics_sync_jobs
       set status = 'queued', error = left(p_error, 2000), stats = p_stats, locked_at = null,
           run_after = now() + make_interval(secs => 60 * power(2, j.attempts - 1))
     where id = p_job_id;
    return;
  end if;

  update public.analytics_sync_jobs
     set status = case when p_outcome = 'retry' then 'failed' else p_outcome end,
         error = left(p_error, 2000), stats = p_stats, finished_at = now(), locked_at = null
   where id = p_job_id;

  if p_outcome in ('succeeded', 'partial') and j.connection_id is not null then
    update public.integration_connections
       set last_synced_at = now(), status = 'connected', last_error = null
     where id = j.connection_id;
  elsif p_auth_error and j.connection_id is not null then
    update public.integration_connections
       set status = 'error', last_error = left(coalesce(p_error, 'authorization failed'), 500)
     where id = j.connection_id;
  end if;
end $$;

revoke all on function public.enqueue_daily_sync() from public, anon, authenticated;
revoke all on function public.claim_next_sync_job() from public, anon, authenticated;
revoke all on function public.requeue_stale_sync_jobs(int) from public, anon, authenticated;
revoke all on function public.finish_sync_job(uuid, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_daily_sync() to service_role;
grant execute on function public.claim_next_sync_job() to service_role;
grant execute on function public.requeue_stale_sync_jobs(int) to service_role;
grant execute on function public.finish_sync_job(uuid, text, text, jsonb, boolean) to service_role;
