begin;
select set_config('manual.actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('manual.actor')::uuid,'manual-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values(current_setting('manual.actor')::uuid,'Manual certificate clinician','clinical_staff',true,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('manual.actor'),'role','authenticated')::text,true);
create function pg_temp.reject_manual(payload jsonb, pattern text default 'VALIDATION_FAILED') returns void language plpgsql as $$
begin
  perform public.portal_mutation('issue_travel_certificate',payload,gen_random_uuid());
  raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if;
end $$;
set local role authenticated;
do $$
declare person uuid; pet uuid; day date; line jsonb; extra jsonb; payload jsonb; result jsonb; retry uuid:=gen_random_uuid(); snapshot jsonb;
  before_stock integer; before_queue integer; before_reminders integer; old_lot text;
begin
  select (now() at time zone timezone)::date into day from public.clinic_settings limit 1;
  person:=(public.portal_mutation('create_owner','{"fullName":"Manual owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Manual pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  select count(*) into before_stock from public.inventory_movements;
  select count(*) into before_queue from public.queue_entries;
  select count(*) into before_reminders from public.reminders;
  line:=jsonb_build_object('id',gen_random_uuid(),'vaccine','Manual Rabies <label>','lotNumber',' MANUAL-01 ','brand','Brand','administeredAt',day-30,'nextDueAt',day+365,'veterinarianName','Outside doctor','expirationDate',day+40);
  extra:=jsonb_build_object('id',gen_random_uuid(),'vaccine','Combination','lotNumber','MANUAL-02','administeredAt',day-60,'dose','1 mL','expirationDate',day+60);
  payload:=jsonb_build_object('petId',pet,'issuerId',auth.uid(),'travelDate',day+1,'validUntil',day+5,'destination','Cebu','controlNumber','MANUAL-001',
    'rabiesConfirmed',true,'eligibilityConfirmed',true,'manualVaccinations',jsonb_build_array(line,extra),'manualRabiesItemId',line->>'id','isPublic',true);
  perform pg_temp.reject_manual(payload||jsonb_build_object('rabiesVaccinationId',gen_random_uuid()));
  perform pg_temp.reject_manual(payload||jsonb_build_object('manualRabiesItemId',gen_random_uuid()));
  perform pg_temp.reject_manual(payload||'{"manualVaccinations":null}');
  perform pg_temp.reject_manual(payload||jsonb_build_object('manualVaccinations',jsonb_build_array(line,line)));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,0,lotNumber}','"   "'));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,0,lotNumber}',to_jsonb(repeat('x',201))));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,0,administeredAt}',to_jsonb((day+1)::text)));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,0,nextDueAt}',to_jsonb((day+2)::text)));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,1,expirationDate}',to_jsonb((day-61)::text)));
  perform pg_temp.reject_manual(jsonb_set(payload,'{manualVaccinations,1,administeredAt}','"2026-02-30"'));
  perform pg_temp.reject_manual(payload||jsonb_build_object('manualVaccinations',(select jsonb_agg(line||jsonb_build_object('id',gen_random_uuid())) from generate_series(1,51))));
  if exists(select 1 from public.vaccinations where pet_id=pet) then raise exception 'TEST: rejected request left vaccine history'; end if;
  result:=public.portal_mutation('issue_travel_certificate',payload,retry);
  if public.portal_mutation('issue_travel_certificate',payload,retry)<>result then raise exception 'TEST: retry changed result'; end if;
  if (select count(*) from public.vaccinations where pet_id=pet)<>2 then raise exception 'TEST: manual history duplicated or missing'; end if;
  if (select count(*) from public.preventive_care_records where pet_id=pet and recording_purpose='record_only')<>2 then raise exception 'TEST: manual historical parents missing'; end if;
  if exists(select 1 from public.vaccinations where pet_id=pet and (stock_tracked or consumed_at is not null or inventory_item_id is not null)) then raise exception 'TEST: manual history linked stock'; end if;
  select c.snapshot into snapshot from public.travel_certificates c where id=(result->>'id')::uuid;
  if jsonb_array_length(snapshot->'vaccinations')<>2 or snapshot->>'rabiesVaccinationId'<>line->>'id' then raise exception 'TEST: incorrect manual snapshot'; end if;
  if not exists(select 1 from jsonb_array_elements(snapshot->'vaccinations') v where v->>'id'=line->>'id' and v->>'lotNumber'='MANUAL-01' and v->>'expirationDate'=(day+40)::text and v->>'administeredBy'='Outside doctor') then raise exception 'TEST: manual evidence changed'; end if;
  perform public.portal_mutation('update_preventive_care',jsonb_build_object(
    'id',(select preventive_record_id from public.vaccinations where id=(line->>'id')::uuid),'version',0,
    'petId',pet,'kind','vaccination','recordingPurpose','record_only','administeredAt',line->>'administeredAt','veterinarianName','Outside doctor',
    'vaccines',jsonb_build_array((line-'administeredAt'-'expirationDate'-'veterinarianName')||'{"lotNumber":"CORRECTED-HISTORY-LOT"}')),gen_random_uuid());
  if (select c.snapshot from public.travel_certificates c where id=(result->>'id')::uuid)<>snapshot then raise exception 'TEST: lot correction changed issued snapshot'; end if;
  -- New rows are created before the duplicate-control check; the entire failed issuance must roll back.
  extra:=extra||jsonb_build_object('id',gen_random_uuid());
  payload:=payload-'manualRabiesItemId'||jsonb_build_object('rabiesVaccinationId',line->>'id','manualVaccinations',jsonb_build_array(extra));
  perform pg_temp.reject_manual(payload,'VALIDATION_FAILED: control number already exists');
  if exists(select 1 from public.vaccinations where id=(extra->>'id')::uuid) then raise exception 'TEST: failed certificate left history'; end if;
  payload:=payload||'{"controlNumber":"MANUAL-002"}';
  result:=public.portal_mutation('issue_travel_certificate',payload,gen_random_uuid());
  if (select count(*) from public.vaccinations where pet_id=pet)<>3 then raise exception 'TEST: mixed entries not saved'; end if;
  if not exists(select 1 from public.travel_certificates c, jsonb_array_elements(c.snapshot->'vaccinations') v where c.id=(result->>'id')::uuid and v->>'id'=line->>'id' and v->>'lotNumber'='CORRECTED-HISTORY-LOT') then raise exception 'TEST: future certificate missed lot correction'; end if;
  if (select count(*) from public.inventory_movements)<>before_stock or (select count(*) from public.queue_entries)<>before_queue
    or (select count(*) from public.reminders)<>before_reminders then raise exception 'TEST: manual history had operational side effects'; end if;
  perform set_config('manual.payload',payload::text,true);
  perform set_config('manual.pet',pet::text,true);
end $$;
reset role;
-- The new private helper is not a browser API.
do $$ begin
  if has_function_privilege('authenticated','private.prepare_manual_certificate_vaccines(jsonb,date)','execute')
    or has_function_privilege('anon','private.prepare_manual_certificate_vaccines(jsonb,date)','execute') then raise exception 'TEST: private helper exposed'; end if;
end $$;
set local role service_role;
update public.profiles set is_active=false where id=current_setting('manual.actor')::uuid;
set local role authenticated;
select pg_temp.reject_manual(current_setting('manual.payload')::jsonb,'FORBIDDEN');
reset role;
rollback;
