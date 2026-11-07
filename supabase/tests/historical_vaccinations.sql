begin;
select set_config('history.actor',gen_random_uuid()::text,true);
select set_config('history.foreign_actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.actor')::uuid,'history-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('history.actor')::uuid,'History recorder','clinical_staff',true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('history.foreign_actor')::uuid,'foreign-history-'||gen_random_uuid()||'@veterina-test.invalid',now());
select set_config('history.foreign_clinic',public.provision_vetshop(current_setting('history.foreign_actor')::uuid,'Foreign history clinic','Foreign clinician')::text,true);
insert into private.clinic_subscriptions(clinic_id,expires_at) values(current_setting('history.foreign_clinic')::uuid,now()+interval '30 days');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.actor'),'role','authenticated')::text,true);
insert into public.inventory_items(name,sku,category,unit,minimum_stock,brand,created_by) values('Live vaccine','HIST-VAX-TEST','Vaccines','dose',0,'Live brand',current_setting('history.actor')::uuid);
select set_config('history.item',(select id::text from public.inventory_items where name='Live vaccine'),true);
select set_config('history.batch',(public.portal_mutation('create_batch',jsonb_build_object('itemId',current_setting('history.item'),'lotNumber','HIST-STOCK'),gen_random_uuid())->>'id'),true);
set local role authenticated;

do $$ declare person uuid; pet uuid; saved jsonb; payload jsonb; key uuid:=gen_random_uuid(); vaccine uuid; before_queue integer; before_reminders integer; before_stock integer; before_records integer; bad jsonb;
begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Vaccination household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Historical vaccine pet','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('create_queued_encounter',jsonb_build_object('petId',pet,'type','Wellness Check','complaint','Current care','weightKg',3,'veterinarianId',auth.uid()),gen_random_uuid());
  perform public.portal_mutation('create_queued_vaccination',jsonb_build_object('petId',pet,'veterinarianId',auth.uid(),'inventoryItemId',current_setting('history.item'),'batchId',current_setting('history.batch'),'dispenseQuantity',1,'administeredAt',current_date,'nextDueAt',current_date+30),gen_random_uuid());
  select count(*) into before_queue from public.queue_entries;
  select count(*) into before_reminders from public.reminders;
  select count(*) into before_stock from public.inventory_movements;
  payload:=jsonb_build_object('petId',pet,'vaccine','Anti-Rabies','administeredAt','2020-01-02','nextDueAt','2030-01-02','veterinarianName','Dok Máya sa Bukid','lotNumber','OLD-01');
  saved:=public.portal_mutation('create_record_only_vaccination',payload,key); vaccine:=(saved->>'id')::uuid;
  if public.portal_mutation('create_record_only_vaccination',payload,key)<>saved then raise exception 'TEST: retry duplicated vaccination'; end if;
  if saved ? 'queueEntryId' or not exists(select 1 from public.vaccinations where id=vaccine and recording_purpose='record_only' and administered_by is null and administered_by_name=payload->>'veterinarianName' and recorded_by=auth.uid() and inventory_item_id is null and administered_at='2020-01-02') then raise exception 'TEST: historical evidence not preserved'; end if;
  perform public.portal_mutation('update_vaccination',payload||jsonb_build_object('id',vaccine,'veterinarianName','','nextDueAt','2031-01-02'),gen_random_uuid());
  if not exists(select 1 from public.vaccinations where id=vaccine and administered_by is null and administered_by_name='' and next_due_at='2031-01-02') then raise exception 'TEST: historical edit failed'; end if;
  select count(*) into before_records from public.vaccinations;
  foreach bad in array array[
    jsonb_build_object('vaccine',''),jsonb_build_object('administeredAt',''),jsonb_build_object('administeredAt','2999-01-01'),jsonb_build_object('nextDueAt','2020-01-02'),jsonb_build_object('administeredAt','infinity'),
    jsonb_build_object('veterinarianId',current_setting('history.foreign_actor')),jsonb_build_object('petId',gen_random_uuid()),jsonb_build_object('inventoryItemId',gen_random_uuid()),jsonb_build_object('dispenseQuantity',1)] loop
    begin
      perform public.portal_mutation('create_record_only_vaccination',payload||bad,gen_random_uuid());
      raise exception 'TEST: invalid historical vaccination accepted %',bad;
    exception when others then if sqlerrm not like 'VALIDATION_FAILED%' and sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  end loop;
  begin
    perform public.portal_mutation('update_vaccination',payload||jsonb_build_object('id',vaccine,'recordingPurpose','queue'),gen_random_uuid());
    raise exception 'TEST: mode conversion accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  if (select count(*) from public.vaccinations)<>before_records then raise exception 'TEST: failed saves left partial records'; end if;
  if (select count(*) from public.queue_entries)<>before_queue or (select count(*) from public.reminders)<>before_reminders or (select count(*) from public.inventory_movements)<>before_stock then raise exception 'TEST: historical vaccination changed operational state'; end if;
  if has_function_privilege('authenticated','private.save_record_only_vaccination(jsonb,boolean)','execute') or has_function_privilege('anon','private.save_record_only_vaccination(jsonb,boolean)','execute') then raise exception 'TEST: helper exposed'; end if;
  perform set_config('history.vaccine',vaccine::text,true);
end $$;
reset role;
-- Even internal writes cannot attach historical evidence to live queues/reminders.
set local role veterina_rpc;
do $$ begin
  begin
    update public.queue_entries set vaccination_id=current_setting('history.vaccine')::uuid where pet_id=(select pet_id from public.vaccinations where id=current_setting('history.vaccine')::uuid);
    raise exception 'TEST: historical queue link allowed';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  begin
    insert into public.reminders(pet_id,vaccination_id,reminder_type,title,due_at,created_by) select pet_id,id,'vaccination','Historical due',now(),auth.uid() from public.vaccinations where id=current_setting('history.vaccine')::uuid;
    raise exception 'TEST: historical reminder allowed';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('history.foreign_actor'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.vaccinations where id=current_setting('history.vaccine')::uuid) then raise exception 'TEST: cross-clinic history leaked'; end if;
  begin
    perform public.portal_mutation('update_vaccination',jsonb_build_object('id',current_setting('history.vaccine'),'vaccine','Other','administeredAt','2020-01-02'),gen_random_uuid());
    raise exception 'TEST: foreign update allowed';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' and sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
end $$;
reset role;
rollback;
