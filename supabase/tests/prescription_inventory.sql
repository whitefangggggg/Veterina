-- Isolated Postgres regression checks; every fixture is rolled back.
begin;
select set_config('veterina_test.rx_actor',gen_random_uuid()::text,true);
select set_config('veterina_test.rx_owner',gen_random_uuid()::text,true);
select set_config('veterina_test.rx_inactive',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('veterina_test.rx_actor')::uuid,'rx-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into auth.users(id,email,email_confirmed_at) values(current_setting('veterina_test.rx_owner')::uuid,'rx-owner-'||gen_random_uuid()||'@veterina-test.invalid',now()),(current_setting('veterina_test.rx_inactive')::uuid,'rx-inactive-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('veterina_test.rx_actor')::uuid,'Prescription test clinician','clinical_staff',true);
insert into public.profiles(id,full_name,role,is_active) values(current_setting('veterina_test.rx_owner')::uuid,'Prescription test owner','owner',true),(current_setting('veterina_test.rx_inactive')::uuid,'Prescription inactive','clinical_staff',false);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.rx_actor'),'role','authenticated')::text,true);

create function pg_temp.reject_rx(action text, payload jsonb, expected text) returns void language plpgsql as $$
begin
  perform public.portal_mutation(action,payload,gen_random_uuid());
  raise exception 'TEST: expected rejection %',expected;
exception when others then
  if sqlerrm not like expected||'%' then raise; end if;
end $$;

set local role authenticated;
do $$
declare
  person uuid; patient uuid; visit uuid; item uuid; batch uuid; other_item uuid; other_batch uuid;
  expired uuid; inactive uuid; fractional uuid; fractional_batch uuid; rx uuid; response jsonb;
  medication jsonb; payload jsonb; saved jsonb; key uuid:=gen_random_uuid(); before_count integer;
begin
  if has_table_privilege('authenticated','private.prescription_dispenses','SELECT')
    or has_table_privilege('authenticated','private.prescription_dispenses','INSERT')
    or has_table_privilege('anon','private.prescription_dispenses','SELECT')
    or has_function_privilege('authenticated','private.dispense_prescription_inventory()','EXECUTE') then
    raise exception 'TEST: private dispensing evidence exposed';
  end if;
  person:=(public.portal_mutation('create_owner','{"fullName":"RX owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','RX patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  visit:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',patient,'type','Wellness check','complaint','RX check','weightKg',3,'veterinarianId',current_setting('veterina_test.rx_actor')),gen_random_uuid())->>'id')::uuid;
  item:=(public.portal_mutation('create_inventory_item','{"name":"Medicine snapshot","brand":"Brand","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  other_item:=(public.portal_mutation('create_inventory_item','{"name":"Consumable","category":"Consumables","unit":"unit","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
  select id into other_batch from public.inventory_batches where item_id=other_item;
  fractional:=(public.portal_mutation('create_inventory_item','{"name":"Liquid","category":"Other","unit":"ml","minimumStock":0,"allowsFraction":true}',gen_random_uuid())->>'id')::uuid;
  select id into fractional_batch from public.inventory_batches where item_id=fractional;
  expired:=(public.portal_mutation('create_batch',jsonb_build_object('itemId',item,'lotNumber','EXPIRED','expirationDate','2000-01-01'),gen_random_uuid())->>'id')::uuid;
  inactive:=(public.portal_mutation('create_batch',jsonb_build_object('itemId',item,'lotNumber','INACTIVE'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('update_batch',jsonb_build_object('id',inactive,'isActive',false),gen_random_uuid());
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',10,'reason','Supplier delivery'),gen_random_uuid());
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',fractional,'batchId',fractional_batch,'delta',2,'reason','Supplier delivery'),gen_random_uuid());
  medication:=jsonb_build_object('medicationId',gen_random_uuid(),'medicationName','Client name ignored','inventoryItemId',item,'batchId',batch,'dispenseQuantity',3,'route','Oral','dose','Recorded dose','frequency','Recorded frequency','instructions','Original instructions');
  payload:=jsonb_build_object('visitId',visit,'medications',jsonb_build_array(medication));
  response:=public.portal_mutation('create_prescription',payload,key); rx:=(response->>'id')::uuid;
  if public.portal_mutation('create_prescription',payload,key)<>response then raise exception 'TEST: retry response changed'; end if;
  if (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>7 then raise exception 'TEST: retry deducted twice'; end if;
  select medications into saved from public.prescriptions where id=rx;
  if saved#>>'{0,medicationName}'<>'Medicine snapshot' or saved#>>'{0,dispenseUnit}'<>'tablet' then raise exception 'TEST: server snapshot missing'; end if;
  medication:=saved->0;
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication||'{"instructions":"Edited instructions"}')),gen_random_uuid());
  if (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>7 then raise exception 'TEST: text edit deducted twice'; end if;
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication||'{"dispenseQuantity":2}')),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication||jsonb_build_object('batchId',other_batch))),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication||jsonb_build_object('inventoryItemId',other_item))),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication||'{"medicationName":"Changed"}')),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array(medication-'inventoryItemId'-'batchId'-'dispenseQuantity'-'dispenseUnit')),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medicationName','Legacy replacement','route','Oral','dose','Dose','frequency','Frequency'),'DISPENSING_LOCKED');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,batchId}',to_jsonb(other_batch)),'INVENTORY_UNAVAILABLE');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,batchId}',to_jsonb(expired)),'EXPIRED_BATCH');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,batchId}',to_jsonb(inactive)),'INVENTORY_UNAVAILABLE');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,dispenseQuantity}','0'),'VALIDATION_FAILED');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,dispenseQuantity}','-1'),'VALIDATION_FAILED');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,dispenseQuantity}','0.5'),'VALIDATION_FAILED');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,dispenseQuantity}','"NaN"'),'VALIDATION_FAILED');
  perform pg_temp.reject_rx('create_prescription',jsonb_set(payload,'{medications,0,dispenseQuantity}','100'),'INSUFFICIENT_STOCK');
  perform pg_temp.reject_rx('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(medication,medication)),'VALIDATION_FAILED');
  -- Each row is affordable alone, but the complete transaction must roll back.
  select count(*) into before_count from public.prescriptions;
  perform pg_temp.reject_rx('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(
    medication||jsonb_build_object('medicationId',gen_random_uuid(),'dispenseQuantity',4),
    medication||jsonb_build_object('medicationId',gen_random_uuid(),'dispenseQuantity',4))),'INSUFFICIENT_STOCK');
  if (select count(*) from public.prescriptions)<>before_count or (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>7 then raise exception 'TEST: partial save leaked'; end if;
  perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(
    medication||jsonb_build_object('inventoryItemId',fractional,'batchId',fractional_batch,'dispenseQuantity',0.25))),gen_random_uuid());
  if (select sum(quantity_delta) from public.inventory_movements where batch_id=fractional_batch)<>1.75 then raise exception 'TEST: fractional dispensing'; end if;
  perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(jsonb_build_object('medicationName','Custom','route','Oral','dose','Dose','frequency','Frequency'))),gen_random_uuid());
  perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medicationName','Legacy custom','route','Oral','dose','Dose','frequency','Frequency'),gen_random_uuid());
  if (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>7 then raise exception 'TEST: custom deducted stock'; end if;
  -- Newly added inventory rows deduct once; existing dispensing remains unchanged.
  saved:=jsonb_build_array(medication,medication||jsonb_build_object('medicationId',gen_random_uuid(),'dispenseQuantity',1));
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',saved),gen_random_uuid());
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',saved),gen_random_uuid());
  if (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>6 then raise exception 'TEST: adding a row deducted twice'; end if;
  perform public.portal_mutation('update_inventory_item',jsonb_build_object('id',item,'name','Renamed medicine','category','Medicine','unit','tablet','minimumStock',0,'isActive',false),gen_random_uuid());
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',saved),gen_random_uuid());
  if (select medications#>>'{0,medicationName}' from public.prescriptions where id=rx)<>'Medicine snapshot' then raise exception 'TEST: historical name lost'; end if;
  perform pg_temp.reject_rx('create_prescription',payload,'INVENTORY_UNAVAILABLE');
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit),gen_random_uuid());
  perform pg_temp.reject_rx('update_prescription',jsonb_build_object('id',rx,'medications',saved),'RECORD_FINALIZED');
  perform set_config('veterina_test.rx',rx::text,true);
  perform set_config('veterina_test.rx_visit',visit::text,true);
  perform set_config('veterina_test.rx_patient',patient::text,true);
end $$;

reset role;
-- Owner-only deletion attempts must also preserve parent records and stock.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.rx_owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_rx('delete_record',jsonb_build_object('entity','prescription','id',current_setting('veterina_test.rx'),'reason','Test'),'DISPENSING_LOCKED');
select pg_temp.reject_rx('delete_record',jsonb_build_object('entity','visit','id',current_setting('veterina_test.rx_visit'),'reason','Test'),'DISPENSING_LOCKED');
select pg_temp.reject_rx('delete_record',jsonb_build_object('entity','pet','id',current_setting('veterina_test.rx_patient'),'reason','Test'),'DISPENSING_LOCKED');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('veterina_test.rx_inactive'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_rx('create_prescription',jsonb_build_object('visitId',current_setting('veterina_test.rx_visit'),'medicationName','Inactive','route','Oral','dose','Dose','frequency','Frequency'),'FORBIDDEN');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.reject_rx('create_prescription','{}','FORBIDDEN');
rollback;
