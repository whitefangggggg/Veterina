begin;
select set_config('followup.actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('followup.actor')::uuid,'followup-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('followup.actor')::uuid,'Follow-up clinician','owner',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('followup.actor'),'role','authenticated')::text,true);
create function pg_temp.reject_followup(action text,data jsonb,pattern text) returns void language plpgsql as $$
begin
  perform public.portal_mutation(action,data,gen_random_uuid());
  raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if;
end $$;
set local role authenticated;
do $$
declare person uuid; patient uuid; source uuid; other_source uuid; result jsonb; arrival uuid; queue uuid;
  data jsonb; key_id uuid:=gen_random_uuid(); today date; service uuid; before_count integer; snapshot jsonb;
begin
  select (now() at time zone timezone)::date into today from public.clinic_settings limit 1;
  select id into service from public.service_types where workflow='checkup' and is_active limit 1;
  person:=(public.portal_mutation('create_owner','{"fullName":"Follow-up household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Follow-up patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  data:=jsonb_build_object('petId',patient,'type','Sick visit','complaint','Original complaint','weightKg',3,'veterinarianId',auth.uid(),'followUpDate',today+2,'subjective','Original findings','clinicalNotes','Retained notes');
  source:=(public.portal_mutation('create_encounter',data,gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',source),gen_random_uuid());
  select to_jsonb(v)-array['updated_at','follow_up_scheduled_date','follow_up_visit_id','follow_up_queue_id','follow_up_arrived_at'] into snapshot from public.visits v where id=source;
  data:=jsonb_build_object('visitId',source,'petId',patient,'expectedDate',today+2,'serviceId',service,'veterinarianId',auth.uid(),'complaint','Current follow-up complaint','weightKg',3.4,'notes','Arrived for review');
  select count(*) into before_count from public.visits where pet_id=patient;
  perform pg_temp.reject_followup('arrive_follow_up',data,'FOLLOWUP_NOT_TODAY');
  if (select count(*) from public.visits where pet_id=patient)<>before_count or exists(select 1 from public.queue_entries where pet_id=patient) then raise exception 'TEST: wrong-day arrival wrote records'; end if;
  perform pg_temp.reject_followup('reschedule_follow_up',jsonb_build_object('visitId',source,'expectedDate',today+1,'date',today),'RECORD_CHANGED');
  perform pg_temp.reject_followup('reschedule_follow_up',jsonb_build_object('visitId',source,'expectedDate',today+2,'date',today-1),'VALIDATION_FAILED');
  perform public.portal_mutation('reschedule_follow_up',jsonb_build_object('visitId',source,'expectedDate',today+2,'date',today),gen_random_uuid());
  if (select follow_up_scheduled_date from public.visits where id=source)<>today then raise exception 'TEST: reschedule not saved'; end if;
  if not exists(select 1 from public.reminders where visit_id=source and (due_at at time zone (select timezone from public.clinic_settings limit 1))::date=today) then raise exception 'TEST: reminder did not sync'; end if;
  data:=data||jsonb_build_object('expectedDate',today);
  perform pg_temp.reject_followup('arrive_follow_up',data||jsonb_build_object('serviceId',gen_random_uuid()),'VALIDATION_FAILED');
  perform pg_temp.reject_followup('arrive_follow_up',data||jsonb_build_object('petId',gen_random_uuid()),'VALIDATION_FAILED');
  perform pg_temp.reject_followup('arrive_follow_up',data||jsonb_build_object('weightKg',-1),'');
  if (select count(*) from public.visits where pet_id=patient)<>before_count or exists(select 1 from public.queue_entries where pet_id=patient) then raise exception 'TEST: invalid clinical save was not atomic'; end if;
  result:=public.portal_mutation('arrive_follow_up',data,key_id);
  arrival:=(result->>'id')::uuid; queue:=(result->>'queueEntryId')::uuid;
  if arrival=source or not exists(select 1 from public.visits where id=arrival and pet_id=patient and chief_complaint='Current follow-up complaint' and subjective='' and objective='' and assessment='' and plan='' and clinical_notes='' and finalized_at is null) then raise exception 'TEST: arrival did not create a fresh clinical record'; end if;
  if not exists(select 1 from public.visit_vitals where visit_id=arrival and weight_kg=3.4) or not exists(select 1 from public.queue_entries where id=queue and visit_id=arrival and status='waiting' and queue_number>0) then raise exception 'TEST: arrival visit/vitals/queue not linked'; end if;
  if snapshot is distinct from (select to_jsonb(v)-array['updated_at','follow_up_scheduled_date','follow_up_visit_id','follow_up_queue_id','follow_up_arrived_at'] from public.visits v where id=source) then raise exception 'TEST: finalized source clinical fields changed'; end if;
  if public.portal_mutation('arrive_follow_up',data,key_id)<>result then raise exception 'TEST: same-key retry changed receipt'; end if;
  if public.portal_mutation('arrive_follow_up',data,gen_random_uuid())<>result then raise exception 'TEST: another-tab retry lost its ticket receipt'; end if;
  if (select count(*) from public.visits where pet_id=patient)<>before_count+1 or (select count(*) from public.queue_entries where pet_id=patient)<>1 then raise exception 'TEST: repeated arrival duplicated records'; end if;
  perform pg_temp.reject_followup('reschedule_follow_up',jsonb_build_object('visitId',source,'expectedDate',today,'date',today+1),'FOLLOWUP_ALREADY_ARRIVED');
  perform pg_temp.reject_followup('update_encounter',jsonb_build_object('id',source,'type','Sick visit','complaint','Overwrite','veterinarianId',auth.uid(),'weightKg',3),'RECORD_FINALIZED');
  -- Completing queued care edits the newly created visit, not the source or a third visit.
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',auth.uid()),gen_random_uuid());
  perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('petId',patient,'type','Follow-up','complaint','Reviewed today','weightKg',3.5,'veterinarianId',auth.uid(),'clinicalNotes','New findings')),gen_random_uuid());
  if (select count(*) from public.visits where pet_id=patient)<>before_count+1 or (select clinical_notes from public.visits where id=arrival)<>'New findings' then raise exception 'TEST: completion duplicated or failed to update new visit'; end if;
  if has_table_privilege('authenticated','public.visits','UPDATE') or has_function_privilege('authenticated','private.follow_up_mutation(text,jsonb)','EXECUTE') then raise exception 'TEST: browser bypasses authenticated dispatcher'; end if;
end $$;
reset role;
update public.profiles set is_active=false where id=current_setting('followup.actor')::uuid;
set local role authenticated;
select pg_temp.reject_followup('arrive_follow_up','{}','FORBIDDEN');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin perform public.portal_mutation('arrive_follow_up','{}',gen_random_uuid()); raise exception 'TEST: anonymous arrival allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
