begin;
select set_config('completion.actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('completion.actor')::uuid,'completion-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('completion.actor')::uuid,'Completion clinician','clinical_staff',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('completion.actor'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare person uuid; pet uuid; result jsonb; payload jsonb; receipt jsonb; ticket uuid; visit uuid; key uuid:=gen_random_uuid(); before_count integer; begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Completion household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Completion pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  payload:=jsonb_build_object('petId',pet,'type','Wellness check','complaint','Completed care','weightKg',3,'veterinarianId',auth.uid(),'clinicalNotes','Completion notes');
  result:=public.portal_mutation('complete_checkup',payload,key);
  visit:=(result->>'id')::uuid; ticket:=(result->>'queueEntryId')::uuid;
  if not exists(select 1 from public.queue_entries where id=ticket and visit_id=visit and status='completed' and started_at is not null and finished_at is not null) then raise exception 'TEST: new checkup not completed'; end if;
  if not exists(select 1 from public.visits where id=visit and clinical_notes='Completion notes' and finalized_at is null) then raise exception 'TEST: notes lost or prematurely finalized'; end if;
  receipt:=public.portal_mutation('complete_checkup',payload,key);
  if receipt<>result or (select count(*) from public.visits where pet_id=pet)<>1 then raise exception 'TEST: completion retry duplicated care'; end if;
  -- A completed clinical record remains available to the existing prescription
  -- mutation, including its server-side Route and inventory dispensing guards.
  perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(jsonb_build_object('medicationName','Custom','route','Oral','dose','Dose','frequency','Frequency'))),gen_random_uuid());
  if (select count(*) from public.prescriptions where visit_id=visit)<>1 then raise exception 'TEST: prescription linked to wrong checkup'; end if;
  -- Completion of an already recorded waiting checkup updates the same record.
  result:=public.portal_mutation('create_queued_encounter',payload,gen_random_uuid());
  result:=public.portal_mutation('complete_checkup',payload||jsonb_build_object('id',result->>'id','queueEntryId',result->>'queueEntryId','draftVersion',0),gen_random_uuid());
  if (select count(*) from public.visits where pet_id=pet)<>2 or not exists(select 1 from public.queue_entries where id=(result->>'queueEntryId')::uuid and status='completed') then raise exception 'TEST: waiting checkup duplicated'; end if;
  select count(*) into before_count from public.visits where pet_id=pet;
  begin
    perform public.portal_mutation('complete_checkup',payload||jsonb_build_object('draftVersion',100),gen_random_uuid());
    raise exception 'TEST: expected stale draft rejection';
  exception when others then if sqlerrm not like 'DRAFT_CONFLICT%' then raise; end if; end;
  if (select count(*) from public.visits where pet_id=pet)<>before_count or exists(select 1 from public.queue_entries where pet_id=pet and status in ('waiting','in_progress')) then raise exception 'TEST: failed completion partially persisted'; end if;
  -- Preparing a prescription keeps care open across cancellation/reload.
  key:=gen_random_uuid();
  result:=public.portal_mutation('save_checkup_progress',payload,key);
  if public.portal_mutation('save_checkup_progress',payload,key)<>result then raise exception 'TEST: prepare retry changed'; end if;
  visit:=(result->>'id')::uuid; ticket:=(result->>'queueEntryId')::uuid;
  if not exists(select 1 from public.queue_entries where id=ticket and status='in_progress' and finished_at is null and visit_id=visit and draft_version=1) then raise exception 'TEST: preparation completed care'; end if;
  payload:=payload||jsonb_build_object('id',visit,'queueEntryId',ticket,'draftVersion',1);
  receipt:=jsonb_build_object('visitId',visit,'checkup',payload,'medications',jsonb_build_array(jsonb_build_object('medicationName','Custom','route','','dose','Dose','frequency','Frequency')));
  begin
    perform public.portal_mutation('prescribe_and_complete_checkup',receipt,gen_random_uuid());
    raise exception 'TEST: invalid prescription accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED%' then raise; end if; end;
  if not exists(select 1 from public.queue_entries where id=ticket and status='in_progress' and draft_version=1 and finished_at is null)
    or exists(select 1 from public.prescriptions where visit_id=visit) then raise exception 'TEST: failed prescription partially completed care'; end if;
  receipt:=jsonb_set(receipt,'{medications,0,route}','"Oral"');
  -- Inventory failure also rolls back completion, and successful retry dispenses once.
  declare item uuid; batch uuid; medication jsonb; rx_payload jsonb; rx_result jsonb; rx_key uuid:=gen_random_uuid(); begin
    item:=(public.portal_mutation('create_inventory_item','{"name":"Completion medicine","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
    select id into batch from public.inventory_batches where item_id=item;
    medication:=(receipt#>'{medications,0}')||jsonb_build_object('medicationId',gen_random_uuid(),'inventoryItemId',item,'batchId',batch,'dispenseQuantity',2);
    rx_payload:=receipt||jsonb_build_object('medications',jsonb_build_array(medication));
    begin
      perform public.portal_mutation('prescribe_and_complete_checkup',rx_payload,rx_key);
      raise exception 'TEST: insufficient stock accepted';
    exception when others then if sqlerrm not like 'INSUFFICIENT_STOCK%' then raise; end if; end;
    if not exists(select 1 from public.queue_entries where id=ticket and status='in_progress' and draft_version=1) then raise exception 'TEST: stock failure completed care'; end if;
    perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',5,'reason','Supplier delivery'),gen_random_uuid());
    rx_result:=public.portal_mutation('prescribe_and_complete_checkup',rx_payload,rx_key);
    if public.portal_mutation('prescribe_and_complete_checkup',rx_payload,rx_key)<>rx_result
      or (select sum(quantity_delta) from public.inventory_movements where batch_id=batch)<>3
      or (select count(*) from public.prescriptions where visit_id=visit)<>1
      or not exists(select 1 from public.queue_entries where id=ticket and status='completed') then raise exception 'TEST: prescription retry repeated stock or failed completion'; end if;
  end;
  if has_function_privilege('authenticated','private.save_checkup_progress(jsonb)','EXECUTE')
    or has_function_privilege('anon','private.prescribe_and_complete_checkup(jsonb)','EXECUTE') then raise exception 'TEST: progress helpers exposed'; end if;
  if has_function_privilege('authenticated','private.complete_checkup(jsonb)','EXECUTE') or has_function_privilege('anon','private.complete_checkup(jsonb)','EXECUTE') then raise exception 'TEST: private helper exposed'; end if;
end $$;
rollback;
