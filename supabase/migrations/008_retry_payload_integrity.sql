alter table public.idempotency_keys add column if not exists request_hash text;
create or replace function private.mutate(p_action text, p_data jsonb, p_key uuid) returns jsonb
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
create or replace function private.create_custom_reminder(p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; entity uuid; saved_hash text; begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_key is null then raise exception 'VALIDATION_FAILED'; end if;
  insert into public.idempotency_keys(user_id,endpoint,key,request_hash) values(auth.uid(),'create_custom_reminder',p_key,md5(p_data::text)) on conflict do nothing;
  select response,request_hash into result,saved_hash from public.idempotency_keys where user_id=auth.uid() and endpoint='create_custom_reminder' and key=p_key for update;
  if saved_hash is not null and saved_hash<>md5(p_data::text) then raise exception 'VALIDATION_FAILED: retry payload changed; reload to confirm the original saved record';end if;
  if result is not null then return result; end if;
  insert into public.reminders(pet_id,reminder_type,title,notes,due_at,created_by)
  values((p_data->>'petId')::uuid,'custom',p_data->>'title',coalesce(p_data->>'notes',''),(p_data->>'dueDate')::date::timestamp at time zone 'Asia/Manila',auth.uid()) returning id into entity;
  result := jsonb_build_object('id',entity);
  update public.idempotency_keys set response=result where user_id=auth.uid() and endpoint='create_custom_reminder' and key=p_key;
  return result;
end $$;
