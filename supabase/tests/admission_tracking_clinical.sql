begin;
create or replace function pg_temp.clinical_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'CLINICAL TEST: %',label; end if; end $$;
select set_config('request.jwt.claims','{}',true);
select set_config('clinical.actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('clinical.actor')::uuid,'clinical-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values(current_setting('clinical.actor')::uuid,'Clinical sharing doctor','owner',true,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('clinical.actor'),'role','authenticated')::text,true);
create or replace function pg_temp.clinical_mutate(action text,data jsonb default '{}',retry_key uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare a uuid:=current_setting('clinical.admission')::uuid; version integer; begin
  if left(action,9)='tracking_' then select s.version into version from public.admission_public_sharing s where id=a;
  else select s.version into version from public.admissions s where id=a; end if;
  return public.portal_mutation(action,jsonb_build_object('id',a,'expectedVersion',coalesce(version,0))||data,retry_key);
end $$;
set local role authenticated;
do $$ declare owner uuid; pet uuid; a uuid; r jsonb; obs uuid; ord uuid; task uuid; k uuid:=gen_random_uuid(); payload jsonb; i integer; begin
  owner:=(public.portal_mutation('create_owner','{"fullName":"HOUSEHOLD-SECRET","phone":"09171234567","address":"ADDRESS-SECRET"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Clinical test pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  a:=(public.portal_mutation('admission_create',jsonb_build_object('petId',pet,'reason','Clinical intake note','condition','critical','admittedAt',now()-interval '10 days','veterinarianId',auth.uid()),gen_random_uuid())->>'id')::uuid;
  perform set_config('clinical.admission',a::text,true);
  perform pg_temp.clinical_mutate('tracking_configure','{"petDisplayName":"Clinical pet","clinicName":"Clinic","showSpecies":false,"showAdmissionDetails":false}');
  r:=pg_temp.clinical_mutate('tracking_generate','{"acknowledgePublic":true}');
  perform set_config('clinical.token',r->>'token',true);
  perform pg_temp.clinical_assert((select not share_clinical_details from public.admission_public_sharing where id=a),'default off');
  begin perform pg_temp.clinical_mutate('tracking_clinical_sharing','{"enabled":true}'); raise exception 'CLINICAL TEST: missing approval accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED:%' then raise; end if; end;
  begin perform pg_temp.clinical_mutate('tracking_clinical_sharing','{"enabled":"true","acknowledgePublic":true}'); raise exception 'CLINICAL TEST: invalid boolean accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED:%' then raise; end if; end;
  obs:=(pg_temp.clinical_mutate('admission_observe','{"kind":"vitals","values":{"temperatureC":38.2},"note":"Original measurement"}')->>'observationId')::uuid;
  perform pg_temp.clinical_mutate('admission_correct',jsonb_build_object('correctsId',obs,'values',jsonb_build_object('temperatureC',38.5),'note','Corrected measurement','reason','Transcription corrected'));
  for i in 1..26 loop perform pg_temp.clinical_mutate('admission_observe',jsonb_build_object('kind','note','note','Live progress '||i||' <script>literal</script>')); end loop;
  ord:=(pg_temp.clinical_mutate('admission_order',jsonb_build_object('kind','medication','title','Clinical medicine','dose','2 ml','route','Oral','frequency','Every 6 hours','duration','2 days','instructions','With food','startsAt',now(),'endsAt',now()+interval '2 days','intervalHours',6))->>'orderId')::uuid;
  -- The mutation returns its admission ID; locate the independently stored order.
  select id into ord from public.admission_orders where admission_id=a and title='Clinical medicine';
  select id into task from public.admission_tasks where order_id=ord order by due_at limit 1;
  r:=pg_temp.clinical_mutate('admission_task',jsonb_build_object('taskId',task,'taskVersion',0,'outcome','held','reason','Awaiting assessment'));
  perform pg_temp.clinical_mutate('admission_correct',jsonb_build_object('administrationId',r->>'administrationId','reason','Clarified reason'));
end $$;
reset role;
set local role service_role;
do $$ declare doc jsonb; begin
  doc:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64));
  perform pg_temp.clinical_assert(doc->'clinicalEnabled'='false' and not(doc ? 'clinical') and not(doc ? 'condition'),'existing code still limited');
  perform pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64),'monitoring') is null,'no clinical pagination before approval');
end $$;
reset role;
set local role authenticated;
do $$ declare p jsonb; k uuid:=gen_random_uuid(); r jsonb; before_hash text; begin
  select token_hash into before_hash from public.admission_public_sharing where id=current_setting('clinical.admission')::uuid;
  p:=jsonb_build_object('id',current_setting('clinical.admission'),'expectedVersion',(select version from public.admission_public_sharing where id=current_setting('clinical.admission')::uuid),'enabled',true,'acknowledgePublic',true);
  r:=public.portal_mutation('tracking_clinical_sharing',p,k);
  perform pg_temp.clinical_assert(public.portal_mutation('tracking_clinical_sharing',p,k)=r,'lost-acknowledgment replay');
  perform pg_temp.clinical_assert((select token_hash=before_hash from public.admission_public_sharing where id=current_setting('clinical.admission')::uuid),'approval keeps code');
  begin perform public.portal_mutation('tracking_clinical_sharing',p,gen_random_uuid()); raise exception 'CLINICAL TEST: stale version accepted';
  exception when others then if sqlerrm not like 'RECORD_CHANGED:%' then raise; end if; end;
end $$;
reset role;
set local role service_role;
do $$ declare doc jsonb; first jsonb; second jsonb; items jsonb; begin
  doc:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64));
  perform pg_temp.clinical_assert(doc->'clinicalEnabled'='true' and doc->>'condition'='critical','clinical enabled for same code');
  first:=doc#>'{clinical,monitoring}';
  perform pg_temp.clinical_assert(jsonb_array_length(first->'items')=20 and first->'next'<>'null','bounded first page');
  second:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64),'monitoring',first->'next')->'page';
  perform pg_temp.clinical_assert(jsonb_array_length(second->'items')=9 and second->'next'='null','remaining history');
  perform pg_temp.clinical_assert(not exists(select 1 from jsonb_array_elements(first->'items') x join jsonb_array_elements(second->'items') y on x->>'key'=y->>'key'),'no pagination duplicates with tied timestamps');
  perform pg_temp.clinical_assert(exists(select 1 from jsonb_array_elements((first->'items')||(second->'items')) x where x->>'note'='Original measurement' and x->'isCurrent'='false'),'superseded observation');
  perform pg_temp.clinical_assert(exists(select 1 from jsonb_array_elements((first->'items')||(second->'items')) x where x->'correction'='true' and x->>'correctionReason'='Transcription corrected'),'correction history');
  perform pg_temp.clinical_assert(doc#>>'{clinical,orders,items,0,medication,dose}'='2 ml' and doc#>>'{clinical,orders,items,0,medication,route}'='Oral','matching medication details');
  perform pg_temp.clinical_assert(jsonb_array_length(doc#>'{clinical,tasks,items}')=8 and jsonb_array_length(doc#>'{clinical,resolvedTasks,items}')=1,'open and resolved tasks');
  perform pg_temp.clinical_assert(jsonb_array_length(doc#>'{clinical,administrations,items}')=2,'administration corrections');
  perform pg_temp.clinical_assert(not exists(select 1 from jsonb_array_elements(doc#>'{clinical,activity,items}') e where e->>'type' like 'tracking_%'),'no sharing-management events');
  items:=jsonb_path_query_array(doc,'$.clinical.*.items[*]');
  perform pg_temp.clinical_assert(items::text !~ '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}','no raw identifiers in DTO items');
  perform pg_temp.clinical_assert(items::text not like '%HOUSEHOLD-SECRET%' and items::text not like '%ADDRESS-SECRET%' and items::text not like '%stock_quantity%' and items::text not like '%movement_id%' and items::text not like '%clinic_id%','excluded structured fields');
  perform pg_temp.clinical_assert(not(public.lookup_public_admission(current_setting('clinical.token'),repeat('d',64)) ? 'clinical'),'original RPC contract retained');
end $$;
reset role;
-- The new content RPC delegates every credential/clinic/subscription gate.
update public.admission_public_sharing set expires_at=now()-interval '1 second' where id=current_setting('clinical.admission')::uuid;
set local role service_role;
select pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64)) is null,'clinical credential expiry');
reset role;
update public.admission_public_sharing set expires_at=now()+interval '1 day' where id=current_setting('clinical.admission')::uuid;
update public.admissions set status='discharged',closed_at=now()-interval '8 days' where id=current_setting('clinical.admission')::uuid;
set local role service_role;
select pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64),'monitoring') is null,'clinical discharge cutoff');
reset role;
update public.admissions set status='admitted',closed_at=null where id=current_setting('clinical.admission')::uuid;
update public.clinics set is_active=false where id=(select clinic_id from public.admissions where id=current_setting('clinical.admission')::uuid);
set local role service_role;
select pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64)) is null,'clinical inactive clinic');
reset role;
update public.clinics set is_active=true where id=(select clinic_id from public.admissions where id=current_setting('clinical.admission')::uuid);
update private.clinic_subscriptions set expires_at=now()-interval '1 second' where clinic_id=(select clinic_id from public.admissions where id=current_setting('clinical.admission')::uuid);
set local role service_role;
select pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64)) is null,'clinical inactive subscription');
reset role;
update private.clinic_subscriptions set expires_at=now()+interval '1 day' where clinic_id=(select clinic_id from public.admissions where id=current_setting('clinical.admission')::uuid);
set local role authenticated;
select pg_temp.clinical_mutate('admission_observe','{"kind":"note","note":"NEW LIVE NOTE"}');
reset role;
set local role service_role;
do $$ declare first jsonb; second jsonb; begin
  first:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64))#>'{clinical,monitoring}';
  second:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64),'monitoring',first->'next')->'page';
  perform pg_temp.clinical_assert(((first->'items')||(second->'items'))::text like '%NEW LIVE NOTE%','new notes automatically visible');
end $$;
reset role;
-- Another active clinic cannot change this setting, even with a bypass-RLS owner.
do $$ declare actor uuid:=gen_random_uuid(); shop uuid; begin
  insert into public.clinics(name) values('Clinical isolation clinic') returning id into shop;
  insert into private.clinic_subscriptions(clinic_id,expires_at) values(shop,now()+interval '1 day');
  insert into auth.users(id,email,email_confirmed_at) values(actor,'clinical-other-'||actor||'@veterina-test.invalid',now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.profiles(id,clinic_id,full_name,role,is_active,is_veterinarian) values(actor,shop,'Other clinical owner','owner',true,true);
end $$;
set local role authenticated;
do $$ begin
  begin perform pg_temp.clinical_mutate('tracking_clinical_sharing','{"enabled":false}'); raise exception 'CLINICAL TEST: foreign clinic changed sharing';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('clinical.actor'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.clinical_mutate('tracking_clinical_sharing','{"enabled":false}');
reset role;
set local role service_role;
do $$ declare doc jsonb; begin
  doc:=public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64));
  perform pg_temp.clinical_assert(doc->'clinicalEnabled'='false' and not(doc ? 'clinical'),'disable removes clinical content');
  perform pg_temp.clinical_assert(public.lookup_public_admission_content(current_setting('clinical.token'),repeat('d',64),'orders') is null,'disable removes paginated content');
end $$;
reset role;
select pg_temp.clinical_assert(not has_function_privilege('anon','public.lookup_public_admission_content(text,text,text,jsonb)','execute') and not has_function_privilege('authenticated','public.lookup_public_admission_content(text,text,text,jsonb)','execute'),'no browser RPC execution');
select pg_temp.clinical_assert(exists(select 1 from public.audit_logs where table_name='admission_public_sharing' and record_id=current_setting('clinical.admission') and new_data->>'share_clinical_details'='true'),'approval audited');
rollback;
