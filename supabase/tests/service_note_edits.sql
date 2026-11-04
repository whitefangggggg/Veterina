-- All identities, notes, queue entries, audit rows and retry keys roll back.
begin;
select set_config('notes_test.actor',gen_random_uuid()::text,true);
select set_config('notes_test.pending',gen_random_uuid()::text,true);
select set_config('notes_test.inactive',gen_random_uuid()::text,true);
select set_config('notes_test.service',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
select current_setting('notes_test.actor')::uuid,'notes-active-'||gen_random_uuid()||'@veterina-test.invalid',now()
union all select current_setting('notes_test.pending')::uuid,'notes-pending-'||gen_random_uuid()||'@veterina-test.invalid',now()
union all select current_setting('notes_test.inactive')::uuid,'notes-inactive-'||gen_random_uuid()||'@veterina-test.invalid',now();
insert into public.profiles(id,full_name,role,is_active) values
 (current_setting('notes_test.actor')::uuid,'Notes test clinician','clinical_staff',true),
 (current_setting('notes_test.inactive')::uuid,'Notes test inactive','clinical_staff',false);
insert into public.service_types(id,name,workflow,default_duration_minutes,is_active)
values(current_setting('notes_test.service')::uuid,'Notes fixture '||gen_random_uuid(),'maintenance',30,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('notes_test.actor'),'role','authenticated')::text,true);
create function pg_temp.reject_notes(payload jsonb,pattern text) returns void language plpgsql as $$
begin
  begin
    perform public.portal_mutation('update_service_notes',payload,gen_random_uuid());
  exception when others then
    if sqlerrm like pattern then return; end if;
    raise;
  end;
  raise exception 'TEST: service notes action unexpectedly accepted';
end $$;
grant execute on function pg_temp.reject_notes(jsonb,text) to authenticated,anon;
set local role authenticated;
do $$
declare actor uuid:=current_setting('notes_test.actor')::uuid; owner_id uuid; pet uuid; queue uuid; closed_queue uuid; clinical_queue uuid;
  payload jsonb; original jsonb; replay uuid:=gen_random_uuid(); response jsonb;
begin
  owner_id:=(public.portal_mutation('create_owner',jsonb_build_object('fullName','Service notes fixture','phone','09171234567','address','Test'),gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner_id,'name','Service notes fixture patient','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Intact'),gen_random_uuid())->>'id')::uuid;
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'serviceId',current_setting('notes_test.service')),gen_random_uuid())->>'id')::uuid;
  select to_jsonb(q)-'notes'-'service_notes'-'updated_at' into original from public.queue_entries q where id=queue;
  payload:=jsonb_build_object('id',queue,'notes','Arrival note','serviceNotes','Planned bath','originalNotes','','originalServiceNotes','');
  response:=public.portal_mutation('update_service_notes',payload,replay);
  if public.portal_mutation('update_service_notes',payload,replay)<>response then raise exception 'TEST: notes replay changed'; end if;
  if not exists(select 1 from public.queue_entries where id=queue and notes='Arrival note' and service_notes='Planned bath') then raise exception 'TEST: notes did not save'; end if;
  if (select to_jsonb(q)-'notes'-'service_notes'-'updated_at' from public.queue_entries q where id=queue) is distinct from original then raise exception 'TEST: notes changed queue workflow'; end if;
  perform pg_temp.reject_notes(payload,'RECORD_CHANGED%');
  perform pg_temp.reject_notes(payload-'notes','VALIDATION_FAILED%');
  perform pg_temp.reject_notes(payload||'{"serviceNotes":null}','VALIDATION_FAILED%');
  perform pg_temp.reject_notes(payload||jsonb_build_object('serviceNotes',repeat('x',10001)),'VALIDATION_FAILED%');
  perform pg_temp.reject_notes(payload||jsonb_build_object('id',gen_random_uuid()),'NOT_FOUND%');

  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',actor),gen_random_uuid());
  payload:=payload||'{"originalNotes":"Arrival note","originalServiceNotes":"Planned bath","serviceNotes":"Bath in progress"}';
  perform public.portal_mutation('update_service_notes',payload,gen_random_uuid());
  if (select status from public.queue_entries where id=queue)<>'in_progress' then raise exception 'TEST: edit changed progress'; end if;
  perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'record',jsonb_build_object('petId',pet,'veterinarianId',actor,'serviceNotes','Bath completed')),gen_random_uuid());
  select to_jsonb(q)-'notes'-'service_notes'-'updated_at' into original from public.queue_entries q where id=queue;
  payload:=payload||'{"originalServiceNotes":"Bath completed","serviceNotes":"Bath completed; corrected notes"}';
  perform public.portal_mutation('update_service_notes',payload,gen_random_uuid());
  if (select to_jsonb(q)-'notes'-'service_notes'-'updated_at' from public.queue_entries q where id=queue) is distinct from original then raise exception 'TEST: completed service workflow changed'; end if;
  perform pg_temp.reject_notes(payload||'{"originalServiceNotes":"Bath completed; corrected notes","serviceNotes":""}','VALIDATION_FAILED%');
  perform set_config('notes_test.queue',queue::text,true);

  closed_queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'serviceId',current_setting('notes_test.service')),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('cancel_queue_entry',jsonb_build_object('id',closed_queue),gen_random_uuid());
  perform public.portal_mutation('update_service_notes',jsonb_build_object('id',closed_queue,'notes','Cancelled arrival','serviceNotes','','originalNotes','','originalServiceNotes',''),gen_random_uuid());
  if (select status from public.queue_entries where id=closed_queue)<>'cancelled' then raise exception 'TEST: cancelled service reopened'; end if;
  clinical_queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'serviceId',(select id from public.service_types where workflow='checkup' and is_active limit 1)),gen_random_uuid())->>'id')::uuid;
  perform pg_temp.reject_notes(payload||jsonb_build_object('id',clinical_queue),'NOT_FOUND%');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('notes_test.pending'),'role','authenticated')::text,true);
  perform pg_temp.reject_notes(payload,'FORBIDDEN%');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('notes_test.inactive'),'role','authenticated')::text,true);
  perform pg_temp.reject_notes(payload,'FORBIDDEN%');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where table_name='queue_entries' and record_id=current_setting('notes_test.queue') and action='UPDATE' and new_data->>'service_notes'='Planned bath' and old_data->>'service_notes' is distinct from new_data->>'service_notes')<>1 then raise exception 'TEST: notes audit/replay'; end if;
  if not exists(select 1 from public.audit_logs where table_name='queue_entries' and record_id=current_setting('notes_test.queue') and action='UPDATE' and new_data->>'service_notes'='Bath completed; corrected notes') then raise exception 'TEST: completed notes not audited'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.reject_notes(jsonb_build_object('id',current_setting('notes_test.queue')),'permission denied%');
reset role;
rollback;
select 'PASS: service note saves, validation, staff permissions, audit/replay, conflicts and preserved workflow across queue statuses (fixtures rolled back)' as result;
