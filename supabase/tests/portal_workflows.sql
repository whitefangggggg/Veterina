-- Run as database administrator on the connected development schema.
-- Every fixture and write is rolled back; no test patients or stock remain.
begin;
select set_config('veterina_test.owner',gen_random_uuid()::text,true);
select set_config('veterina_test.staff',gen_random_uuid()::text,true);
select set_config('veterina_test.pending',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
select current_setting('veterina_test.owner')::uuid,'rollback-owner-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('veterina_test.staff')::uuid,'rollback-staff-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('veterina_test.pending')::uuid,'rollback-pending-'||gen_random_uuid()||'@example.org',now();
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('veterina_test.owner')::uuid,'Rollback owner','owner',true),
  (current_setting('veterina_test.staff')::uuid,'Rollback staff','clinical_staff',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.owner'),'role','authenticated')::text,true);
set local role authenticated;

do $$
#variable_conflict use_variable
declare
  owner_id uuid; pet_id uuid; second_pet uuid; visit_id uuid; vaccine_id uuid; reminder_id uuid; appointment_id uuid;
  supplier_id uuid; item_id uuid; batch_id uuid; rx_id uuid; alert_id uuid; second_item_id uuid; generated_sku text;
  key_id uuid:=gen_random_uuid(); data jsonb; result jsonb; export_document jsonb; before_count integer; rejected boolean; invalid_quantity text; past_start timestamptz; saved_start timestamptz;
  care_date date:=(now() at time zone 'Asia/Manila')::date;
begin
  if current_user<>'authenticated' then raise exception 'TEST: user role not applied'; end if;
  if has_table_privilege('authenticated','public.profiles','INSERT') or has_table_privilege('authenticated','public.inventory_movements','INSERT') then
    raise exception 'TEST: browser has direct privileged write grants'; end if;
  if has_function_privilege('anon','public.portal_mutation(text,jsonb,uuid)','EXECUTE') then raise exception 'TEST: anonymous mutation grant'; end if;

  data:=jsonb_build_object('fullName','Rollback patient owner','phone','09171234567','address','Rollback address','email','test@example.org');
  result:=public.portal_mutation('create_owner',data,key_id); owner_id:=(result->>'id')::uuid;
  if public.portal_mutation('create_owner',data,key_id)<>result then raise exception 'TEST: idempotency mismatch'; end if;
  if (select normalized_phone from public.owners where id=owner_id)<>'+639171234567' then raise exception 'TEST: phone normalization'; end if;
  perform public.portal_mutation('update_owner',data||jsonb_build_object('id',owner_id,'fullName','Updated rollback owner'),gen_random_uuid());
  if (select full_name from public.owners where id=owner_id)<>'Updated rollback owner' then raise exception 'TEST: owner update'; end if;

  data:=jsonb_build_object('ownerId',owner_id,'name','Rollback patient','species','Rabbit','breed','Mixed','sex','Unknown','reproductiveStatus','Unknown','microchip','','latestWeight','2');
  pet_id:=(public.portal_mutation('create_pet',data,gen_random_uuid())->>'id')::uuid;
  second_pet:=(public.portal_mutation('create_pet',data||jsonb_build_object('name','Second rollback patient'),gen_random_uuid())->>'id')::uuid;
  if exists(select 1 from public.pets where id in (pet_id,second_pet) and microchip_number is not null) then raise exception 'TEST: empty microchips'; end if;
  perform public.portal_mutation('update_pet',data||jsonb_build_object('id',pet_id,'name','Updated rabbit','status','Inactive'),gen_random_uuid());
  if (select status from public.pets where id=pet_id)<>'Inactive' then raise exception 'TEST: patient status update'; end if;

  data:=jsonb_build_object('petId',pet_id,'type','Wellness check','complaint','Rollback checkup','weightKg','2.5','veterinarianId',current_setting('veterina_test.owner'),'followUpDate',care_date+1);
  rejected:=false;
  begin perform public.portal_mutation('create_encounter',data||'{"weightKg":"-1"}'::jsonb,gen_random_uuid());
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'TEST: invalid weight accepted'; end if;
  if (select count(*) from public.visits v where v.pet_id=pet_id)<>0 then raise exception 'TEST: partial encounter write'; end if;
  key_id:=gen_random_uuid(); result:=public.portal_mutation('create_encounter',data,key_id); visit_id:=(result->>'id')::uuid;
  perform public.portal_mutation('create_encounter',data,key_id);
  if (select count(*) from public.visits v where v.id=visit_id)<>1 or (select count(*) from public.reminders r where r.visit_id=visit_id)<>1 then raise exception 'TEST: encounter replay duplicated rows'; end if;
  perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit_id,'complaint','Edited checkup','weightKg','3'),gen_random_uuid());
  if (select weight_kg from public.visit_vitals v where v.visit_id=visit_id)<>3 then raise exception 'TEST: vitals edit'; end if;
  rx_id:=(public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit_id,'medicationName','Recorded medication','dose','Recorded dose','frequency','Recorded frequency'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit_id),gen_random_uuid());
  rejected:=false;
  begin perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit_id),gen_random_uuid()); exception when others then if sqlerrm like 'RECORD_FINALIZED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: finalized visit editable'; end if;
  rejected:=false;
  begin perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx_id,'medicationName','Changed','dose','Changed','frequency','Changed'),gen_random_uuid()); exception when others then if sqlerrm like 'RECORD_FINALIZED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: finalized prescription editable'; end if;
  perform public.portal_mutation('correct_encounter',jsonb_build_object('id',visit_id,'reason','Rollback correction','correction','Corrected historical entry'),gen_random_uuid());
  if not exists(select 1 from public.visit_corrections c where c.visit_id=visit_id and c.before_data#>>'{visit,id}'=visit_id::text and c.after_data->>'appended_correction'='Corrected historical entry') then raise exception 'TEST: correction snapshots missing'; end if;

  data:=jsonb_build_object('petId',pet_id,'vaccine','Rollback vaccine','lotNumber','ROLLBACK','administeredAt',care_date,'nextDueAt',care_date+10,'veterinarianId',current_setting('veterina_test.owner'));
  vaccine_id:=(public.portal_mutation('create_vaccination',data,gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('update_vaccination',data||jsonb_build_object('id',vaccine_id,'nextDueAt',care_date+20),gen_random_uuid());
  if (select count(*) from public.reminders r where r.vaccination_id=vaccine_id and status not in ('completed','cancelled'))<>1 then raise exception 'TEST: vaccine reminder duplicate'; end if;
  if (select count(*) from public.reminders r where r.vaccination_id=vaccine_id and status='cancelled')<>1 then raise exception 'TEST: superseded reminder history lost'; end if;

  data:=jsonb_build_object('petId',pet_id,'title','Rollback reminder','dueDate',care_date,'priority','high','assignedTo','');
  reminder_id:=(public.portal_mutation('create_reminder',data,gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('update_reminder',data||jsonb_build_object('id',reminder_id,'title','Updated reminder'),gen_random_uuid());
  perform public.portal_mutation('snooze_reminder',jsonb_build_object('id',reminder_id,'dueDate',care_date+2),gen_random_uuid());
  perform public.portal_mutation('log_reminder_attempt',jsonb_build_object('id',reminder_id,'notes','Owner unavailable; try again later'),gen_random_uuid());
  if (select status from public.reminders where id=reminder_id)='completed' or not exists(select 1 from public.reminder_activity a where a.reminder_id=reminder_id and action='contact_attempt') then raise exception 'TEST: contact attempt incorrectly completed reminder'; end if;
  perform public.portal_mutation('complete_reminder',jsonb_build_object('id',reminder_id,'outcome','Reached owner'),gen_random_uuid());
  if not exists(select 1 from public.reminder_activity r where r.reminder_id=reminder_id and action='completed') then raise exception 'TEST: contact outcome missing'; end if;

  data:=jsonb_build_object('petId',pet_id,'date',care_date+1,'time','09:00','service','Wellness check','veterinarianId',current_setting('veterina_test.owner'));
  -- Creating or rescheduling into yesterday, an earlier hour or this minute
  -- must fail server-side, independently of browser input restrictions.
  foreach past_start in array array[clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour',date_trunc('minute',clock_timestamp())] loop
    rejected:=false;
    begin perform public.portal_mutation('book_appointment',data||jsonb_build_object('date',to_char(past_start at time zone 'Asia/Manila','YYYY-MM-DD'),'time',to_char(past_start at time zone 'Asia/Manila','HH24:MI')),gen_random_uuid());
    exception when others then if sqlerrm like 'APPOINTMENT_IN_PAST%' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'TEST: booking in the past accepted'; end if;
  end loop;
  appointment_id:=(public.portal_mutation('book_appointment',data,gen_random_uuid())->>'id')::uuid;
  select starts_at into saved_start from public.appointments where id=appointment_id;
  foreach past_start in array array[clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour',date_trunc('minute',clock_timestamp())] loop
    rejected:=false;
    begin perform public.portal_mutation('reschedule_appointment',data||jsonb_build_object('id',appointment_id,'date',to_char(past_start at time zone 'Asia/Manila','YYYY-MM-DD'),'time',to_char(past_start at time zone 'Asia/Manila','HH24:MI')),gen_random_uuid());
    exception when others then if sqlerrm like 'APPOINTMENT_IN_PAST%' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'TEST: rescheduling into the past accepted'; end if;
    if (select starts_at from public.appointments where id=appointment_id)<>saved_start then raise exception 'TEST: failed reschedule changed original appointment'; end if;
  end loop;
  rejected:=false;
  begin perform public.portal_mutation('book_appointment',data,gen_random_uuid()); exception when others then if sqlerrm like 'APPOINTMENT_CONFLICT%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: overlapping booking accepted'; end if;
  perform public.portal_mutation('reschedule_appointment',data||jsonb_build_object('id',appointment_id,'time','10:00'),gen_random_uuid());
  perform public.portal_mutation('transition_appointment',jsonb_build_object('id',appointment_id,'status','arrived'),gen_random_uuid());
  perform public.portal_mutation('transition_appointment',jsonb_build_object('id',appointment_id,'status','in_progress'),gen_random_uuid());
  perform public.portal_mutation('transition_appointment',jsonb_build_object('id',appointment_id,'status','completed'),gen_random_uuid());

  data:=jsonb_build_object('name','Rollback supplier','phone','09171234567','address','Test','contactPerson','Test');
  supplier_id:=(public.portal_mutation('create_supplier',data,gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('update_supplier',data||jsonb_build_object('id',supplier_id,'name','Updated supplier'),gen_random_uuid());
  -- No SKU input is needed. Retried creates return the same item and SKU.
  data:=jsonb_build_object('name','Rollback item','category','Medicine','unit','unit','minimumStock','2','supplierId',supplier_id,'expirationDate',care_date+30);
  key_id:=gen_random_uuid();
  item_id:=(public.portal_mutation('create_inventory_item',data,key_id)->>'id')::uuid;
  select sku into generated_sku from public.inventory_items where id=item_id;
  if generated_sku !~ '^SKU-[0-9]{6,}$' then raise exception 'TEST: inventory SKU was not generated'; end if;
  if (public.portal_mutation('create_inventory_item',data,key_id)->>'id')::uuid<>item_id then raise exception 'TEST: inventory retry duplicated item'; end if;
  perform public.portal_mutation('update_inventory_item',data||jsonb_build_object('id',item_id,'name','Edited rollback item'),gen_random_uuid());
  perform public.portal_mutation('update_inventory_item',data||jsonb_build_object('id',item_id,'sku','CLIENT-SUPPLIED-SKU'),gen_random_uuid());
  if (select sku from public.inventory_items where id=item_id)<>generated_sku then raise exception 'TEST: inventory edit changed SKU'; end if;
  second_item_id:=(public.portal_mutation('create_inventory_item',data||jsonb_build_object('sku',generated_sku,'name','Second rollback item'),gen_random_uuid())->>'id')::uuid;
  if (select sku from public.inventory_items where id=second_item_id)=generated_sku then raise exception 'TEST: inventory SKUs are not unique'; end if;
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','inventory_item','id',second_item_id,'reason','Rollback SKU uniqueness check'),gen_random_uuid());
  select id into batch_id from public.inventory_batches b where b.item_id=item_id;
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item_id,'batchId',batch_id,'delta',10,'reason','Supplier delivery'),gen_random_uuid());
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item_id,'batchId',batch_id,'delta',-3,'reason','Clinic use'),gen_random_uuid());
  rejected:=false;
  begin perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item_id,'batchId',batch_id,'delta',-8,'reason','Clinic use'),gen_random_uuid()); exception when others then if sqlerrm like 'INSUFFICIENT_STOCK%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: negative stock accepted'; end if;
  perform public.portal_mutation('record_count_adjustment',jsonb_build_object('id',item_id,'batchId',batch_id,'observedQuantity',6,'reason','Counted one damaged unit'),gen_random_uuid());
  if (select sum(quantity_delta) from public.inventory_movements m where m.item_id=item_id)<>6 then raise exception 'TEST: stock balance'; end if;
  if not exists(select 1 from public.inventory_movements m where m.item_id=item_id and movement_type='adjustment' and reason like '%Counted one damaged unit%') then raise exception 'TEST: adjustment reason missing'; end if;
  foreach invalid_quantity in array array['','NaN','Infinity'] loop
    rejected:=false;
    begin perform public.portal_mutation('record_count_adjustment',jsonb_build_object('id',item_id,'batchId',batch_id,'observedQuantity',invalid_quantity,'reason','Invalid count'),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED%' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'TEST: invalid stock count accepted'; end if;
  end loop;
  rejected:=false;
  begin perform public.portal_mutation('update_batch',jsonb_build_object('id',batch_id,'isActive',false),gen_random_uuid()); exception when others then if sqlerrm like 'BATCH_HAS_STOCK%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: stocked batch archived'; end if;
  perform public.portal_mutation('record_count_adjustment',jsonb_build_object('id',item_id,'batchId',batch_id,'observedQuantity',0,'reason','Rollback disposal'),gen_random_uuid());
  perform public.portal_mutation('update_batch',jsonb_build_object('id',batch_id,'isActive',false),gen_random_uuid());
  if (select is_active from public.inventory_batches where id=batch_id) then raise exception 'TEST: batch archive not saved'; end if;
  rejected:=false;
  begin perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item_id,'batchId',batch_id,'delta',1,'reason','Supplier delivery'),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: archived batch received stock'; end if;
  rejected:=false;
  begin perform public.portal_mutation('record_count_adjustment',jsonb_build_object('id',item_id,'batchId',batch_id,'observedQuantity',1,'reason','Invalid archived count'),gen_random_uuid()); exception when others then if sqlerrm like 'VALIDATION_FAILED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: archived batch count increased'; end if;
  rejected:=false;
  begin perform public.portal_mutation('delete_record',jsonb_build_object('entity','inventory_item','id',item_id,'reason','Rollback'),gen_random_uuid()); exception when others then if sqlerrm like 'IMMUTABLE_LEDGER%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: stock history deleted'; end if;

  alert_id:=(public.portal_mutation('create_alert',jsonb_build_object('petId',pet_id,'alertType','allergy','description','Recorded allergy'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('update_alert',jsonb_build_object('id',alert_id,'alertType','allergy','severity','critical','description','Updated allergy'),gen_random_uuid());
  if (select description from public.pet_alerts where id=alert_id)<>'Updated allergy' then raise exception 'TEST: care alert edit'; end if;
  perform public.portal_mutation('resolve_alert',jsonb_build_object('id',alert_id),gen_random_uuid());
  result:=public.export_report('history',pet_id);
  if result->0->'owner' is null or jsonb_array_length(result->0->'visits')<>1 or jsonb_array_length(result->0->'vitals')<>1 then raise exception 'TEST: incomplete history export'; end if;

  -- A clinician rename must not rewrite the name on historical encounters.
  select jsonb_build_object('clinicName',c.clinic_name,'phone',c.phone,'email',c.email,'address',c.address,'timezone',c.timezone,
    'retentionYears',c.record_retention_years,'reminderLeadDays',c.reminder_lead_days,'aiEnabled',c.ai_enabled,'fullName','Renamed rollback owner')
    into data from public.clinic_settings c limit 1;
  perform public.portal_mutation('save_settings',data,gen_random_uuid());
  if (select attending_veterinarian_name from public.visits where id=visit_id)<>'Rollback owner' or (select recorded_by_name from public.visits where id=visit_id)<>'Rollback owner' then raise exception 'TEST: historical clinician attribution changed'; end if;
  if (select administered_by_name from public.vaccinations where id=vaccine_id)<>'Rollback owner' then raise exception 'TEST: vaccination clinician attribution changed'; end if;

  export_document:=public.filtered_export_report('patients',null,'{"species":"Rabbit","patient_status":"Inactive"}');
  if (export_document->>'row_count')::integer<>1 then raise exception 'TEST: patient report filters'; end if;
  if not exists(select 1 from public.export_events e where id=(export_document->>'export_id')::uuid and row_count=1 and filters->>'species'='Rabbit' and status='prepared') then raise exception 'TEST: export audit metadata'; end if;
  export_document:=public.filtered_export_report('vaccinations',null,jsonb_build_object('date_from',care_date+19,'date_to',care_date+21));
  if (export_document->>'row_count')::integer<>1 then raise exception 'TEST: vaccination report date filters'; end if;
  export_document:=public.filtered_export_report('vaccinations',null,jsonb_build_object('date_from',care_date+1,'date_to',care_date+2));
  if (export_document->>'row_count')::integer<>0 then raise exception 'TEST: empty filtered export'; end if;
  export_document:=public.filtered_export_report('reminders',null,jsonb_build_object('date_from',care_date+2,'date_to',care_date+2,'reminder_status','completed'));
  if (export_document->>'row_count')::integer<>1 then raise exception 'TEST: reminder report filters'; end if;
  rejected:=false;
  begin perform public.filtered_export_report('patients',null,jsonb_build_object('date_from',care_date+2,'date_to',care_date)); exception when others then if sqlerrm like 'VALIDATION_FAILED%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: reversed report range accepted'; end if;
  perform public.portal_mutation('create_encounter',jsonb_build_object('petId',pet_id,'type','Follow-up','complaint','Second history entry','weightKg','3','veterinarianId',current_setting('veterina_test.owner')),gen_random_uuid());
  perform public.portal_mutation('create_encounter',jsonb_build_object('petId',pet_id,'type','Follow-up','complaint','Third history entry','weightKg','3','veterinarianId',current_setting('veterina_test.owner')),gen_random_uuid());
  export_document:=public.filtered_export_report('history',pet_id);
  if jsonb_array_length(export_document->'rows'->0->'visits')<>3 or jsonb_array_length(export_document->'rows'->0->'vitals')<>3 then raise exception 'TEST: full history with 3 encounters'; end if;

  -- Exercise clinical staff privileges with an unexpired authenticated identity.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.staff'),'role','authenticated')::text,true);
  if not exists(select 1 from public.pets where id=pet_id) then raise exception 'TEST: active staff cannot read'; end if;
  rejected:=false;
  begin perform public.portal_mutation('delete_record',jsonb_build_object('entity','pet','id',pet_id,'reason','Unauthorized'),gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: staff permanent delete succeeded'; end if;
  rejected:=false;
  begin perform public.export_report('patients'); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: staff export succeeded'; end if;
  rejected:=false;
  begin perform public.filtered_export_report('patients'); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: staff filtered export succeeded'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.pending'),'role','authenticated')::text,true);
  if exists(select 1 from public.pets) or exists(select 1 from public.owners) then raise exception 'TEST: pending user can read clinic data'; end if;
  rejected:=false;
  begin perform public.portal_mutation('create_owner',jsonb_build_object('fullName','Unauthorized'),gen_random_uuid()); exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: pending user can mutate'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.owner'),'role','authenticated')::text,true);
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','pet','id',pet_id,'reason','Rollback test cleanup'),gen_random_uuid());
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','pet','id',second_pet,'reason','Rollback test cleanup'),gen_random_uuid());
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','owner','id',owner_id,'reason','Rollback test cleanup'),gen_random_uuid());
  if exists(select 1 from public.visits v where v.id=visit_id) or exists(select 1 from public.pets p where p.id=pet_id) then raise exception 'TEST: delete did not remove dependent clinical rows'; end if;
end $$;
reset role;
update public.profiles set is_active=false where id=current_setting('veterina_test.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
  if exists(select 1 from public.pets) or exists(select 1 from public.reminders) then raise exception 'TEST: inactive staff can read'; end if;
  begin perform public.portal_mutation('create_owner','{}'::jsonb,gen_random_uuid());
  exception when others then if sqlerrm like 'FORBIDDEN%' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'TEST: inactive staff can write'; end if;
end $$;
reset role;
rollback;
