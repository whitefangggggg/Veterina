begin;
select set_config('rbac.owner_a',gen_random_uuid()::text,true),set_config('rbac.owner_b',gen_random_uuid()::text,true),set_config('rbac.staff',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
  (current_setting('rbac.owner_a')::uuid,'rbac-a-'||gen_random_uuid()||'@veterina-test.invalid',now()),
  (current_setting('rbac.owner_b')::uuid,'rbac-b-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('rbac.owner_a')::uuid,'Shop A owner','owner',true);
select set_config('rbac.clinic_a',(select clinic_id::text from public.profiles where id=current_setting('rbac.owner_a')::uuid),true);
select set_config('rbac.clinic_b',public.provision_vetshop(current_setting('rbac.owner_b')::uuid,'Second isolated shop','Shop B owner')::text,true);
select set_config('rbac.code_a',(select code from private.clinic_codes where clinic_id=current_setting('rbac.clinic_a')::uuid),true);
select set_config('rbac.code_b',(select code from private.clinic_codes where clinic_id=current_setting('rbac.clinic_b')::uuid),true);
create function pg_temp.reject_rbac(query text,pattern text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if; end $$;
-- A signup payload cannot choose a role or a target clinic independently of its code.
insert into auth.users(id,email,raw_user_meta_data) values(current_setting('rbac.staff')::uuid,'rbac-staff-'||gen_random_uuid()||'@veterina-test.invalid',
  jsonb_build_object('application','veterina','full_name','Pending staff','veterina_code',current_setting('rbac.code_a'),'role','owner','clinic_id',current_setting('rbac.clinic_b')));
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('rbac.staff')::uuid) or
    not exists(select 1 from private.staff_join_requests where id=current_setting('rbac.staff')::uuid and clinic_id=current_setting('rbac.clinic_a')::uuid and status='pending') then raise exception 'TEST: metadata granted membership'; end if;
end $$;
select pg_temp.reject_rbac($query$insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'invalid-code@veterina-test.invalid','{"application":"veterina","full_name":"Invalid signup","veterina_code":"VET-00000000000000000000"}')$query$,'INVALID_VETERINA_CODE');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  if not (public.veterina_code_info(current_setting('rbac.code_a'))->>'valid')::boolean then raise exception 'TEST: valid code rejected'; end if;
  if (public.veterina_code_info('VET-00000000000000000000')->>'valid')::boolean then raise exception 'TEST: invalid code accepted'; end if;
  if has_function_privilege('anon','private.portal_mutation(text,jsonb,uuid)','EXECUTE') or has_function_privilege('anon','private.staff_administration(text,jsonb)','EXECUTE') or has_table_privilege('anon','private.clinic_codes','SELECT') then raise exception 'TEST: anonymous clinical privileges'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.owner_a'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ declare owner_id uuid; pet_id uuid; item uuid; batch uuid; queue uuid; begin
  owner_id:=(public.portal_mutation('create_owner','{"fullName":"Only shop A","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet_id:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner_id,'name','Only shop A patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown','microchip','900000000000123'),gen_random_uuid())->>'id')::uuid;
  perform set_config('rbac.patient_a',pet_id::text,true); perform set_config('rbac.person_a',owner_id::text,true);
  item:=(public.portal_mutation('create_inventory_item','{"name":"Only shop A medicine","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',10,'reason','Supplier delivery'),gen_random_uuid());
  perform set_config('rbac.item_a',item::text,true); perform set_config('rbac.batch_a',batch::text,true);
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet_id,'ownerId',owner_id,'serviceId',(select id from public.service_types where workflow='checkup' limit 1)),gen_random_uuid())->>'id')::uuid;
  if (select queue_number from public.queue_entries where id=queue)<1 then raise exception 'TEST: original shop queue number'; end if;
  perform pg_temp.reject_rbac(format('select public.staff_administration(''approve'',%L::jsonb)',jsonb_build_object('id',current_setting('rbac.staff'),'full_name','Staff member','role','clinical_staff')),'VALIDATION_FAILED: verified email');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.owner_b'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ declare person uuid; pet uuid; visit uuid; queue uuid; document jsonb; begin
  if exists(select 1 from public.pets where id=current_setting('rbac.patient_a')::uuid) then raise exception 'TEST: cross-shop SELECT leaked'; end if;
  if public.staff_administration('list')->'accounts' @> jsonb_build_array(jsonb_build_object('id',current_setting('rbac.staff'))) then raise exception 'TEST: another shop sees pending registration'; end if;
  if jsonb_array_length(public.staff_administration('list')->'accounts')<>0 then raise exception 'TEST: shop owner shown as a pending staff registration'; end if;
  perform pg_temp.reject_rbac(format('select public.staff_administration(''approve'',%L::jsonb)',jsonb_build_object('id',current_setting('rbac.staff'),'full_name','Stolen account','role','clinical_staff')),'NOT_FOUND');
  perform pg_temp.reject_rbac(format('select public.portal_mutation(''create_pet'',%L::jsonb,gen_random_uuid())',jsonb_build_object('ownerId',current_setting('rbac.person_a'),'name','Cross-shop pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown')),'FORBIDDEN');
  person:=(public.portal_mutation('create_owner','{"fullName":"Only shop B","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Only shop B patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown','microchip','900000000000123'),gen_random_uuid())->>'id')::uuid;
  perform set_config('rbac.patient_b',pet::text,true);
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'ownerId',person,'serviceId',(select id from public.service_types where workflow='checkup' limit 1)),gen_random_uuid())->>'id')::uuid;
  if (select queue_number from public.queue_entries where id=queue)<>1 then raise exception 'TEST: queue counter shared between shops'; end if;
  document:=public.filtered_export_report('patients');
  if document::text like '%Only shop A%' or (document->>'row_count')::int<>1 then raise exception 'TEST: patient export leaked another shop'; end if;
  document:=public.filtered_export_report('inventory');
  if document::text like '%Only shop A medicine%' or (document->>'row_count')::int<>0 then raise exception 'TEST: stock export leaked another shop'; end if;
  if exists(select 1 from public.inventory_items where id=current_setting('rbac.item_a')::uuid) then raise exception 'TEST: cross-shop inventory SELECT'; end if;
  visit:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',pet,'type','Wellness check','complaint','Shop B care','weightKg',3,'veterinarianId',auth.uid()),gen_random_uuid())->>'id')::uuid;
  perform pg_temp.reject_rbac(format('select public.portal_mutation(''create_prescription'',%L::jsonb,gen_random_uuid())',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(jsonb_build_object('medicationId',gen_random_uuid(),'inventoryItemId',current_setting('rbac.item_a'),'batchId',current_setting('rbac.batch_a'),'dispenseQuantity',1,'route','Oral','dose','Dose','frequency','Frequency')))),'INVENTORY_UNAVAILABLE');
  if exists(select 1 from public.prescriptions where visit_id=visit) then raise exception 'TEST: cross-shop dispensing partially saved'; end if;
  if exists(select 1 from public.profiles where id=current_setting('rbac.owner_a')::uuid) then raise exception 'TEST: cross-shop profiles leaked'; end if;
  perform pg_temp.reject_rbac(format('select public.staff_administration(''update'',%L::jsonb)',jsonb_build_object('id',current_setting('rbac.owner_b'),'role','clinical_staff','is_active',false)),'VALIDATION_FAILED: keep at least');
end $$;
reset role;
-- An editable application marker cannot stop email status synchronization or
-- move the request; its persisted shop remains authoritative.
update auth.users set raw_user_meta_data='{}' where id=current_setting('rbac.staff')::uuid;
update auth.users set email_confirmed_at=now() where id=current_setting('rbac.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.owner_a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$ declare accounts jsonb:=public.staff_administration('list')->'accounts'; begin
  if jsonb_array_length(accounts)<>1 or accounts->0->>'id'<>current_setting('rbac.staff') or accounts->0->>'role'<>'clinical_staff' or accounts->0->>'status'<>'pending' then raise exception 'TEST: owner without MFA did not receive only pending code-linked staff'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.owner_a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select pg_temp.reject_rbac(format('select public.staff_administration(''approve'',%L::jsonb)',jsonb_build_object('id',current_setting('rbac.staff'),'full_name','Escalated account','role','owner')),'VALIDATION_FAILED');
select public.staff_administration('approve',jsonb_build_object('id',current_setting('rbac.staff'),'full_name','Approved staff','role','clinical_staff'));
do $$ begin
  if not exists(select 1 from public.profiles where id=current_setting('rbac.staff')::uuid and clinic_id=current_setting('rbac.clinic_a')::uuid and is_active) then raise exception 'TEST: approval failed'; end if;
  if public.staff_administration('list')->'accounts' @> jsonb_build_array(jsonb_build_object('id',current_setting('rbac.staff'))) then raise exception 'TEST: approved account remains pending'; end if;
  if exists(select 1 from public.pets where id=current_setting('rbac.patient_b')::uuid) then raise exception 'TEST: owner cross-shop read'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.staff'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.pets where id=current_setting('rbac.patient_a')::uuid) or exists(select 1 from public.pets where id=current_setting('rbac.patient_b')::uuid) then raise exception 'TEST: staff isolation'; end if;
  perform pg_temp.reject_rbac('select public.owner_veterina_code()','FORBIDDEN');
  perform pg_temp.reject_rbac('select public.staff_administration(''list'')','FORBIDDEN');
  perform pg_temp.reject_rbac('select public.export_report(''patients'')','FORBIDDEN');
  if has_table_privilege('authenticated','private.clinic_codes','SELECT') or has_table_privilege('authenticated','public.profiles','UPDATE') or has_function_privilege('authenticated','public.provision_vetshop(uuid,text,text,text)','EXECUTE') then raise exception 'TEST: browser can provision or self-approve'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.reject_rbac(format('select public.pet_photo_admin(%L::uuid,%L::jsonb)',current_setting('rbac.owner_a'),jsonb_build_object('action','read','petId',current_setting('rbac.patient_b'))),'NOT_FOUND');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.owner_a'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
select public.staff_administration('update',jsonb_build_object('id',current_setting('rbac.staff'),'role','clinical_staff','is_active',false));
select public.owner_veterina_code(true);
do $$ begin if (public.veterina_code_info(current_setting('rbac.code_a'))->>'valid')::boolean then raise exception 'TEST: rotated code remains valid'; end if; end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('rbac.staff'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pets) then raise exception 'TEST: stale JWT retains deactivated access'; end if;
  if (select count(*) from public.profiles)<>1 or not exists(select 1 from public.profiles where id=auth.uid() and not is_active) then raise exception 'TEST: inactive user cannot check own approval status'; end if;
  perform pg_temp.reject_rbac('select public.portal_mutation(''create_owner'',''{"fullName":"Blocked","phone":"09171234567","address":"Test"}'',gen_random_uuid())','FORBIDDEN');
end $$;
rollback;
