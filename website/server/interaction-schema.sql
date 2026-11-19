begin;
create table public.interaction_events (
 event_id uuid primary key,
 session_id uuid not null references public.sessions(id),
 stream_id uuid not null, sequence bigint not null check(sequence>0),
 client_at timestamptz not null, elapsed_ms double precision not null,
 received_at timestamptz not null default now(),
 phase text not null check(phase in ('rough','final')),
 type text not null, target text not null, payload jsonb not null default '{}',
 version integer not null default 1,
 unique(session_id,stream_id,sequence)
);
create index interaction_events_timeline on public.interaction_events(session_id,client_at);
alter table public.interaction_events enable row level security;
revoke all on public.interaction_events from anon,authenticated;
grant all on public.interaction_events to service_role;
alter table public.snapshots add column client_at timestamptz;
alter table public.snapshots add column writing_phase text check(writing_phase in ('rough','final'));
alter table public.ai_requests add column response_at timestamptz;
notify pgrst,'reload schema';
commit;
