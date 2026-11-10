-- Synthetic fixtures always roll back. Run only against the isolated test DB.
begin;
select set_config('labs.owner',gen_random_uuid()::text,true),set_config('labs.staff',gen_random_uuid()::text,true),
  set_config('labs.pending',gen_random_uuid()::text,true),set_config('labs.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('labs.'||kind)::uuid,'labs-'||kind||'-'||gen_random_uuid()||'@veterina-test.invalid',now()
  from unnest(array['owner','staff','pending','foreign']) kind;
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('labs.owner')::uuid,'Lab owner','owner',true),
  (current_setting('labs.staff')::uuid,'Lab clinician','clinical_staff',true),
  (current_setting('labs.pending')::uuid,'Unapproved clinician','clinical_staff',false);
select set_config('labs.foreign_clinic',public.provision_vetshop(current_setting('labs.foreign')::uuid,'Foreign lab clinic','Foreign owner')::text,true);
insert into private.clinic_subscriptions(clinic_id,expires_at) values(current_setting('labs.foreign_clinic')::uuid,now()+interval '30 days');
create function pg_temp.reject_lab(action text,data jsonb,pattern text) returns void language plpgsql as $$
begin
  perform public.portal_mutation(action,data,gen_random_uuid());
  raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm not like pattern||'%' then raise; end if;
end $$;
create function pg_temp.assert_lab(visit uuid,requests text,results text) returns void language plpgsql as $$
begin
  if not exists(select 1 from public.visits where id=visit and laboratory_requests=requests and laboratory_results=results) then
    raise exception 'TEST: laboratory text lost or altered'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('labs.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare person uuid; pet uuid; queue uuid; visit uuid; historical uuid; data jsonb; saved jsonb; payload jsonb;
  key uuid; bad jsonb; field text; before_queue integer; before_reminders integer;
begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Lab household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Lab patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  data:=jsonb_build_object('petId',pet,'type','Wellness Check','complaint','Lab investigation','weightKg','3','veterinarianId',auth.uid());
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','checkup'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',auth.uid()),gen_random_uuid());
  payload:=jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('laboratoryRequests',E'CBC\nUrinalysis','laboratoryResults','No parasites'));
  key:=gen_random_uuid(); saved:=public.portal_mutation('save_queue_draft',payload,key);
  if public.portal_mutation('save_queue_draft',payload,key)<>saved then raise exception 'TEST: draft retry changed'; end if;
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',1,'record','{"complaint":"Older client"}'::jsonb),gen_random_uuid());
  if not exists(select 1 from public.queue_entries where id=queue and care_draft->>'laboratoryRequests'=E'CBC\nUrinalysis' and care_draft->>'laboratoryResults'='No parasites' and draft_version=2) then raise exception 'TEST: omitted draft fields erased'; end if;
  perform pg_temp.reject_lab('save_queue_draft',payload,'DRAFT_CONFLICT');
  foreach field in array array['laboratoryRequests','laboratoryResults'] loop
    foreach bad in array array['null'::jsonb,'123'::jsonb,'{}'::jsonb,'[]'::jsonb,to_jsonb(repeat('x',10001))] loop
      perform pg_temp.reject_lab('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',2,'record',jsonb_build_object(field,bad)),'VALIDATION_FAILED');
      perform pg_temp.reject_lab('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',2,'record',data||jsonb_build_object(field,bad)),'VALIDATION_FAILED');
    end loop;
  end loop;
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',2,'record','{"laboratoryRequests":""}'::jsonb),gen_random_uuid());
  if (select care_draft->>'laboratoryRequests' from public.queue_entries where id=queue)<>'' then raise exception 'TEST: draft could not clear'; end if;
  payload:=jsonb_build_object('id',queue,'draftVersion',3,'record',data);
  key:=gen_random_uuid(); saved:=public.portal_mutation('complete_queue_entry',payload,key);
  if public.portal_mutation('complete_queue_entry',payload,key)<>saved then raise exception 'TEST: completion retry changed'; end if;
  select visit_id into visit from public.queue_entries where id=queue;
  perform pg_temp.assert_lab(visit,'','No parasites');
  if (select care_draft from public.queue_entries where id=queue)<>'{}'::jsonb then raise exception 'TEST: completed draft retained'; end if;
  -- Valid boundaries, optional values and old-client updates.
  perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit,'laboratoryRequests',repeat('x',10000),'laboratoryResults',E'Result <one>\nResult two'),gen_random_uuid());
  perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit),gen_random_uuid());
  perform pg_temp.assert_lab(visit,repeat('x',10000),E'Result <one>\nResult two');
  foreach field in array array['laboratoryRequests','laboratoryResults'] loop
    foreach bad in array array['null'::jsonb,'true'::jsonb,'{}'::jsonb,to_jsonb(repeat('x',10001))] loop
      perform pg_temp.reject_lab('update_encounter',data||jsonb_build_object('id',visit,field,bad),'VALIDATION_FAILED');
      perform pg_temp.reject_lab('create_record_only_checkup',data||jsonb_build_object('encounteredAt','2020-01-02T00:00:00Z',field,bad),'VALIDATION_FAILED');
    end loop;
  end loop;
  perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit,'laboratoryRequests','','laboratoryResults',''),gen_random_uuid());
  perform pg_temp.assert_lab(visit,'','');
  select count(*) into before_queue from public.queue_entries;
  select count(*) into before_reminders from public.reminders;
  payload:=data||jsonb_build_object('encounteredAt','2020-01-02T00:00:00Z','laboratoryRequests',E'Historical CBC\nChemistry','laboratoryResults','Historical findings');
  key:=gen_random_uuid(); saved:=public.portal_mutation('create_record_only_checkup',payload,key); historical:=(saved->>'id')::uuid;
  if public.portal_mutation('create_record_only_checkup',payload,key)<>saved then raise exception 'TEST: historical retry changed'; end if;
  perform pg_temp.assert_lab(historical,E'Historical CBC\nChemistry','Historical findings');
  if (select count(*) from public.queue_entries)<>before_queue or (select count(*) from public.reminders)<>before_reminders then raise exception 'TEST: historical labs changed live work'; end if;
  perform set_config('labs.visit',historical::text,true); perform set_config('labs.pet',pet::text,true); perform set_config('labs.payload',payload::text,true);
  -- Progress saves inherit a draft even when an old client opens prescribing.
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'category','checkup'),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',auth.uid()),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record','{"laboratoryRequests":"Progress CBC","laboratoryResults":"Progress finding"}'::jsonb),gen_random_uuid());
  saved:=public.portal_mutation('save_checkup_progress',data||jsonb_build_object('queueEntryId',queue,'draftVersion',1),gen_random_uuid());
  visit:=(saved->>'id')::uuid;
  perform pg_temp.assert_lab(visit,'Progress CBC','Progress finding');
  payload:=data||jsonb_build_object('id',visit,'queueEntryId',queue,'draftVersion',saved->'draftVersion');
  perform public.portal_mutation('prescribe_and_complete_checkup',jsonb_build_object('visitId',visit,'checkup',payload,
    'medications',jsonb_build_array(jsonb_build_object('medicationName','Custom medicine','route','Oral','dose','1 dose','frequency','Daily'))),gen_random_uuid());
  perform pg_temp.assert_lab(visit,'Progress CBC','Progress finding');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('labs.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb:=current_setting('labs.payload')::jsonb; visit uuid:=current_setting('labs.visit')::uuid; begin
  perform pg_temp.assert_lab(visit,E'Historical CBC\nChemistry','Historical findings');
  perform public.portal_mutation('update_encounter',payload||jsonb_build_object('id',visit,'laboratoryResults','Approved staff findings'),gen_random_uuid());
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit),gen_random_uuid());
  perform pg_temp.reject_lab('update_encounter',payload||jsonb_build_object('id',visit,'laboratoryResults','Overwrite'),'RECORD_FINALIZED');
  perform pg_temp.reject_lab('correct_encounter',jsonb_build_object('id',visit,'reason','Lab result','correction','Unauthorized staff correction'),'FORBIDDEN');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('labs.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare visit uuid:=current_setting('labs.visit')::uuid; begin
  perform public.portal_mutation('correct_encounter',jsonb_build_object('id',visit,'reason','Laboratory clarification','correction','Revised interpretation appended'),gen_random_uuid());
  perform pg_temp.assert_lab(visit,E'Historical CBC\nChemistry','Approved staff findings');
  if not exists(select 1 from public.visit_corrections where visit_id=visit and before_data#>>'{visit,laboratory_results}'='Approved staff findings') then raise exception 'TEST: correction snapshot lacks laboratory evidence'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.audit_logs where record_id=current_setting('labs.visit') and new_data->>'laboratory_results'='Approved staff findings') then raise exception 'TEST: laboratory audit missing'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('labs.foreign'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.visits where id=current_setting('labs.visit')::uuid) then raise exception 'TEST: foreign laboratory data visible'; end if;
  perform pg_temp.reject_lab('update_encounter',current_setting('labs.payload')::jsonb||jsonb_build_object('id',current_setting('labs.visit'),'veterinarianId',auth.uid()),'NOT_FOUND');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('labs.pending'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.visits where id=current_setting('labs.visit')::uuid) then raise exception 'TEST: unapproved staff reads labs'; end if;
  perform pg_temp.reject_lab('update_encounter',current_setting('labs.payload')::jsonb||jsonb_build_object('id',current_setting('labs.visit')),'FORBIDDEN');
end $$;
reset role;
rollback;
