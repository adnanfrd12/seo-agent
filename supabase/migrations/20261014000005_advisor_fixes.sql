-- Fixes from the Supabase security/performance advisors.
alter function public.set_updated_at() set search_path = '';

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

create index if not exists sync_jobs_connection_idx on public.analytics_sync_jobs (connection_id);
create index if not exists sync_jobs_requested_by_idx on public.analytics_sync_jobs (requested_by);
create index if not exists integration_resources_connection_idx on public.integration_resources (connection_id);

-- Intentionally left as-is (documented):
--  * integration_secrets: RLS on, no policies => service role only.
--  * create_client / enqueue_sync_job / is_client_member / _assert_member are SECURITY DEFINER
--    and executable by `authenticated` by design; each authorizes via auth.uid().
