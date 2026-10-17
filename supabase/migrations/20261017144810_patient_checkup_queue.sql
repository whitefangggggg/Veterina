alter table public.queue_entries drop constraint queue_entries_source_check;
alter table public.queue_entries add constraint queue_entries_source_check check (source in ('walk_in','appointment','patient_record'));

-- The outer portal dispatcher owns the retry key and the whole transaction.
-- Lock a linked appointment before its queue row, as the other queue actions do.
create function private.create_queued_encounter(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); patient uuid:=(p_data->>'petId')::uuid;
  doctor uuid:=coalesce(nullif(p_data->>'veterinarianId','')::uuid,auth.uid());
  ticket uuid; appointment uuid; entry public.queue_entries; saved jsonb; visit uuid;
begin
  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.pets where id=patient and status='Active') then raise exception 'VALIDATION_FAILED: select an active patient'; end if;
  if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
  if length(btrim(coalesce(p_data->>'complaint','')))=0 or nullif(p_data->>'weightKg','') is null then raise exception 'VALIDATION_FAILED: complaint and weight required'; end if;
  select id,appointment_id into ticket,appointment from public.queue_entries where pet_id=patient and category='checkup' and status in ('waiting','in_progress');
  if appointment is not null then perform 1 from public.appointments where id=appointment for update; end if;
  select * into entry from public.queue_entries where id=ticket and status in ('waiting','in_progress') for update;
  if entry.id is null then
    insert into public.queue_entries(pet_id,category,service_name,source,veterinarian_id,notes,created_by)
    values(patient,'checkup',coalesce(nullif(p_data->>'type',''),'Checkup'),'patient_record',doctor,p_data->>'complaint',actor) returning * into entry;
  else
    if entry.visit_id is not null or entry.draft_saved_at is not null then raise exception 'CHECKUP_ALREADY_QUEUED: open the existing queued checkup'; end if;
    if entry.veterinarian_id is not null and entry.veterinarian_id<>doctor then raise exception 'VALIDATION_FAILED: select the veterinarian assigned to the queue entry'; end if;
  end if;
  saved:=private.portal_mutation('create_encounter',p_data||jsonb_build_object('veterinarianId',doctor),gen_random_uuid());
  visit:=(saved->>'id')::uuid;
  update public.visits set appointment_id=entry.appointment_id where id=visit;
  update public.queue_entries set visit_id=visit,veterinarian_id=coalesce(veterinarian_id,doctor) where id=entry.id returning * into entry;
  return saved||jsonb_build_object('queueEntryId',entry.id,'queueNumber',entry.queue_number,'queueDate',entry.queue_date);
exception when unique_violation then raise exception 'QUEUE_DUPLICATE: this patient already has an active checkup';
end $$;
revoke all on function private.create_queued_encounter(jsonb) from public,anon,authenticated;

create function private.guard_queued_visit_finalization() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.finalized_at is not null and old.finalized_at is null and exists(
    select 1 from public.queue_entries where visit_id=new.id and status in ('waiting','in_progress')
  ) then raise exception 'CHECKUP_IN_QUEUE: complete or cancel the queue entry before finalizing'; end if;
  return new;
end $$;
revoke all on function private.guard_queued_visit_finalization() from public,anon,authenticated;
create trigger visits_guard_queued_finalization before update of finalized_at on public.visits
  for each row execute function private.guard_queued_visit_finalization();

do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    '  if p_action in (''add_queue_entry'',',
    '  if p_action=''create_queued_encounter'' then'||chr(10)||
    '    result:=private.create_queued_encounter(p_data);'||chr(10)||
    '  elsif p_action in (''add_queue_entry'',');
  if patched=definition then raise exception 'Expected portal queue dispatcher was not found'; end if;
  execute patched;
  select pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    $old$        saved:=private.portal_mutation('create_encounter',record_data,gen_random_uuid());
        care_id:=(saved->>'id')::uuid;$old$,
    $new$        if entry.visit_id is not null then
          perform 1 from public.visits where id=entry.visit_id and pet_id=entry.pet_id for update;
          if not found then raise exception 'NOT_FOUND: linked checkup record'; end if;
          saved:=private.portal_mutation('update_encounter',record_data||jsonb_build_object('id',entry.visit_id),gen_random_uuid());
          care_id:=entry.visit_id;
        else
          saved:=private.portal_mutation('create_encounter',record_data,gen_random_uuid());
          care_id:=(saved->>'id')::uuid;
        end if;$new$);
  if patched=definition then raise exception 'Expected queue encounter creation was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
