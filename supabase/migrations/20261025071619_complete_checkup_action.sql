-- One outer portal retry receipt covers registration, starting care and clinical
-- completion. Existing queue/clinical guards, tenant RLS and audits still apply.
create or replace function private.complete_checkup(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ticket uuid:=nullif(p_data->>'queueEntryId','')::uuid; entry public.queue_entries; saved jsonb; version integer;
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
  select * into entry from public.queue_entries where id=ticket;
  if entry.id is null then raise exception 'NOT_FOUND'; end if;
  if entry.category<>'checkup' or entry.pet_id is distinct from nullif(p_data->>'petId','')::uuid
    or (nullif(p_data->>'id','') is not null and entry.visit_id is distinct from (p_data->>'id')::uuid) then raise exception 'VALIDATION_FAILED: select this checkup''s queue entry'; end if;
  version:=coalesce((p_data->>'draftVersion')::integer,0);
  if entry.status='waiting' then
    perform private.queue_mutation('start_queue_entry',jsonb_build_object('id',ticket,'veterinarianId',p_data->>'veterinarianId'),gen_random_uuid());
  end if;
  saved:=private.queue_mutation('complete_queue_entry',jsonb_build_object('id',ticket,'record',p_data,'draftVersion',version),gen_random_uuid());
  return saved||jsonb_build_object('queueEntryId',ticket,'queueNumber',entry.queue_number,'queueDate',entry.queue_date);
end $$;
revoke all on function private.complete_checkup(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.complete_checkup(jsonb) to veterina_rpc;
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,'  elsif p_action=''create_queued_encounter'' then',
    '  elsif p_action=''complete_checkup'' then'||chr(10)||'    result:=private.complete_checkup(p_data);'||chr(10)||'  elsif p_action=''create_queued_encounter'' then');
  if patched=definition then raise exception 'Expected checkup dispatcher not found'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
