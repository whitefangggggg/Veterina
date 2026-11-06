-- Historical vaccinations retain clinical evidence without operational side effects.
alter table public.vaccinations add column recording_purpose text not null default 'queue'
  check (recording_purpose in ('queue','record_only'));
alter table public.vaccinations alter column administered_by drop not null;
alter table public.vaccinations add constraint vaccination_queue_clinician check (recording_purpose='record_only' or administered_by is not null);
alter table public.vaccinations add column recorded_by uuid references public.profiles(id) on delete set null default auth.uid();
create index vaccinations_recorded_by_idx on public.vaccinations(recorded_by) where recorded_by is not null;

create function private.guard_vaccination_recording_mode() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.recording_purpose<>old.recording_purpose then raise exception 'VALIDATION_FAILED: recording purpose cannot be changed'; end if;
    new.recorded_by:=old.recorded_by;
  else new.recorded_by:=auth.uid(); end if;
  if new.recording_purpose='record_only' then
    if new.inventory_item_id is not null or new.visit_id is not null then raise exception 'VALIDATION_FAILED: historical vaccinations cannot link inventory or live care'; end if;
    if not isfinite(new.administered_at) or new.administered_at > (now() at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date
      or (new.next_due_at is not null and not isfinite(new.next_due_at)) then raise exception 'VALIDATION_FAILED: invalid historical vaccination date'; end if;
  end if;
  return new;
end $$;
create trigger b_vaccination_recording_mode before insert or update on public.vaccinations for each row execute function private.guard_vaccination_recording_mode();

create function private.guard_historical_vaccine_reminder() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.vaccinations where id=new.vaccination_id and recording_purpose='record_only') then raise exception 'VALIDATION_FAILED: historical vaccinations cannot create reminders'; end if;
  return new;
end $$;
create trigger b_historical_vaccine_reminder before insert or update on public.reminders for each row execute function private.guard_historical_vaccine_reminder();

create function private.save_record_only_vaccination(p_data jsonb,p_update boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.vaccinations; patient uuid; doctor uuid; vaccine_id uuid; name text:=btrim(coalesce(p_data->>'vaccine','')); clinician text:=btrim(coalesce(p_data->>'veterinarianName','')); administered date; due date;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_update then
    select * into original from public.vaccinations where id=(p_data->>'id')::uuid for update;
    if original.id is null then raise exception 'NOT_FOUND'; end if;
    if original.recording_purpose<>'record_only' then raise exception 'VALIDATION_FAILED: historical vaccination required'; end if;
    patient:=original.pet_id;
    if nullif(p_data->>'petId','')::uuid is distinct from patient then raise exception 'VALIDATION_FAILED: patient cannot be changed'; end if;
  else patient:=nullif(p_data->>'petId','')::uuid; end if;
  if not exists(select 1 from public.pets where id=patient) then raise exception 'NOT_FOUND: patient'; end if;
  if p_data ? 'recordingPurpose' and p_data->>'recordingPurpose' is distinct from 'record_only' then raise exception 'VALIDATION_FAILED: recording purpose cannot be changed'; end if;
  if nullif(p_data->>'inventoryItemId','') is not null or nullif(p_data->>'visitId','') is not null or p_data ?| array['batchId','dispenseQuantity','dispenseUnit'] then raise exception 'VALIDATION_FAILED: historical vaccinations cannot dispense or link inventory'; end if;
  if name='' or length(name)>300 or length(clinician)>200 or length(coalesce(p_data->>'brand',''))>300 or length(coalesce(p_data->>'lotNumber',''))>200 or length(coalesce(p_data->>'dose',''))>300 then raise exception 'VALIDATION_FAILED: vaccine name required or details too long'; end if;
  administered:=nullif(p_data->>'administeredAt','')::date;
  due:=nullif(p_data->>'nextDueAt','')::date;
  if administered is null then raise exception 'VALIDATION_FAILED: administration date required'; end if;
  if due is not null and due<=administered then raise exception 'VALIDATION_FAILED: next due date must follow administration'; end if;
  doctor:=nullif(p_data->>'veterinarianId','')::uuid;
  if doctor is not null and not exists(select 1 from public.profiles where id=doctor and (is_active or (p_update and id=original.administered_by))) then raise exception 'VALIDATION_FAILED: active veterinarian required'; end if;
  if p_update then
    update public.vaccinations set vaccine_name=name,brand=nullif(btrim(p_data->>'brand'),''),lot_number=nullif(btrim(p_data->>'lotNumber'),''),dose=nullif(btrim(p_data->>'dose'),''),administered_at=administered,next_due_at=due,administered_by=doctor,administered_by_name=clinician where id=original.id returning id into vaccine_id;
  else
    insert into public.vaccinations(pet_id,vaccine_name,brand,lot_number,dose,administered_at,next_due_at,administered_by,administered_by_name,recording_purpose,recorded_by)
      values(patient,name,nullif(btrim(p_data->>'brand'),''),nullif(btrim(p_data->>'lotNumber'),''),nullif(btrim(p_data->>'dose'),''),administered,due,doctor,clinician,'record_only',auth.uid()) returning id into vaccine_id;
  end if;
  return jsonb_build_object('id',vaccine_id);
end $$;

-- Preserve ownership, privileges, auditing and idempotency of established entry points.
do $migration$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('private.portal_snapshot_clinicians()'::regprocedure);
  patched:=replace(definition,$old$elsif tg_table_name='vaccinations' then
    if tg_op='INSERT'$old$,$new$elsif tg_table_name='vaccinations' then
    if new.administered_by is null then new.administered_by_name:=btrim(coalesce(new.administered_by_name,''));
    elsif tg_op='INSERT'$new$);
  if patched=definition then raise exception 'Expected vaccination snapshot branch'; end if; execute patched;

  definition:=pg_get_functiondef('private.create_vaccine_reminder()'::regprocedure);
  patched:=replace(definition,'if new.next_due_at is not null then', 'if new.recording_purpose<>''record_only'' and new.next_due_at is not null then');
  if patched=definition then raise exception 'Expected vaccine reminder branch'; end if; execute patched;

  definition:=pg_get_functiondef('private.guard_historical_queue_link()'::regprocedure);
  patched:=replace(definition,'if exists(select 1 from public.visits', 'if exists(select 1 from public.vaccinations where id=new.vaccination_id and recording_purpose=''record_only'') or exists(select 1 from public.visits');
  if patched=definition then raise exception 'Expected queue historical guard'; end if; execute patched;

  definition:=pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure);
  patched:=replace(definition,$old$elsif action in ('create_vaccination','update_vaccination') then$old$,$new$elsif action in ('create_vaccination','update_vaccination') then
    if action='update_vaccination' and exists(select 1 from public.vaccinations where id=(data->>'id')::uuid and recording_purpose='record_only') then return data; end if;
    if coalesce(data->>'recordingPurpose','queue')<>'queue' then raise exception 'VALIDATION_FAILED: use direct historical recording'; end if;$new$);
  if patched=definition then raise exception 'Expected vaccination preparation'; end if; execute patched;

  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$if p_action='create_record_only_checkup' then$old$,$new$if p_action='create_record_only_vaccination' or (p_action='update_vaccination' and exists(select 1 from public.vaccinations where id=(p_data->>'id')::uuid and recording_purpose='record_only')) then
    result:=private.save_record_only_vaccination(p_data,p_action='update_vaccination'); entity:=(result->>'id')::uuid;
  elsif p_action='create_record_only_checkup' then$new$);
  if patched=definition then raise exception 'Expected historical dispatch'; end if; execute patched;

  definition:=pg_get_functiondef('public.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$if p_action='update_vaccination' and not exists($old$,$new$if p_action='update_vaccination' and not exists(select 1 from public.vaccinations where id=(p_data->>'id')::uuid and recording_purpose='record_only') and not exists($new$);
  if patched=definition then raise exception 'Expected registered veterinarian guard'; end if; execute patched;
end $migration$;
revoke all on function private.guard_vaccination_recording_mode(),private.guard_historical_vaccine_reminder(),private.save_record_only_vaccination(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.guard_vaccination_recording_mode(),private.guard_historical_vaccine_reminder(),private.save_record_only_vaccination(jsonb,boolean) to veterina_rpc;
notify pgrst,'reload schema';
