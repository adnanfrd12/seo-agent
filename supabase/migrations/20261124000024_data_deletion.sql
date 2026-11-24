-- Data deletion requests (Meta/TikTok notifications, Disconnect, revocation detection, email requests)
-- and an ID-only audit log of every deletion. Service role only: RLS on, no policies.
-- Until this migration is applied the app stores the same records as JSON in the private
-- Storage bucket "compliance" (src/lib/compliance/store.ts).

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  platform_user_id text,
  workspace_id uuid references public.clients(id) on delete set null,
  source text not null check (source in ('dashboard', 'platform_webhook', 'revocation_detected', 'email')),
  confirmation_code text not null unique check (confirmation_code ~ '^[A-Za-z0-9_-]{10,12}$'),
  status text not null default 'received' check (status in ('received', 'completed', 'not_found')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists data_deletion_requests_platform_user_idx on public.data_deletion_requests (platform, platform_user_id);
alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from anon, authenticated;

create table if not exists public.data_deletion_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('connection_deleted', 'workspace_deleted', 'notification_received')),
  platform text not null,
  reason text not null,
  connection_ref text,
  workspace_id uuid,          -- no FK: the log outlives the workspace it records
  platform_user_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists data_deletion_log_at_idx on public.data_deletion_log (at desc);
alter table public.data_deletion_log enable row level security;
revoke all on public.data_deletion_log from anon, authenticated;

comment on table public.data_deletion_requests is 'One row per deletion request; confirmation_code is shown on /data-deletion/status';
