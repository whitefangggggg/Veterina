-- Extend clinical forms without rewriting historical values.
alter table public.pets add column diet text not null default '';
alter table public.inventory_items add column brand text;
alter table public.vaccinations add column inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column brand text;
create index vaccinations_inventory_item on public.vaccinations(inventory_item_id);
alter table public.vaccinations alter column lot_number drop not null;
alter table public.vaccinations drop constraint portal_vaccine_identity;
alter table public.vaccinations add constraint portal_vaccine_identity check (length(btrim(vaccine_name))>0);

alter table public.visit_vitals add column body_condition_scale integer not null default 9;
alter table public.visit_vitals alter column body_condition_scale set default 5;
alter table public.visit_vitals drop constraint visit_vitals_body_condition_score_check;
alter table public.visit_vitals add constraint visit_vitals_body_condition_score_check
  check (body_condition_scale in (5,9) and (body_condition_score is null or body_condition_score between 1 and body_condition_scale));
update public.queue_entries set care_draft=care_draft||'{"bodyConditionScale":"9"}'::jsonb
  where category='checkup' and nullif(care_draft->>'bodyConditionScore','') is not null;

alter table public.service_types add column workflow text not null default 'checkup'
  check (workflow in ('checkup','vaccination','maintenance'));
update public.service_types set workflow='vaccination' where name='Vaccination';
insert into public.service_types(name,default_duration_minutes,workflow)
  values('Surgery',60,'checkup'),('Grooming',60,'maintenance') on conflict(name) do nothing;
alter table public.queue_entries add column service_type_id uuid references public.service_types(id) on delete set null,
  add column service_notes text not null default '';
create index queue_service_type on public.queue_entries(service_type_id);
alter table public.queue_entries drop constraint queue_entries_category_check;
alter table public.queue_entries add constraint queue_entries_category_check check (category in ('checkup','vaccination','maintenance'));
update public.queue_entries q set service_type_id=a.service_type_id from public.appointments a where a.id=q.appointment_id;
update public.queue_entries q set service_type_id=s.id from public.service_types s
  where q.service_type_id is null and q.service_name=s.name and q.category=s.workflow;

create function private.guard_service_workflow() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.workflow<>old.workflow and (exists(select 1 from public.appointments where service_type_id=old.id)
    or exists(select 1 from public.queue_entries where service_type_id=old.id)) then
    raise exception 'VALIDATION_FAILED: archive a used service and create a replacement to change its workflow';
  end if;
  return new;
end $$;
revoke all on function private.guard_service_workflow() from public,anon,authenticated;
create trigger service_workflow_guard before update of workflow on public.service_types for each row execute function private.guard_service_workflow();
create trigger service_types_audit after insert or update or delete on public.service_types for each row execute function private.write_audit_log();

-- Called after the dispatcher's authorization and raw-payload idempotency check.
create function private.prepare_clinical_payload(action text, data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  patient public.pets; vaccine public.vaccinations; item public.inventory_items; vital public.visit_vitals;
  today date; birth date; estimated boolean:=false; years integer; months integer; score integer; scale integer;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if action in ('create_pet','update_pet') then
    if coalesce(data->>'sex','') not in ('Male','Female') then raise exception 'VALIDATION_FAILED: select Male or Female'; end if;
    select (now() at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date into today;
    if action='update_pet' then
      select * into patient from public.pets where id=(data->>'id')::uuid for update;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    if data->>'birthMode'='age' then
      if nullif(data->>'ageYears','') is not null or nullif(data->>'ageMonths','') is not null then
        if coalesce(nullif(data->>'ageYears',''),'0') !~ '^\d+$' or coalesce(nullif(data->>'ageMonths',''),'0') !~ '^\d+$' then
          raise exception 'VALIDATION_FAILED: age must use whole years and months'; end if;
        years:=coalesce(nullif(data->>'ageYears','')::integer,0); months:=coalesce(nullif(data->>'ageMonths','')::integer,0);
        if years<0 or months not between 0 and 11 then raise exception 'VALIDATION_FAILED: invalid age'; end if;
        birth:=(today-make_interval(years=>years,months=>months))::date; estimated:=true;
      end if;
    else
      birth:=nullif(data->>'birthDate','')::date;
      -- An estimated date stays estimated when an unrelated field is edited.
      estimated:=action='update_pet' and birth is not distinct from patient.birth_date and patient.birth_date_estimated
        and coalesce(data->>'birthMode','preserve')<>'date';
    end if;
    if birth>today then raise exception 'VALIDATION_FAILED: birth date cannot be in the future'; end if;
    data:=data||jsonb_build_object('birthDate',birth,'birthDateEstimated',estimated);
  elsif action in ('create_inventory_item','update_inventory_item') then
    if data->>'category'='Vaccines' and length(btrim(coalesce(data->>'brand','')))=0 then
      raise exception 'VALIDATION_FAILED: vaccine inventory requires a brand'; end if;
  elsif action in ('create_encounter','update_encounter') then
    if action='update_encounter' then
      perform 1 from public.visits where id=(data->>'id')::uuid for update;
      select * into vital from public.visit_vitals where visit_id=(data->>'id')::uuid for update;
    end if;
    if action='update_encounter' and coalesce(data->>'bodyConditionMode','keep')='keep' and vital.body_condition_scale=9 then
      score:=vital.body_condition_score; scale:=9;
    else
      score:=nullif(data->>'bodyConditionScore','')::integer; scale:=5;
      if score is not null and (data->>'bodyConditionScore' !~ '^[1-5]$' or score not between 1 and 5) then
        raise exception 'VALIDATION_FAILED: body condition must be a whole number from 1 to 5'; end if;
    end if;
    data:=data||jsonb_build_object('bodyConditionScore',score,'bodyConditionScale',scale);
  elsif action in ('create_vaccination','update_vaccination') then
    if action='update_vaccination' then
      select * into vaccine from public.vaccinations where id=(data->>'id')::uuid for update;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    if action='update_vaccination' and nullif(data->>'inventoryItemId','')::uuid is not distinct from vaccine.inventory_item_id then
      data:=data||jsonb_build_object('vaccine',vaccine.vaccine_name,'brand',vaccine.brand,'lotNumber',vaccine.lot_number);
    else
      select * into item from public.inventory_items where id=nullif(data->>'inventoryItemId','')::uuid for share;
      if item.id is null or not item.is_active or item.category<>'Vaccines' or length(btrim(coalesce(item.brand,'')))=0 then
        raise exception 'VALIDATION_FAILED: select an active vaccine inventory item with a brand'; end if;
      data:=data||jsonb_build_object('vaccine',item.name,'brand',item.brand,'lotNumber',vaccine.lot_number);
    end if;
  end if;
  return data;
end $$;
revoke all on function private.prepare_clinical_payload(text,jsonb) from public,anon,authenticated;

-- Guarded patches retain unrelated workflows and existing function privileges.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure) into definition;
  if strpos(definition,'if result is not null then return result; end if;')=0 then raise exception 'Expected mutate retry guard'; end if;
  definition:=replace(definition,'if result is not null then return result; end if;', 'if result is not null then return result; end if;'||chr(10)||'  p_data:=private.prepare_clinical_payload(p_action,p_data);');
  if strpos(definition,$old$reproductive_status,birth_date,color_markings,microchip_number,baseline_weight,created_by)$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$reproductive_status,birth_date,color_markings,microchip_number,baseline_weight,created_by)$old$,$new$reproductive_status,birth_date,birth_date_estimated,diet,color_markings,microchip_number,baseline_weight,created_by)$new$);
  if strpos(definition,$old$nullif(p_data->>'birthDate','')::date,p_data->>'color'$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$nullif(p_data->>'birthDate','')::date,p_data->>'color'$old$,$new$nullif(p_data->>'birthDate','')::date,coalesce((p_data->>'birthDateEstimated')::boolean,false),coalesce(p_data->>'diet',''),p_data->>'color'$new$);
  if strpos(definition,$old$body_condition_score,hydration,measured_by)$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$body_condition_score,hydration,measured_by)$old$,$new$body_condition_score,body_condition_scale,hydration,measured_by)$new$);
  if strpos(definition,$old$nullif(p_data->>'bodyConditionScore','')::integer,p_data->>'hydration'$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$nullif(p_data->>'bodyConditionScore','')::integer,p_data->>'hydration'$old$,$new$nullif(p_data->>'bodyConditionScore','')::integer,(p_data->>'bodyConditionScale')::integer,p_data->>'hydration'$new$);
  if strpos(definition,$old$insert into public.vaccinations(pet_id,vaccine_name,lot_number,dose$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$insert into public.vaccinations(pet_id,vaccine_name,lot_number,dose$old$,$new$insert into public.vaccinations(pet_id,vaccine_name,inventory_item_id,brand,lot_number,dose$new$);
  if strpos(definition,$old$values(pet,p_data->>'vaccine',p_data->>'lotNumber',p_data->>'dose'$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$values(pet,p_data->>'vaccine',p_data->>'lotNumber',p_data->>'dose'$old$,$new$values(pet,p_data->>'vaccine',nullif(p_data->>'inventoryItemId','')::uuid,p_data->>'brand',p_data->>'lotNumber',p_data->>'dose'$new$);
  if strpos(definition,$old$inventory_items(sku,name,category,unit$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$inventory_items(sku,name,category,unit$old$,$new$inventory_items(sku,name,brand,category,unit$new$);
  if strpos(definition,$old$values(p_data->>'sku',p_data->>'name',p_data->>'category'$old$)=0 then raise exception 'Expected mutate implementation was not found'; end if;
  definition:=replace(definition,$old$values(p_data->>'sku',p_data->>'name',p_data->>'category'$old$,$new$values(p_data->>'sku',p_data->>'name',nullif(btrim(p_data->>'brand'),''),p_data->>'category'$new$);
  execute definition;
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  if strpos(definition,$old$  if result is not null then return result; end if;$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$  if result is not null then return result; end if;$old$,$new$  if result is not null then return result; end if;
  p_data:=private.prepare_clinical_payload(p_action,p_data);$new$);
  if strpos(definition,$old$  if p_action='create_queued_vaccination' then$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$  if p_action='create_queued_vaccination' then$old$,$new$  if p_action in ('create_service','update_service') then
    if staff_role<>'owner' then raise exception 'FORBIDDEN: services are owner-managed'; end if;
    if length(btrim(coalesce(p_data->>'name','')))=0 or coalesce((p_data->>'duration')::integer,0) not between 5 and 480
      or coalesce(p_data->>'workflow','') not in ('checkup','vaccination','maintenance') then
      raise exception 'VALIDATION_FAILED: service name, duration and workflow required'; end if;
    if p_action='create_service' then
      insert into public.service_types(name,default_duration_minutes,workflow,is_active)
      values(btrim(p_data->>'name'),(p_data->>'duration')::integer,p_data->>'workflow',true) returning id into entity;
    else
      perform 1 from public.service_types where id=entity for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      update public.service_types set name=btrim(p_data->>'name'),default_duration_minutes=(p_data->>'duration')::integer,
        workflow=p_data->>'workflow',is_active=coalesce((p_data->>'isActive')::boolean,true) where id=entity;
    end if;
  elsif p_action='create_queued_vaccination' then$new$);
  if strpos(definition,$old$birth_date=nullif(p_data->>'birthDate','')::date,color_markings$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$birth_date=nullif(p_data->>'birthDate','')::date,color_markings$old$,$new$birth_date=nullif(p_data->>'birthDate','')::date,birth_date_estimated=coalesce((p_data->>'birthDateEstimated')::boolean,false),diet=coalesce(p_data->>'diet',''),color_markings$new$);
  if strpos(definition,$old$body_condition_score=nullif(p_data->>'bodyConditionScore','')::integer,hydration$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$body_condition_score=nullif(p_data->>'bodyConditionScore','')::integer,hydration$old$,$new$body_condition_score=nullif(p_data->>'bodyConditionScore','')::integer,body_condition_scale=(p_data->>'bodyConditionScale')::integer,hydration$new$);
  if strpos(definition,$old$set vaccine_name=p_data->>'vaccine',lot_number$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$set vaccine_name=p_data->>'vaccine',lot_number$old$,$new$set vaccine_name=p_data->>'vaccine',inventory_item_id=nullif(p_data->>'inventoryItemId','')::uuid,brand=p_data->>'brand',lot_number$new$);
  if strpos(definition,$old$name=p_data->>'name',category=p_data->>'category'$old$)=0 then raise exception 'Expected portal_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$name=p_data->>'name',category=p_data->>'category'$old$,$new$name=p_data->>'name',brand=nullif(btrim(p_data->>'brand'),''),category=p_data->>'category'$new$);
  execute definition;
  select pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  if strpos(definition,$old$record_data jsonb; saved jsonb; care_id uuid;$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$record_data jsonb; saved jsonb; care_id uuid;$old$,$new$record_data jsonb; saved jsonb; care_id uuid; service public.service_types;$new$);
  if strpos(definition,$old$    if coalesce(p_data->>'category','') not in ('checkup','vaccination') then raise exception 'VALIDATION_FAILED: select a service'; end if;$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$    if coalesce(p_data->>'category','') not in ('checkup','vaccination') then raise exception 'VALIDATION_FAILED: select a service'; end if;$old$,$new$    if nullif(p_data->>'serviceId','') is not null then
      select * into service from public.service_types where id=(p_data->>'serviceId')::uuid and is_active for share;
    else
      -- Keep older callers compatible with the two original queue categories.
      select * into service from public.service_types where name=case p_data->>'category' when 'vaccination' then 'Vaccination' when 'checkup' then 'Wellness check' end and is_active for share;
    end if;
    if service.id is null then raise exception 'VALIDATION_FAILED: select an active service'; end if;$new$);
  if strpos(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$,$new$(pet_id,category,service_name,service_type_id,source,veterinarian_id,notes,created_by)$new$);
  if strpos(definition,$old$p_data->>'category',case when p_data->>'category'='vaccination' then 'Vaccination' else 'Checkup' end,$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$p_data->>'category',case when p_data->>'category'='vaccination' then 'Vaccination' else 'Checkup' end,$old$,$new$service.workflow,service.name,service.id,$new$);
  if strpos(definition,$old$array['vaccine','administeredAt','nextDueAt','lotNumber','dose','veterinarianId'] else$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$array['vaccine','administeredAt','nextDueAt','lotNumber','dose','veterinarianId'] else$old$,$new$array['vaccine','inventoryItemId','brand','administeredAt','nextDueAt','lotNumber','dose','veterinarianId'] when entry.category='maintenance' then array['serviceNotes','veterinarianId'] else$new$);
  if strpos(definition,$old$'bodyConditionScore','hydration'$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$'bodyConditionScore','hydration'$old$,$new$'bodyConditionScore','bodyConditionScale','bodyConditionMode','hydration'$new$);
  if strpos(definition,$old$      else
        if length(btrim(coalesce(record_data->>'vaccine','')))=0 or length(btrim(coalesce(record_data->>'lotNumber','')))=0 then
          raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;$old$)=0 then raise exception 'Expected queue_mutation implementation was not found'; end if;
  definition:=replace(definition,$old$      else
        if length(btrim(coalesce(record_data->>'vaccine','')))=0 or length(btrim(coalesce(record_data->>'lotNumber','')))=0 then
          raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;$old$,$new$      elsif entry.category='maintenance' then
        if length(btrim(coalesce(record_data->>'serviceNotes','')))=0 then raise exception 'VALIDATION_FAILED: work performed is required'; end if;
        update public.queue_entries set status='completed',service_notes=btrim(record_data->>'serviceNotes'),finished_at=now() where id=entity;
        saved:=jsonb_build_object('id',entity);
      else$new$);
  execute definition;
  select pg_get_functiondef('private.create_queued_encounter(jsonb)'::regprocedure) into definition;
  if strpos(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$)=0 then raise exception 'Expected create_queued_encounter implementation was not found'; end if;
  definition:=replace(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$,$new$(pet_id,category,service_name,service_type_id,source,veterinarian_id,notes,created_by)$new$);
  if strpos(definition,$old$coalesce(nullif(p_data->>'type',''),'Checkup'),'patient_record'$old$)=0 then raise exception 'Expected create_queued_encounter implementation was not found'; end if;
  definition:=replace(definition,$old$coalesce(nullif(p_data->>'type',''),'Checkup'),'patient_record'$old$,$new$coalesce(nullif(p_data->>'type',''),'Checkup'),(select id from public.service_types where name=coalesce(nullif(p_data->>'type',''),'Checkup') and workflow='checkup' and is_active),'patient_record'$new$);
  execute definition;
  select pg_get_functiondef('private.create_queued_vaccination(jsonb)'::regprocedure) into definition;
  if strpos(definition,$old$if length(btrim(coalesce(p_data->>'vaccine','')))=0 or length(btrim(coalesce(p_data->>'lotNumber','')))=0 then raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;$old$)=0 then raise exception 'Expected create_queued_vaccination implementation was not found'; end if;
  definition:=replace(definition,$old$if length(btrim(coalesce(p_data->>'vaccine','')))=0 or length(btrim(coalesce(p_data->>'lotNumber','')))=0 then raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;$old$,$new$-- Inventory validation occurs inside the nested atomic clinical save.$new$);
  if strpos(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$)=0 then raise exception 'Expected create_queued_vaccination implementation was not found'; end if;
  definition:=replace(definition,$old$(pet_id,category,service_name,source,veterinarian_id,notes,created_by)$old$,$new$(pet_id,category,service_name,service_type_id,source,veterinarian_id,notes,created_by)$new$);
  if strpos(definition,$old$'Vaccination','patient_record'$old$)=0 then raise exception 'Expected create_queued_vaccination implementation was not found'; end if;
  definition:=replace(definition,$old$'Vaccination','patient_record'$old$,$new$'Vaccination',(select id from public.service_types where name='Vaccination' and workflow='vaccination' and is_active),'patient_record'$new$);
  execute definition;
  select pg_get_functiondef('private.sync_appointment_queue()'::regprocedure) into definition;
  if strpos(definition,$old$select name into service_name from public.service_types where id=new.service_type_id;
      service_category:=case when service_name='Vaccination' then 'vaccination' else 'checkup' end;$old$)=0 then raise exception 'Expected sync_appointment_queue implementation was not found'; end if;
  definition:=replace(definition,$old$select name into service_name from public.service_types where id=new.service_type_id;
      service_category:=case when service_name='Vaccination' then 'vaccination' else 'checkup' end;$old$,$new$select name,workflow into service_name,service_category from public.service_types where id=new.service_type_id for share;
      service_category:=coalesce(service_category,'checkup');$new$);
  if strpos(definition,$old$(pet_id,category,service_name,source,appointment_id$old$)=0 then raise exception 'Expected sync_appointment_queue implementation was not found'; end if;
  definition:=replace(definition,$old$(pet_id,category,service_name,source,appointment_id$old$,$new$(pet_id,category,service_name,service_type_id,source,appointment_id$new$);
  if strpos(definition,$old$coalesce(service_name,'Checkup'),'appointment'$old$)=0 then raise exception 'Expected sync_appointment_queue implementation was not found'; end if;
  definition:=replace(definition,$old$coalesce(service_name,'Checkup'),'appointment'$old$,$new$coalesce(service_name,'Checkup'),new.service_type_id,'appointment'$new$);
  if strpos(definition,$old$(entry.visit_id is null and entry.vaccination_id is null)$old$)=0 then raise exception 'Expected sync_appointment_queue implementation was not found'; end if;
  definition:=replace(definition,$old$(entry.visit_id is null and entry.vaccination_id is null)$old$,$new$(entry.visit_id is null and entry.vaccination_id is null and not (entry.category='maintenance' and length(btrim(entry.service_notes))>0))$new$);
  execute definition;
  select pg_get_functiondef('private.filtered_export_report(text,uuid,jsonb)'::regprocedure) into definition;
  if strpos(definition,$old$p.species,p.breed,p.status,p.microchip_number$old$)=0 then raise exception 'Expected filtered_export_report implementation was not found'; end if;
  definition:=replace(definition,$old$p.species,p.breed,p.status,p.microchip_number$old$,$new$p.species,p.breed,p.sex,p.birth_date,p.birth_date_estimated,p.diet,p.status,p.microchip_number$new$);
  if strpos(definition,$old$v.next_due_at,v.lot_number$old$)=0 then raise exception 'Expected filtered_export_report implementation was not found'; end if;
  definition:=replace(definition,$old$v.next_due_at,v.lot_number$old$,$new$v.next_due_at,v.brand,v.inventory_item_id,v.lot_number$new$);
  if strpos(definition,$old$i.nearest_expiration,item.is_active$old$)=0 then raise exception 'Expected filtered_export_report implementation was not found'; end if;
  definition:=replace(definition,$old$i.nearest_expiration,item.is_active$old$,$new$i.nearest_expiration,item.brand,item.is_active$new$);
  if strpos(definition,$old$'prescriptions',(select$old$)=0 then raise exception 'Expected filtered_export_report implementation was not found'; end if;
  definition:=replace(definition,$old$'prescriptions',(select$old$,$new$'maintenance',(select coalesce(jsonb_agg(to_jsonb(q) order by q.arrived_at desc),'[]') from public.queue_entries q where q.pet_id=p.id and q.category='maintenance'),
      'prescriptions',(select$new$);
  execute definition;
  select pg_get_functiondef('private.export_report(text,uuid)'::regprocedure) into definition;
  if strpos(definition,$old$'prescriptions',(select$old$)=0 then raise exception 'Expected export_report implementation was not found'; end if;
  definition:=replace(definition,$old$'prescriptions',(select$old$,$new$'maintenance',(select coalesce(jsonb_agg(to_jsonb(q) order by q.arrived_at desc),'[]') from public.queue_entries q where q.pet_id=p.id and q.category='maintenance'),
      'prescriptions',(select$new$);
  if strpos(definition,$old$p.species,p.breed,p.microchip_number$old$)=0 then raise exception 'Expected export_report implementation was not found'; end if;
  definition:=replace(definition,$old$p.species,p.breed,p.microchip_number$old$,$new$p.species,p.breed,p.sex,p.birth_date,p.birth_date_estimated,p.diet,p.microchip_number$new$);
  if strpos(definition,$old$v.administered_at,v.next_due_at from public.vaccinations$old$)=0 then raise exception 'Expected export_report implementation was not found'; end if;
  definition:=replace(definition,$old$v.administered_at,v.next_due_at from public.vaccinations$old$,$new$v.administered_at,v.next_due_at,v.brand,v.lot_number from public.vaccinations$new$);
  execute definition;
end $migration$;
notify pgrst, 'reload schema';
