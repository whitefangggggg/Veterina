-- Opening the prescription form persists clinical work without finishing care.
-- Queue and appointment locks follow the existing appointment -> queue order.
create function private.save_checkup_progress(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ticket uuid:=nullif(p_data->>'queueEntryId','')::uuid; entry public.queue_entries;
  booking uuid; saved jsonb; version integer:=coalesce((p_data->>'draftVersion')::integer,0);
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if ticket is null and nullif(p_data->>'id','') is not null then
    select id into ticket from public.queue_entries where visit_id=(p_data->>'id')::uuid and category='checkup' and status in ('waiting','in_progress');
    if ticket is null then raise exception 'INVALID_TRANSITION: this checkup has no active queue entry'; end if;
  end if;
  if ticket is null then
    saved:=private.create_queued_encounter(p_data);
    ticket:=(saved->>'queueEntryId')::uuid;
  end if;
  select appointment_id into booking from public.queue_entries where id=ticket;
  if booking is not null then perform 1 from public.appointments where id=booking for update; end if;
  select * into entry from public.queue_entries where id=ticket for update;
  if entry.id is null then raise exception 'NOT_FOUND'; end if;
  if entry.category<>'checkup' or entry.pet_id is distinct from nullif(p_data->>'petId','')::uuid
    or (nullif(p_data->>'id','') is not null and entry.visit_id is distinct from (p_data->>'id')::uuid) then
    raise exception 'VALIDATION_FAILED: select this checkup''s queue entry';
  end if;
  if entry.status not in ('waiting','in_progress') then raise exception 'INVALID_TRANSITION'; end if;
  if version<>entry.draft_version then raise exception 'DRAFT_CONFLICT: a newer draft is available'; end if;
  if entry.status='waiting' then
    perform private.queue_mutation('start_queue_entry',jsonb_build_object('id',ticket,'veterinarianId',p_data->>'veterinarianId'),gen_random_uuid());
    select * into entry from public.queue_entries where id=ticket;
  end if;
  if entry.veterinarian_id is distinct from nullif(p_data->>'veterinarianId','')::uuid then
    raise exception 'VALIDATION_FAILED: veterinarian must match the queue entry';
  end if;
  if length(btrim(coalesce(p_data->>'complaint','')))=0 or nullif(p_data->>'weightKg','') is null then
    raise exception 'VALIDATION_FAILED: complaint and weight required';
  end if;
  saved:=private.portal_mutation(case when entry.visit_id is null then 'create_encounter' else 'update_encounter' end,
    p_data||jsonb_build_object('id',entry.visit_id),gen_random_uuid());
  update public.visits set appointment_id=entry.appointment_id where id=(saved->>'id')::uuid;
  update public.queue_entries set visit_id=(saved->>'id')::uuid,care_draft='{}'::jsonb,
    draft_saved_at=null,draft_saved_by=null,draft_version=draft_version+1 where id=ticket;
  return saved||jsonb_build_object('queueEntryId',ticket,'queueNumber',entry.queue_number,'queueDate',entry.queue_date,'draftVersion',version+1);
end $$;
revoke all on function private.save_checkup_progress(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_checkup_progress(jsonb) to veterina_rpc;

-- Completion and prescribing (including stock deductions) commit together.
-- The outer portal receipt makes retries safe after a lost acknowledgement.
create function private.prescribe_and_complete_checkup(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved jsonb; checkup jsonb:=p_data->'checkup';
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(checkup) is distinct from 'object' or nullif(checkup->>'queueEntryId','') is null
    or nullif(checkup->>'id','') is null or nullif(checkup->>'id','')::uuid is distinct from nullif(p_data->>'visitId','')::uuid then
    raise exception 'VALIDATION_FAILED: prescription must belong to this checkup';
  end if;
  saved:=private.complete_checkup(checkup);
  return private.portal_mutation('create_prescription',p_data-'checkup',gen_random_uuid())||jsonb_build_object('queueEntryId',saved->>'queueEntryId');
end $$;
revoke all on function private.prescribe_and_complete_checkup(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.prescribe_and_complete_checkup(jsonb) to veterina_rpc;

do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,'  elsif p_action=''complete_checkup'' then',
    '  elsif p_action=''save_checkup_progress'' then'||chr(10)||'    result:=private.save_checkup_progress(p_data);'||chr(10)||
    '  elsif p_action=''prescribe_and_complete_checkup'' then'||chr(10)||'    result:=private.prescribe_and_complete_checkup(p_data);'||chr(10)||
    '  elsif p_action=''complete_checkup'' then');
  if patched=definition then raise exception 'Expected checkup dispatcher not found'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
