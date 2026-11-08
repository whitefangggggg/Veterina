-- KAN-19. Admission writes run inside the existing payload-bound portal receipt.
alter table public.visits drop constraint visits_recording_purpose_check;
alter table public.visits add constraint visits_recording_purpose_check
  check(recording_purpose in ('queue','record_only','admission'));

create table public.admission_wards (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  version integer not null default 0,
  unique(clinic_id,name)
);
create table public.admission_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  ward_id uuid not null references public.admission_wards(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  kind text not null default 'cage' check(kind in ('cage','kennel')),
  state text not null default 'available' check(state in ('available','occupied','cleaning_required','maintenance')),
  is_active boolean not null default true,
  version integer not null default 0,
  unique(ward_id,name)
);
create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  pet_id uuid not null references public.pets(id) on delete restrict,
  visit_id uuid not null unique references public.visits(id) on delete restrict,
  reference text not null default ('ADM-'||upper(gen_random_uuid()::text)),
  status text not null default 'admitted' check(status in ('admitted','under_treatment','ready_for_discharge','discharged','cancelled')),
  condition text not null check(condition in ('stable','critical','improving','under_observation')),
  admitted_at timestamptz not null check(isfinite(admitted_at)),
  closed_at timestamptz check(isfinite(closed_at)),
  is_historical boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  version integer not null default 0,
  unique(clinic_id,reference),
  check(closed_at is null or closed_at>=admitted_at),
  check((status in ('discharged','cancelled'))=(closed_at is not null)),
  check(not is_historical or status='discharged')
);
create unique index admissions_one_active_patient on public.admissions(clinic_id,pet_id)
  where status not in ('discharged','cancelled');
create index admissions_patient_date on public.admissions(clinic_id,pet_id,admitted_at desc);
create index admissions_visit on public.admissions(visit_id);
create table public.admission_occupancy (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.admission_units(id),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  assigned_by uuid not null default auth.uid() references public.profiles(id),
  released_by uuid references public.profiles(id),
  check(released_at is null or released_at>=assigned_at)
);
create unique index occupancy_one_patient on public.admission_occupancy(admission_id) where released_at is null;
create unique index occupancy_one_unit on public.admission_occupancy(unit_id) where released_at is null;
create table public.admission_observations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  kind text not null check(kind in ('intake','vitals','condition','note')),
  values jsonb not null default '{}' check(jsonb_typeof(values)='object'),
  note text not null default '' check(length(note)<=10000),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  author_name text not null,
  corrects_id uuid unique references public.admission_observations(id),
  correction_reason text,
  check(corrects_id is null or length(btrim(correction_reason))>0)
);
create index admission_observations_page on public.admission_observations(admission_id,recorded_at,id);
create table public.admission_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  event_type text not null,
  details jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  author_name text not null
);
create index admission_events_page on public.admission_events(admission_id,occurred_at,id);
create table public.admission_discharge_summaries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null unique references public.admissions(id),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles(id)
);

-- Explicit grants and tenant checks cover reads as well as every foreign key.
do $$ declare t text; begin
  foreach t in array array['admission_wards','admission_units','admissions','admission_occupancy',
    'admission_observations','admission_events','admission_discharge_summaries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('grant select,insert,update on public.%I to veterina_rpc',t);
    execute format('create policy clinic_read on public.%I for select to authenticated using(clinic_id=(select private.current_clinic_id()))',t);
    execute format('create policy clinic_rpc on public.%I for all to veterina_rpc using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()))',t);
    execute format('create trigger a_clinic_scope before insert or update on public.%I for each row execute function private.enforce_clinic_scope()',t);
    execute format('create trigger audit after insert or update on public.%I for each row execute function private.write_audit_log()',t);
  end loop;
  foreach t in array array['admission_observations','admission_events','admission_discharge_summaries'] loop
    execute format('revoke update on public.%I from veterina_rpc',t);
    execute format('create trigger immutable before update or delete on public.%I for each row execute function private.portal_immutable_ledger()',t);
  end loop;
end $$;
create index admission_units_clinic on public.admission_units(clinic_id,ward_id);
create index admission_occupancy_clinic on public.admission_occupancy(clinic_id,admission_id);

create function private.admission_author() returns text language sql stable security invoker set search_path='' as $$
  select full_name from public.profiles where id=auth.uid() and clinic_id=private.current_clinic_id();
$$;
create function private.admission_event(p_id uuid,p_type text,p_details jsonb default '{}') returns void
language sql security invoker set search_path='' as $$
  insert into public.admission_events(admission_id,event_type,details,author_name)
    values(p_id,p_type,p_details,private.admission_author());
$$;
create function private.admission_values(p_values jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; v numeric;
begin
  if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'VALIDATION_FAILED: measurements must be an object'; end if;
  for k in select jsonb_object_keys(p_values) loop
    if k not in ('weightKg','temperatureC','heartRate','respiratoryRate','bodyConditionScore','hydration','condition') then raise exception 'VALIDATION_FAILED: unknown measurement'; end if;
    if k='condition' then
      if p_values->>k not in ('stable','critical','improving','under_observation') then raise exception 'VALIDATION_FAILED: condition'; end if;
    elsif k='hydration' then
      if jsonb_typeof(p_values->k)<>'string' or length(p_values->>k)>200 then raise exception 'VALIDATION_FAILED: hydration'; end if;
    else
      if jsonb_typeof(p_values->k)<>'number' then raise exception 'VALIDATION_FAILED: numeric measurements required'; end if;
      v:=(p_values->>k)::numeric;
      if v<=0 or v>10000 or (k='temperatureC' and v not between 30 and 45)
        or (k='bodyConditionScore' and (v>9 or v<>trunc(v)))
        or (k in ('heartRate','respiratoryRate') and v<>trunc(v)) then raise exception 'VALIDATION_FAILED: measurement outside supported range'; end if;
    end if;
  end loop;
  return p_values;
end $$;

create function private.admission_assign(p_id uuid,p_unit uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare old_unit uuid; target public.admission_units;
begin
  select unit_id into old_unit from public.admission_occupancy where admission_id=p_id and released_at is null;
  if old_unit is not distinct from p_unit then return; end if;
  perform id from public.admission_units where id in (old_unit,p_unit) order by id for update;
  if p_unit is not null then
    select * into target from public.admission_units where id=p_unit;
    if target.id is null then raise exception 'NOT_FOUND: accommodation'; end if;
    if not target.is_active or target.state<>'available' or not exists(select 1 from public.admission_wards where id=target.ward_id and is_active) then raise exception 'UNIT_UNAVAILABLE'; end if;
    if exists(select 1 from public.admission_occupancy where unit_id=p_unit and released_at is null) then raise exception 'UNIT_UNAVAILABLE'; end if;
  end if;
  update public.admission_occupancy set released_at=clock_timestamp(),released_by=auth.uid() where admission_id=p_id and released_at is null;
  update public.admission_units set state='cleaning_required',version=version+1 where id=old_unit;
  if p_unit is not null then
    insert into public.admission_occupancy(admission_id,unit_id) values(p_id,p_unit);
    update public.admission_units set state='occupied',version=version+1 where id=p_unit;
  end if;
  perform private.admission_event(p_id,'transfer',jsonb_build_object('fromUnitId',old_unit,'toUnitId',p_unit));
end $$;

create function private.admission_snapshot(p_id uuid,p_data jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('version',1,'admission',to_jsonb(a),'encounter',to_jsonb(v),
    'patient',to_jsonb(p),'owner',to_jsonb(o),'clinic',(select to_jsonb(c) from public.clinic_settings c where c.clinic_id=a.clinic_id),
    'veterinarian',(select jsonb_build_object('name',pr.full_name,'prcLicenseNumber',pr.prc_license_number) from public.profiles pr where pr.id=v.attending_veterinarian_id),
    'assessment',p_data->>'assessment','instructions',p_data->>'instructions','followUp',p_data->>'followUp',
    'authorizedBy',private.admission_author(),'authorizedAt',now(),
    'observations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.recorded_at),'[]') from public.admission_observations x where x.admission_id=a.id),
    'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at),'[]') from public.admission_events x where x.admission_id=a.id))
  from public.admissions a join public.visits v on v.id=a.visit_id join public.pets p on p.id=a.pet_id join public.owners o on o.id=p.owner_id where a.id=p_id;
$$;

create function private.admission_facility(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target uuid:=nullif(p_data->>'id','')::uuid; unit public.admission_units; ward public.admission_wards; next_state text;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_action='facility_clean' then
    select * into unit from public.admission_units where id=target for update;
    if unit.id is null then raise exception 'NOT_FOUND'; end if;
    if (p_data->>'expectedVersion')::integer is distinct from unit.version then raise exception 'RECORD_CHANGED'; end if;
    if unit.state<>'cleaning_required' or not unit.is_active then raise exception 'INVALID_TRANSITION'; end if;
    update public.admission_units set state='available',version=version+1 where id=target;
  else
    if private.staff_role()<>'owner' then raise exception 'FORBIDDEN: owner-managed facilities'; end if;
    if p_action='facility_ward' then
      if target is null then
        insert into public.admission_wards(name) values(btrim(p_data->>'name')) returning id into target;
      else
        select * into ward from public.admission_wards where id=target for update;
        if ward.id is null then raise exception 'NOT_FOUND'; end if;
        if (p_data->>'expectedVersion')::integer is distinct from ward.version then raise exception 'RECORD_CHANGED'; end if;
        -- Lock child units before checking occupancy/archival.
        perform id from public.admission_units where ward_id=target order by id for update;
        if not coalesce((p_data->>'isActive')::boolean,true) and exists(select 1 from public.admission_units where ward_id=target and state='occupied') then raise exception 'UNIT_OCCUPIED'; end if;
        update public.admission_wards set name=btrim(p_data->>'name'),is_active=coalesce((p_data->>'isActive')::boolean,true),version=version+1 where id=target;
      end if;
    elsif p_action='facility_unit' then
      if target is null then
        if not exists(select 1 from public.admission_wards where id=(p_data->>'wardId')::uuid and is_active) then raise exception 'NOT_FOUND: active ward'; end if;
        insert into public.admission_units(ward_id,name,kind) values((p_data->>'wardId')::uuid,btrim(p_data->>'name'),p_data->>'kind') returning id into target;
      else
        select * into unit from public.admission_units where id=target for update;
        if unit.id is null then raise exception 'NOT_FOUND'; end if;
        if (p_data->>'expectedVersion')::integer is distinct from unit.version then raise exception 'RECORD_CHANGED'; end if;
        next_state:=coalesce(p_data->>'state',unit.state);
        if next_state='occupied' and unit.state<>'occupied' then raise exception 'INVALID_TRANSITION'; end if;
        if unit.state='occupied' and (next_state<>'occupied' or not coalesce((p_data->>'isActive')::boolean,true)) then raise exception 'UNIT_OCCUPIED'; end if;
        if unit.state='cleaning_required' and next_state='available' then raise exception 'VALIDATION_FAILED: use Mark cleaned'; end if;
        update public.admission_units set name=btrim(p_data->>'name'),kind=coalesce(p_data->>'kind',kind),state=next_state,is_active=coalesce((p_data->>'isActive')::boolean,true),version=version+1 where id=target;
      end if;
    else raise exception 'VALIDATION_FAILED: unknown facility action'; end if;
  end if;
  return jsonb_build_object('id',target);
end $$;

-- Replaced by the next stage; foundation already provides safe discharge.
create function private.admission_care_mutation(p_action text,p_data jsonb,p_admission public.admissions) returns jsonb
language plpgsql security invoker set search_path='' as $$ begin raise exception 'VALIDATION_FAILED: unsupported admission action'; end $$;
create function private.admission_resolve_tasks(p_id uuid,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$ begin return; end $$;
create function private.admission_has_care(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.admission_observations where admission_id=p_id and kind<>'intake');
$$;

create function private.admission_mutation(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.admissions; patient public.pets; v uuid; doctor uuid:=nullif(p_data->>'veterinarianId','')::uuid;
  historical boolean:=p_action='admission_historical_create'; started timestamptz; finished timestamptz;
  name text:=btrim(coalesce(p_data->>'veterinarianName','')); target uuid:=nullif(p_data->>'id','')::uuid;
  result jsonb; obs public.admission_observations; measured timestamptz; vals jsonb; next_status text;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if left(p_action,9)='facility_' then return private.admission_facility(p_action,p_data); end if;
  if p_action in ('admission_create','admission_historical_create') then
    select * into patient from public.pets where id=(p_data->>'petId')::uuid for update;
    if patient.id is null then raise exception 'NOT_FOUND: patient'; end if;
    if not historical and lower(patient.status::text)<>'active' then raise exception 'VALIDATION_FAILED: active patient required'; end if;
    started:=(p_data->>'admittedAt')::timestamptz;
    if started is null or not isfinite(started) or started>now() then raise exception 'VALIDATION_FAILED: admission time must not be in the future'; end if;
    if length(btrim(coalesce(p_data->>'reason','')))=0 or length(p_data->>'reason')>10000 then raise exception 'VALIDATION_FAILED: admission reason required'; end if;
    if not historical and exists(select 1 from public.admissions where pet_id=patient.id and closed_at is null) then raise exception 'ADMISSION_ACTIVE'; end if;
    if doctor is not null then
      select full_name into name from public.profiles where id=doctor and is_active and is_veterinarian;
      if not found then raise exception 'VALIDATION_FAILED: active designated veterinarian required'; end if;
    elsif not historical then raise exception 'VALIDATION_FAILED: attending veterinarian required'; end if;
    if historical then
      finished:=(p_data->>'dischargedAt')::timestamptz;
      if finished is null or not isfinite(finished) or finished<started or finished>now() then raise exception 'VALIDATION_FAILED: historical discharge date'; end if;
      if p_data ? 'unitId' or p_data ?| array['inventoryItemId','batchId','dispenseQuantity'] then raise exception 'VALIDATION_FAILED: historical stays have no operational effects'; end if;
    end if;
    insert into public.visits(pet_id,visited_at,visit_type,chief_complaint,attending_veterinarian_id,attending_veterinarian_name,recorded_by,recording_purpose)
      values(patient.id,started,'Hospitalization',btrim(p_data->>'reason'),doctor,coalesce(name,''),auth.uid(),case when historical then 'record_only' else 'admission' end) returning id into v;
    insert into public.admissions(pet_id,visit_id,condition,admitted_at,status,closed_at,is_historical,created_by)
      values(patient.id,v,p_data->>'condition',started,case when historical then 'discharged' else 'admitted' end,finished,historical,auth.uid()) returning * into a;
    vals:=private.admission_values(coalesce(p_data->'vitals','{}'))||jsonb_build_object('condition',a.condition);
    insert into public.admission_observations(admission_id,kind,values,note,occurred_at,author_name)
      values(a.id,'intake',vals,coalesce(p_data->>'initialNotes',''),started,private.admission_author());
    perform private.admission_event(a.id,case when historical then 'historical_stay' else 'admitted' end,jsonb_build_object('admittedAt',started));
    if historical then
      -- Historical detail insertion and the richer snapshot are supplied by stage 3.
      perform private.admission_resolve_tasks(a.id,p_data);
      insert into public.admission_discharge_summaries(admission_id,snapshot) values(a.id,private.admission_snapshot(a.id,p_data));
      update public.visits set finalized_at=now(),finalized_by=auth.uid() where id=v;
    elsif nullif(p_data->>'unitId','') is not null then perform private.admission_assign(a.id,(p_data->>'unitId')::uuid); end if;
    return jsonb_build_object('id',a.id,'visitId',v,'version',a.version);
  end if;
  select * into a from public.admissions where id=target for update;
  if a.id is null then raise exception 'NOT_FOUND: admission'; end if;
  if (p_data->>'expectedVersion')::integer is distinct from a.version then raise exception 'RECORD_CHANGED'; end if;
  if a.closed_at is not null and p_action<>'admission_correct' then raise exception 'RECORD_FINALIZED: admission is closed'; end if;
  if p_action='admission_transfer' then
    perform private.admission_assign(a.id,nullif(p_data->>'unitId','')::uuid);
  elsif p_action='admission_transition' then
    next_status:=p_data->>'status';
    if not ((a.status='admitted' and next_status in ('under_treatment','ready_for_discharge'))
      or (a.status='under_treatment' and next_status='ready_for_discharge')
      or (a.status='ready_for_discharge' and next_status='under_treatment' and length(btrim(coalesce(p_data->>'reason','')))>0)) then raise exception 'INVALID_TRANSITION'; end if;
    update public.admissions set status=next_status where id=a.id;
    perform private.admission_event(a.id,'status',jsonb_build_object('from',a.status,'to',next_status,'reason',p_data->>'reason'));
  elsif p_action='admission_cancel' then
    if private.staff_role()<>'owner' then raise exception 'FORBIDDEN'; end if;
    if a.status<>'admitted' or private.admission_has_care(a.id) then raise exception 'INVALID_TRANSITION: discharge after care'; end if;
    if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: cancellation reason required'; end if;
    perform private.admission_assign(a.id,null);
    update public.admissions set status='cancelled',closed_at=clock_timestamp() where id=a.id;
    update public.visits set finalized_at=now(),finalized_by=auth.uid() where id=a.visit_id;
    perform private.admission_event(a.id,'cancelled',jsonb_build_object('reason',p_data->>'reason'));
  elsif p_action='admission_discharge' then
    if a.status<>'ready_for_discharge' then raise exception 'INVALID_TRANSITION: mark ready for discharge first'; end if;
    if length(btrim(coalesce(p_data->>'assessment','')))=0 or length(btrim(coalesce(p_data->>'instructions','')))=0 then raise exception 'VALIDATION_FAILED: discharge assessment and instructions required'; end if;
    perform private.admission_resolve_tasks(a.id,p_data);
    perform private.admission_assign(a.id,null);
    update public.admissions set status='discharged',condition=p_data->>'condition',closed_at=clock_timestamp() where id=a.id;
    perform private.admission_event(a.id,'discharged',jsonb_build_object('condition',p_data->>'condition'));
    update public.visits set finalized_at=now(),finalized_by=auth.uid() where id=a.visit_id;
    insert into public.admission_discharge_summaries(admission_id,snapshot) values(a.id,private.admission_snapshot(a.id,p_data));
  elsif p_action in ('admission_observe','admission_correct') and not(p_data ? 'administrationId') then
    if p_action='admission_correct' then
      if private.staff_role()<>'owner' then raise exception 'FORBIDDEN: owner correction required'; end if;
      select * into obs from public.admission_observations where id=(p_data->>'correctsId')::uuid and admission_id=a.id;
      if obs.id is null then raise exception 'NOT_FOUND: observation'; end if;
      if exists(select 1 from public.admission_observations where corrects_id=obs.id) then raise exception 'RECORD_CHANGED: correct the latest entry'; end if;
      if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: correction reason required'; end if;
    end if;
    measured:=coalesce((p_data->>'occurredAt')::timestamptz,obs.occurred_at,now());
    if not isfinite(measured) or measured<a.admitted_at or measured>coalesce(a.closed_at,now()) then raise exception 'VALIDATION_FAILED: observation time outside stay'; end if;
    vals:=private.admission_values(coalesce(p_data->'values','{}'));
    if coalesce(obs.kind,p_data->>'kind') not in ('intake','vitals','condition','note') or (p_action='admission_observe' and p_data->>'kind'='intake') then raise exception 'VALIDATION_FAILED: observation kind'; end if;
    if coalesce(obs.kind,p_data->>'kind')='condition' and not(vals ? 'condition') then raise exception 'VALIDATION_FAILED: condition required'; end if;
    if coalesce(obs.kind,p_data->>'kind')='vitals' and vals='{}' then raise exception 'VALIDATION_FAILED: record a measurement'; end if;
    if coalesce(obs.kind,p_data->>'kind')='note' and length(btrim(coalesce(p_data->>'note','')))=0 then raise exception 'VALIDATION_FAILED: note required'; end if;
    insert into public.admission_observations(admission_id,kind,values,note,occurred_at,author_name,corrects_id,correction_reason)
      values(a.id,coalesce(obs.kind,p_data->>'kind'),vals,coalesce(p_data->>'note',''),measured,private.admission_author(),obs.id,p_data->>'reason') returning id into target;
    if vals ? 'condition' and a.closed_at is null then
      update public.admissions set condition=(select x.values->>'condition' from public.admission_observations x where x.admission_id=a.id and x.values ? 'condition'
        and not exists(select 1 from public.admission_observations c where c.corrects_id=x.id) order by x.occurred_at desc,x.recorded_at desc limit 1) where id=a.id;
    end if;
    result:=jsonb_build_object('observationId',target);
  else result:=private.admission_care_mutation(p_action,p_data,a);
  end if;
  update public.admissions set version=version+1 where id=a.id;
  return coalesce(result,'{}')||jsonb_build_object('id',a.id,'version',a.version+1);
end $$;

-- Block legacy checkup actions on inpatient encounters before they obtain visit
-- locks. Admission handlers use their own attributed clinical lifecycle.
create function private.guard_admission_payload(p_action text,p_data jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare visit_uuid uuid;
begin
  if left(p_action,10)='admission_' or left(p_action,9)='facility_' then return p_data; end if;
  if p_data->>'recordingPurpose'='admission' then raise exception 'ADMISSION_WORKSPACE_REQUIRED'; end if;
  if p_action in ('update_encounter','finalize_encounter','correct_encounter','create_prescription','update_prescription','prescribe_and_complete_checkup','complete_checkup','save_checkup_progress','arrive_follow_up','reschedule_follow_up','delete_record','update_record_only_checkup','update_record_only_prescription') then
    visit_uuid:=coalesce(nullif(p_data->>'visitId','')::uuid,nullif(p_data->>'id','')::uuid,nullif(p_data->'checkup'->>'id','')::uuid);
    if p_action in ('update_prescription','update_record_only_prescription') or (p_action='delete_record' and p_data->>'entity'='prescription') then
      select visit_id into visit_uuid from public.prescriptions where id=nullif(p_data->>'id','')::uuid;
    end if;
    if exists(select 1 from public.admissions where visit_id=visit_uuid) then raise exception 'ADMISSION_WORKSPACE_REQUIRED'; end if;
  end if;
  return p_data;
end $$;
do $$ declare d text; patched text; begin
  d:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(d,'p_data:=private.prepare_clinical_payload(p_action,p_data);',
    'p_data:=private.guard_admission_payload(p_action,p_data); p_data:=private.prepare_clinical_payload(p_action,p_data);');
  if patched=d then raise exception 'Expected clinical dispatcher guard missing'; end if;
  d:=patched;
  patched:=replace(d,$old$if p_action in ('create_queued_vaccination'$old$,$new$if left(p_action,10)='admission_' or left(p_action,9)='facility_' then
    result:=private.admission_mutation(p_action,p_data); entity:=(result->>'id')::uuid;
  elsif p_action in ('create_queued_vaccination'$new$);
  if patched=d then raise exception 'Expected admission dispatcher insertion point missing'; end if;
  execute patched;
end $$;

-- Legacy public RPC wrappers call private.mutate directly, bypassing portal.
do $$ declare d text; patched text; begin
  d:=pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched:=replace(d,'p_data:=private.prepare_clinical_payload(p_action,p_data);',
    'p_data:=private.guard_admission_payload(p_action,p_data); p_data:=private.prepare_clinical_payload(p_action,p_data);');
  if patched=d then raise exception 'Expected legacy mutation guard missing'; end if;
  execute patched;
end $$;

-- None of the new private helpers is an independently callable API.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'admission_%' or p.proname='guard_admission_payload') loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to veterina_rpc',r.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
