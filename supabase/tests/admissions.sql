begin;
select set_config('admission.actor',gen_random_uuid()::text,true);
select set_config('admission.staff',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
 (current_setting('admission.actor')::uuid,'admission-owner-'||gen_random_uuid()||'@veterina-test.invalid',now()),
 (current_setting('admission.staff')::uuid,'admission-staff-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values
 (current_setting('admission.actor')::uuid,'Admission owner','owner',true,true),
 (current_setting('admission.staff')::uuid,'Admission staff','clinical_staff',true,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.actor'),'role','authenticated')::text,true);
create function pg_temp.admit_call(action text,p jsonb,k uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
begin
  if p ? 'id' and not(p ? 'expectedVersion') then p:=p||jsonb_build_object('expectedVersion',(select version from public.admissions where id=(p->>'id')::uuid)); end if;
  return public.portal_mutation(action,p,k);
end $$;
create function pg_temp.admit_reject(action text,p jsonb,pattern text default 'VALIDATION_FAILED') returns void language plpgsql as $$
begin
  perform pg_temp.admit_call(action,p);
  raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if;
end $$;
set local role authenticated;
do $$
declare owner uuid; pet uuid; pet2 uuid; a uuid; b uuid; ward uuid; unit uuid; unit2 uuid; item uuid; batch uuid; ord uuid; task uuid;
  result jsonb; payload jsonb; retry uuid:=gen_random_uuid(); obs uuid; corrected uuid; original jsonb; before_stock integer; before_queue integer; before_reminders integer; rx uuid; history jsonb;
begin
  owner:=(public.portal_mutation('create_owner','{"fullName":"Admission test owner","phone":"09171234567","address":"Test"}'::jsonb,gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Inpatient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  pet2:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Second inpatient','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  ward:=(public.portal_mutation('facility_ward','{"name":"Hospital ward"}'::jsonb,gen_random_uuid())->>'id')::uuid;
  unit:=(public.portal_mutation('facility_unit',jsonb_build_object('name','Cage 1','kind','cage','wardId',ward),gen_random_uuid())->>'id')::uuid;
  unit2:=(public.portal_mutation('facility_unit',jsonb_build_object('name','Kennel 2','kind','kennel','wardId',ward),gen_random_uuid())->>'id')::uuid;
  payload:=jsonb_build_object('petId',pet,'reason','Hospital monitoring','admittedAt',now()-interval '2 hours','condition','critical','veterinarianId',auth.uid(),'unitId',unit,'vitals','{"weightKg":4.2}'::jsonb);
  result:=public.portal_mutation('admission_create',payload,retry); a:=(result->>'id')::uuid;
  if public.portal_mutation('admission_create',payload,retry)<>result then raise exception 'TEST: admission retry changed'; end if;
  perform pg_temp.admit_reject('admission_create',payload,'ADMISSION_ACTIVE');
  perform pg_temp.admit_reject('admission_create',payload||jsonb_build_object('petId',pet2),'UNIT_UNAVAILABLE');
  if exists(select 1 from public.admissions where pet_id=pet2) then raise exception 'TEST: failed occupancy left admission'; end if;
  if (select state from public.admission_units where id=unit)<>'occupied' then raise exception 'TEST: missing occupancy'; end if;
  perform pg_temp.admit_reject('facility_unit',jsonb_build_object('id',unit,'expectedVersion',1,'name','Cage 1','state','maintenance'),'UNIT_OCCUPIED');
  perform pg_temp.admit_reject('facility_ward',jsonb_build_object('id',ward,'expectedVersion',0,'name','Hospital ward','isActive',false),'UNIT_OCCUPIED');
  perform pg_temp.admit_call('admission_transfer',jsonb_build_object('id',a,'unitId',unit2));
  if (select state from public.admission_units where id=unit)<>'cleaning_required' then raise exception 'TEST: transfer skipped cleaning'; end if;
  perform public.portal_mutation('facility_clean',jsonb_build_object('id',unit,'expectedVersion',(select version from public.admission_units where id=unit)),gen_random_uuid());
  perform pg_temp.admit_reject('admission_transition',jsonb_build_object('id',a,'expectedVersion',0,'status','under_treatment'),'RECORD_CHANGED');
  obs:=(pg_temp.admit_call('admission_observe',jsonb_build_object('id',a,'kind','condition','values','{"condition":"improving"}'::jsonb,'occurredAt',now()-interval '10 minutes'))->>'observationId')::uuid;
  perform pg_temp.admit_call('admission_observe',jsonb_build_object('id',a,'kind','condition','values','{"condition":"stable"}'::jsonb,'occurredAt',now()-interval '30 minutes'));
  if (select condition from public.admissions where id=a)<>'improving' then raise exception 'TEST: backdated condition overwrote newer condition'; end if;
  corrected:=(pg_temp.admit_call('admission_correct',jsonb_build_object('id',a,'correctsId',obs,'values','{"condition":"stable"}'::jsonb,'reason','Correct transcription'))->>'observationId')::uuid;
  if (select condition from public.admissions where id=a)<>'stable' or (select is_current from public.admission_observation_history where id=obs) then raise exception 'TEST: correction not projected'; end if;
  perform pg_temp.admit_reject('admission_correct',jsonb_build_object('id',a,'correctsId',obs,'values','{}'::jsonb,'reason','Wrong branch'),'RECORD_CHANGED');
  perform pg_temp.admit_reject('admission_cancel',jsonb_build_object('id',a,'reason','Wrong patient'),'INVALID_TRANSITION');
  perform pg_temp.admit_reject('admission_observe',jsonb_build_object('id',a,'kind','vitals','values','{"temperatureC":99}'::jsonb));
  perform pg_temp.admit_call('admission_transition',jsonb_build_object('id',a,'status','under_treatment'));
  item:=(public.portal_mutation('create_inventory_item','{"name":"Inpatient medicine","category":"Medicine","unit":"mL","minimumStock":0,"allowsFraction":true}'::jsonb,gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',5,'reason','Test delivery'),gen_random_uuid());
  select count(*) into before_stock from public.inventory_movements;
  ord:=(pg_temp.admit_call('admission_order',jsonb_build_object('id',a,'kind','medication','title','Inpatient medicine','dose','As ordered','route','Oral','frequency','Every hour','startsAt',now()-interval '30 minutes','endsAt',now()+interval '3 hours','intervalHours',1,'inventoryItemId',item))->>'orderId')::uuid;
  if (select count(*) from public.inventory_movements)<>before_stock then raise exception 'TEST: order consumed stock'; end if;
  select prescription_id into rx from public.admission_orders where id=ord;
  begin
    perform public.create_prescription(jsonb_build_object('visitId',(select visit_id from public.admissions where id=a),'medications','[]'::jsonb),gen_random_uuid());
    raise exception 'TEST: legacy prescription API bypassed admission guard';
  exception when others then if sqlerrm not like 'ADMISSION_WORKSPACE_REQUIRED%' then raise; end if; end;
  begin
    perform private.mutate('finalize_encounter',jsonb_build_object('id',(select visit_id from public.admissions where id=a)),gen_random_uuid());
    raise exception 'TEST: legacy finalization bypassed admission guard';
  exception when others then if sqlerrm not like 'ADMISSION_WORKSPACE_REQUIRED%' then raise; end if; end;
  perform pg_temp.admit_reject('update_prescription',jsonb_build_object('id',rx),'ADMISSION_WORKSPACE_REQUIRED');
  perform pg_temp.admit_reject('finalize_encounter',jsonb_build_object('id',(select visit_id from public.admissions where id=a)),'ADMISSION_WORKSPACE_REQUIRED');
  perform pg_temp.admit_reject('admission_order',jsonb_build_object('id',a,'kind','treatment','title','Too many tasks','startsAt',now(),'endsAt',now()+interval '1 year','intervalHours',1));
  select id into task from public.admission_tasks where order_id=ord order by due_at limit 1;
  perform pg_temp.admit_reject('admission_task',jsonb_build_object('id',a,'taskId',task,'taskVersion',0,'outcome','given','inventoryItemId',item,'batchId',batch,'stockQuantity',8),'INSUFFICIENT_STOCK');
  if (select status from public.admission_tasks where id=task)<>'pending' or exists(select 1 from public.admission_administrations where task_id=task) then raise exception 'TEST: failed dose left partial care'; end if;
  payload:=jsonb_build_object('id',a,'expectedVersion',(select version from public.admissions where id=a),'taskId',task,'taskVersion',0,'outcome','given','inventoryItemId',item,'batchId',batch,'stockQuantity',1);
  retry:=gen_random_uuid(); result:=public.portal_mutation('admission_task',payload,retry);
  if public.portal_mutation('admission_task',payload,retry)<>result then raise exception 'TEST: dose retry changed result'; end if;
  if (select sum(quantity_delta) from public.inventory_movements where item_id=item)<>4 then raise exception 'TEST: duplicate dose consumption'; end if;
  begin perform public.portal_mutation('admission_task',payload||'{"stockQuantity":2}'::jsonb,retry); raise exception 'TEST: changed retry accepted'; exception when others then if sqlerrm not like 'VALIDATION_FAILED: retry payload changed%' then raise; end if; end;
  perform pg_temp.admit_reject('admission_task',jsonb_build_object('id',a,'taskId',task,'taskVersion',0,'outcome','given'),'RECORD_CHANGED');
  select id into task from public.admission_tasks where order_id=ord and status='pending' order by due_at limit 1;
  perform pg_temp.admit_reject('admission_task',jsonb_build_object('id',a,'taskId',task,'taskVersion',0,'outcome','held'));
  perform pg_temp.admit_call('admission_task',jsonb_build_object('id',a,'taskId',task,'taskVersion',0,'outcome','delayed','reason','Patient assessment','deferredUntil',now()+interval '8 hours'));
  if (select original_due_at=due_at from public.admission_tasks where id=task) then raise exception 'TEST: delayed task lost original time'; end if;
  perform pg_temp.admit_call('admission_order',jsonb_build_object('id',a,'kind','treatment','title','Overdue nursing care','startsAt',now()-interval '20 minutes'));
  perform pg_temp.admit_call('admission_transition',jsonb_build_object('id',a,'status','ready_for_discharge'));
  payload:=jsonb_build_object('id',a,'condition','stable','assessment','Clinician assessment','instructions','Home care instructions','followUp','Contact clinic for review');
  perform pg_temp.admit_reject('admission_discharge',payload,'OPEN_CARE_TASKS');
  perform pg_temp.admit_reject('admission_discharge',payload||'{"overdueReason":"Not clinically indicated"}'::jsonb,'OPEN_CARE_TASKS');
  payload:=payload||jsonb_build_object('expectedVersion',(select version from public.admissions where id=a),'overdueReason','Reviewed at discharge','acknowledgeFutureTasks',true);
  retry:=gen_random_uuid(); result:=public.portal_mutation('admission_discharge',payload,retry);
  if public.portal_mutation('admission_discharge',payload,retry)<>result then raise exception 'TEST: discharge retry changed'; end if;
  if exists(select 1 from public.admission_tasks where admission_id=a and status in ('pending','delayed')) then raise exception 'TEST: discharge left open tasks'; end if;
  if (select state from public.admission_units where id=unit2)<>'cleaning_required' then raise exception 'TEST: discharge did not release to cleaning'; end if;
  select snapshot into original from public.admission_discharge_summaries where admission_id=a;
  if jsonb_array_length(original->'administrations')<3 or jsonb_array_length(original->'prescriptions')<>1 then raise exception 'TEST: incomplete discharge evidence'; end if;
  perform pg_temp.admit_call('admission_correct',jsonb_build_object('id',a,'correctsId',corrected,'values','{"condition":"improving"}'::jsonb,'reason','Post-discharge addendum'));
  if (select snapshot from public.admission_discharge_summaries where admission_id=a)<>original then raise exception 'TEST: addendum rewrote discharge snapshot'; end if;
  perform pg_temp.admit_reject('admission_observe',jsonb_build_object('id',a,'kind','note','note','Late silent change'),'RECORD_FINALIZED');
  -- Closed historical stays contain structured evidence but never live work.
  select count(*) into before_stock from public.inventory_movements;
  select count(*) into before_queue from public.queue_entries;
  select count(*) into before_reminders from public.reminders;
  payload:=jsonb_build_object('petId',pet,'reason','Previous hospitalization','condition','stable','admittedAt',now()-interval '30 days','dischargedAt',now()-interval '28 days','veterinarianName','External clinician',
    'observations',jsonb_build_array(jsonb_build_object('kind','vitals','values','{"weightKg":3.5}'::jsonb,'occurredAt',now()-interval '29 days')),
    'medications','[{"title":"Historical medicine","dose":"Recorded dose"}]'::jsonb);
  b:=(pg_temp.admit_call('admission_historical_create',payload)->>'id')::uuid;
  if (select count(*) from public.inventory_movements)<>before_stock or (select count(*) from public.queue_entries)<>before_queue or (select count(*) from public.reminders)<>before_reminders then raise exception 'TEST: historical operational effects'; end if;
  if exists(select 1 from public.admission_tasks where admission_id=b) or exists(select 1 from public.admission_occupancy where admission_id=b) then raise exception 'TEST: historical tasks or occupancy'; end if;
  if (select count(*) from public.prescriptions where visit_id=(select visit_id from public.admissions where id=b))<>1 then raise exception 'TEST: historical prescription missing'; end if;
  perform pg_temp.admit_reject('admission_historical_create',payload||jsonb_build_object('medications',jsonb_build_array(jsonb_build_object('title','Bad historical medicine','inventoryItemId',item))));
  -- Cancel only intake-only admissions; a patient can be readmitted after closure.
  b:=(pg_temp.admit_call('admission_create',jsonb_build_object('petId',pet,'reason','Mistaken intake','condition','stable','admittedAt',now(),'veterinarianId',auth.uid()))->>'id')::uuid;
  perform pg_temp.admit_call('admission_cancel',jsonb_build_object('id',b,'reason','Entered in error'));
  perform set_config('admission.saved',a::text,true);
  perform set_config('admission.pet',pet::text,true);
  -- Report has admission evidence regardless of current page state.
  history:=public.export_report('history',pet)->0;
  if jsonb_array_length(history->'admissions')<>3 then raise exception 'TEST: missing admissions in complete history'; end if;
  -- Revisions retain old schedules and explicitly resolve future tasks.
  b:=(pg_temp.admit_call('admission_create',jsonb_build_object('petId',pet2,'reason','Schedule test','condition','stable','admittedAt',now()-interval '1 hour','veterinarianId',auth.uid()))->>'id')::uuid;
  ord:=(pg_temp.admit_call('admission_order',jsonb_build_object('id',b,'kind','treatment','title','Initial schedule','startsAt',now()+interval '1 hour','endsAt',now()+interval '3 hours','intervalHours',1))->>'orderId')::uuid;
  result:=pg_temp.admit_call('admission_revise_order',jsonb_build_object('id',b,'replacesOrderId',ord,'kind','treatment','title','Revised schedule','startsAt',now()+interval '2 hours','endsAt',now()+interval '4 hours','intervalHours',1,'reason','Reviewed schedule'));
  if (select count(*) from public.admission_tasks where order_id=ord and status='cancelled')<>3 then raise exception 'TEST: revision did not retain/cancel previous tasks'; end if;
  ord:=(result->>'orderId')::uuid;
  select id into task from public.admission_tasks where order_id=ord order by due_at limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.staff'),'role','authenticated')::text,true);
  select count(*) into before_stock from public.inventory_movements;
  perform pg_temp.admit_call('admission_task',jsonb_build_object('id',b,'taskId',task,'taskVersion',0,'outcome','held','reason','Clinical review'));
  perform pg_temp.admit_call('admission_unscheduled',jsonb_build_object('id',b,'title','Unscheduled nursing care','outcome','given','reason','Care performed'));
  perform pg_temp.admit_call('admission_stop_order',jsonb_build_object('id',b,'orderId',ord,'reason','Plan complete'));
  if (select count(*) from public.inventory_movements)<>before_stock then raise exception 'TEST: nursing or held care consumed stock'; end if;
  if exists(select 1 from public.admission_tasks where order_id=ord and status in ('pending','delayed')) then raise exception 'TEST: stopped order left future work'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.actor'),'role','authenticated')::text,true);
end $$;
reset role;
-- API grants, immutable evidence and persona boundaries.
do $$ begin
  if has_table_privilege('authenticated','public.admissions','insert') or has_table_privilege('anon','public.admissions','select')
    or has_table_privilege('anon','public.admission_observation_history','select') or has_table_privilege('authenticated','public.admission_observation_history','update')
    or has_function_privilege('authenticated','private.admission_mutation(text,jsonb)','execute') then raise exception 'TEST: exposed admission write'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.admit_reject('facility_ward','{"name":"Unauthorized ward"}'::jsonb,'FORBIDDEN');
select pg_temp.admit_reject('admission_correct',jsonb_build_object('id',current_setting('admission.saved'),'correctsId',gen_random_uuid(),'reason','No permission'),'FORBIDDEN');
do $$ begin
  if not exists(select 1 from public.admissions where id=current_setting('admission.saved')::uuid) then raise exception 'TEST: approved staff cannot read'; end if;
  begin update public.admission_observations set note='overwrite'; raise exception 'TEST: clinical evidence overwritten'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.actor'),'role','authenticated')::text,true);
update public.profiles set is_active=false where id=current_setting('admission.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.admit_reject('admission_create','{}'::jsonb,'FORBIDDEN');
do $$ begin if exists(select 1 from public.admissions) then raise exception 'TEST: inactive member read admission'; end if; end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.admit_reject('admission_create','{}','FORBIDDEN');
do $$ begin if exists(select 1 from public.admissions) then raise exception 'TEST: unapproved account read'; end if; end $$;
reset role;
-- Another active clinic cannot read or supply references from this clinic.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.actor'),'role','authenticated')::text,true);
do $$ declare clinic uuid; actor uuid:=gen_random_uuid(); begin
  insert into public.clinics(name) values('Other admission test clinic') returning id into clinic;
  insert into private.clinic_subscriptions(clinic_id,expires_at) values(clinic,now()+interval '1 day');
  insert into auth.users(id,email,email_confirmed_at) values(actor,'admission-other-'||actor||'@veterina-test.invalid',now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.profiles(id,clinic_id,full_name,role,is_active,is_veterinarian) values(actor,clinic,'Other owner','owner',true,true);
end $$;
set local role authenticated;
select pg_temp.admit_reject('admission_transfer',jsonb_build_object('id',current_setting('admission.saved'),'unitId',null),'NOT_FOUND');
select pg_temp.admit_reject('admission_create',jsonb_build_object('petId',current_setting('admission.pet'),'reason','Cross clinic','condition','stable','admittedAt',now(),'veterinarianId',auth.uid()),'NOT_FOUND');
do $$ begin if exists(select 1 from public.admissions where id=current_setting('admission.saved')::uuid) then raise exception 'TEST: cross-clinic read'; end if; end $$;
reset role;
update private.clinic_subscriptions set expires_at=now()-interval '1 second' where clinic_id=(select clinic_id from public.profiles where id=current_setting('admission.actor')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('admission.actor'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.admit_reject('admission_create','{}'::jsonb,'FORBIDDEN');
do $$ begin if exists(select 1 from public.admissions) then raise exception 'TEST: expired clinic read'; end if; end $$;
rollback;
