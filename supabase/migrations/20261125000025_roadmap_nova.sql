-- AI SEO Roadmap (month-by-month strategy with categorised tasks), its change history, and Nova (the AI SEO
-- strategist chat): conversations, messages and actions waiting for the user's confirmation.
--
-- Same access model as the rest of the dashboard: members of a client can read; every write goes through the
-- server (service role) after the app has checked the user's role, so there are no insert/update policies.

-- ------------------------------------------------------------ roadmap months
create table if not exists public.roadmap_months (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month date not null check (extract(day from month) = 1),       -- first day of the month
  summary text not null default '',
  objectives jsonb not null default '[]'::jsonb,                  -- [{ title, detail, metric }]
  priorities jsonb not null default '[]'::jsonb,                  -- [string]
  expected_outcomes jsonb not null default '[]'::jsonb,           -- [string]
  focus text,                                                     -- optional steer, e.g. "more backlinks and local SEO"
  sources jsonb not null default '[]'::jsonb,                     -- data sources the strategy was built from
  generated_by text not null default 'manual' check (generated_by in ('ai', 'schedule', 'nova', 'manual')),
  model text,
  cost_usd numeric(10, 4) not null default 0,
  generated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, month)
);
create index if not exists roadmap_months_client_idx on public.roadmap_months (client_id, month desc);

-- ------------------------------------------------------------ roadmap tasks
create table if not exists public.roadmap_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month_id uuid not null references public.roadmap_months(id) on delete cascade,
  category text not null check (category in (
    'on_page', 'technical', 'off_page', 'content', 'local', 'social', 'keywords', 'cro', 'ai_visibility', 'other')),
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  why text not null default '',                                   -- why it matters, from the client's data
  evidence jsonb not null default '[]'::jsonb,                    -- [{ ref, source, label, value }] copied from the evidence package
  steps jsonb not null default '[]'::jsonb,                       -- [string]
  urls jsonb not null default '[]'::jsonb,                        -- [string] affected pages
  keywords jsonb not null default '[]'::jsonb,                    -- [string]
  subtasks jsonb not null default '[]'::jsonb,                    -- [{ id, text, done }]
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  impact text not null default 'medium' check (impact in ('high', 'medium', 'low')),
  effort text not null default 'medium' check (effort in ('small', 'medium', 'large')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'skipped')),
  due_date date,
  source text not null default 'manual' check (source in ('ai', 'manual', 'nova')),
  dedupe_key text not null,                                       -- normalised category + title, to avoid duplicates
  sort int not null default 0,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists roadmap_tasks_month_idx on public.roadmap_tasks (month_id, category, sort);
create index if not exists roadmap_tasks_client_idx on public.roadmap_tasks (client_id, status);
create unique index if not exists roadmap_tasks_dedupe_idx on public.roadmap_tasks (month_id, dedupe_key);

-- ------------------------------------------------------------ change history (manual and AI changes)
create table if not exists public.roadmap_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month_id uuid references public.roadmap_months(id) on delete set null,
  task_id uuid,                                                   -- kept after the task is deleted
  actor text not null check (actor in ('user', 'nova', 'schedule')),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,                                           -- e.g. task.add, task.update, task.complete, task.delete, month.generate, month.update
  summary text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists roadmap_changes_client_idx on public.roadmap_changes (client_id, created_at desc);

-- ------------------------------------------------------------ Nova conversations (per client and user)
create table if not exists public.nova_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nova_conversations_user_idx on public.nova_conversations (client_id, user_id, updated_at desc);

create table if not exists public.nova_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nova_conversations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  actions jsonb not null default '[]'::jsonb,                     -- tools Nova used: [{ tool, ok, summary, detail }]
  cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists nova_messages_conversation_idx on public.nova_messages (conversation_id, created_at);

-- destructive or strategy-replacing actions wait here until the user presses Confirm in the chat
create table if not exists public.nova_pending_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.nova_conversations(id) on delete cascade,
  tool text not null,
  input jsonb not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled', 'failed')),
  result text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists nova_pending_user_idx on public.nova_pending_actions (client_id, user_id, status);

-- ------------------------------------------------------------ updated_at
drop trigger if exists roadmap_months_set_updated_at on public.roadmap_months;
create trigger roadmap_months_set_updated_at before update on public.roadmap_months for each row execute function public.set_updated_at();
drop trigger if exists roadmap_tasks_set_updated_at on public.roadmap_tasks;
create trigger roadmap_tasks_set_updated_at before update on public.roadmap_tasks for each row execute function public.set_updated_at();
drop trigger if exists nova_conversations_set_updated_at on public.nova_conversations;
create trigger nova_conversations_set_updated_at before update on public.nova_conversations for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ row level security
do $$
declare t text;
begin
  -- roadmap: every member of the client can read
  foreach t in array array['roadmap_months', 'roadmap_tasks', 'roadmap_changes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
  -- Nova: only the user's own conversations, and only while they are still a member of the client
  foreach t in array array['nova_conversations', 'nova_messages', 'nova_pending_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;
