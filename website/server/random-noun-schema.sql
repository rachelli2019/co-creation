-- Apply once to the private study project. No existing records are removed.
begin;
alter table public.sessions add column if not exists condition text;
alter table public.sessions add column if not exists assigned_noun text;
alter table public.sessions add column if not exists noun_pool text;
alter table public.sessions add column if not exists writing_system_prompt text;
alter table public.sessions add column if not exists writing_prompt_version text;
alter table public.sessions add column if not exists writing_model text;
create unique index if not exists main_noun_unique on public.sessions(noun_pool,assigned_noun)
 where assigned_noun is not null and test_session = false;
create or replace function public.enroll_random_noun(
 p_id uuid, p_participant text, p_test boolean, p_submission text,
 p_pool text, p_override text, p_nouns text[], p_prompt text, p_version text, p_model text
) returns setof public.sessions language plpgsql security definer set search_path = public as $$
declare chosen text;
begin
 -- Serialize selection and enrollment within a pool, including simultaneous arrivals.
 perform pg_advisory_xact_lock(hashtextextended('noun:' || p_pool,0));
 if p_override is not null and (not p_test or not p_override = any(p_nouns)) then
  raise exception 'Invalid noun override';
 end if;
 if p_override is not null then chosen := p_override;
 else
  select n into chosen from unnest(p_nouns) n where not exists
   (select 1 from public.sessions s where s.noun_pool=p_pool and s.assigned_noun=n)
   order by random() limit 1;
  if chosen is null and p_test then select n into chosen from unnest(p_nouns) n order by random() limit 1; end if;
 end if;
 if chosen is null then raise exception 'Noun pool exhausted'; end if;
 insert into public.participants(prolific_id,group_key) values(p_participant,'AI-DIV');
 return query insert into public.sessions(id,prolific_id,group_key,ai_access,test_session,prolific_submission_id,expires_at,
 condition,assigned_noun,noun_pool,writing_system_prompt,writing_prompt_version,writing_model)
 values(p_id,p_participant,'AI-DIV','both',p_test,p_submission,now()+interval '2 hours',
 'random-noun',chosen,p_pool,replace(p_prompt,'{noun}',chosen),p_version,p_model) returning *;
end $$;
revoke all on function public.enroll_random_noun(uuid,text,boolean,text,text,text,text[],text,text,text) from public,anon,authenticated;
grant execute on function public.enroll_random_noun(uuid,text,boolean,text,text,text,text[],text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
