begin;
select set_config('history.actor',gen_random_uuid()::text,true);
select set_config('history.foreign_actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.actor')::uuid,'history-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('history.actor')::uuid,'Visit recorder','owner',true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.foreign_actor')::uuid,'foreign-history-'||gen_random_uuid()||'@veterina-test.invalid',now());
select set_config('history.foreign_clinic',public.provision_vetshop(current_setting('history.foreign_actor')::uuid,'Foreign history clinic','Foreign clinician')::text,true);
insert into private.clinic_subscriptions(clinic_id,expires_at) values(current_setting('history.foreign_clinic')::uuid,now()+interval '30 days');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.actor'),'role','authenticated')::text,true);
select set_config('history.foreign_service',(select id::text from public.service_types where clinic_id=current_setting('history.foreign_clinic')::uuid and workflow='maintenance' limit 1),true);
set local role authenticated;

do $$ declare person uuid; pet uuid; grooming uuid; surgery uuid; saved jsonb; payload jsonb; key uuid:=gen_random_uuid(); service_record uuid; before_q integer; before_r integer; before_i integer; bad jsonb; queued jsonb; export jsonb;
begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Visit household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Visit pet','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  select id into grooming from public.service_types where name='Grooming' and is_active;
  select id into surgery from public.service_types where name='Surgery' and is_active;
  queued:=public.portal_mutation('add_queue_entry',jsonb_build_object('ownerId',person,'petId',pet,'serviceId',grooming,'notes','Current bath'),gen_random_uuid());
  if not exists(select 1 from public.queue_entries where id=(queued->>'id')::uuid and category='maintenance' and status='waiting') then raise exception 'TEST: live service not queued'; end if;
  select count(*) into before_q from public.queue_entries;
  select count(*) into before_r from public.reminders;
  select count(*) into before_i from public.inventory_movements;
  payload:=jsonb_build_object('petId',pet,'serviceId',grooming,'performedAt','2020-01-02T01:00:00Z','veterinarianId','','veterinarianName','Dok sa Bukid','serviceNotes','Old grooming notes');
  saved:=public.portal_mutation('create_record_only_service',payload,key); service_record:=(saved->>'id')::uuid;
  if public.portal_mutation('create_record_only_service',payload,key)<>saved then raise exception 'TEST: duplicate on retry'; end if;
  if saved ? 'queueEntryId' or not exists(select 1 from public.patient_service_records where id=service_record and performed_by is null and performed_by_name='Dok sa Bukid' and recorded_by=auth.uid() and service_name='Grooming' and performed_at='2020-01-02T01:00:00Z') then raise exception 'TEST: historical service evidence lost'; end if;
  perform public.portal_mutation('update_record_only_service',payload||jsonb_build_object('id',service_record,'veterinarianName','','serviceNotes','Corrected historical notes'),gen_random_uuid());
  if not exists(select 1 from public.patient_service_records where id=service_record and performed_by_name='' and service_notes='Corrected historical notes' and recorded_by=auth.uid()) then raise exception 'TEST: optional clinician/edit failed'; end if;
  foreach bad in array array[jsonb_build_object('performedAt',''),jsonb_build_object('performedAt','2999-01-01'),jsonb_build_object('performedAt','infinity'),jsonb_build_object('serviceId',surgery),jsonb_build_object('serviceId',current_setting('history.foreign_service')),jsonb_build_object('petId',gen_random_uuid()),jsonb_build_object('veterinarianId',current_setting('history.foreign_actor')),jsonb_build_object('dispenseQuantity',1)] loop
    begin
      perform public.portal_mutation('create_record_only_service',payload||bad,gen_random_uuid());
      raise exception 'TEST: invalid historical service accepted %',bad;
    exception when others then if sqlerrm not like 'VALIDATION_FAILED%' and sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  end loop;
  if (select count(*) from public.queue_entries)<>before_q or (select count(*) from public.reminders)<>before_r or (select count(*) from public.inventory_movements)<>before_i then raise exception 'TEST: historical services altered operational state'; end if;
  if (select count(*) from public.patient_service_records where pet_id=pet)<>1 then raise exception 'TEST: failed saves left partial records'; end if;
  saved:=public.portal_mutation('create_queued_encounter',jsonb_build_object('petId',pet,'serviceId',surgery,'type','Medical Concern','complaint','Current surgery','weightKg',3,'veterinarianId',auth.uid()),gen_random_uuid());
  if not exists(select 1 from public.queue_entries where id=(saved->>'queueEntryId')::uuid and service_type_id=surgery and service_name='Surgery') or not exists(select 1 from public.visits where id=(saved->>'id')::uuid and service_type_id=surgery and service_name='Surgery' and visit_type='Medical Concern') then raise exception 'TEST: selected service replaced by reason'; end if;
  saved:=public.portal_mutation('create_record_only_checkup',jsonb_build_object('petId',pet,'serviceId',surgery,'type','Medical Concern','complaint','Old surgery','encounteredAt','2020-01-02T01:00:00Z'),gen_random_uuid());
  if not exists(select 1 from public.visits where id=(saved->>'id')::uuid and service_name='Surgery' and recording_purpose='record_only') then raise exception 'TEST: historical selected service lost'; end if;
  begin
    perform public.portal_mutation('create_record_only_checkup',jsonb_build_object('petId',pet,'serviceId',grooming,'type','Medical Concern','complaint','Wrong form','encounteredAt','2020-01-02T01:00:00Z'),gen_random_uuid());
    raise exception 'TEST: grooming used checkup form';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  export:=public.filtered_export_report('history',pet,'{}');
  if export#>>'{rows,0,historical_services,0,service_notes}' is distinct from 'Corrected historical notes' then raise exception 'TEST: history export omitted service'; end if;
  if has_table_privilege('authenticated','public.patient_service_records','insert') or has_function_privilege('authenticated','private.save_record_only_service(jsonb,boolean)','execute') then raise exception 'TEST: direct mutation exposed'; end if;
  perform set_config('history.service_record',service_record::text,true);
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.foreign_actor'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.patient_service_records where id=current_setting('history.service_record')::uuid) then raise exception 'TEST: cross-clinic history leaked'; end if;
  begin
    perform public.portal_mutation('update_record_only_service',jsonb_build_object('id',current_setting('history.service_record')),gen_random_uuid());
    raise exception 'TEST: cross-clinic update allowed';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
end $$;
reset role;
rollback;
