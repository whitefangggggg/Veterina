-- Provider-neutral RAG foundation. No vector dimension is guessed: run the
-- generated hybrid migration only after choosing the embedding model.
create extension if not exists vector with schema extensions;
create table public.kb_documents (
  id uuid primary key default gen_random_uuid(), title text not null,
  kind text not null default 'sop' check(kind in ('sop','protocol','formulary','script','other')),
  status text not null default 'draft' check(status in ('draft','published','archived')),
  version integer not null default 1 check(version>0), storage_path text unique,
  content text not null check(length(content) between 1 and 100000),
  uploaded_by uuid not null references public.profiles(id), published_by uuid references public.profiles(id),
  published_at timestamptz, created_at timestamptz not null default now()
);
create table public.rag_chunks (
  id uuid primary key default gen_random_uuid(), source_type text not null check(source_type in ('visit','vaccination','alert','kb_document')),
  source_id uuid not null, patient_id uuid references public.pets(id), document_id uuid references public.kb_documents(id),
  chunk_index integer not null check(chunk_index>=0), content text not null, content_hash text not null,
  metadata jsonb not null default '{}', embedding_model text, embedding_version integer,
  fts tsvector generated always as (to_tsvector('simple',content)) stored,
  updated_at timestamptz not null default now(), unique(source_type,source_id,chunk_index),
  check((source_type='kb_document' and document_id=source_id and patient_id is null) or
    (source_type<>'kb_document' and patient_id is not null and document_id is null))
);
create index rag_chunks_patient_idx on public.rag_chunks(patient_id);
create index rag_chunks_document_idx on public.rag_chunks(document_id);
create index rag_chunks_fts_idx on public.rag_chunks using gin(fts);
create table public.rag_jobs (
  id bigint generated always as identity primary key, source_type text not null, source_id uuid not null,
  op text not null default 'upsert' check(op in ('upsert','delete')),
  status text not null default 'queued' check(status in ('queued','running','done','failed','dead')),
  attempts integer not null default 0, last_error text, run_after timestamptz not null default now(),
  lease_token uuid, locked_at timestamptz, created_at timestamptz not null default now()
);
create index rag_jobs_pending_idx on public.rag_jobs(run_after,id) where status in ('queued','failed','running');
create index rag_jobs_source_idx on public.rag_jobs(source_type,source_id);
create table public.ai_interactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
  mode text not null check(mode in ('patient','knowledge')), patient_id uuid references public.pets(id),
  model text, retrieved_chunk_ids uuid[] not null default '{}', latency_ms integer,
  outcome text not null default 'started' check(outcome in ('started','answered','insufficient_evidence','declined','error')),
  feedback smallint check(feedback in (-1,0,1)), feedback_reason text,
  created_at timestamptz not null default now(),
  check((mode='patient' and patient_id is not null) or (mode='knowledge' and patient_id is null))
);
create index ai_interactions_user_date_idx on public.ai_interactions(user_id,created_at);
create index ai_interactions_patient_idx on public.ai_interactions(patient_id);
create index kb_documents_uploader_idx on public.kb_documents(uploaded_by);
create index kb_documents_publisher_idx on public.kb_documents(published_by);

alter table public.kb_documents enable row level security;
alter table public.rag_chunks enable row level security;
alter table public.rag_jobs enable row level security;
alter table public.ai_interactions enable row level security;
revoke all on public.kb_documents,public.rag_chunks,public.rag_jobs,public.ai_interactions from anon,authenticated;
grant select on public.kb_documents,public.rag_chunks,public.ai_interactions to authenticated;
grant all on public.kb_documents,public.rag_chunks,public.rag_jobs,public.ai_interactions to service_role;
grant all on sequence public.rag_jobs_id_seq to service_role;
create policy kb_read on public.kb_documents for select to authenticated
using((select private.staff_role()) is not null and (status='published' or (select private.staff_role())='owner'));
create policy chunks_read on public.rag_chunks for select to authenticated using(
  (select private.staff_role()) is not null and (
    (patient_id is not null and exists(select 1 from public.pets p where p.id=patient_id)) or
    (document_id is not null and exists(select 1 from public.kb_documents d where d.id=document_id and d.status='published'))));
create policy interaction_read on public.ai_interactions for select to authenticated
using((select private.staff_role()) is not null and (user_id=(select auth.uid()) or (select private.staff_role())='owner'));
create policy jobs_internal_only on public.rag_jobs for all to service_role using(true) with check(true);

create function private.enqueue_rag() returns trigger language plpgsql security definer set search_path='' as $$
declare source text := tg_argv[0]; source_uuid uuid := coalesce(new.id,old.id); begin
  -- Invalidate immediately so an edited, resolved, or archived source cannot be
  -- retrieved from an old embedding while ingestion catches up.
  delete from public.rag_chunks where source_type=source and source_id=source_uuid;
  insert into public.rag_jobs(source_type,source_id,op)
  values(source,source_uuid,case when tg_op='DELETE' then 'delete' else 'upsert' end);
  return coalesce(new,old);
end $$;
revoke all on function private.enqueue_rag() from public,anon,authenticated;
create trigger visits_queue_rag after insert or update or delete on public.visits for each row execute function private.enqueue_rag('visit');
create trigger vaccines_queue_rag after insert or update or delete on public.vaccinations for each row execute function private.enqueue_rag('vaccination');
create trigger alerts_queue_rag after insert or update or delete on public.pet_alerts for each row execute function private.enqueue_rag('alert');
create trigger kb_queue_rag after insert or update or delete on public.kb_documents for each row execute function private.enqueue_rag('kb_document');
create trigger kb_audit after insert or update or delete on public.kb_documents for each row execute function private.write_audit_log();

create function public.retrieve_patient_context(p_patient_id uuid,p_query_text text,p_match_count integer default 8)
returns table(chunk_id uuid,source_type text,source_id uuid,content text,metadata jsonb,score real)
language sql stable security invoker set search_path='' as $$
  select c.id,c.source_type,c.source_id,c.content,c.metadata,ts_rank_cd(c.fts,q.query)
  from public.rag_chunks c cross join websearch_to_tsquery('simple',left(p_query_text,2000)) q(query)
  where c.patient_id=p_patient_id and c.document_id is null and c.fts @@ q.query
  order by ts_rank_cd(c.fts,q.query) desc,c.id limit least(greatest(p_match_count,1),20);
$$;
create function public.retrieve_kb_context(p_query_text text,p_match_count integer default 8)
returns table(chunk_id uuid,document_id uuid,title text,version integer,content text,metadata jsonb,score real)
language sql stable security invoker set search_path='' as $$
  select c.id,d.id,d.title,d.version,c.content,c.metadata,ts_rank_cd(c.fts,q.query)
  from public.rag_chunks c join public.kb_documents d on d.id=c.document_id
  cross join websearch_to_tsquery('simple',left(p_query_text,2000)) q(query)
  where c.patient_id is null and d.status='published' and c.fts @@ q.query
  order by ts_rank_cd(c.fts,q.query) desc,c.id limit least(greatest(p_match_count,1),20);
$$;
create function public.patient_facts(p_patient_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('patient_id',p.id,'name',p.name,
    'latest_weight',(select jsonb_build_object('weight_kg',vt.weight_kg,'source_id',v.id,'date',v.visited_at)
      from public.visits v join public.visit_vitals vt on vt.visit_id=v.id where v.pet_id=p.id and vt.weight_kg is not null order by v.visited_at desc,v.id limit 1),
    'vaccinations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,vaccine_name,administered_at,next_due_at from public.vaccinations where pet_id=p.id order by administered_at desc,id limit 20) x),
    'open_reminders',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,due_at from public.reminders where pet_id=p.id and status not in ('completed','cancelled') order by due_at,id limit 20) x))
  from public.pets p where p.id=p_patient_id;
$$;

create function private.start_assistant(p_mode text,p_patient_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$ declare result uuid; budget integer; begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  -- Serialize reservations across the clinic; requests count even if a provider fails.
  select ai_daily_request_limit into budget from public.clinic_settings where ai_enabled for update;
  if budget is null then raise exception 'AI_DISABLED'; end if;
  if p_mode='patient' and not exists(select 1 from public.pets where id=p_patient_id) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from public.ai_interactions where created_at >= date_trunc('day',now() at time zone 'Asia/Manila') at time zone 'Asia/Manila') >= budget
    or (select count(*) from public.ai_interactions where user_id=auth.uid() and created_at>now()-interval '1 minute')>=10 then raise exception 'AI_RATE_LIMITED'; end if;
  insert into public.ai_interactions(user_id,mode,patient_id) values(auth.uid(),p_mode,p_patient_id) returning id into result;
  return result;
end $$;
create function private.finish_assistant(p_id uuid,p_outcome text,p_chunks uuid[],p_model text,p_latency integer) returns void
language plpgsql security definer set search_path='' as $$ begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  update public.ai_interactions set outcome=p_outcome,retrieved_chunk_ids=p_chunks,model=p_model,latency_ms=p_latency
  where id=p_id and user_id=auth.uid() and outcome='started';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
create function public.start_assistant(p_mode text,p_patient_id uuid default null) returns uuid
language sql security invoker set search_path='' as $$ select private.start_assistant(p_mode,p_patient_id); $$;
create function public.finish_assistant(p_id uuid,p_outcome text,p_chunks uuid[],p_model text,p_latency integer) returns void
language sql security invoker set search_path='' as $$ select private.finish_assistant(p_id,p_outcome,p_chunks,p_model,p_latency); $$;
create function private.assistant_feedback(p_id uuid,p_feedback smallint,p_reason text) returns void
language plpgsql security definer set search_path='' as $$ begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  update public.ai_interactions set feedback=p_feedback,feedback_reason=left(p_reason,1000) where id=p_id and user_id=auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
create function public.assistant_feedback(p_id uuid,p_feedback smallint,p_reason text default '') returns void
language sql security invoker set search_path='' as $$ select private.assistant_feedback(p_id,p_feedback,p_reason); $$;

create function private.manage_kb(p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$ declare result uuid; begin
  if private.staff_role() is distinct from 'owner'::public.staff_role then raise exception 'FORBIDDEN'; end if;
  if p_data->>'action'='create' then
    insert into public.kb_documents(title,kind,content,uploaded_by) values(p_data->>'title',coalesce(p_data->>'kind','sop'),p_data->>'content',auth.uid()) returning id into result;
  elsif p_data->>'action' in ('publish','archive') then
    result := (p_data->>'id')::uuid;
    update public.kb_documents set status=case when p_data->>'action'='publish' then 'published' else 'archived' end,
      published_at=case when p_data->>'action'='publish' then now() else published_at end,published_by=auth.uid() where id=result;
    if not found then raise exception 'NOT_FOUND'; end if;
  else raise exception 'VALIDATION_FAILED'; end if;
  return result;
end $$;
create function public.manage_kb(p_data jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.manage_kb(p_data); $$;

-- Internal queue functions are service-role-only and use expiring leases.
create function public.claim_rag_jobs(p_limit integer default 10) returns setof public.rag_jobs
language sql security invoker set search_path='' as $$
  update public.rag_jobs j set status='running',attempts=attempts+1,locked_at=now(),lease_token=gen_random_uuid()
  where id in (select id from public.rag_jobs where
    ((status in ('queued','failed') and run_after<=now()) or (status='running' and locked_at<now()-interval '5 minutes'))
    and attempts<5 order by id for update skip locked limit least(greatest(p_limit,1),20)) returning j.*;
$$;
create function public.rag_source(p_type text,p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select case p_type
    when 'visit' then (select jsonb_build_object('patient_id',pet_id,'content',concat_ws(E'\n',visit_type,chief_complaint,subjective,objective,diagnosis_summary),
      'metadata',jsonb_build_object('label',visit_type,'date',visited_at)) from public.visits where id=p_id)
    when 'vaccination' then (select jsonb_build_object('patient_id',pet_id,'content',concat_ws(' ',vaccine_name,'administered',administered_at::text,'next due',next_due_at::text,'lot',lot_number),
      'metadata',jsonb_build_object('label',vaccine_name,'date',administered_at)) from public.vaccinations where id=p_id)
    when 'alert' then (select jsonb_build_object('patient_id',pet_id,'content',description,'metadata',jsonb_build_object('label',alert_type,'date',created_at)) from public.pet_alerts where id=p_id and is_active)
    when 'kb_document' then (select jsonb_build_object('document_id',id,'content',content,'metadata',jsonb_build_object('label',title,'version',version,'date',published_at)) from public.kb_documents where id=p_id and status='published') end;
$$;
create function public.finish_rag_job(p_id bigint,p_lease uuid,p_chunks jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$ declare job public.rag_jobs; source jsonb; begin
  select * into job from public.rag_jobs where id=p_id and lease_token=p_lease and status='running' for update;
  if not found then return false; end if;
  -- Lock the source to avoid publishing chunks computed before a concurrent edit.
  if job.source_type='visit' then perform 1 from public.visits where id=job.source_id for share;
  elsif job.source_type='vaccination' then perform 1 from public.vaccinations where id=job.source_id for share;
  elsif job.source_type='alert' then perform 1 from public.pet_alerts where id=job.source_id for share;
  else perform 1 from public.kb_documents where id=job.source_id for share; end if;
  source := public.rag_source(job.source_type,job.source_id);
  if p_error is not null then
    update public.rag_jobs set status=case when attempts>=5 then 'dead' else 'failed' end,last_error=left(p_error,1000),run_after=now()+interval '1 minute'*attempts where id=p_id;
    return false;
  end if;
  if source is not null and job.op<>'delete' then
    if p_chunks->0->>'source_hash' is distinct from md5(source->>'content') then
      update public.rag_jobs set status='queued',run_after=now(),attempts=0 where id=p_id;
      return false;
    end if;
    delete from public.rag_chunks where source_type=job.source_type and source_id=job.source_id;
    insert into public.rag_chunks(source_type,source_id,patient_id,document_id,chunk_index,content,content_hash,metadata)
    select job.source_type,job.source_id,(source->>'patient_id')::uuid,(source->>'document_id')::uuid,(c->>'index')::integer,c->>'content',md5(c->>'content'),source->'metadata'
    from jsonb_array_elements(p_chunks) c;
  end if;
  update public.rag_jobs set status='done',last_error=null where id=p_id;
  return true;
end $$;
-- Source hash is computed in SQL for the worker rather than exposing a hashing dependency.
create function public.rag_source_with_hash(p_type text,p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select s || jsonb_build_object('source_hash',md5(s->>'content')) from public.rag_source(p_type,p_id) s;
$$;

revoke all on all functions in schema private from public,anon;
grant execute on function private.start_assistant(text,uuid),private.finish_assistant(uuid,text,uuid[],text,integer),private.assistant_feedback(uuid,smallint,text),private.manage_kb(jsonb) to authenticated;
revoke all on function public.claim_rag_jobs(integer),public.rag_source(text,uuid),public.rag_source_with_hash(text,uuid),public.finish_rag_job(bigint,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_rag_jobs(integer),public.rag_source(text,uuid),public.rag_source_with_hash(text,uuid),public.finish_rag_job(bigint,uuid,jsonb,text) to service_role;
revoke all on function public.retrieve_patient_context(uuid,text,integer),public.retrieve_kb_context(text,integer),public.patient_facts(uuid),public.start_assistant(text,uuid),public.finish_assistant(uuid,text,uuid[],text,integer),public.assistant_feedback(uuid,smallint,text),public.manage_kb(jsonb) from public,anon;
grant execute on function public.retrieve_patient_context(uuid,text,integer),public.retrieve_kb_context(text,integer),public.patient_facts(uuid),public.start_assistant(text,uuid),public.finish_assistant(uuid,text,uuid[],text,integer),public.assistant_feedback(uuid,smallint,text),public.manage_kb(jsonb) to authenticated;

insert into storage.buckets(id,name,public) values('knowledge-base','knowledge-base',false) on conflict(id) do nothing;
create policy kb_owner_upload on storage.objects for insert to authenticated with check(bucket_id='knowledge-base' and (select private.staff_role())='owner');
create policy kb_owner_delete on storage.objects for delete to authenticated using(bucket_id='knowledge-base' and (select private.staff_role())='owner');
create policy kb_staff_read on storage.objects for select to authenticated using(bucket_id='knowledge-base' and (select private.staff_role()) is not null and exists
  (select 1 from public.kb_documents d where d.storage_path=name and (d.status='published' or (select private.staff_role())='owner')));
