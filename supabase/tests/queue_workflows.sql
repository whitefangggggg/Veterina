-- Run as a database administrator. All identities and clinical rows roll back.
begin;
select set_config('queue_test.owner',gen_random_uuid()::text,true);
select set_config('queue_test.staff',gen_random_uuid()::text,true);
select set_config('queue_test.pending',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
select current_setting('queue_test.owner')::uuid,'queue-owner-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('queue_test.staff')::uuid,'queue-staff-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('queue_test.pending')::uuid,'queue-pending-'||gen_random_uuid()||'@example.org',now();
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('queue_test.owner')::uuid,'Queue owner','owner',true),
  (current_setting('queue_test.staff')::uuid,'Queue staff','clinical_staff',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('queue_test.owner'),'role','authenticated')::text,true);
-- Seed bookings at a future instant today, independent of the clinic's opening hours.
insert into public.owners(full_name,phone,address,created_by) values('Queue patient owner','09171234567','Rollback clinic address',current_setting('queue_test.owner')::uuid);
select set_config('queue_test.patient_owner',(select id::text from public.owners where created_by=current_setting('queue_test.owner')::uuid),true);
insert into public.pets(owner_id,name,species,breed,sex,reproductive_status,created_by)
values(current_setting('queue_test.patient_owner')::uuid,'Queue patient','Dog','Mixed','Unknown','Unknown',current_setting('queue_test.owner')::uuid);
select set_config('queue_test.pet',(select id::text from public.pets where created_by=current_setting('queue_test.owner')::uuid),true);
insert into public.appointments(pet_id,service_type_id,starts_at,ends_at,status,veterinarian_id,created_by)
values(current_setting('queue_test.pet')::uuid,(select id from public.service_types where name='Wellness check'),
  clock_timestamp()+interval '1 second',clock_timestamp()+interval '2 seconds','pending',current_setting('queue_test.owner')::uuid,current_setting('queue_test.owner')::uuid);
select set_config('queue_test.appointment',(select id::text from public.appointments where created_by=current_setting('queue_test.owner')::uuid),true);
insert into public.appointments(pet_id,service_type_id,starts_at,ends_at,status,veterinarian_id,created_by)
values(current_setting('queue_test.pet')::uuid,(select id from public.service_types where name='Vaccination'),
  clock_timestamp()+interval '3 seconds',clock_timestamp()+interval '4 seconds','confirmed',current_setting('queue_test.staff')::uuid,current_setting('queue_test.staff')::uuid);
select set_config('queue_test.cancel_appointment',(select id::text from public.appointments where created_by=current_setting('queue_test.staff')::uuid),true);
-- Exercise a clinic-midnight boundary and deletion without changing wall time.
do $$
declare
  first_id uuid; second_id uuid; third_id uuid; fourth_id uuid; rejected boolean;
  clinic_zone text:=coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila');
  first_ticket integer; second_ticket integer; third_ticket integer;
begin
  insert into public.queue_entries(pet_id,category,service_name,source,status,arrived_at,created_by,queue_number,queue_date)
  values(current_setting('queue_test.pet')::uuid,'checkup','Checkup','walk_in','cancelled',
    timestamp '2098-12-31 23:59:59' at time zone clinic_zone,current_setting('queue_test.owner')::uuid,999,date '2000-01-01')
  returning id,queue_number into first_id,first_ticket;
  if (select queue_date from public.queue_entries where id=first_id)<>date '2098-12-31' then raise exception 'TEST: ticket date did not use clinic timezone'; end if;
  insert into public.queue_entries(pet_id,category,service_name,source,status,arrived_at,created_by)
  values(current_setting('queue_test.pet')::uuid,'vaccination','Vaccination','walk_in','cancelled',
    timestamp '2099-01-01 00:00:00' at time zone clinic_zone,current_setting('queue_test.owner')::uuid)
  returning id,queue_number into second_id,second_ticket;
  if first_ticket<>1 or second_ticket<>1 or (select queue_date from public.queue_entries where id=second_id)<>date '2099-01-01' then raise exception 'TEST: daily ticket reset'; end if;
  insert into public.queue_entries(pet_id,category,service_name,source,status,arrived_at,created_by)
  values(current_setting('queue_test.pet')::uuid,'checkup','Checkup','walk_in','cancelled',
    timestamp '2099-01-01 00:00:01' at time zone clinic_zone,current_setting('queue_test.owner')::uuid)
  returning id,queue_number into third_id,third_ticket;
  if third_ticket<>2 then raise exception 'TEST: services did not share a sequence'; end if;
  delete from public.queue_entries where id=second_id;
  insert into public.queue_entries(pet_id,category,service_name,source,status,arrived_at,created_by)
  values(current_setting('queue_test.pet')::uuid,'checkup','Checkup','walk_in','cancelled',
    timestamp '2099-01-01 00:00:02' at time zone clinic_zone,current_setting('queue_test.owner')::uuid)
  returning id into fourth_id;
  if (select queue_number from public.queue_entries where id=fourth_id)<>3 or (select queue_number from public.queue_entries where id=third_id)<>2 then raise exception 'TEST: deleted ticket reused/renumbered'; end if;
  rejected:=false;
  begin update public.queue_entries set queue_number=4 where id=third_id; exception when others then if sqlerrm like 'VALIDATION_FAILED: arrival date and queue number%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: assigned ticket was editable'; end if;
  rejected:=false;
  begin update public.queue_entries set arrived_at=arrived_at+interval '1 day' where id=third_id; exception when others then if sqlerrm like 'VALIDATION_FAILED: arrival date and queue number%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: ticket arrival date was editable'; end if;
end $$;
insert into public.inventory_items(name,brand,category,unit,created_by) values('Queue vaccine','Queue Brand','Vaccines','dose',current_setting('queue_test.owner')::uuid);
select set_config('queue_test.vaccine_item',(select id::text from public.inventory_items where created_by=current_setting('queue_test.owner')::uuid),true);
set local role authenticated;
do $$
#variable_conflict use_variable
declare
  pet uuid:=current_setting('queue_test.pet')::uuid;
  appointment uuid:=current_setting('queue_test.appointment')::uuid;
  doctor uuid:=current_setting('queue_test.owner')::uuid;
  queue uuid; walkin uuid; record_id uuid; key_id uuid; payload jsonb; record_data jsonb; result jsonb;
  rejected boolean; before_count integer; walkin_ticket integer; booked_ticket integer;
  today date:=(now() at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date;
begin
  if has_table_privilege('authenticated','public.queue_entries','INSERT') or has_table_privilege('authenticated','public.queue_entries','UPDATE') or has_table_privilege('anon','public.queue_entries','SELECT') then
    raise exception 'TEST: direct queue grants'; end if;
  if has_function_privilege('authenticated','private.queue_mutation(text,jsonb,uuid)','EXECUTE') then raise exception 'TEST: internal helper exposed'; end if;
  if has_table_privilege('authenticated','private.queue_number_counters','UPDATE') or has_function_privilege('authenticated','private.assign_queue_number()','EXECUTE') then raise exception 'TEST: ticket allocator exposed'; end if;

  payload:=jsonb_build_object('petId',pet,'category','vaccination'); key_id:=gen_random_uuid();
  result:=public.portal_mutation('add_queue_entry',payload,key_id); walkin:=(result->>'id')::uuid;
  select queue_number into walkin_ticket from public.queue_entries where id=walkin;
  if walkin_ticket is null or walkin_ticket<1 or (select queue_date from public.queue_entries where id=walkin)<>today then raise exception 'TEST: walk-in ticket missing'; end if;
  if public.portal_mutation('add_queue_entry',payload,key_id)<>result then raise exception 'TEST: walk-in replay'; end if;
  if (select queue_number from public.queue_entries where id=walkin)<>walkin_ticket then raise exception 'TEST: retry renumbered walk-in'; end if;
  rejected:=false;
  begin perform public.portal_mutation('add_queue_entry',payload,gen_random_uuid()); exception when others then if sqlerrm like 'QUEUE_DUPLICATE%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: duplicate active arrival'; end if;
  rejected:=false;
  begin perform public.portal_mutation('check_in_appointment',jsonb_build_object('appointmentId',current_setting('queue_test.cancel_appointment')),gen_random_uuid()); exception when others then if sqlerrm like 'QUEUE_DUPLICATE%' then rejected:=true; else raise; end if; end;
  if not rejected or (select status from public.appointments where id=current_setting('queue_test.cancel_appointment')::uuid)<>'confirmed' then raise exception 'TEST: conflicting booked arrival partially checked in'; end if;
  rejected:=false;
  begin perform public.portal_mutation('add_queue_entry',payload||'{"category":"checkup"}',key_id); exception when others then if sqlerrm like 'VALIDATION_FAILED: retry payload changed%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: changed retry payload'; end if;
  rejected:=false;
  begin perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',walkin),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: started without veterinarian'; end if;
  rejected:=false;
  begin perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',walkin,'record','{}'::jsonb),gen_random_uuid()); exception when others then if sqlerrm like 'INVALID_TRANSITION%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: saved draft before care started'; end if;
  key_id:=gen_random_uuid();
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',walkin,'veterinarianId',doctor),key_id);
  payload:=jsonb_build_object('id',walkin,'draftVersion',0,'record',jsonb_build_object('vaccine','Unfinished vaccine','administeredAt','','lotNumber','','nextDueAt',''));
  result:=public.portal_mutation('save_queue_draft',payload,key_id);
  if public.portal_mutation('save_queue_draft',payload,key_id)<>result or (select draft_version from public.queue_entries where id=walkin)<>1 then raise exception 'TEST: draft retry duplicated save'; end if;
  if (select queue_number from public.queue_entries where id=walkin)<>walkin_ticket then raise exception 'TEST: draft renumbered walk-in'; end if;
  if (select status from public.queue_entries where id=walkin)<>'in_progress' or (select care_draft->>'vaccine' from public.queue_entries where id=walkin)<>'Unfinished vaccine' or
    exists(select 1 from public.vaccinations where pet_id=pet) or exists(select 1 from public.reminders where pet_id=pet) then raise exception 'TEST: partial vaccine draft created care/reminders'; end if;
  rejected:=false;
  begin perform public.portal_mutation('save_queue_draft',payload,gen_random_uuid()); exception when others then if sqlerrm like 'DRAFT_CONFLICT%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: stale draft overwrote newer save'; end if;
  rejected:=false;
  begin perform public.portal_mutation('save_queue_draft',payload||jsonb_build_object('draftVersion',1,'record',jsonb_build_object('petId',pet)),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED: unsupported draft fields%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: draft changed patient identity'; end if;
  record_data:=jsonb_build_object('petId',pet,'veterinarianId',doctor,'inventoryItemId',current_setting('queue_test.vaccine_item'),'administeredAt',today,'nextDueAt',today+10);
  select count(*) into before_count from public.vaccinations where pet_id=pet;
  rejected:=false;
  begin perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',walkin,'draftVersion',1,'record',record_data||jsonb_build_object('nextDueAt',today-1)),gen_random_uuid()); exception when check_violation then rejected:=true; end;
  if not rejected or (select status from public.queue_entries where id=walkin)<>'in_progress' or (select count(*) from public.vaccinations where pet_id=pet)<>before_count then
    raise exception 'TEST: failed care save was not atomic'; end if;
  rejected:=false;
  begin perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',walkin,'draftVersion',1,'record',record_data||jsonb_build_object('veterinarianId',current_setting('queue_test.staff'))),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED: patient and veterinarian%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: mismatched clinician'; end if;
  payload:=jsonb_build_object('id',walkin,'draftVersion',1,'record',record_data);
  result:=public.portal_mutation('complete_queue_entry',payload,key_id); record_id:=(result->>'id')::uuid;
  if public.portal_mutation('complete_queue_entry',payload,key_id)<>result then raise exception 'TEST: completion retry'; end if;
  if (select status from public.queue_entries where id=walkin)<>'completed' or (select vaccination_id from public.queue_entries where id=walkin)<>record_id or
    (select count(*) from public.reminders where vaccination_id=record_id)<>1 then raise exception 'TEST: vaccine completion/reminder'; end if;
  if (select care_draft from public.queue_entries where id=walkin)<>'{}'::jsonb or (select draft_saved_at from public.queue_entries where id=walkin) is not null then raise exception 'TEST: completed vaccine retained live draft'; end if;
  if (select queue_number from public.queue_entries where id=walkin)<>walkin_ticket then raise exception 'TEST: completion renumbered walk-in'; end if;
  rejected:=false;
  begin perform public.portal_mutation('complete_queue_entry',payload,gen_random_uuid()); exception when others then if sqlerrm like 'INVALID_TRANSITION%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: second completion accepted'; end if;

  -- An unexpired clinical staff identity can check in, start and record care.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('queue_test.staff'),'role','authenticated')::text,true);
  payload:=jsonb_build_object('appointmentId',appointment); key_id:=gen_random_uuid();
  result:=public.portal_mutation('check_in_appointment',payload,key_id); queue:=(result->>'id')::uuid;
  select queue_number into booked_ticket from public.queue_entries where id=queue;
  if booked_ticket<>walkin_ticket+1 then raise exception 'TEST: booked arrival did not receive next ticket'; end if;
  if public.portal_mutation('check_in_appointment',payload,key_id)<>result then raise exception 'TEST: check-in retry'; end if;
  if (select status from public.appointments where id=appointment)<>'arrived' or (select status from public.queue_entries where id=queue)<>'waiting' then raise exception 'TEST: check-in synchronization'; end if;
  if (select count(*) from public.appointment_events where appointment_id=appointment and status in ('confirmed','arrived'))<>2 then raise exception 'TEST: pending confirmation history'; end if;
  key_id:=gen_random_uuid();
  perform public.portal_mutation('transition_appointment',jsonb_build_object('id',appointment,'status','in_progress'),key_id);
  if (select status from public.queue_entries where id=queue)<>'in_progress' then raise exception 'TEST: calendar start synchronization'; end if;
  rejected:=false;
  begin perform public.portal_mutation('transition_appointment',jsonb_build_object('id',appointment,'status','completed'),gen_random_uuid()); exception when others then if sqlerrm like 'CARE_RECORD_REQUIRED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: calendar bypassed clinical save'; end if;
  payload:=jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('complaint','Partial checkup','weightKg','','encounteredAt',''));
  perform public.portal_mutation('save_queue_draft',payload,gen_random_uuid());
  if exists(select 1 from public.visits where pet_id=pet) or (select status from public.appointments where id=appointment)<>'in_progress' then raise exception 'TEST: checkup draft completed appointment'; end if;
  perform public.portal_mutation('save_queue_draft',payload||jsonb_build_object('draftVersion',1),gen_random_uuid());
  if (select draft_saved_by from public.queue_entries where id=queue)<>current_setting('queue_test.staff')::uuid then raise exception 'TEST: draft author not recorded'; end if;
  record_data:=jsonb_build_object('petId',pet,'veterinarianId',doctor,'type','Wellness check','complaint','Queue checkup','weightKg','2.5','followUpDate',today+1,'encounteredAt',now());
  rejected:=false;
  begin perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',1,'record',record_data),gen_random_uuid()); exception when others then if sqlerrm like 'DRAFT_CONFLICT%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: stale completion discarded newer draft'; end if;
  result:=public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',2,'record',record_data),key_id); record_id:=(result->>'id')::uuid;
  if (select status from public.appointments where id=appointment)<>'completed' or (select visit_id from public.queue_entries where id=queue)<>record_id or
    not exists(select 1 from public.visits where id=record_id and appointment_id=appointment and finalized_at is null) then raise exception 'TEST: booked care completion'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',doctor,'role','authenticated')::text,true);
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','visit','id',record_id,'reason','Queue rollback deletion'),gen_random_uuid());
  if (select visit_id from public.queue_entries where id=queue) is not null then raise exception 'TEST: visit delete reference'; end if;
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','appointment','id',appointment,'reason','Queue rollback deletion'),gen_random_uuid());
  if (select appointment_id from public.queue_entries where id=queue) is not null then raise exception 'TEST: appointment delete reference'; end if;
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','vaccination','id',(select vaccination_id from public.queue_entries where id=walkin),'reason','Queue rollback deletion'),gen_random_uuid());
  if (select vaccination_id from public.queue_entries where id=walkin) is not null then raise exception 'TEST: vaccination delete reference'; end if;

  queue:=(public.portal_mutation('check_in_appointment',jsonb_build_object('appointmentId',current_setting('queue_test.cancel_appointment')),gen_random_uuid())->>'id')::uuid;
  if (select category from public.queue_entries where id=queue)<>'vaccination' then raise exception 'TEST: vaccination booking category'; end if;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',current_setting('queue_test.staff')),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('vaccine','Retained cancelled draft')),gen_random_uuid());
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',queue),gen_random_uuid());
  if (select status from public.appointments where id=current_setting('queue_test.cancel_appointment')::uuid)<>'cancelled' or (select status from public.queue_entries where id=queue)<>'cancelled' then raise exception 'TEST: booked cancellation synchronization'; end if;
  if (select care_draft->>'vaccine' from public.queue_entries where id=queue)<>'Retained cancelled draft' then raise exception 'TEST: cancellation lost unfinished notes'; end if;
  rejected:=false;
  begin perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',1,'record','{}'::jsonb),gen_random_uuid()); exception when others then if sqlerrm like 'INVALID_TRANSITION%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: cancelled draft editable'; end if;

  walkin:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','checkup'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',walkin),gen_random_uuid());
  if (select status from public.queue_entries where id=walkin)<>'cancelled' or (select finished_at from public.queue_entries where id=walkin) is null then raise exception 'TEST: cancel history'; end if;
  rejected:=false;
  begin perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',walkin,'veterinarianId',doctor),gen_random_uuid()); exception when others then if sqlerrm like 'INVALID_TRANSITION%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: terminal queue reopened'; end if;

  -- Patient-page checkup saves create one waiting ticket linked to the record.
  record_data:=jsonb_build_object('petId',pet,'veterinarianId',doctor,'type','Wellness check','complaint','Patient-page checkup','weightKg','3','followUpDate',today+1,'encounteredAt',now());
  select count(*) into before_count from public.visits where pet_id=pet;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_encounter',record_data||'{"weightKg":"-1"}',gen_random_uuid()); exception when check_violation then rejected:=true; end;
  if not rejected or (select count(*) from public.visits where pet_id=pet)<>before_count or exists(select 1 from public.queue_entries where pet_id=pet and category='checkup' and status in ('waiting','in_progress')) then raise exception 'TEST: failed patient checkup left partial record/ticket'; end if;
  key_id:=gen_random_uuid(); result:=public.portal_mutation('create_queued_encounter',record_data,key_id);
  record_id:=(result->>'id')::uuid; queue:=(result->>'queueEntryId')::uuid;
  if public.portal_mutation('create_queued_encounter',record_data,key_id)<>result then raise exception 'TEST: patient checkup retry changed ticket'; end if;
  if not exists(select 1 from public.queue_entries where id=queue and visit_id=record_id and status='waiting' and source='patient_record' and queue_number=(result->>'queueNumber')::integer) or
    (select count(*) from public.visits where pet_id=pet)<>before_count+1 then raise exception 'TEST: patient checkup not queued exactly once'; end if;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_encounter',record_data,gen_random_uuid()); exception when others then if sqlerrm like 'CHECKUP_ALREADY_QUEUED%' then rejected:=true; else raise; end if; end;
  if not rejected or (select count(*) from public.visits where pet_id=pet)<>before_count+1 then raise exception 'TEST: second patient checkup replaced queued record'; end if;
  rejected:=false;
  begin perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',record_id),gen_random_uuid()); exception when others then if sqlerrm like 'CHECKUP_IN_QUEUE%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: checkup finalized before queued care finished'; end if;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',doctor),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('complaint','Continued queued checkup')),gen_random_uuid());
  result:=public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',1,'record',record_data||'{"complaint":"Completed original checkup","weightKg":"4"}'),gen_random_uuid());
  if (result->>'id')::uuid<>record_id or (select visit_id from public.queue_entries where id=queue)<>record_id or
    (select count(*) from public.visits where pet_id=pet)<>before_count+1 or (select chief_complaint from public.visits where id=record_id)<>'Completed original checkup' or
    (select count(*) from public.reminders where visit_id=record_id)<>1 then raise exception 'TEST: completion duplicated or lost linked patient checkup'; end if;
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',record_id),gen_random_uuid());

  -- A waiting walk-in without a clinical record keeps its original ticket.
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','checkup'),gen_random_uuid())->>'id')::uuid;
  select queue_number into booked_ticket from public.queue_entries where id=queue;
  result:=public.portal_mutation('create_queued_encounter',record_data,gen_random_uuid());
  if (result->>'queueEntryId')::uuid<>queue or (result->>'queueNumber')::integer<>booked_ticket then raise exception 'TEST: patient checkup replaced existing arrival'; end if;
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',queue),gen_random_uuid());

  -- Adding a vaccine from the patient page mirrors the checkup workflow.
  record_data:=jsonb_build_object('petId',pet,'veterinarianId',doctor,'inventoryItemId',current_setting('queue_test.vaccine_item'),'administeredAt',today,'nextDueAt',today+20,'dose','Recorded dose');
  select count(*) into before_count from public.vaccinations where pet_id=pet;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_vaccination',record_data||jsonb_build_object('nextDueAt',today-1),gen_random_uuid()); exception when check_violation then rejected:=true; end;
  if not rejected or (select count(*) from public.vaccinations where pet_id=pet)<>before_count or exists(select 1 from public.queue_entries where pet_id=pet and category='vaccination' and status in ('waiting','in_progress')) then raise exception 'TEST: failed vaccine save left partial record/ticket'; end if;
  key_id:=gen_random_uuid(); result:=public.portal_mutation('create_queued_vaccination',record_data,key_id);
  record_id:=(result->>'id')::uuid; queue:=(result->>'queueEntryId')::uuid;
  if public.portal_mutation('create_queued_vaccination',record_data,key_id)<>result then raise exception 'TEST: patient vaccine retry changed ticket'; end if;
  if not exists(select 1 from public.queue_entries where id=queue and vaccination_id=record_id and status='waiting' and source='patient_record') or
    (select count(*) from public.vaccinations where pet_id=pet)<>before_count+1 or (select count(*) from public.reminders where vaccination_id=record_id)<>1 then raise exception 'TEST: patient vaccine not queued exactly once'; end if;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_vaccination',record_data,gen_random_uuid()); exception when others then if sqlerrm like 'VACCINATION_ALREADY_QUEUED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: queued vaccination replaced by duplicate'; end if;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',doctor),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('vaccine','Continued vaccination draft')),gen_random_uuid());
  result:=public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',1,'record',record_data||'{"dose":"Updated dose"}'),gen_random_uuid());
  if (result->>'id')::uuid<>record_id or (select vaccination_id from public.queue_entries where id=queue)<>record_id or (select status from public.queue_entries where id=queue)<>'completed' or
    (select count(*) from public.vaccinations where pet_id=pet)<>before_count+1 or (select dose from public.vaccinations where id=record_id)<>'Updated dose' or
    (select count(*) from public.reminders where vaccination_id=record_id)<>1 then raise exception 'TEST: vaccine completion duplicated record/reminder or lost status'; end if;
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','vaccination'),gen_random_uuid())->>'id')::uuid;
  select queue_number into booked_ticket from public.queue_entries where id=queue;
  result:=public.portal_mutation('create_queued_vaccination',record_data,gen_random_uuid());
  if (result->>'queueEntryId')::uuid<>queue or (result->>'queueNumber')::integer<>booked_ticket then raise exception 'TEST: patient vaccine replaced existing arrival'; end if;
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',queue),gen_random_uuid());
  if (select status from public.queue_entries where id=queue)<>'cancelled' or (select vaccination_id from public.queue_entries where id=queue) is null then raise exception 'TEST: cancelled vaccine lost record/status'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('queue_test.pending'),'role','authenticated')::text,true);
  if exists(select 1 from public.queue_entries) then raise exception 'TEST: pending queue read'; end if;
  rejected:=false;
  begin perform public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','checkup'),gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: pending queue write'; end if;
  rejected:=false;
  begin perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',1,'record','{}'::jsonb),gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: pending draft write'; end if;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_encounter',record_data,gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: pending patient checkup write'; end if;
  rejected:=false;
  begin perform public.portal_mutation('create_queued_vaccination',record_data,gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: pending patient vaccine write'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',doctor,'role','authenticated')::text,true);
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','pet','id',pet,'reason','Queue rollback cleanup'),gen_random_uuid());
  if exists(select 1 from public.queue_entries where pet_id=pet) then raise exception 'TEST: patient deletion left queue rows'; end if;
end $$;
reset role;
update public.profiles set is_active=false where id=current_setting('queue_test.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('queue_test.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
  if exists(select 1 from public.queue_entries) then raise exception 'TEST: inactive queue read'; end if;
  begin perform public.portal_mutation('add_queue_entry','{}',gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: inactive queue write'; end if;
end $$;
reset role;
rollback;
select 'PASS: automatic checkup/vaccine queueing, linked record completion, daily tickets, drafts, retries, atomic care, appointment synchronization, reminders, access and deletion' as result;
