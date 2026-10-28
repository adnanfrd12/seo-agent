-- Rank tracking (Google positions for chosen keywords) and AI visibility (does an AI assistant
-- mention or cite the brand when asked the questions customers ask). Safe to run more than once.

-- ------------------------------------------------------------ rank tracking
create table if not exists public.rank_keywords (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword text not null check (char_length(keyword) between 2 and 120),
  device text not null default 'desktop' check (device in ('desktop', 'mobile')),
  location_code int not null default 2840,
  language_code text not null default 'en',
  created_at timestamptz not null default now(),
  unique (client_id, keyword, device, location_code)
);
create index if not exists rank_keywords_client_idx on public.rank_keywords (client_id);

create table if not exists public.rank_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword_id uuid not null references public.rank_keywords(id) on delete cascade,
  checked_on date not null,
  -- null = the site was not found within `depth` results
  position int,
  url text,
  depth int not null default 30,
  -- the top 10 results at the time (domain, url, title), for context and competitor comparison
  top jsonb not null default '[]'::jsonb,
  cost numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (keyword_id, checked_on)
);
create index if not exists rank_checks_client_idx on public.rank_checks (client_id, checked_on desc);

-- ------------------------------------------------------------ AI visibility
create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 8 and 300),
  created_at timestamptz not null default now(),
  unique (client_id, prompt)
);
create index if not exists ai_prompts_client_idx on public.ai_prompts (client_id);

create table if not exists public.ai_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  prompt_id uuid not null references public.ai_prompts(id) on delete cascade,
  checked_on date not null,
  model text not null,
  used_search boolean not null default false,
  -- the brand or website is named in the answer text
  mentioned boolean not null default false,
  -- the website is among the sources the answer cites
  cited boolean not null default false,
  -- the website appeared in the search results the model read (even if not cited)
  seen boolean not null default false,
  -- sources cited by the answer: [{domain, url, title}]
  sources jsonb not null default '[]'::jsonb,
  -- other businesses named in the answer
  competitors jsonb not null default '[]'::jsonb,
  answer text,
  cost numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (prompt_id, checked_on)
);
create index if not exists ai_checks_client_idx on public.ai_checks (client_id, checked_on desc);

-- members read; every write goes through the server after an owner/admin check
do $$
declare t text;
begin
  foreach t in array array['rank_keywords', 'rank_checks', 'ai_prompts', 'ai_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_client_member(client_id))', t || '_select', t);
  end loop;
end $$;
