-- Run as the database owner on the isolated test stack. All fixtures roll back.
begin;
do $$ declare u uuid; s uuid; i uuid; x uuid; begin
  u:=gen_random_uuid(); s:=gen_random_uuid(); i:=gen_random_uuid(); x:=gen_random_uuid();
  insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(s,s::text||'@example.invalid'),(i,i::text||'@example.invalid'),(x,x::text||'@example.invalid');
  insert into public.profiles(id,full_name,role,is_active) values(u,'Test Owner','owner',true),(s,'Test Staff','clinical_staff',true),(i,'Test Inactive','clinical_staff',false);
  perform set_config('test.owner',u::text,true);perform set_config('test.staff',s::text,true);perform set_config('test.inactive',i::text,true);perform set_config('test.outsider',x::text,true);
  if exists(select 1 from pg_tables where schemaname='public' and tablename in ('profiles','owners','pets','visits','visit_vitals','vaccinations','appointments','reminders','inventory_items','inventory_movements','rag_chunks','rag_jobs','kb_documents','ai_interactions') and not rowsecurity) then raise exception 'FAIL: RLS disabled'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform 1 from public.pets; raise exception 'FAIL: anon read'; exception when insufficient_privilege then null; end;
  begin perform public.create_owner('{}',gen_random_uuid()); raise exception 'FAIL: anon RPC'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.staff'),true);
do $$ declare o uuid; p uuid; q uuid; v uuid; vac uuid; key uuid; data jsonb; item uuid; vaccine_item uuid; batch uuid; result jsonb; begin
  o:=(public.create_owner('{"fullName":"Test Household","phone":"09170000000","address":"Fixture"}',gen_random_uuid())->>'id')::uuid;
  p:=(public.create_pet(jsonb_build_object('ownerId',o,'name','Patient A','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Intact'),gen_random_uuid())->>'id')::uuid;
  q:=(public.create_pet(jsonb_build_object('ownerId',o,'name','Patient B','species','Dog','breed','Mixed','sex','Female','reproductiveStatus','Intact'),gen_random_uuid())->>'id')::uuid;
  key:=gen_random_uuid();data:=jsonb_build_object('petId',p,'type','Wellness check','complaint','itching','subjective','skin itching','weightKg','5','followUpDate',current_date+1);
  result:=public.create_encounter(data,key);v:=(result->>'id')::uuid;
  if public.create_encounter(data,key)<>result then raise exception 'FAIL: idempotent response';end if;
  begin perform public.create_encounter(data || '{"complaint":"different payload"}'::jsonb,key);raise exception 'FAIL: changed payload replay';exception when raise_exception then if sqlerrm not like '%retry payload changed%' then raise;end if;end;
  if (select count(*) from public.visits where pet_id=p)<>1 or (select count(*) from public.visit_vitals where visit_id=v)<>1 or (select count(*) from public.reminders where visit_id=v)<>1 then raise exception 'FAIL: atomic encounter';end if;
  vaccine_item:=(public.portal_mutation('create_inventory_item',jsonb_build_object('name','Fixture Rabies','brand','Fixture Brand','category','Vaccines','unit','dose','minimumStock',0,'allowsFraction','false'),gen_random_uuid())->>'id')::uuid;
  key:=gen_random_uuid();data:=jsonb_build_object('petId',p,'inventoryItemId',vaccine_item,'lotNumber','TEST-LOT','administeredAt',current_date,'nextDueAt',current_date+30);
  vac:=(public.create_vaccination(data,key)->>'id')::uuid;perform public.create_vaccination(data,key);
  if (select count(*) from public.reminders where vaccination_id=vac)<>1 then raise exception 'FAIL: duplicate vaccine reminder';end if;
  perform public.book_appointment(jsonb_build_object('petId',p,'date',current_date+10,'time','09:00','service','Wellness check','veterinarianId',current_setting('test.staff')),gen_random_uuid());
  begin
    perform public.book_appointment(jsonb_build_object('petId',q,'date',current_date+10,'time','09:15','service','Wellness check','veterinarianId',current_setting('test.staff')),gen_random_uuid());
    raise exception 'FAIL: overlapping booking allowed';
  exception when raise_exception then if sqlerrm not like '%APPOINTMENT_CONFLICT%' then raise;end if;end;
  item:=(public.create_inventory_item(jsonb_build_object('sku',gen_random_uuid()::text,'name','Test Stock','category','Medicine','unit','unit','lotNumber','TEST'),gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  perform public.record_inventory_movement(jsonb_build_object('id',item,'batchId',batch,'delta',2,'reason','Supplier delivery'),gen_random_uuid());
  begin perform public.record_inventory_movement(jsonb_build_object('id',item,'batchId',batch,'delta',-3,'reason','Clinic use'),gen_random_uuid());raise exception 'FAIL: negative stock';
  exception when raise_exception then if sqlerrm not like '%INSUFFICIENT_STOCK%' then raise;end if;end;
  begin update public.profiles set role='owner' where id=auth.uid();raise exception 'FAIL: escalation';exception when insufficient_privilege then null;end;
  begin insert into public.inventory_movements(item_id,batch_id,movement_type,quantity_delta,reason,performed_by) values(item,batch,'stock_out',-9,'bypass',auth.uid());raise exception 'FAIL: direct stock bypass';exception when insufficient_privilege then null;end;
  begin perform public.export_report('patients');raise exception 'FAIL: staff export';exception when raise_exception then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
  begin perform public.manage_kb('{"action":"create","title":"x","content":"x"}');raise exception 'FAIL: staff KB publication';exception when raise_exception then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
  perform public.finalize_encounter(jsonb_build_object('id',v),gen_random_uuid());
  begin perform public.create_prescription(jsonb_build_object('visitId',v,'medicationName','x','dose','x','frequency','x'),gen_random_uuid());raise exception 'FAIL: finalized change';exception when raise_exception then if sqlerrm not like '%RECORD_FINALIZED%' then raise;end if;end;
  perform set_config('test.pet',p::text,true);perform set_config('test.other_pet',q::text,true);perform set_config('test.visit',v::text,true);
end $$;
reset role;
set local role service_role;
do $$ declare job public.rag_jobs; source jsonb; done boolean; begin
  for job in select * from public.claim_rag_jobs(20) loop
    source:=public.rag_source_with_hash(job.source_type,job.source_id);
    done:=public.finish_rag_job(job.id,job.lease_token,
      case when source is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('index',0,'content',source->>'content','source_hash',source->>'source_hash')) end);
    if not done then raise exception 'FAIL: ingestion lease/source hash';end if;
  end loop;
  if not exists(select 1 from public.rag_chunks where patient_id=current_setting('test.pet')::uuid and content like '%itching%') then raise exception 'FAIL: searchable saved encounter';end if;
  -- Keep the following leakage fixtures deterministic after checking ingestion.
  delete from public.rag_chunks where patient_id in (current_setting('test.pet')::uuid,current_setting('test.other_pet')::uuid);
end $$;
reset role;
do $$ declare published uuid; draft uuid; begin
  insert into public.kb_documents(title,content,status,uploaded_by) values('Published checklist','checklist approved','published',current_setting('test.owner')::uuid) returning id into published;
  insert into public.kb_documents(title,content,status,uploaded_by) values('Draft checklist','checklist secret draft','draft',current_setting('test.owner')::uuid) returning id into draft;
  insert into public.rag_chunks(source_type,source_id,patient_id,chunk_index,content,content_hash) values
    ('visit',current_setting('test.visit')::uuid,current_setting('test.pet')::uuid,0,'skin itching patient A','test'),
    ('alert',gen_random_uuid(),current_setting('test.other_pet')::uuid,0,'skin secret patient B','test');
  insert into public.rag_chunks(source_type,source_id,document_id,chunk_index,content,content_hash) values
    ('kb_document',published,published,0,'checklist approved','test'),('kb_document',draft,draft,0,'checklist secret draft','test');
end $$;
set local role authenticated;
do $$ begin
  if (select count(*) from public.retrieve_patient_context(current_setting('test.pet')::uuid,'skin'))<>1 then raise exception 'FAIL: patient scope';end if;
  if exists(select 1 from public.retrieve_patient_context(current_setting('test.pet')::uuid,'skin') where content like '%patient B%') then raise exception 'FAIL: patient leakage';end if;
  if (select count(*) from public.retrieve_kb_context('checklist'))<>1 then raise exception 'FAIL: draft leakage';end if;
  if exists(select 1 from public.rag_chunks where content like '%secret draft%') then raise exception 'FAIL: direct draft chunk leakage';end if;
  begin perform public.claim_rag_jobs();raise exception 'FAIL: staff worker access';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
update public.profiles set is_active=false where id=current_setting('test.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.staff'),true);
do $$ begin
  if exists(select 1 from public.pets) or exists(select 1 from public.rag_chunks) or public.patient_facts(current_setting('test.pet')::uuid) is not null then raise exception 'FAIL: deactivated access';end if;
  begin perform public.create_owner('{"fullName":"Denied","phone":"x"}',gen_random_uuid());raise exception 'FAIL: inactive write';exception when raise_exception then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.outsider'),true);
do $$ begin if exists(select 1 from public.pets) then raise exception 'FAIL: unregistered user';end if;end $$;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
do $$ begin
  perform public.correct_encounter(jsonb_build_object('id',current_setting('test.visit'),'reason','Test correction','correction','Appended, no overwrite'),gen_random_uuid());
  perform public.export_report('patients');
  if (select count(*) from public.export_events where user_id=auth.uid())<>1 then raise exception 'FAIL: export audit';end if;
end $$;
rollback;
select 'PASS: anonymous, outsider, inactive and staff RLS; idempotency; atomic visits/vaccines; booking overlap; negative stock; finalized records; scoped RAG; draft isolation; owner export audit' as result;
