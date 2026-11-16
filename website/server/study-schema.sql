-- New private study project only. No participant Supabase accounts or browser access.
begin;
create table public.participants (
 prolific_id text primary key, group_key text not null,
 is_banned boolean not null default false, created_at timestamptz not null default now()
);
create table public.sessions (
 id uuid primary key, prolific_id text not null unique references public.participants(prolific_id),
 group_key text not null, ai_access text not null check(ai_access in ('rough','final','both','neither')),
 test_session boolean not null default false, prolific_submission_id text,
 started_at timestamptz not null default now(), finished_at timestamptz,
 expires_at timestamptz not null, revoked boolean not null default false,
 rough_started_at timestamptz, final_started_at timestamptz
);
create table public.snapshots (
 id bigint generated always as identity primary key, session_id uuid not null references public.sessions(id),
 timestamp timestamptz not null default now(), phase text not null check(phase in ('brainstorm','writing')),
 textbox text not null check(textbox in ('main','chat')), text text not null
);
create index snapshots_session_time on public.snapshots(session_id,timestamp);
create table public.submissions (
 session_id uuid primary key references public.sessions(id), brainstorm_text text not null,
 final_text text not null, word_count integer not null, attention_meta jsonb,
 survey_responses jsonb, ai_transcript jsonb, created_at timestamptz not null default now()
);
create table public.ai_requests (
 session_id uuid not null references public.sessions(id), request_number integer not null check(request_number between 1 and 15),
 phase text not null check(phase in ('rough','final')), prompt text not null, response text,
 created_at timestamptz not null default now(), primary key(session_id,request_number)
);
alter table public.participants enable row level security;
alter table public.sessions enable row level security;
alter table public.snapshots enable row level security;
alter table public.submissions enable row level security;
alter table public.ai_requests enable row level security;
revoke all on public.participants,public.sessions,public.snapshots,public.submissions,public.ai_requests from anon,authenticated;
grant all on public.participants,public.sessions,public.snapshots,public.submissions,public.ai_requests to service_role;
revoke all on sequence public.snapshots_id_seq from anon,authenticated;
grant usage on sequence public.snapshots_id_seq to service_role;
commit;
