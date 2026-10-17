-- Harden the original scaffold and make every frontend write transactional.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create function private.staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active;
$$;
revoke all on function private.staff_role() from public, anon;
grant execute on function private.staff_role() to authenticated, service_role;
create or replace function public.current_staff_role() returns public.staff_role
language sql stable security invoker set search_path = '' as $$ select private.staff_role(); $$;
create or replace function public.is_clinic_staff() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.staff_role() is not null; $$;
create or replace function public.is_clinic_owner() returns boolean
language sql stable security invoker set search_path = '' as $$ select coalesce(private.staff_role() = 'owner', false); $$;

alter table public.reminders add column visit_id uuid references public.visits(id);
create unique index reminders_visit_once on public.reminders(visit_id) where reminder_type = 'follow_up';
create unique index reminders_vaccination_once on public.reminders(vaccination_id) where reminder_type = 'vaccination';
alter table public.pets add column baseline_weight numeric(7,2) check (baseline_weight > 0);
alter table public.inventory_items add column allows_fraction boolean not null default false;
alter table public.clinic_settings add column ai_enabled boolean not null default false;
alter table public.clinic_settings add column ai_daily_request_limit integer not null default 100 check (ai_daily_request_limit between 1 and 10000);
create unique index clinic_settings_singleton on public.clinic_settings ((true));
alter table public.appointments alter column veterinarian_id set not null;
alter table public.appointments add constraint appointments_pet_no_overlap exclude using gist
  (pet_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('pending', 'confirmed', 'arrived', 'in_progress'));
alter table public.vaccinations add constraint vaccination_date_order check (next_due_at is null or next_due_at > administered_at);
alter table public.pets add constraint microchip_format check (microchip_number is null or microchip_number ~ '^[0-9]{15}$');

create table public.idempotency_keys (
  user_id uuid not null references public.profiles(id), endpoint text not null, key uuid not null,
  response jsonb, request_hash text, created_at timestamptz not null default now(), primary key(user_id, endpoint, key)
);
create table public.visit_corrections (
  id uuid primary key default gen_random_uuid(), visit_id uuid not null references public.visits(id),
  reason text not null check (length(trim(reason)) > 0), correction text not null,
  recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.export_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
  report_type text not null, row_count integer not null, created_at timestamptz not null default now()
);
create table public.appointment_events (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id),
  status public.appointment_status not null, performed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Replace ALL permissive policies in this application's public tables.
do $$ declare r record; t text; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and tablename=any(array['profiles','clinic_settings','owners','owner_contacts','pets','pet_alerts','visits','visit_vitals','diagnoses','treatments','prescriptions','vaccinations','attachments','service_types','appointments','reminders','reminder_activity','suppliers','inventory_items','item_suppliers','inventory_batches','inventory_movements','audit_logs','idempotency_keys','visit_corrections','export_events','appointment_events']) loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename=any(array['profiles','clinic_settings','owners','owner_contacts','pets','pet_alerts','visits','visit_vitals','diagnoses','treatments','prescriptions','vaccinations','attachments','service_types','appointments','reminders','reminder_activity','suppliers','inventory_items','item_suppliers','inventory_batches','inventory_movements','audit_logs','idempotency_keys','visit_corrections','export_events','appointment_events']) loop
    t := r.tablename;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if t in ('audit_logs','export_events','idempotency_keys') then
      execute format('create policy owner_read on public.%I for select to authenticated using ((select private.staff_role()) = ''owner'')', t);
    else
      execute format('create policy staff_read on public.%I for select to authenticated using ((select private.staff_role()) is not null)', t);
    end if;
  end loop;
end $$;
revoke all on public.inventory_on_hand from anon;
grant select on public.inventory_on_hand to authenticated;
revoke all on sequence public.pet_record_number_seq,public.audit_logs_id_seq from anon,authenticated;
grant all on sequence public.pet_record_number_seq,public.audit_logs_id_seq to service_role;

-- Existing trigger functions stay attached by OID, but leave the exposed schema.
alter function public.prevent_role_escalation() set schema private;
alter function private.prevent_role_escalation() set search_path = '';
alter function public.write_audit_log() set schema private;
alter function private.write_audit_log() set search_path = '';
alter function public.create_vaccine_reminder() set schema private;
alter function private.create_vaccine_reminder() set search_path = '';
alter function public.owner_only_permanent_delete() set schema private;
alter function private.owner_only_permanent_delete() set search_path = '';
alter function public.protect_finalized_visit() set schema private;
alter function private.protect_finalized_visit() set search_path = '';
alter function public.set_updated_at() set schema private;
alter function private.set_updated_at() set search_path = '';
create or replace function private.prevent_role_escalation() returns trigger
language plpgsql security invoker set search_path = '' as $$ begin
  if current_setting('role',true) = 'service_role' then return new; end if;
  if not public.is_clinic_owner() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.prc_license_number is distinct from old.prc_license_number) then
    raise exception 'FORBIDDEN: owner required';
  end if;
  return new;
end $$;
create or replace function private.protect_finalized_visit() returns trigger
language plpgsql security invoker set search_path = '' as $$ begin
  if old.finalized_at is not null then raise exception 'RECORD_FINALIZED: append a correction instead'; end if;
  if new.finalized_at is not null then new.finalized_by := auth.uid(); end if;
  return new;
end $$;

create function private.mutate(p_action text, p_data jsonb, p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid(); role_name public.staff_role := private.staff_role();
  result jsonb; entity uuid; pet uuid; doctor uuid; item uuid; batch uuid;
  quantity numeric; balance numeric; duration integer; start_time timestamptz; prior text; saved_hash text;
begin
  if role_name is null then raise exception 'FORBIDDEN: active staff required'; end if;
  if p_key is null then raise exception 'VALIDATION_FAILED: idempotency key required'; end if;
  insert into public.idempotency_keys(user_id, endpoint, key, request_hash) values(u, p_action, p_key, md5(p_data::text)) on conflict do nothing;
  select response,request_hash into result,saved_hash from public.idempotency_keys where user_id=u and endpoint=p_action and key=p_key for update;
  if saved_hash is not null and saved_hash<>md5(p_data::text) then raise exception 'VALIDATION_FAILED: retry payload changed; reload to confirm the original saved record';end if;
  if result is not null then return result; end if;
  pet := nullif(p_data->>'petId','')::uuid;
  if p_action = 'create_owner' then
    if length(trim(coalesce(p_data->>'fullName',''))) = 0 or length(trim(coalesce(p_data->>'phone',''))) = 0 then
      raise exception 'VALIDATION_FAILED: name and phone required'; end if;
    insert into public.owners(full_name,phone,email,address,emergency_contact,created_by)
    values(trim(p_data->>'fullName'),p_data->>'phone',nullif(p_data->>'email',''),coalesce(p_data->>'address',''),p_data->>'emergencyContact',u) returning id into entity;
  elsif p_action = 'create_pet' then
    insert into public.pets(owner_id,name,species,breed,sex,reproductive_status,birth_date,color_markings,microchip_number,baseline_weight,created_by)
    values((p_data->>'ownerId')::uuid,trim(p_data->>'name'),p_data->>'species',coalesce(p_data->>'breed',''),p_data->>'sex',p_data->>'reproductiveStatus',
      nullif(p_data->>'birthDate','')::date,p_data->>'color',nullif(regexp_replace(p_data->>'microchip','\s','','g'),''),nullif(p_data->>'latestWeight','')::numeric,u) returning id into entity;
    if length(trim(coalesce(p_data->>'allergies',''))) > 0 then
      insert into public.pet_alerts(pet_id,alert_type,description,created_by) values(entity,'allergy',p_data->>'allergies',u);
    end if;
  elsif p_action = 'create_encounter' then
    doctor := coalesce(nullif(p_data->>'veterinarianId','')::uuid,u);
    if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: inactive veterinarian'; end if;
    insert into public.visits(pet_id,visit_type,chief_complaint,subjective,objective,assessment,plan,diagnosis_summary,attending_veterinarian_id,recorded_by,follow_up_date)
    values(pet,p_data->>'type',p_data->>'complaint',coalesce(p_data->>'subjective',''),coalesce(p_data->>'objective',''),coalesce(p_data->>'assessment',''),
      coalesce(p_data->>'plan',''),coalesce(p_data->>'diagnosis',''),doctor,u,nullif(p_data->>'followUpDate','')::date) returning id into entity;
    insert into public.visit_vitals(visit_id,weight_kg,temperature_c,heart_rate_bpm,respiratory_rate_rpm,body_condition_score,hydration,measured_by)
    values(entity,nullif(p_data->>'weightKg','')::numeric,nullif(p_data->>'temperatureC','')::numeric,nullif(p_data->>'heartRate','')::integer,
      nullif(p_data->>'respiratoryRate','')::integer,nullif(p_data->>'bodyConditionScore','')::integer,p_data->>'hydration',u);
    if nullif(p_data->>'followUpDate','') is not null then
      insert into public.reminders(pet_id,visit_id,reminder_type,title,notes,due_at,created_by)
      values(pet,entity,'follow_up',(p_data->>'type') || ' follow-up',coalesce(p_data->>'plan',''),(p_data->>'followUpDate')::date::timestamp at time zone 'Asia/Manila',u);
    end if;
  elsif p_action = 'create_vaccination' then
    doctor := coalesce(nullif(p_data->>'veterinarianId','')::uuid,u);
    if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: inactive veterinarian'; end if;
    insert into public.vaccinations(pet_id,vaccine_name,lot_number,dose,administered_at,next_due_at,administered_by)
    values(pet,p_data->>'vaccine',p_data->>'lotNumber',p_data->>'dose',(p_data->>'administeredAt')::date,nullif(p_data->>'nextDueAt','')::date,doctor) returning id into entity;
  elsif p_action = 'book_appointment' then
    doctor := (p_data->>'veterinarianId')::uuid;
    if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
    select id, default_duration_minutes into item,duration from public.service_types where name=p_data->>'service' and is_active;
    if item is null then raise exception 'VALIDATION_FAILED: unknown service'; end if;
    start_time := ((p_data->>'date') || ' ' || (p_data->>'time'))::timestamp at time zone 'Asia/Manila';
    insert into public.appointments(pet_id,service_type_id,starts_at,ends_at,veterinarian_id,notes,created_by)
    values(pet,item,start_time,start_time + make_interval(mins=>duration),doctor,coalesce(p_data->>'notes',''),u) returning id into entity;
    insert into public.appointment_events(appointment_id,status,performed_by) values(entity,'confirmed',u);
  elsif p_action = 'transition_appointment' then
    entity := (p_data->>'id')::uuid;
    select status::text into prior from public.appointments where id=entity for update;
    if prior is null then raise exception 'NOT_FOUND'; end if;
    if not ((prior='confirmed' and p_data->>'status' in ('arrived','cancelled','no_show')) or
      (prior='arrived' and p_data->>'status' in ('in_progress','cancelled')) or
      (prior='in_progress' and p_data->>'status'='completed')) then raise exception 'INVALID_TRANSITION'; end if;
    update public.appointments set status=(p_data->>'status')::public.appointment_status where id=entity;
    insert into public.appointment_events(appointment_id,status,performed_by) values(entity,(p_data->>'status')::public.appointment_status,u);
  elsif p_action = 'complete_reminder' then
    entity := (p_data->>'id')::uuid;
    if length(trim(coalesce(p_data->>'outcome',''))) = 0 then raise exception 'VALIDATION_FAILED: outcome required'; end if;
    perform 1 from public.reminders where id=entity for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    update public.reminders set status='completed',outcome=p_data->>'outcome',completed_at=now(),completed_by=u where id=entity and status<>'completed';
    if found then insert into public.reminder_activity(reminder_id,action,note,performed_by) values(entity,'completed',p_data->>'outcome',u); end if;
  elsif p_action = 'create_supplier' then
    insert into public.suppliers(name,contact_person,phone,email,address,ordering_notes,created_by)
    values(p_data->>'name',p_data->>'contactPerson',p_data->>'phone',nullif(p_data->>'email',''),p_data->>'address',coalesce(p_data->>'notes',''),u) returning id into entity;
  elsif p_action = 'create_inventory_item' then
    insert into public.inventory_items(sku,name,category,unit,minimum_stock,allows_fraction,created_by)
    values(p_data->>'sku',p_data->>'name',p_data->>'category',p_data->>'unit',coalesce(nullif(p_data->>'minimumStock','')::numeric,0),coalesce((p_data->>'allowsFraction')::boolean,false),u) returning id into entity;
    insert into public.inventory_batches(item_id,supplier_id,lot_number,expiration_date)
    values(entity,nullif(p_data->>'supplierId','')::uuid,nullif(p_data->>'lotNumber',''),nullif(p_data->>'expirationDate','')::date);
    if nullif(p_data->>'supplierId','') is not null then insert into public.item_suppliers(item_id,supplier_id,is_preferred) values(entity,(p_data->>'supplierId')::uuid,true); end if;
  elsif p_action = 'record_inventory_movement' then
    item := (p_data->>'id')::uuid; batch := nullif(p_data->>'batchId','')::uuid; quantity := (p_data->>'delta')::numeric;
    perform 1 from public.inventory_items where id=item and is_active for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if quantity is null or quantity=0 or length(trim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: quantity and reason required'; end if;
    if quantity<>trunc(quantity) and not (select allows_fraction from public.inventory_items where id=item) then raise exception 'VALIDATION_FAILED: whole units required'; end if;
    if batch is null or not exists(select 1 from public.inventory_batches where id=batch and item_id=item) then raise exception 'VALIDATION_FAILED: batch required'; end if;
    if quantity<0 and p_data->>'reason' <> 'Expired / damaged' and exists(select 1 from public.inventory_batches where id=batch and expiration_date < (now() at time zone 'Asia/Manila')::date) then raise exception 'EXPIRED_BATCH'; end if;
    select coalesce(sum(quantity_delta),0) into balance from public.inventory_movements where item_id=item and batch_id=batch;
    if balance+quantity<0 then raise exception 'INSUFFICIENT_STOCK'; end if;
    if p_data->>'reason'='Physical count correction' and role_name<>'owner' then raise exception 'FORBIDDEN: owner adjustment required'; end if;
    insert into public.inventory_movements(item_id,batch_id,movement_type,quantity_delta,reason,performed_by)
    values(item,batch,case when p_data->>'reason'='Physical count correction' then 'adjustment'::public.stock_movement_type when quantity>0 then 'stock_in'::public.stock_movement_type else 'stock_out'::public.stock_movement_type end,quantity,p_data->>'reason',u) returning id into entity;
  elsif p_action = 'save_settings' then
    if role_name<>'owner' then raise exception 'FORBIDDEN'; end if;
    update public.clinic_settings set clinic_name=p_data->>'clinicName',phone=p_data->>'phone',email=p_data->>'email',address=p_data->>'address',
      ai_enabled=coalesce((p_data->>'aiEnabled')::boolean,false),record_retention_years=coalesce((p_data->>'retentionYears')::integer,10) returning id into entity;
    update public.profiles set full_name=p_data->>'fullName',prc_license_number=p_data->>'prcLicenseNumber',ptr_number=p_data->>'ptrNumber',license_expires_on=nullif(p_data->>'licenseExpiresOn','')::date where id=u;
  elsif p_action = 'finalize_encounter' then
    entity := (p_data->>'id')::uuid;
    update public.visits set finalized_at=now(),finalized_by=u where id=entity and finalized_at is null;
    if not found then raise exception 'NOT_FOUND: missing or finalized encounter'; end if;
  elsif p_action = 'correct_encounter' then
    if role_name<>'owner' then raise exception 'FORBIDDEN'; end if;
    entity := (p_data->>'id')::uuid;
    insert into public.visit_corrections(visit_id,reason,correction,recorded_by) values(entity,p_data->>'reason',p_data->>'correction',u);
  elsif p_action = 'create_prescription' then
    entity := (p_data->>'visitId')::uuid;
    perform 1 from public.visits where id=entity and finalized_at is null for update;
    if not found then raise exception 'RECORD_FINALIZED: select an open encounter'; end if;
    insert into public.prescriptions(visit_id,medication_name,dose,frequency,instructions,prescribed_by)
    values(entity,p_data->>'medicationName',p_data->>'dose',p_data->>'frequency',coalesce(p_data->>'instructions',''),u) returning id into entity;
  else raise exception 'VALIDATION_FAILED: unknown action';
  end if;
  result := jsonb_build_object('id',entity);
  update public.idempotency_keys set response=result where user_id=u and endpoint=p_action and key=p_key;
  return result;
exception when exclusion_violation then raise exception 'APPOINTMENT_CONFLICT';
end $$;
revoke all on function private.mutate(text,jsonb,uuid) from public, anon;
grant execute on function private.mutate(text,jsonb,uuid) to authenticated;

-- The API surface is invoker-only; privileged implementations are private.
do $$ declare action text; begin
  foreach action in array array['create_owner','create_pet','create_encounter','create_vaccination','book_appointment','transition_appointment','complete_reminder','create_supplier','create_inventory_item','record_inventory_movement','save_settings','finalize_encounter','correct_encounter','create_prescription'] loop
    execute format('create function public.%I(p_data jsonb, p_key uuid) returns jsonb language sql security invoker set search_path = '''' as $body$ select private.mutate(%L,p_data,p_key); $body$', action, action);
  end loop;
end $$;
-- Disable legacy bypass paths; keep their definitions for migration history.
revoke execute on function public.record_inventory_movement(uuid,uuid,numeric,text,text,uuid) from public, anon, authenticated;
alter function public.record_inventory_movement(uuid,uuid,numeric,text,text,uuid) set schema private;
alter function public.refresh_reminder_statuses() set schema private;
alter function private.refresh_reminder_statuses() set search_path = '';
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['current_staff_role','is_clinic_staff','is_clinic_owner','create_owner','create_pet','create_encounter','create_vaccination','book_appointment','transition_appointment','complete_reminder','create_supplier','create_inventory_item','record_inventory_movement','save_settings','finalize_encounter','correct_encounter','create_prescription']) loop
    execute format('revoke all on function %s from public,anon',r.signature);
    execute format('grant execute on function %s to authenticated',r.signature);
  end loop;
end $$;
revoke all on function private.record_inventory_movement(uuid,uuid,numeric,text,text,uuid) from public, anon, authenticated;
revoke all on function private.refresh_reminder_statuses() from public, anon, authenticated;
revoke all on function private.write_audit_log(), private.prevent_role_escalation(), private.create_vaccine_reminder(), private.owner_only_permanent_delete(), private.protect_finalized_visit(), private.set_updated_at() from public, anon, authenticated;

-- Storage policies use the same active-staff check and explicit roles.
drop policy "staff read clinic files" on storage.objects;
drop policy "staff upload clinic files" on storage.objects;
drop policy "owner deletes clinic files" on storage.objects;
create policy staff_read_clinic_files on storage.objects for select to authenticated
using(bucket_id in ('pet-photos','medical-attachments') and (select private.staff_role()) is not null);
create policy staff_upload_clinic_files on storage.objects for insert to authenticated
with check(bucket_id in ('pet-photos','medical-attachments') and (select private.staff_role()) is not null);
create policy owner_delete_clinic_files on storage.objects for delete to authenticated
using(bucket_id in ('pet-photos','medical-attachments') and (select private.staff_role())='owner');

-- Index foreign-key and policy lookups (without duplicating leading existing indexes).
do $$ declare r record; begin
  for r in select t.relname as tbl,a.attname as col from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
    where c.contype='f' and n.nspname='public' and not exists
    (select 1 from pg_index i where i.indrelid=t.oid and i.indkey[0]=a.attnum)
  loop execute format('create index if not exists %I on public.%I(%I)',r.tbl || '_' || r.col || '_fk_idx',r.tbl,r.col); end loop;
end $$;
do $$ declare t text; begin
  foreach t in array array['owners','profiles','clinic_settings','appointments','reminders','suppliers','inventory_items','inventory_batches','visit_corrections','prescriptions'] loop
    execute format('create trigger audit_backend after insert or update or delete on public.%I for each row execute function private.write_audit_log()', t);
  end loop;
end $$;

create function private.export_report(p_report text, p_patient_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ declare result jsonb; begin
  if private.staff_role() is distinct from 'owner'::public.staff_role then raise exception 'FORBIDDEN'; end if;
  if p_report='patients' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select p.record_number,p.name,p.species,p.breed,p.microchip_number,o.full_name,o.phone from public.pets p join public.owners o on o.id=p.owner_id order by p.record_number) x;
  elsif p_report='vaccinations' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select p.name,v.vaccine_name,v.administered_at,v.next_due_at from public.vaccinations v join public.pets p on p.id=v.pet_id order by v.next_due_at) x;
  elsif p_report='inventory' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from public.inventory_on_hand x;
  elsif p_report='reminders' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select p.name,r.title,r.due_at,r.status,r.outcome from public.reminders r join public.pets p on p.id=r.pet_id order by r.due_at) x;
  elsif p_report='history' and p_patient_id is not null then
    select jsonb_build_array(jsonb_build_object('patient',to_jsonb(p),'visits',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.visits v where v.pet_id=p.id),
      'vitals',(select coalesce(jsonb_agg(to_jsonb(vt)),'[]') from public.visit_vitals vt join public.visits v on v.id=vt.visit_id where v.pet_id=p.id),
      'vaccinations',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.vaccinations v where v.pet_id=p.id),
      'prescriptions',(select coalesce(jsonb_agg(to_jsonb(pr)),'[]') from public.prescriptions pr join public.visits v on v.id=pr.visit_id where v.pet_id=p.id),
      'corrections',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.visit_corrections c join public.visits v on v.id=c.visit_id where v.pet_id=p.id))) into result from public.pets p where p.id=p_patient_id;
    if result is null then raise exception 'NOT_FOUND'; end if;
  else raise exception 'VALIDATION_FAILED: unknown report'; end if;
  insert into public.export_events(user_id,report_type,row_count) values(auth.uid(),p_report,jsonb_array_length(result));
  return result;
end $$;
revoke all on function private.export_report(text,uuid) from public, anon;
grant execute on function private.export_report(text,uuid) to authenticated;
create function public.export_report(p_report text,p_patient_id uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.export_report(p_report,p_patient_id); $$;
revoke all on function public.export_report(text,uuid) from public, anon;
grant execute on function public.export_report(text,uuid) to authenticated;

create or replace view public.inventory_on_hand with(security_invoker=true) as
select i.id,i.sku,i.name,i.category,i.unit,i.minimum_stock,
  coalesce((select sum(m.quantity_delta) from public.inventory_movements m where m.item_id=i.id),0) as quantity_on_hand,
  (select min(b.expiration_date) from public.inventory_batches b where b.item_id=i.id
    and coalesce((select sum(m.quantity_delta) from public.inventory_movements m where m.batch_id=b.id),0)>0) as nearest_expiration
from public.inventory_items i;
