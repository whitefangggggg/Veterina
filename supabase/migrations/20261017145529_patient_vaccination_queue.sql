-- Patient-page vaccination saves and ticket allocation share one transaction.
create function private.create_queued_vaccination(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); patient uuid:=(p_data->>'petId')::uuid;
  doctor uuid:=coalesce(nullif(p_data->>'veterinarianId','')::uuid,auth.uid());
  ticket uuid; appointment uuid; entry public.queue_entries; saved jsonb; vaccination uuid;
begin
  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.pets where id=patient and status='Active') then raise exception 'VALIDATION_FAILED: select an active patient'; end if;
  if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
  if length(btrim(coalesce(p_data->>'vaccine','')))=0 or length(btrim(coalesce(p_data->>'lotNumber','')))=0 then raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;
  select id,appointment_id into ticket,appointment from public.queue_entries where pet_id=patient and category='vaccination' and status in ('waiting','in_progress');
  if appointment is not null then perform 1 from public.appointments where id=appointment for update; end if;
  select * into entry from public.queue_entries where id=ticket and status in ('waiting','in_progress') for update;
  if entry.id is null then
    insert into public.queue_entries(pet_id,category,service_name,source,veterinarian_id,notes,created_by)
    values(patient,'vaccination','Vaccination','patient_record',doctor,p_data->>'vaccine',actor) returning * into entry;
  else
    if entry.vaccination_id is not null or entry.draft_saved_at is not null then raise exception 'VACCINATION_ALREADY_QUEUED: open the existing queued vaccination'; end if;
    if entry.veterinarian_id is not null and entry.veterinarian_id<>doctor then raise exception 'VALIDATION_FAILED: select the veterinarian assigned to the queue entry'; end if;
  end if;
  saved:=private.portal_mutation('create_vaccination',p_data||jsonb_build_object('veterinarianId',doctor),gen_random_uuid());
  vaccination:=(saved->>'id')::uuid;
  update public.queue_entries set vaccination_id=vaccination,veterinarian_id=coalesce(veterinarian_id,doctor) where id=entry.id returning * into entry;
  return saved||jsonb_build_object('queueEntryId',entry.id,'queueNumber',entry.queue_number,'queueDate',entry.queue_date);
exception when unique_violation then raise exception 'QUEUE_DUPLICATE: this patient already has an active vaccination';
end $$;
revoke all on function private.create_queued_vaccination(jsonb) from public,anon,authenticated;

do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    '  if p_action=''create_queued_encounter'' then',
    '  if p_action=''create_queued_vaccination'' then'||chr(10)||
    '    result:=private.create_queued_vaccination(p_data);'||chr(10)||
    '  elsif p_action=''create_queued_encounter'' then');
  if patched=definition then raise exception 'Expected patient checkup dispatcher was not found'; end if;
  execute patched;
  select pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    $old$        saved:=private.portal_mutation('create_vaccination',record_data,gen_random_uuid());
        care_id:=(saved->>'id')::uuid;$old$,
    $new$        if entry.vaccination_id is not null then
          perform 1 from public.vaccinations where id=entry.vaccination_id and pet_id=entry.pet_id for update;
          if not found then raise exception 'NOT_FOUND: linked vaccination record'; end if;
          saved:=private.portal_mutation('update_vaccination',record_data||jsonb_build_object('id',entry.vaccination_id),gen_random_uuid());
          care_id:=entry.vaccination_id;
        else
          saved:=private.portal_mutation('create_vaccination',record_data,gen_random_uuid());
          care_id:=(saved->>'id')::uuid;
        end if;$new$);
  if patched=definition then raise exception 'Expected queue vaccination creation was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
