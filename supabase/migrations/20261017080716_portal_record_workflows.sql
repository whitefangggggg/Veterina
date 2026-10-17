-- Forward-only extension of the connected Veterina backend. Existing clinic
-- writes keep their transactional paths; browser roles retain read-only tables.

alter table public.owners add column if not exists normalized_phone text
  generated always as (
    case when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^09[0-9]{9}$'
      then '+63' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
      when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^639[0-9]{9}$'
      then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
      else regexp_replace(phone, '[^0-9+]', '', 'g') end
  ) stored;
create index if not exists owners_normalized_phone_idx on public.owners(normalized_phone);

alter table public.owners add constraint portal_owner_identity check (
  length(btrim(full_name)) > 0 and length(btrim(address)) > 0
  and normalized_phone ~ '^\+[1-9][0-9]{7,14}$'
  and (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
alter table public.pets add constraint portal_pet_identity check (
  length(btrim(name)) > 0 and length(btrim(breed)) > 0
  and species in ('Dog','Cat','Bird','Rabbit','Other')
);
alter table public.suppliers add constraint portal_supplier_identity check (
  length(btrim(name)) > 0 and length(btrim(phone)) > 0
  and (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
alter table public.inventory_items add constraint portal_item_identity check (
  length(btrim(sku)) > 0 and length(btrim(name)) > 0 and length(btrim(unit)) > 0
);

create or replace function private.portal_protect_record_number()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.record_number is distinct from old.record_number then
    raise exception 'VALIDATION_FAILED: record numbers cannot be changed';
  end if;
  return new;
end $$;
create trigger pets_immutable_record_number before update on public.pets
for each row execute function private.portal_protect_record_number();

create or replace function private.portal_immutable_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'IMMUTABLE_LEDGER: record a correcting movement instead'; end $$;
create trigger inventory_immutable_ledger before update or delete on public.inventory_movements
for each row execute function private.portal_immutable_ledger();

create or replace function private.portal_protect_visit_children()
returns trigger language plpgsql set search_path = '' as $$
declare visit_uuid uuid;
begin
  visit_uuid := case when tg_op='INSERT' then new.visit_id else old.visit_id end;
  if exists(select 1 from public.visits where id=visit_uuid and finalized_at is not null) then
    raise exception 'RECORD_FINALIZED: append an owner correction instead';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.visits where id=new.visit_id and finalized_at is not null) then
    raise exception 'RECORD_FINALIZED';
  end if;
  return new;
end $$;
create trigger vitals_protect_finalized before insert or update on public.visit_vitals
for each row execute function private.portal_protect_visit_children();
create trigger prescriptions_protect_finalized before insert or update on public.prescriptions
for each row execute function private.portal_protect_visit_children();

create or replace function private.portal_clinic_settings_validation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone)
    or length(btrim(new.clinic_name))=0 then
    raise exception 'VALIDATION_FAILED: clinic name and valid IANA timezone required';
  end if;
  return new;
end $$;
create trigger clinic_settings_validate before insert or update on public.clinic_settings
for each row execute function private.portal_clinic_settings_validation();

-- Read-time display state never relies on a nightly refresh job.
create or replace view public.reminder_worklist with (security_invoker = true) as
select r.*, case when r.status in ('completed','cancelled') then r.status::text
  when (r.due_at at time zone c.timezone)::date < (now() at time zone c.timezone)::date then 'overdue'
  when (r.due_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date then 'due'
  else 'upcoming' end as display_status
from public.reminders r cross join lateral (select timezone from public.clinic_settings limit 1) c;
revoke all on public.reminder_worklist from anon;
grant select on public.reminder_worklist to authenticated;

-- Retain superseded/completed vaccine reminders while allowing one live one.
create unique index reminders_vaccination_open_once on public.reminders(vaccination_id)
where reminder_type='vaccination' and status not in ('completed','cancelled');
drop index public.reminders_vaccination_once;

create or replace function private.portal_mutation(p_action text,p_data jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); staff_role public.staff_role := private.staff_role();
  entity uuid := nullif(p_data->>'id','')::uuid;
  result jsonb; saved_hash text; affected integer; visit_uuid uuid; pet_uuid uuid;
  start_time timestamptz; duration integer; clinic_timezone text;
  original public.visits; old_vaccine public.vaccinations; stock numeric; delta numeric;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if staff_role is null then raise exception 'FORBIDDEN: active staff required'; end if;
  if p_key is null or jsonb_typeof(p_data) <> 'object' then raise exception 'VALIDATION_FAILED'; end if;
  select timezone into clinic_timezone from public.clinic_settings limit 1;
  clinic_timezone := coalesce(clinic_timezone,'Asia/Manila');
  insert into public.idempotency_keys(user_id,endpoint,key,request_hash)
    values(actor,'portal_'||p_action,p_key,md5(p_data::text)) on conflict do nothing;
  select response,request_hash into result,saved_hash from public.idempotency_keys
    where user_id=actor and endpoint='portal_'||p_action and key=p_key for update;
  if saved_hash is distinct from md5(p_data::text) then raise exception 'VALIDATION_FAILED: retry payload changed'; end if;
  if result is not null then return result; end if;

  -- Reuse the established atomic creation and stock functions.
  if p_action in ('create_owner','create_pet','create_supplier','create_inventory_item',
    'create_encounter','create_vaccination','create_prescription','record_inventory_movement',
    'complete_reminder','finalize_encounter','correct_encounter') then
    result := private.mutate(p_action,p_data,p_key);
    entity := (result->>'id')::uuid;
    if p_action='create_encounter' and nullif(p_data->>'encounteredAt','') is not null then
      update public.visits set visited_at=(p_data->>'encounteredAt')::timestamptz where id=entity;
    end if;
  elsif p_action='update_owner' then
    update public.owners set full_name=btrim(p_data->>'fullName'),phone=p_data->>'phone',
      email=nullif(p_data->>'email',''),address=p_data->>'address',emergency_contact=p_data->>'emergencyContact',
      notes=coalesce(p_data->>'notes',''),is_active=coalesce((p_data->>'isActive')::boolean,true)
      where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='update_pet' then
    update public.pets set owner_id=(p_data->>'ownerId')::uuid,name=btrim(p_data->>'name'),
      species=p_data->>'species',breed=p_data->>'breed',sex=p_data->>'sex',reproductive_status=p_data->>'reproductiveStatus',
      birth_date=nullif(p_data->>'birthDate','')::date,color_markings=p_data->>'color',
      microchip_number=nullif(regexp_replace(p_data->>'microchip','\s','','g'),''),
      baseline_weight=nullif(p_data->>'latestWeight','')::numeric,status=p_data->>'status' where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='update_supplier' then
    update public.suppliers set name=btrim(p_data->>'name'),contact_person=p_data->>'contactPerson',phone=p_data->>'phone',
      email=nullif(p_data->>'email',''),address=p_data->>'address',ordering_notes=coalesce(p_data->>'notes',''),
      is_active=coalesce((p_data->>'isActive')::boolean,true) where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='update_inventory_item' then
    update public.inventory_items set sku=p_data->>'sku',name=p_data->>'name',category=p_data->>'category',unit=p_data->>'unit',
      minimum_stock=(p_data->>'minimumStock')::numeric,is_active=coalesce((p_data->>'isActive')::boolean,true)
      where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
    delete from public.item_suppliers where item_id=entity;
    if nullif(p_data->>'supplierId','') is not null then
      insert into public.item_suppliers(item_id,supplier_id,is_preferred) values(entity,(p_data->>'supplierId')::uuid,true);
    end if;
  elsif p_action in ('create_batch','update_batch') then
    if p_action='create_batch' then
      insert into public.inventory_batches(item_id,supplier_id,lot_number,expiration_date,unit_cost)
      values((p_data->>'itemId')::uuid,nullif(p_data->>'supplierId','')::uuid,nullif(p_data->>'lotNumber',''),
        nullif(p_data->>'expirationDate','')::date,nullif(p_data->>'unitCost','')::numeric) returning id into entity;
    else
      update public.inventory_batches set supplier_id=nullif(p_data->>'supplierId','')::uuid,
        lot_number=nullif(p_data->>'lotNumber',''),expiration_date=nullif(p_data->>'expirationDate','')::date,
        unit_cost=nullif(p_data->>'unitCost','')::numeric where id=entity;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
  elsif p_action='record_count_adjustment' then
    if staff_role<>'owner' then raise exception 'FORBIDDEN: owner adjustment required'; end if;
    perform 1 from public.inventory_items where id=entity and is_active for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if (p_data->>'observedQuantity')::numeric < 0 or length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED'; end if;
    select coalesce(sum(quantity_delta),0) into stock from public.inventory_movements where item_id=entity and batch_id=(p_data->>'batchId')::uuid;
    delta := (p_data->>'observedQuantity')::numeric-stock;
    if delta <> 0 then
      result := private.mutate('record_inventory_movement',jsonb_build_object('id',entity,'batchId',p_data->>'batchId','delta',delta,'reason','Physical count correction'),p_key);
    end if;
  elsif p_action='update_encounter' then
    select * into original from public.visits where id=entity for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if original.finalized_at is not null then raise exception 'RECORD_FINALIZED: append a correction instead'; end if;
    update public.visits set visit_type=p_data->>'type',chief_complaint=p_data->>'complaint',subjective=coalesce(p_data->>'subjective',''),
      objective=coalesce(p_data->>'objective',''),assessment=coalesce(p_data->>'assessment',''),plan=coalesce(p_data->>'plan',''),
      diagnosis_summary=coalesce(p_data->>'diagnosis',''),follow_up_date=nullif(p_data->>'followUpDate','')::date,
      visited_at=coalesce(nullif(p_data->>'encounteredAt','')::timestamptz,visited_at),attending_veterinarian_id=(p_data->>'veterinarianId')::uuid where id=entity;
    update public.visit_vitals set weight_kg=nullif(p_data->>'weightKg','')::numeric,temperature_c=nullif(p_data->>'temperatureC','')::numeric,
      heart_rate_bpm=nullif(p_data->>'heartRate','')::integer,respiratory_rate_rpm=nullif(p_data->>'respiratoryRate','')::integer,
      body_condition_score=nullif(p_data->>'bodyConditionScore','')::integer,hydration=p_data->>'hydration' where visit_id=entity;
    if original.follow_up_date is distinct from nullif(p_data->>'followUpDate','')::date then
      update public.reminders set status='cancelled' where visit_id=entity and status<>'completed';
      if nullif(p_data->>'followUpDate','') is not null then
        insert into public.reminders(pet_id,visit_id,reminder_type,title,notes,due_at,created_by)
        values(original.pet_id,entity,'follow_up',(p_data->>'type')||' follow-up',coalesce(p_data->>'plan',''),(p_data->>'followUpDate')::date::timestamp at time zone clinic_timezone,actor)
        on conflict (visit_id) where reminder_type='follow_up' do update set due_at=excluded.due_at,status='upcoming',title=excluded.title,notes=excluded.notes
        where public.reminders.status<>'completed';
      end if;
    end if;
  elsif p_action='update_vaccination' then
    select * into old_vaccine from public.vaccinations where id=entity for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    update public.vaccinations set vaccine_name=p_data->>'vaccine',lot_number=p_data->>'lotNumber',dose=p_data->>'dose',
      administered_at=(p_data->>'administeredAt')::date,next_due_at=nullif(p_data->>'nextDueAt','')::date,
      administered_by=(p_data->>'veterinarianId')::uuid where id=entity;
    if old_vaccine.next_due_at is distinct from nullif(p_data->>'nextDueAt','')::date then
      insert into public.reminder_activity(reminder_id,action,note,performed_by)
        select id,'superseded','Vaccination due date changed',actor from public.reminders where vaccination_id=entity and status<>'completed';
      update public.reminders set status='cancelled' where vaccination_id=entity and status<>'completed';
      if nullif(p_data->>'nextDueAt','') is not null then
        insert into public.reminders(pet_id,vaccination_id,reminder_type,title,due_at,created_by)
        values(old_vaccine.pet_id,entity,'vaccination',(p_data->>'vaccine')||' due',(p_data->>'nextDueAt')::date::timestamp at time zone clinic_timezone,actor);
      end if;
    end if;
  elsif p_action in ('book_appointment','reschedule_appointment') then
    if not exists(select 1 from public.profiles where id=(p_data->>'veterinarianId')::uuid and is_active) then raise exception 'VALIDATION_FAILED: active veterinarian required'; end if;
    select default_duration_minutes into duration from public.service_types where name=p_data->>'service' and is_active;
    if duration is null then raise exception 'VALIDATION_FAILED: unknown service'; end if;
    duration := coalesce(nullif(p_data->>'durationMinutes','')::integer,duration);
    if duration not between 5 and 480 then raise exception 'VALIDATION_FAILED: duration must be 5 to 480 minutes'; end if;
    start_time := ((p_data->>'date')||' '||(p_data->>'time'))::timestamp at time zone clinic_timezone;
    if p_action='book_appointment' then
      insert into public.appointments(pet_id,service_type_id,starts_at,ends_at,veterinarian_id,notes,created_by)
      values((p_data->>'petId')::uuid,(select id from public.service_types where name=p_data->>'service' and is_active),start_time,
        start_time+make_interval(mins=>duration),(p_data->>'veterinarianId')::uuid,coalesce(p_data->>'notes',''),actor) returning id into entity;
      insert into public.appointment_events(appointment_id,status,performed_by) values(entity,'confirmed',actor);
    else
      update public.appointments set pet_id=(p_data->>'petId')::uuid,
        service_type_id=(select id from public.service_types where name=p_data->>'service' and is_active),starts_at=start_time,
        ends_at=start_time+make_interval(mins=>duration),veterinarian_id=(p_data->>'veterinarianId')::uuid,notes=coalesce(p_data->>'notes','')
        where id=entity and status in ('pending','confirmed');
      if not found then raise exception 'INVALID_TRANSITION: only scheduled visits can be rescheduled'; end if;
      insert into public.appointment_events(appointment_id,status,performed_by)
        select id,status,actor from public.appointments where id=entity;
    end if;
  elsif p_action='transition_appointment' then
    result := private.mutate(p_action,p_data,p_key); entity := (result->>'id')::uuid;
  elsif p_action in ('create_reminder','update_reminder','snooze_reminder','cancel_reminder') then
    if p_action='create_reminder' then
      insert into public.reminders(pet_id,reminder_type,title,notes,due_at,priority,assigned_to,created_by)
      values((p_data->>'petId')::uuid,coalesce(p_data->>'reminderType','custom'),p_data->>'title',coalesce(p_data->>'notes',''),
        (p_data->>'dueDate')::date::timestamp at time zone clinic_timezone,coalesce(p_data->>'priority','normal'),nullif(p_data->>'assignedTo','')::uuid,actor) returning id into entity;
    elsif p_action='update_reminder' then
      update public.reminders set title=p_data->>'title',notes=coalesce(p_data->>'notes',''),due_at=(p_data->>'dueDate')::date::timestamp at time zone clinic_timezone,
        priority=p_data->>'priority',assigned_to=nullif(p_data->>'assignedTo','')::uuid where id=entity and status not in ('completed','cancelled');
      if not found then raise exception 'INVALID_TRANSITION'; end if;
    elsif p_action='snooze_reminder' then
      update public.reminders set due_at=(p_data->>'dueDate')::date::timestamp at time zone clinic_timezone,status='snoozed' where id=entity and status not in ('completed','cancelled');
      if not found then raise exception 'INVALID_TRANSITION'; end if;
    else
      update public.reminders set status='cancelled' where id=entity and status<>'completed';
      if not found then raise exception 'INVALID_TRANSITION'; end if;
    end if;
    insert into public.reminder_activity(reminder_id,action,note,performed_by) values(entity,p_action,p_data->>'notes',actor);
  elsif p_action in ('create_alert','resolve_alert') then
    if p_action='create_alert' then
      insert into public.pet_alerts(pet_id,alert_type,description,severity,created_by)
      values((p_data->>'petId')::uuid,p_data->>'alertType',p_data->>'description',coalesce(p_data->>'severity','warning'),actor) returning id into entity;
    else
      update public.pet_alerts set is_active=false,resolved_at=now(),resolved_by=actor where id=entity;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
  elsif p_action='update_prescription' then
    update public.prescriptions set medication_name=p_data->>'medicationName',dose=p_data->>'dose',frequency=p_data->>'frequency',instructions=coalesce(p_data->>'instructions','') where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='save_settings' then
    if staff_role<>'owner' then raise exception 'FORBIDDEN'; end if;
    update public.clinic_settings set clinic_name=p_data->>'clinicName',phone=p_data->>'phone',email=p_data->>'email',address=p_data->>'address',
      timezone=coalesce(p_data->>'timezone',timezone),record_retention_years=(p_data->>'retentionYears')::integer,
      reminder_lead_days=(p_data->>'reminderLeadDays')::integer,ai_enabled=coalesce((p_data->>'aiEnabled')::boolean,false) returning id into entity;
    update public.profiles set full_name=p_data->>'fullName',prc_license_number=p_data->>'prcLicenseNumber',ptr_number=p_data->>'ptrNumber',license_expires_on=nullif(p_data->>'licenseExpiresOn','')::date where id=actor;
  elsif p_action='delete_record' then
    if staff_role<>'owner' then raise exception 'FORBIDDEN: permanent deletion is owner-only'; end if;
    if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: deletion reason required'; end if;
    case p_data->>'entity'
    when 'owner' then
      if exists(select 1 from public.pets where owner_id=entity) then raise exception 'HAS_DEPENDENTS: delete or reassign this owner''s pets first'; end if;
      delete from public.owners where id=entity;
    when 'pet' then
      if exists(select 1 from public.attachments where pet_id=entity) then raise exception 'HAS_ATTACHMENTS: remove stored attachments before deleting the patient'; end if;
      delete from public.rag_chunks where patient_id=entity;
      delete from public.ai_interactions where patient_id=entity;
      delete from public.reminders where pet_id=entity;
      delete from public.visit_corrections where visit_id in (select id from public.visits where pet_id=entity);
      delete from public.vaccinations where pet_id=entity;
      delete from public.visits where pet_id=entity;
      delete from public.appointments where pet_id=entity;
      delete from public.pets where id=entity;
    when 'visit' then
      delete from public.rag_chunks where source_type='visit' and source_id=entity;
      delete from public.reminders where visit_id=entity;
      delete from public.visit_corrections where visit_id=entity;
      delete from public.visits where id=entity;
    when 'vaccination' then
      delete from public.rag_chunks where source_type='vaccination' and source_id=entity;
      delete from public.vaccinations where id=entity;
    when 'reminder' then delete from public.reminders where id=entity;
    when 'alert' then
      delete from public.rag_chunks where source_type='alert' and source_id=entity;
      delete from public.pet_alerts where id=entity;
    when 'prescription' then delete from public.prescriptions where id=entity;
    when 'supplier' then delete from public.suppliers where id=entity;
    when 'appointment' then delete from public.appointments where id=entity;
    when 'inventory_item' then
      if exists(select 1 from public.inventory_movements where item_id=entity) then raise exception 'IMMUTABLE_LEDGER: archive items with stock history'; end if;
      delete from public.inventory_batches where item_id=entity;
      delete from public.inventory_items where id=entity;
    when 'batch' then
      if exists(select 1 from public.inventory_movements where batch_id=entity) then raise exception 'IMMUTABLE_LEDGER: batches with movements must be retained'; end if;
      delete from public.inventory_batches where id=entity;
    else raise exception 'VALIDATION_FAILED: unsupported record type';
    end case;
    get diagnostics affected=row_count;
    if affected=0 then raise exception 'NOT_FOUND'; end if;
    insert into public.audit_logs(actor_id,action,table_name,record_id)
    values(actor,'PERMANENT_DELETE: '||left(p_data->>'reason',200),p_data->>'entity',entity);
  else raise exception 'VALIDATION_FAILED: unsupported action';
  end if;
  result := coalesce(result,jsonb_build_object('id',entity));
  update public.idempotency_keys set response=result where user_id=actor and endpoint='portal_'||p_action and key=p_key;
  return result;
exception
  when exclusion_violation then raise exception 'APPOINTMENT_CONFLICT: the veterinarian already has a booking during this time';
  when unique_violation then
    if sqlerrm like '%microchip%' then raise exception 'DUPLICATE_MICROCHIP: this microchip is already registered'; end if;
    raise exception 'DUPLICATE_RECORD: an item with this identifier already exists';
end $$;

revoke all on function private.portal_mutation(text,jsonb,uuid) from public,anon;
grant execute on function private.portal_mutation(text,jsonb,uuid) to authenticated;
create or replace function public.portal_mutation(p_action text,p_data jsonb,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.portal_mutation(p_action,p_data,p_key);
$$;
revoke all on function public.portal_mutation(text,jsonb,uuid) from public,anon;
grant execute on function public.portal_mutation(text,jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';
