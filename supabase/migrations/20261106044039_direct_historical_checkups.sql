-- Clinical identity is independent of the staff account responsible for a queue ticket.
alter table public.visits add column recording_purpose text not null default 'queue'
  check (recording_purpose in ('queue','record_only'));
alter table public.visit_vitals alter column weight_kg drop not null;
alter table public.prescriptions add column is_historical boolean not null default false;
alter table public.prescriptions add column recorded_by uuid references public.profiles(id)
  default auth.uid();
-- Legacy recorder attribution remains available through prescribed_by; new rows record both identities.
alter table public.prescriptions alter column prescribed_by drop not null;
alter table public.prescriptions drop constraint portal_prescription_required;
alter table public.prescriptions add constraint portal_prescription_required check
  (length(btrim(medication_name))>0 and (is_historical or (length(btrim(dose))>0 and length(btrim(frequency))>0)));

create function private.guard_visit_recording_mode() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.recording_purpose is distinct from old.recording_purpose then
    raise exception 'VALIDATION_FAILED: recording purpose cannot be changed';
  end if;
  return new;
end $$;
create trigger visits_recording_mode before update on public.visits for each row execute function private.guard_visit_recording_mode();

create function private.guard_recording_vitals() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.weight_kg is null and exists(select 1 from public.visits where id=new.visit_id and recording_purpose<>'record_only') then
    raise exception 'VALIDATION_FAILED: weight required';
  end if;
  return new;
end $$;
create trigger vitals_recording_mode before insert or update on public.visit_vitals for each row execute function private.guard_recording_vitals();

create function private.guard_historical_queue_link() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.visits where id=new.visit_id and recording_purpose='record_only') then raise exception 'VALIDATION_FAILED: historical records cannot join the queue'; end if;
  return new;
end $$;
create trigger queue_recording_mode before insert or update on public.queue_entries for each row execute function private.guard_historical_queue_link();

create function private.prepare_historical_prescription() returns trigger
language plpgsql security invoker set search_path='' as $$
declare purpose text; medication jsonb;
begin
  select recording_purpose into purpose from public.visits where id=new.visit_id;
  if not found then raise exception 'NOT_FOUND: checkup'; end if;
  if tg_op='UPDATE' and new.visit_id is distinct from old.visit_id then raise exception 'VALIDATION_FAILED: prescription checkup cannot be changed'; end if;
  new.is_historical:=purpose='record_only';
  if tg_op='INSERT' then new.recorded_by:=auth.uid(); else new.recorded_by:=old.recorded_by; end if;
  if new.is_historical then
    for medication in select value from jsonb_array_elements(coalesce(new.medications,'[]')) loop
      if medication ?| array['inventoryItemId','batchId','dispenseQuantity','dispenseUnit'] then
        raise exception 'VALIDATION_FAILED: historical prescriptions cannot dispense inventory';
      end if;
    end loop;
  end if;
  return new;
end $$;
-- This runs before inventory preparation, validation and clinician snapshots.
create trigger prescriptions_a_recording_mode before insert or update on public.prescriptions
  for each row execute function private.prepare_historical_prescription();

create or replace function private.validate_prescription_medications() returns trigger
language plpgsql security invoker set search_path='' as $$
declare medication jsonb; field_name text;
begin
  if new.medications is null then
    if not new.is_historical and nullif(btrim(new.route),'') is null then raise exception 'VALIDATION_FAILED: route is required for every medication'; end if;
    return new;
  end if;
  if jsonb_typeof(new.medications)<>'array' or jsonb_array_length(new.medications)=0 then raise exception 'VALIDATION_FAILED: add at least one medication'; end if;
  for medication in select value from jsonb_array_elements(new.medications) loop
    if jsonb_typeof(medication)<>'object' then raise exception 'VALIDATION_FAILED: invalid medication'; end if;
    foreach field_name in array case when new.is_historical then array['medicationName'] else array['medicationName','dose','route','frequency'] end loop
      if jsonb_typeof(medication->field_name) is distinct from 'string' or length(btrim(medication->>field_name))=0 then
        raise exception 'VALIDATION_FAILED: medication details required';
      end if;
    end loop;
    foreach field_name in array array['dose','route','frequency','duration','instructions'] loop
      if medication ? field_name and jsonb_typeof(medication->field_name) is distinct from 'string' then raise exception 'VALIDATION_FAILED: medication details must be text'; end if;
    end loop;
  end loop;
  new.medication_name:=new.medications->0->>'medicationName';
  new.dose:=coalesce(new.medications->0->>'dose',''); new.route:=coalesce(new.medications->0->>'route','');
  new.frequency:=coalesce(new.medications->0->>'frequency',''); new.duration:=coalesce(new.medications->0->>'duration','');
  new.instructions:=coalesce(new.medications->0->>'instructions','');
  return new;
end $$;

create or replace function private.portal_snapshot_clinicians() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='visits' then
    if new.attending_veterinarian_id is null then new.attending_veterinarian_name:=btrim(coalesce(new.attending_veterinarian_name,''));
    elsif tg_op='INSERT' or new.attending_veterinarian_id is distinct from old.attending_veterinarian_id then
      select full_name into new.attending_veterinarian_name from public.profiles where id=new.attending_veterinarian_id;
      new.attending_veterinarian_name:=coalesce(new.attending_veterinarian_name,'Clinic staff');
    else new.attending_veterinarian_name:=old.attending_veterinarian_name; end if;
    if tg_op='INSERT' then
      select full_name into new.recorded_by_name from public.profiles where id=new.recorded_by;
      new.recorded_by_name:=coalesce(new.recorded_by_name,'Clinic staff');
    else new.recorded_by_name:=old.recorded_by_name; end if;
  elsif tg_table_name='vaccinations' then
    if tg_op='INSERT' or new.administered_by is distinct from old.administered_by then
      select full_name into new.administered_by_name from public.profiles where id=new.administered_by;
      new.administered_by_name:=coalesce(new.administered_by_name,'Clinic staff');
    else new.administered_by_name:=old.administered_by_name; end if;
  else
    if new.is_historical and new.prescribed_by is null then new.prescribed_by_name:=btrim(coalesce(new.prescribed_by_name,''));
    elsif tg_op='INSERT' or new.prescribed_by is distinct from old.prescribed_by then
      select full_name into new.prescribed_by_name from public.profiles where id=new.prescribed_by;
      new.prescribed_by_name:=coalesce(new.prescribed_by_name,'Clinic staff');
    else new.prescribed_by_name:=old.prescribed_by_name; end if;
  end if;
  return new;
end $$;

create function private.save_historical_prescription(p_data jsonb, p_update boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare visit_uuid uuid; prescription_uuid uuid:=nullif(p_data->>'id','')::uuid; visit public.visits; original public.prescriptions; doctor uuid; clinician_name text; care_time timestamptz;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_update then
    select * into original from public.prescriptions where id=prescription_uuid for update;
    visit_uuid:=original.visit_id;
  else visit_uuid:=nullif(p_data->>'visitId','')::uuid; end if;
  select * into visit from public.visits where id=visit_uuid for update;
  if visit.id is null then raise exception 'NOT_FOUND: checkup'; end if;
  if visit.recording_purpose<>'record_only' then raise exception 'VALIDATION_FAILED: historical checkup required'; end if;
  if visit.finalized_at is not null then raise exception 'RECORD_FINALIZED'; end if;
  doctor:=nullif(p_data->>'prescribedById','')::uuid;
  clinician_name:=btrim(coalesce(p_data->>'prescribedByName',''));
  if not (p_data ? 'prescribedById' or p_data ? 'prescribedByName') then
    doctor:=case when p_update then original.prescribed_by else visit.attending_veterinarian_id end;
    clinician_name:=case when p_update then original.prescribed_by_name else visit.attending_veterinarian_name end;
  end if;
  if doctor is not null and not exists(select 1 from public.profiles where id=doctor and (is_active or (p_update and id=original.prescribed_by))) then raise exception 'VALIDATION_FAILED: active prescriber required'; end if;
  if length(clinician_name)>200 then raise exception 'VALIDATION_FAILED: clinician name is too long'; end if;
  care_time:=coalesce(nullif(p_data->>'prescribedAt','')::timestamptz,original.prescribed_at,visit.visited_at);
  if p_update then
    update public.prescriptions set medications=p_data->'medications', prescribed_at=care_time, prescribed_by=doctor, prescribed_by_name=clinician_name where id=prescription_uuid;
  else
    insert into public.prescriptions(visit_id,medication_name,dose,frequency,instructions,medications,prescribed_at,prescribed_by,prescribed_by_name,is_historical,recorded_by)
      values(visit.id,'','','','',p_data->'medications',care_time,doctor,clinician_name,true,auth.uid()) returning id into prescription_uuid;
  end if;
  return jsonb_build_object('id',prescription_uuid);
end $$;

create function private.create_record_only_checkup(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved jsonb; prescription jsonb;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  saved:=private.portal_mutation('create_encounter',(p_data-'id'-'prescription')||jsonb_build_object('recordingPurpose','record_only'),gen_random_uuid());
  if p_data ? 'prescription' then
    if jsonb_typeof(p_data->'prescription') is distinct from 'object' then raise exception 'VALIDATION_FAILED: prescription must be an object'; end if;
    prescription:=private.save_historical_prescription((p_data->'prescription')||jsonb_build_object('visitId',saved->>'id'));
    saved:=saved||jsonb_build_object('prescriptionId',prescription->>'id');
  end if;
  return saved;
end $$;

-- Guarded source patches preserve all unrelated workflows, retry receipts, grants and ownership.
do $migration$
declare definition text; patched text; signature text;
begin
  definition:=pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure);
  patched:=replace(definition,$old$  elsif action in ('create_encounter','update_encounter') then$old$,$new$  elsif action in ('create_encounter','update_encounter') then
    if action='update_encounter' then
      if data ? 'recordingPurpose' and data->>'recordingPurpose' is distinct from (select recording_purpose from public.visits where id=(data->>'id')::uuid) then raise exception 'VALIDATION_FAILED: recording purpose cannot be changed'; end if;
      data:=data||jsonb_build_object('recordingPurpose',(select recording_purpose from public.visits where id=(data->>'id')::uuid));
    end if;
    if coalesce(data->>'recordingPurpose','queue') not in ('queue','record_only') then raise exception 'VALIDATION_FAILED: recording purpose'; end if;
    if coalesce(data->>'recordingPurpose','queue')='record_only' and nullif(data->>'encounteredAt','') is null then raise exception 'VALIDATION_FAILED: care date required'; end if;
    if length(coalesce(data->>'veterinarianName',''))>200 then raise exception 'VALIDATION_FAILED: clinician name is too long'; end if;
    if data ? 'veterinarianName' and coalesce(data->>'recordingPurpose','queue')='queue' and nullif(data->>'veterinarianId','') is null and nullif(btrim(data->>'veterinarianName'),'') is null then raise exception 'VALIDATION_FAILED: clinician required'; end if;
    if nullif(data->>'veterinarianId','') is not null and not exists(select 1 from public.profiles where id=(data->>'veterinarianId')::uuid and (is_active or (action='update_encounter' and id=(select attending_veterinarian_id from public.visits where id=(data->>'id')::uuid)))) then raise exception 'VALIDATION_FAILED: active veterinarian required'; end if;
    $new$);
  if patched=definition then raise exception 'Expected clinical payload branch'; end if; execute patched;

  definition:=pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  elsif p_action = 'create_encounter' then
    doctor := coalesce(nullif(p_data->>'veterinarianId','')::uuid,u);
    if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: inactive veterinarian'; end if;$old$,$new$  elsif p_action = 'create_encounter' then
    doctor := case when p_data ? 'veterinarianName' or p_data->>'recordingPurpose'='record_only' then nullif(p_data->>'veterinarianId','')::uuid else coalesce(nullif(p_data->>'veterinarianId','')::uuid,u) end;
    if doctor is not null and not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: inactive veterinarian'; end if;$new$);
  if patched=definition then raise exception 'Expected encounter identity branch'; end if;
  patched:=replace(patched,'insert into public.visits(clinical_notes,pet_id,','insert into public.visits(recording_purpose,attending_veterinarian_name,clinical_notes,pet_id,');
  patched:=replace(patched,$old$values(coalesce(p_data->>'clinicalNotes',''),pet,$old$,$new$values(coalesce(p_data->>'recordingPurpose','queue'),coalesce(p_data->>'veterinarianName',''),coalesce(p_data->>'clinicalNotes',''),pet,$new$);
  patched:=replace(patched,$old$if nullif(p_data->>'followUpDate','') is not null then$old$,$new$if coalesce(p_data->>'recordingPurpose','queue')<>'record_only' and nullif(p_data->>'followUpDate','') is not null then$new$);
  execute patched;

  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  if p_action in ('arrive_follow_up','reschedule_follow_up') then$old$,$new$  if p_action='create_record_only_checkup' then
    result:=private.create_record_only_checkup(p_data); entity:=(result->>'id')::uuid;
  elsif p_action in ('create_prescription','update_prescription') and exists(select 1 from public.visits where recording_purpose='record_only' and id=case when p_action='create_prescription' then nullif(p_data->>'visitId','')::uuid else (select visit_id from public.prescriptions where id=nullif(p_data->>'id','')::uuid) end) then
    result:=private.save_historical_prescription(p_data,p_action='update_prescription'); entity:=(result->>'id')::uuid;
  elsif p_action in ('arrive_follow_up','reschedule_follow_up') then$new$);
  if patched=definition then raise exception 'Expected dispatcher branch'; end if;
  patched:=replace(patched,$old$attending_veterinarian_id=(p_data->>'veterinarianId')::uuid where id=entity;$old$,$new$attending_veterinarian_id=nullif(p_data->>'veterinarianId','')::uuid,attending_veterinarian_name=coalesce(p_data->>'veterinarianName',attending_veterinarian_name) where id=entity;$new$);
  patched:=replace(patched,$old$if original.follow_up_date is distinct from nullif(p_data->>'followUpDate','')::date then$old$,$new$if original.recording_purpose<>'record_only' and original.follow_up_date is distinct from nullif(p_data->>'followUpDate','')::date then$new$);
  execute patched;

  definition:=pg_get_functiondef('public.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$p_action in ('update_encounter','update_vaccination')$old$,$new$p_action='update_vaccination'$new$);
  if patched=definition then raise exception 'Expected public clinician guard'; end if; execute patched;

  definition:=pg_get_functiondef('private.create_queued_encounter(jsonb)'::regprocedure);
  patched:=replace(definition,$old$doctor uuid:=coalesce(nullif(p_data->>'veterinarianId','')::uuid,auth.uid());$old$,$new$doctor uuid:=coalesce(nullif(p_data->>'assignedStaffId','')::uuid,nullif(p_data->>'veterinarianId','')::uuid,auth.uid());$new$);
  patched:=replace(patched,$old$p_data||jsonb_build_object('veterinarianId',doctor)$old$,$new$p_data||case when p_data ? 'veterinarianName' then '{}'::jsonb else jsonb_build_object('veterinarianId',doctor) end$new$);
  if patched=definition then raise exception 'Expected queued identity branch'; end if;
  patched:=replace(patched,$old$  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;$old$,$new$  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_data->>'recordingPurpose'='record_only' then raise exception 'VALIDATION_FAILED: use direct historical recording'; end if;$new$);
  execute patched;

  definition:=pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$array['type','encounteredAt','veterinarianId',$old$,$new$array['type','encounteredAt','veterinarianId','veterinarianName','assignedStaffId',$new$);
  patched:=replace(patched,$old$if nullif(record_data->>'veterinarianId','') is not null and (record_data->>'veterinarianId')::uuid is distinct from entry.veterinarian_id then$old$,$new$if nullif(record_data->>case when entry.category='checkup' and record_data ? 'veterinarianName' then 'assignedStaffId' else 'veterinarianId' end,'') is not null and nullif(record_data->>case when entry.category='checkup' and record_data ? 'veterinarianName' then 'assignedStaffId' else 'veterinarianId' end,'')::uuid is distinct from entry.veterinarian_id then$new$);
  patched:=replace(patched,$old$nullif(record_data->>'veterinarianId','')::uuid is distinct from entry.veterinarian_id then$old$,$new$nullif(record_data->>case when entry.category='checkup' and record_data ? 'veterinarianName' then 'assignedStaffId' else 'veterinarianId' end,'')::uuid is distinct from entry.veterinarian_id then$new$);
  if patched=definition then raise exception 'Expected queue clinician guards'; end if; execute patched;

  foreach signature in array array['private.complete_checkup(jsonb)','private.save_checkup_progress(jsonb)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    patched:=replace(definition,$old$'veterinarianId',p_data->>'veterinarianId'$old$,$new$'veterinarianId',coalesce(p_data->>'assignedStaffId',p_data->>'veterinarianId')$new$);
    patched:=replace(patched,$old$nullif(p_data->>'veterinarianId','')::uuid then$old$,$new$nullif(coalesce(p_data->>'assignedStaffId',p_data->>'veterinarianId'),'')::uuid then$new$);
    if patched=definition then raise exception 'Expected completion identity guard'; end if; execute patched;
  end loop;
  definition:=pg_get_functiondef('private.follow_up_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,$old$if not found or original.follow_up_date is null then$old$,$new$if not found or original.recording_purpose='record_only' or original.follow_up_date is null then$new$);
  if patched=definition then raise exception 'Expected follow-up record lookup'; end if; execute patched;
end $migration$;

-- No browser access to new private helpers; all writes still pass the audited RPC.
revoke all on function private.guard_visit_recording_mode(),private.guard_recording_vitals(),private.guard_historical_queue_link(),private.prepare_historical_prescription(),private.save_historical_prescription(jsonb,boolean),private.create_record_only_checkup(jsonb) from public,anon,authenticated;
grant execute on function private.guard_visit_recording_mode(),private.guard_recording_vitals(),private.guard_historical_queue_link(),private.prepare_historical_prescription(),private.save_historical_prescription(jsonb,boolean),private.create_record_only_checkup(jsonb) to veterina_rpc;
notify pgrst,'reload schema';
