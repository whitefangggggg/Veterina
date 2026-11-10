-- Optional laboratory notes share the visit's existing tenancy, finalization,
-- auditing and retry rules. No new browser grants or RPCs are introduced.
alter table public.visits
  add column laboratory_requests text not null default '' check (length(laboratory_requests)<=10000),
  add column laboratory_results text not null default '' check (length(laboratory_results)<=10000);

do $migration$
declare definition text; patched text; marker text;
begin
  definition:=pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure);
  marker:=$old$  elsif action in ('create_encounter','update_encounter') then$old$;
  if strpos(definition,marker)=0 then raise exception 'Expected clinical payload validation branch'; end if;
  patched:=replace(definition,marker,marker||$new$
    if exists(select 1 from jsonb_each(data) field where field.key in ('laboratoryRequests','laboratoryResults')
      and (jsonb_typeof(field.value) is distinct from 'string' or length(field.value #>> '{}')>10000)) then
      raise exception 'VALIDATION_FAILED: laboratory notes must be text of at most 10000 characters'; end if;
  $new$);
  execute patched;

  definition:=pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  marker:='clinical_notes,pet_id,visit_type,chief_complaint,';
  if strpos(definition,marker)=0 then raise exception 'Expected encounter insert columns'; end if;
  patched:=replace(definition,marker,'laboratory_requests,laboratory_results,'||marker);
  marker:=$old$coalesce(p_data->>'clinicalNotes',''),pet,p_data->>'type',$old$;
  if strpos(patched,marker)=0 then raise exception 'Expected encounter insert values'; end if;
  execute replace(patched,marker,$new$coalesce(p_data->>'laboratoryRequests',''),coalesce(p_data->>'laboratoryResults',''),$new$||marker);

  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  marker:='update public.visits set clinical_notes=';
  if strpos(definition,marker)=0 then raise exception 'Expected encounter update'; end if;
  execute replace(definition,marker,$new$update public.visits set
    laboratory_requests=coalesce(p_data->>'laboratoryRequests',laboratory_requests),
    laboratory_results=coalesce(p_data->>'laboratoryResults',laboratory_results),clinical_notes=$new$);

  definition:=pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure);
  marker:=$old$'plan','clinicalNotes','diagnosis'$old$;
  if strpos(definition,marker)=0 then raise exception 'Expected checkup draft allowlist'; end if;
  patched:=replace(definition,marker,$new$'plan','laboratoryRequests','laboratoryResults','clinicalNotes','diagnosis'$new$);
  -- Apply to draft saves and completion. Only omitted laboratory fields are
  -- inherited; every other field retains the existing replacement semantics.
  foreach marker in array array[
    $old$if jsonb_typeof(record_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED: draft fields required'; end if;$old$,
    $old$if jsonb_typeof(record_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED: clinical record required'; end if;$old$
  ] loop
    if strpos(patched,marker)=0 then raise exception 'Expected queue record validation'; end if;
    patched:=replace(patched,marker,marker||$new$
      if entry.category='checkup' then
        record_data:=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(entry.care_draft)
          where key in ('laboratoryRequests','laboratoryResults'))||record_data;
        if exists(select 1 from jsonb_each(record_data) field where field.key in ('laboratoryRequests','laboratoryResults')
          and (jsonb_typeof(field.value) is distinct from 'string' or length(field.value #>> '{}')>10000)) then
          raise exception 'VALIDATION_FAILED: laboratory notes must be text of at most 10000 characters'; end if;
      end if;
    $new$);
  end loop;
  execute patched;

  -- Opening the prescription editor also commits clinical work and clears its
  -- draft. Retain omitted laboratory values on that path under the queue lock.
  definition:=pg_get_functiondef('private.save_checkup_progress(jsonb)'::regprocedure);
  marker:=$old$  saved:=private.portal_mutation(case when entry.visit_id is null then 'create_encounter' else 'update_encounter' end,$old$;
  if strpos(definition,marker)=0 then raise exception 'Expected checkup progress save'; end if;
  execute replace(definition,marker,$new$  p_data:=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(entry.care_draft)
    where key in ('laboratoryRequests','laboratoryResults'))||p_data;
$new$||marker);
end $migration$;

notify pgrst,'reload schema';
