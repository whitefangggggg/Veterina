-- Historical non-clinical services never occupy a queue slot.
create table public.patient_service_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  pet_id uuid not null references public.pets(id) on delete cascade,
  service_type_id uuid references public.service_types(id) on delete set null,
  service_name text not null check(length(btrim(service_name)) between 1 and 200),
  performed_at timestamptz not null check(isfinite(performed_at)),
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text not null default '' check(length(performed_by_name)<=200),
  service_notes text not null default '' check(length(service_notes)<=10000),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index patient_service_records_clinic_pet_date on public.patient_service_records(clinic_id,pet_id,performed_at desc);
create index patient_service_records_pet on public.patient_service_records(pet_id);
create index patient_service_records_service on public.patient_service_records(service_type_id) where service_type_id is not null;
create index patient_service_records_performer on public.patient_service_records(performed_by) where performed_by is not null;
create index patient_service_records_recorder on public.patient_service_records(recorded_by) where recorded_by is not null;
alter table public.patient_service_records enable row level security;
revoke all on public.patient_service_records from public,anon,authenticated;
grant select on public.patient_service_records to authenticated,service_role;
grant select,insert,update on public.patient_service_records to veterina_rpc;
create policy patient_service_records_read on public.patient_service_records for select to authenticated
  using(clinic_id=(select private.current_clinic_id()));
create policy patient_service_records_rpc on public.patient_service_records for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()));
create trigger a_clinic_scope before insert or update on public.patient_service_records for each row execute function private.enforce_clinic_scope();
create trigger patient_service_records_audit after insert or update on public.patient_service_records for each row execute function private.write_audit_log();

alter table public.visits add column service_type_id uuid references public.service_types(id) on delete set null,
  add column service_name text not null default '';
create index visits_service_type on public.visits(service_type_id) where service_type_id is not null;

create function private.snapshot_checkup_service() returns trigger language plpgsql security invoker set search_path='' as $$
declare service public.service_types;
begin
  if new.service_type_id is not null and (tg_op='INSERT' or new.service_type_id is distinct from old.service_type_id) then
    select * into service from public.service_types where id=new.service_type_id and is_active and workflow='checkup';
    if service.id is null then raise exception 'VALIDATION_FAILED: select an active checkup service'; end if;
    new.service_name:=service.name;
  end if;
  return new;
end $$;
create trigger b_checkup_service before insert or update on public.visits for each row execute function private.snapshot_checkup_service();

create function private.save_record_only_service(p_data jsonb,p_update boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.patient_service_records; service public.service_types; patient uuid:=nullif(p_data->>'petId','')::uuid;
  doctor uuid:=nullif(p_data->>'veterinarianId','')::uuid; clinician text:=btrim(coalesce(p_data->>'veterinarianName',''));
  performed timestamptz:=nullif(p_data->>'performedAt','')::timestamptz; saved uuid;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_update then
    select * into original from public.patient_service_records where id=(p_data->>'id')::uuid for update;
    if original.id is null then raise exception 'NOT_FOUND'; end if;
    if patient is distinct from original.pet_id or nullif(p_data->>'serviceId','')::uuid is distinct from original.service_type_id then raise exception 'VALIDATION_FAILED: patient and service cannot be changed'; end if;
  end if;
  select * into service from public.service_types where id=nullif(p_data->>'serviceId','')::uuid and workflow='maintenance' and (is_active or p_update);
  if not p_update and service.id is null then raise exception 'VALIDATION_FAILED: select an active non-clinical service'; end if;
  if not exists(select 1 from public.pets where id=patient) then raise exception 'NOT_FOUND: patient'; end if;
  if performed is null or not isfinite(performed) or performed>now() then raise exception 'VALIDATION_FAILED: original service date must be in the past'; end if;
  if length(clinician)>200 or length(coalesce(p_data->>'serviceNotes',''))>10000 then raise exception 'VALIDATION_FAILED: service details too long'; end if;
  if p_data ?| array['inventoryItemId','batchId','dispenseQuantity','dispenseUnit','queueEntryId'] then raise exception 'VALIDATION_FAILED: historical services cannot dispense or join the queue'; end if;
  if doctor is not null then
    select full_name into clinician from public.profiles where id=doctor and (is_active or (p_update and id=original.performed_by));
    if not found then raise exception 'VALIDATION_FAILED: active staff required'; end if;
    if p_update and doctor=original.performed_by then clinician:=original.performed_by_name; end if;
  end if;
  if p_update then
    update public.patient_service_records set performed_at=performed,performed_by=doctor,performed_by_name=clinician,service_notes=coalesce(p_data->>'serviceNotes','') where id=original.id returning id into saved;
  else
    insert into public.patient_service_records(pet_id,service_type_id,service_name,performed_at,performed_by,performed_by_name,service_notes,recorded_by)
      values(patient,service.id,service.name,performed,doctor,clinician,coalesce(p_data->>'serviceNotes',''),auth.uid()) returning id into saved;
  end if;
  return jsonb_build_object('id',saved);
end $$;

do $migration$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$if p_action='create_record_only_vaccination' or$old$,$new$if p_action in ('create_record_only_service','update_record_only_service') then
    result:=private.save_record_only_service(p_data,p_action='update_record_only_service'); entity:=(result->>'id')::uuid;
  elsif p_action='create_record_only_vaccination' or$new$);
  if patched=definition then raise exception 'Expected historical dispatcher'; end if; execute patched;

  definition:=pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,'insert into public.visits(recording_purpose,','insert into public.visits(service_type_id,recording_purpose,');
  patched:=replace(patched,$old$values(coalesce(p_data->>'recordingPurpose','queue'),$old$,$new$values(nullif(p_data->>'serviceId','')::uuid,coalesce(p_data->>'recordingPurpose','queue'),$new$);
  if patched=definition then raise exception 'Expected checkup insert'; end if; execute patched;

  definition:=pg_get_functiondef('private.create_queued_encounter(jsonb)'::regprocedure);
  patched:=replace(definition,'ticket uuid; appointment uuid;', 'selected_service public.service_types; ticket uuid; appointment uuid;');
  patched:=replace(patched,$old$  if p_data->>'recordingPurpose'='record_only'$old$,$new$  if nullif(p_data->>'serviceId','') is not null then
    select * into selected_service from public.service_types where id=(p_data->>'serviceId')::uuid and workflow='checkup' and is_active;
    if selected_service.id is null then raise exception 'VALIDATION_FAILED: select an active checkup service'; end if;
  end if;
  if p_data->>'recordingPurpose'='record_only'$new$);
  patched:=replace(patched,$old$values(patient,'checkup',coalesce(nullif(p_data->>'type',''),'Checkup'),(select id from public.service_types where name=coalesce(nullif(p_data->>'type',''),'Checkup') and workflow='checkup' and is_active),$old$,$new$values(patient,'checkup',coalesce(selected_service.name,nullif(p_data->>'type',''),'Checkup'),coalesce(selected_service.id,(select id from public.service_types where name=coalesce(nullif(p_data->>'type',''),'Checkup') and workflow='checkup' and is_active)),$new$);
  patched:=replace(patched,$old$    if entry.visit_id is not null$old$,$new$    if selected_service.id is not null and selected_service.id is distinct from entry.service_type_id then raise exception 'VALIDATION_FAILED: this patient already has another checkup service in the queue'; end if;
    if entry.visit_id is not null$new$);
  if patched=definition or strpos(patched,'selected_service.id is distinct from')=0 then raise exception 'Expected queued checkup service'; end if; execute patched;

  definition:=pg_get_functiondef('private.create_queued_vaccination(jsonb)'::regprocedure);
  patched:=replace(definition,'ticket uuid; appointment uuid;', 'selected_service public.service_types; ticket uuid; appointment uuid;');
  patched:=replace(patched,$old$  -- Inventory validation$old$,$new$  if nullif(p_data->>'serviceId','') is not null then
    select * into selected_service from public.service_types where id=(p_data->>'serviceId')::uuid and workflow='vaccination' and is_active;
    if selected_service.id is null then raise exception 'VALIDATION_FAILED: select an active vaccination service'; end if;
  end if;
  -- Inventory validation$new$);
  patched:=replace(patched,$old$values(patient,'vaccination','Vaccination',(select id from public.service_types where name='Vaccination' and workflow='vaccination' and is_active),$old$,$new$values(patient,'vaccination',coalesce(selected_service.name,'Vaccination'),coalesce(selected_service.id,(select id from public.service_types where name='Vaccination' and workflow='vaccination' and is_active)),$new$);
  patched:=replace(patched,$old$    if entry.vaccination_id is not null$old$,$new$    if selected_service.id is not null and selected_service.id is distinct from entry.service_type_id then raise exception 'VALIDATION_FAILED: this patient already has another vaccination service in the queue'; end if;
    if entry.vaccination_id is not null$new$);
  if patched=definition then raise exception 'Expected queued vaccination service'; end if; execute patched;

  definition:=pg_get_functiondef('private.filtered_export_report(text,uuid,jsonb)'::regprocedure);
  patched:=replace(definition,$old$'maintenance',(select$old$,$new$'historical_services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.performed_at desc),'[]') from public.patient_service_records s where s.pet_id=p.id),
      'maintenance',(select$new$);
  if patched=definition then raise exception 'Expected history export'; end if; execute patched;
end $migration$;
revoke all on function private.snapshot_checkup_service(),private.save_record_only_service(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.snapshot_checkup_service(),private.save_record_only_service(jsonb,boolean) to veterina_rpc;
notify pgrst,'reload schema';
