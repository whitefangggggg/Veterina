begin;
create function pg_temp.verify(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'TEST: %',label; end if;
end $$;
select set_config('search.owner',gen_random_uuid()::text,true);
select set_config('search.staff',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
 (current_setting('search.owner')::uuid,'search-owner-'||gen_random_uuid()||'@veterina-test.invalid',now()),
 (current_setting('search.staff')::uuid,'search-staff-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values
 (current_setting('search.owner')::uuid,'Search owner','owner',true,true),
 (current_setting('search.staff')::uuid,'Search staff','clinical_staff',true,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('search.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare o uuid; p uuid; v uuid; item uuid; batch uuid; r jsonb; ids uuid[]; cursor jsonb; count integer:=0; pages integer:=0; begin
  o:=(public.portal_mutation('create_owner','{"fullName":"Alex Searchhouse","phone":"09171234567","email":"searchhouse@example.invalid","address":"Permitted owner address"}',gen_random_uuid())->>'id')::uuid;
  p:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',o,'name','Mochi Searchpet','species','Cat','breed','Siamese','sex','Female','reproductiveStatus','Unknown','microchip','123456789012345'),gen_random_uuid())->>'id')::uuid;
  perform set_config('search.pet',p::text,true); perform set_config('search.person',o::text,true);
  v:=(public.portal_mutation('create_record_only_checkup',jsonb_build_object('petId',p,'type','Medical Concern','complaint','Dermatitis examination','diagnosis','Allergic dermatitis','encounteredAt','2024-04-05T03:00:00Z','veterinarianName','Historical vet','clinicalNotes','DO_NOT_INDEX_CHART_NOTES',
    'prescription',jsonb_build_object('medications',jsonb_build_array(jsonb_build_object('medicationName','Searchmed antibiotic','dose','One tablet','route','Oral')))),gen_random_uuid())->>'id')::uuid;
  perform set_config('search.visit',v::text,true);
  r:=public.portal_mutation('create_queued_encounter',jsonb_build_object('petId',p,'type','Wellness Check','complaint','Searchpet consultation','weightKg',4,'veterinarianId',auth.uid()),gen_random_uuid());
  perform set_config('search.queued_visit',r->>'id',true);
  perform pg_temp.verify(public.clinic_search_record('visits',(r->>'id')::uuid)->>'status'='waiting','waiting care is not presented as completed');
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',(select id from public.queue_entries where visit_id=(r->>'id')::uuid),'veterinarianId',auth.uid()),gen_random_uuid());
  perform pg_temp.verify(public.clinic_search_record('visits',(r->>'id')::uuid)->>'status'='in_progress','care state follows queue without an encounter edit');
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',(select id from public.queue_entries where visit_id=(r->>'id')::uuid),'reason','Synthetic cancellation'),gen_random_uuid());
  perform pg_temp.verify(public.clinic_search_record('visits',(r->>'id')::uuid)->>'status'='cancelled','cancelled care remains labeled');
  item:=(public.portal_mutation('create_inventory_item','{"name":"Searchmed tablets SP%_A","brand":"Searchbrand","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',7,'reason','Synthetic delivery'),gen_random_uuid());
  perform set_config('search.item',item::text,true); perform set_config('search.batch',batch::text,true);
  perform public.portal_mutation('create_supplier','{"name":"Searchsupplier","contactPerson":"Jamie Contact","phone":"09170000000","email":"supplier@example.invalid","address":"Test"}',gen_random_uuid());
  r:=public.search_clinic_records('  MOCHI   SEARCHPET ',null,50);
  perform pg_temp.verify((r->'records'->0->>'id')::uuid=p,'exact patient title ranks first');
  perform pg_temp.verify(r->'groups' ?& array['patients','visits','prescriptions','queue'],'linked patient expands across modules');
  perform pg_temp.verify((public.search_clinic_records('mochi antibiotic')->>'total')::integer=1,'all terms across linked context');
  perform pg_temp.verify((public.search_clinic_records('Searchhouse','patients')->>'total')::integer=1,'owner name finds patient');
  perform pg_temp.verify((public.search_clinic_records('09171234567','patients')->>'total')::integer=1,'phone finds linked patient');
  perform pg_temp.verify((public.search_clinic_records('123456789012345','patients')->>'total')::integer=1,'microchip lookup');
  perform pg_temp.verify((public.search_clinic_records('SP%_A','inventory')->>'total')::integer=1,'literal SQL wildcard characters');
  perform pg_temp.verify((public.search_clinic_records('%%')->>'total')::integer=0,'wildcard cannot enumerate');
  perform pg_temp.verify((public.search_clinic_records('DO_NOT_INDEX_CHART_NOTES')->>'total')::integer=0,'chart notes outside allowlist');
  perform pg_temp.verify((public.clinic_search_record('visits',v)->'fields'->>'Recording purpose')='record_only','historical semantics');
  perform pg_temp.verify((public.clinic_search_record('inventory_items',item)->'fields'->>'Stock quantity')='7.00','live stock details');
  perform pg_temp.verify((public.search_clinic_records('Staff accounts','navigation')->>'total')::integer=1,'owner administration navigation');
  -- Cursor iteration uses a deterministic complete ordering and returns totals
  -- from the same statement snapshot, without downloading extra source rows.
  loop
    r:=public.search_clinic_records('mochi',null,2,cursor); pages:=pages+1;
    perform pg_temp.verify((r->>'total')::integer>=4,'consistent total');
    perform pg_temp.verify(jsonb_array_length(r->'records')<=2,'page bound');
    perform pg_temp.verify(not exists(select 1 from jsonb_array_elements(r->'records') x where (x->>'id')::uuid=any(coalesce(ids,'{}'))),'no duplicate page rows');
    select coalesce(ids,'{}')||array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(r->'records') x;
    count:=count+jsonb_array_length(r->'records'); cursor:=nullif(r->'nextCursor','null');
    exit when cursor is null; if pages>20 then raise exception 'TEST: cursor did not finish'; end if;
  end loop;
  perform pg_temp.verify(count=(r->>'total')::integer,'pagination completeness');
  perform set_config('search.original_total',r->>'total',true);
  begin perform public.search_clinic_records('x'); raise exception 'TEST: short query'; exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  begin perform public.search_clinic_records('mochi',null,51); raise exception 'TEST: unbounded query'; exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  begin perform public.search_clinic_records('mochi','platform'); raise exception 'TEST: unsupported scope'; exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
end $$;
reset role;
-- Add permitted source records directly under the synthetic migration persona;
-- source triggers still run, and every read below uses the authenticated role.
insert into public.diagnoses(visit_id,description,code) values(current_setting('search.visit')::uuid,'Searchdiagnosis dermatitis','DX-SEARCH');
insert into public.treatments(visit_id,name) values(current_setting('search.visit')::uuid,'Searchtreatment cleaning');
insert into public.patient_service_records(pet_id,service_name,performed_at,performed_by_name,recorded_by)
 values(current_setting('search.pet')::uuid,'Searchgrooming',now()-interval '1 day','Test clinician',current_setting('search.owner')::uuid);
insert into public.preventive_care_records(pet_id,kind,recording_purpose,administered_at,created_by)
 values(current_setting('search.pet')::uuid,'vaccination','record_only',current_date-1,current_setting('search.owner')::uuid);
insert into public.vaccinations(pet_id,preventive_record_id,vaccine_name,lot_number,dose,route,administered_at,recording_purpose)
 select current_setting('search.pet')::uuid,id,'Searchrabies','SEARCH-LOT','1 mL','Subcutaneous',current_date-1,'record_only'
 from public.preventive_care_records where pet_id=current_setting('search.pet')::uuid and kind='vaccination';
insert into public.preventive_care_records(pet_id,kind,recording_purpose,administered_at,created_by)
 values(current_setting('search.pet')::uuid,'deworming','record_only',current_date-2,current_setting('search.owner')::uuid);
insert into public.deworming_administrations(preventive_record_id,product_name,dose)
 select id,'Searchwormer','1 tablet' from public.preventive_care_records where pet_id=current_setting('search.pet')::uuid and kind='deworming';
insert into public.reminders(pet_id,reminder_type,title,due_at,created_by) values(current_setting('search.pet')::uuid,'follow_up','Searchfollowup phone call',now()+interval '1 day',current_setting('search.owner')::uuid);
insert into public.appointments(pet_id,service_type_id,starts_at,ends_at,veterinarian_id,created_by)
 select current_setting('search.pet')::uuid,id,now()+interval '10 days',now()+interval '10 days 30 minutes',current_setting('search.owner')::uuid,current_setting('search.owner')::uuid from public.service_types where name='Wellness check' limit 1;
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.search_clinic_records('mochi',null,50);
  perform pg_temp.verify(r->'groups' ?& array['diagnoses','services','vaccinations','deworming','reminders','appointments'],'all clinical/scheduling sources');
  perform pg_temp.verify((public.search_clinic_records('searchwormer')->>'total')::integer=1,'deworming product');
end $$;
reset role;
-- Parent edits affect related search immediately without rewriting each child.
update public.owners set full_name='Renamed Searchfamily' where id=current_setting('search.person')::uuid;
update public.pets set name='Renamed Searchpatient' where id=current_setting('search.pet')::uuid;
update public.inventory_batches set lot_number='SEARCH-EXPIRY-LOT' where id=current_setting('search.batch')::uuid;
set local role authenticated;
do $$ declare r jsonb; begin
  perform pg_temp.verify((public.search_clinic_records('mochi')->>'total')::integer=0,'old patient name removed');
  perform pg_temp.verify((public.search_clinic_records('Searchfamily','prescriptions')->>'total')::integer=1,'live owner relation');
  perform pg_temp.verify((public.search_clinic_records('Searchpatient antibiotic')->>'total')::integer=1,'live patient relation');
  r:=public.search_clinic_records('SEARCH-EXPIRY-LOT'); perform pg_temp.verify(r->'records'->0->>'source'='inventory_batches','batch lookup');
end $$;
reset role;
-- Only allowlisted certificate fields are projected, never snapshot or QR secrets.
select pg_temp.verify(private.search_project('travel_certificates',jsonb_build_object('id',gen_random_uuid(),'clinic_id',(select clinic_id from public.pets where id=current_setting('search.pet')::uuid),'pet_id',current_setting('search.pet'),'reference_number','CERT-SAFE','control_number','CTRL-SAFE','pet_name','Snapshot patient','status','issued','snapshot','{"secret":"DO_NOT_INDEX_SNAPSHOT"}'::jsonb,'public_token','DO_NOT_INDEX_TOKEN','is_public',false))::text not like '%DO_NOT_INDEX_%','certificate secret exclusion');
-- Browser grants cannot read or change the index or invoke maintenance helpers.
select pg_temp.verify(not has_table_privilege('authenticated','private.clinic_search_documents','select'),'index private');
select pg_temp.verify(not has_function_privilege('authenticated','private.search_refresh(text,uuid)','execute'),'maintenance private');
select pg_temp.verify(not has_function_privilege('anon','public.search_clinic_records(text,text,integer,jsonb)','execute'),'anonymous search denied');
select pg_temp.verify((select not rolcanlogin and not rolbypassrls and not rolsuper from pg_roles where rolname='veterina_search'),'search reader is a restricted non-login role');
select pg_temp.verify(pg_has_role('veterina_search','authenticated','member') and not exists(
  select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid
  where m.member='veterina_search'::regrole and r.rolname<>'authenticated'),'search inherits only the authenticated RLS persona');
select pg_temp.verify(not pg_has_role('authenticated','veterina_search','member') and not pg_has_role('anon','veterina_search','member') and not pg_has_role('service_role','veterina_search','member'),'clients cannot assume the index reader role');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('search.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.verify((public.search_clinic_records('Searchpatient','patients')->>'total')::integer=1,'approved staff read');
select pg_temp.verify((public.search_clinic_records('Staff accounts','navigation')->>'total')::integer=0,'staff cannot discover administration');
select pg_temp.verify((public.search_clinic_records('Reports','navigation')->>'total')::integer=0,'staff cannot discover reports');
reset role;
-- Explicit cross-clinic identifiers and detail APIs stay isolated.
do $$ declare actor uuid:=gen_random_uuid(); clinic uuid; begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'search-other-'||actor||'@veterina-test.invalid',now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.clinics(name) values('Other search clinic') returning id into clinic;
  insert into public.profiles(id,clinic_id,full_name,role,is_active) values(actor,clinic,'Other search owner','owner',true);
  insert into private.clinic_subscriptions(clinic_id,expires_at) values(clinic,now()+interval '1 day');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end $$;
set local role authenticated;
select pg_temp.verify((public.search_clinic_records('Searchpatient')->>'total')::integer=0,'cross-clinic name');
select pg_temp.verify((public.search_clinic_records(current_setting('search.pet'))->>'total')::integer=0,'cross-clinic identifier');
select pg_temp.verify(public.clinic_search_record('pets',current_setting('search.pet')::uuid) is null,'cross-clinic focused read');
reset role;
-- Standalone platform administration grants no clinical search access.
do $$ declare actor uuid:=gen_random_uuid(); begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'search-platform-'||actor||'@veterina-test.invalid',now());
  insert into private.platform_admins(user_id) values(actor);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$ begin
  begin perform public.search_clinic_records('Searchpatient'); raise exception 'TEST: non-member search'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform public.clinic_search_record('pets',current_setting('search.pet')::uuid); raise exception 'TEST: non-member detail'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('search.owner'),'role','authenticated')::text,true);
update public.profiles set is_active=false where id=current_setting('search.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('search.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.search_clinic_records('Searchpatient'); raise exception 'TEST: inactive staff search'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('search.owner'),'role','authenticated')::text,true);
update private.clinic_subscriptions set expires_at=now()-interval '1 second'
  where clinic_id=(select clinic_id from public.profiles where id=current_setting('search.owner')::uuid);
set local role authenticated;
do $$ begin
  begin perform public.search_clinic_records('Searchpatient'); raise exception 'TEST: expired clinic search'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform public.clinic_search_record('pets',current_setting('search.pet')::uuid); raise exception 'TEST: expired clinic detail'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;
reset role;
rollback;
