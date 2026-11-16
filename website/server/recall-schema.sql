-- Apply once in the Supabase SQL editor before running live recall generation.
create table public.recall_generations (
  id uuid primary key,
  session_id uuid not null unique references public.sessions(id),
  story text not null,
  status text not null check (status in ('pending', 'ready', 'failed')),
  simulated boolean not null default false,
  questions jsonb,
  model text,
  prompt text,
  "promptVersion" text,
  responses jsonb,
  created_at timestamptz not null default now()
);
alter table public.recall_generations enable row level security;
-- No browser policies: only the server's service role may read answer keys or write records.
revoke all on public.recall_generations from anon, authenticated;
grant all on public.recall_generations to service_role;

-- Separate, immutable stage submissions; retries do not overwrite the first save.
create table public.study_records (
  session_id uuid not null references public.sessions(id),
  kind text not null check (kind in ('rough_draft', 'survey')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, kind)
);
alter table public.study_records enable row level security;
revoke all on public.study_records from anon, authenticated;
grant all on public.study_records to service_role;
