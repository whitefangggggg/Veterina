begin;
select set_config('history.actor',gen_random_uuid()::text,true);
select set_config('history.foreign_actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.actor')::uuid,'history-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('history.actor')::uuid,'History recorder','clinical_staff',true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.foreign_actor')::uuid,'foreign-history-'||gen_random_uuid()||'@veterina-test.invalid',now());
select set_config('history.foreign_clinic',public.provision_vetshop(current_setting('history.foreign_actor')::uuid,'Foreign history clinic','Foreign clinician')::text,true);
insert into private.clinic_subscriptions(clinic_id,expires_at) values(current_setting('history.foreign_clinic')::uuid,now()+interval '30 days');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.actor'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare person uuid; pet uuid; saved jsonb; queued jsonb; payload jsonb; key uuid:=gen_random_uuid(); visit uuid; rx uuid; before_queue integer; before_reminders integer; before_stock integer; before_visits integer; begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Historical household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Historical pet','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  perform set_config('history.pet',pet::text,true);
  queued:=public.portal_mutation('create_queued_encounter',jsonb_build_object('petId',pet,'type','Wellness Check','complaint','Current care','weightKg',3,'veterinarianId',auth.uid()),gen_random_uuid());
  select count(*) into before_queue from public.queue_entries;
  select count(*) into before_reminders from public.reminders;
  select count(*) into before_stock from public.inventory_movements;
  payload:=jsonb_build_object('petId',pet,'type','Medical Concern','complaint','Old handwritten record','encounteredAt','2020-01-02T03:00:00Z','veterinarianId','','veterinarianName','Dok Máya sa Bukid','clinicalNotes','Historical notes','followUpDate','2030-01-02',
    'prescription',jsonb_build_object('medications',jsonb_build_array(jsonb_build_object('medicationName','Tambal sa tiyan'))));
  saved:=public.portal_mutation('create_record_only_checkup',payload,key);
  visit:=(saved->>'id')::uuid; rx:=(saved->>'prescriptionId')::uuid;
  perform set_config('history.visit',visit::text,true); perform set_config('history.rx',rx::text,true);
  if public.portal_mutation('create_record_only_checkup',payload,key)<>saved then raise exception 'TEST: retry changed'; end if;
  if not exists(select 1 from public.visits where id=visit and recording_purpose='record_only' and attending_veterinarian_id is null and attending_veterinarian_name='Dok Máya sa Bukid' and recorded_by=auth.uid() and visited_at='2020-01-02T03:00:00Z' and finalized_at is null) then raise exception 'TEST: historical identity/date lost'; end if;
  if not exists(select 1 from public.visit_vitals where visit_id=visit and weight_kg is null) then raise exception 'TEST: missing weight invented'; end if;
  if not exists(select 1 from public.prescriptions where id=rx and is_historical and dose='' and frequency='' and prescribed_by is null and prescribed_by_name='Dok Máya sa Bukid' and recorded_by=auth.uid() and prescribed_at='2020-01-02T03:00:00Z') then raise exception 'TEST: historical prescription metadata lost'; end if;
  if (select count(*) from public.queue_entries)<>before_queue or (select count(*) from public.reminders)<>before_reminders or (select count(*) from public.inventory_movements)<>before_stock then raise exception 'TEST: historical save changed operational state'; end if;
  select count(*) into before_visits from public.visits;
  begin
    perform public.portal_mutation('create_record_only_checkup',jsonb_set(payload,'{prescription,medications,0,medicationName}','""'),gen_random_uuid());
    raise exception 'TEST: accepted invalid historical prescription';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  if (select count(*) from public.visits)<>before_visits then raise exception 'TEST: prescription failure left a partial visit'; end if;
  begin
    perform public.portal_mutation('create_record_only_checkup',(payload-'prescription')||jsonb_build_object('veterinarianId',current_setting('history.foreign_actor')),gen_random_uuid());
    raise exception 'TEST: foreign clinician accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  begin
    perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(jsonb_build_object('medicationName','Stock','inventoryItemId',gen_random_uuid()))),gen_random_uuid());
    raise exception 'TEST: historical stock accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED: historical prescriptions%' then raise; end if; end;
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'prescribedById','','prescribedByName','Dok José','prescribedAt','2020-01-03T00:00:00Z','medications',jsonb_build_array(jsonb_build_object('medicationName','Tambal','frequency','Kung gikinahanglan'))),gen_random_uuid());
  if not exists(select 1 from public.prescriptions where id=rx and prescribed_by_name='Dok José' and prescribed_at='2020-01-03T00:00:00Z' and recorded_by=auth.uid()) then raise exception 'TEST: historical prescription edit lost'; end if;
  perform public.portal_mutation('update_encounter',(payload-'prescription')||jsonb_build_object('id',visit,'recordingPurpose','record_only','veterinarianName','','followUpDate','2031-01-02'),gen_random_uuid());
  if not exists(select 1 from public.visits where id=visit and attending_veterinarian_id is null and attending_veterinarian_name='') then raise exception 'TEST: unknown clinician replaced by recorder'; end if;
  if (select count(*) from public.reminders)<>before_reminders then raise exception 'TEST: historical edit created reminder'; end if;
  begin
    perform public.portal_mutation('arrive_follow_up',jsonb_build_object('visitId',visit,'expectedDate','2030-01-02'),gen_random_uuid());
    raise exception 'TEST: historical arrival accepted';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  begin
    perform public.portal_mutation('update_encounter',(payload-'prescription')||jsonb_build_object('id',visit,'recordingPurpose','queue'),gen_random_uuid());
    raise exception 'TEST: purpose conversion accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  -- Queue responsibility remains the real actor while the recorded clinician is custom.
  perform public.portal_mutation('complete_checkup',jsonb_build_object('id',queued->>'id','queueEntryId',queued->>'queueEntryId','petId',pet,'type','Other','complaint','Current concern','weightKg',4,'veterinarianId','','veterinarianName','Dok sa Barangay','assignedStaffId',auth.uid()),gen_random_uuid());
  if not exists(select 1 from public.visits where id=(queued->>'id')::uuid and attending_veterinarian_id is null and attending_veterinarian_name='Dok sa Barangay') then raise exception 'TEST: custom queued clinician lost'; end if;
  if not exists(select 1 from public.queue_entries where id=(queued->>'queueEntryId')::uuid and veterinarian_id=auth.uid() and status='completed') then raise exception 'TEST: queue responsibility lost'; end if;
  begin
    perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',queued->>'id','is_historical',true,'medications',jsonb_build_array(jsonb_build_object('medicationName','Incomplete live medicine'))),gen_random_uuid());
    raise exception 'TEST: caller bypassed live medication validation';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit),gen_random_uuid());
  begin
    perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(jsonb_build_object('medicationName','Changed'))),gen_random_uuid());
    raise exception 'TEST: finalized historical record edited';
  exception when others then if sqlerrm not like 'RECORD_FINALIZED%' then raise; end if; end;
  if has_function_privilege('authenticated','private.create_record_only_checkup(jsonb)','execute') or has_function_privilege('anon','private.save_historical_prescription(jsonb,boolean)','execute') then raise exception 'TEST: private history helper exposed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.foreign_actor'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.visits where id=current_setting('history.visit')::uuid) then raise exception 'TEST: foreign visit visible'; end if;
  begin
    perform public.portal_mutation('create_record_only_checkup',jsonb_build_object('petId',current_setting('history.pet'),'type','Other','complaint','Foreign patient','encounteredAt','2020-01-02T00:00:00Z'),gen_random_uuid());
    raise exception 'TEST: foreign patient accepted';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin
    perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',current_setting('history.visit'),'medications',jsonb_build_array(jsonb_build_object('medicationName','Foreign medicine'))),gen_random_uuid());
    raise exception 'TEST: foreign historical prescription accepted';
  exception when others then if sqlerrm not like 'NOT_FOUND%' and sqlerrm not like 'FORBIDDEN%' and sqlerrm not like 'RECORD_FINALIZED%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin
    perform public.portal_mutation('create_record_only_checkup','{}',gen_random_uuid());
    raise exception 'TEST: anonymous historical save accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
