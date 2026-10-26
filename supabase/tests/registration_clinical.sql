begin;
select set_config('registration.actor',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('registration.actor')::uuid,'registration-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values(current_setting('registration.actor')::uuid,'Registration clinician','owner',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('registration.actor'),'role','authenticated')::text,true);
create function pg_temp.reject_registration(action text,data jsonb,pattern text) returns void language plpgsql as $$
begin
  perform public.portal_mutation(action,data,gen_random_uuid());
  raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm not like pattern||'%' then raise; end if;
end $$;
set local role authenticated;
do $$
declare person uuid; another uuid; patient uuid; visit uuid; rx uuid; queue uuid; data jsonb; meds jsonb; revision bigint;
begin
  person:=(public.portal_mutation('create_owner','{"fullName":"Registration household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  another:=(public.portal_mutation('create_owner','{"fullName":"Other household","phone":"09171234568","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  data:=jsonb_build_object('ownerId',person,'name','Registration pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown');
  patient:=(public.portal_mutation('create_pet',data,gen_random_uuid())->>'id')::uuid;
  perform pg_temp.reject_registration('add_queue_entry',jsonb_build_object('ownerId',another,'petId',patient,'serviceId',(select id from public.service_types where workflow='checkup' and is_active limit 1)),'VALIDATION_FAILED');
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('ownerId',person,'petId',patient,'serviceId',(select id from public.service_types where workflow='checkup' and is_active limit 1)),gen_random_uuid())->>'id')::uuid;
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',auth.uid()),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('clinicalNotes','Draft clinical notes','veterinarianId',auth.uid()::text)),gen_random_uuid());
  if (select care_draft->>'clinicalNotes' from public.queue_entries where id=queue)<>'Draft clinical notes' then raise exception 'TEST: clinical draft lost'; end if;
  data:=jsonb_build_object('petId',patient,'type','Wellness check','complaint','Test complaint','weightKg',3,'veterinarianId',auth.uid(),'clinicalNotes',E'First line\nSecond line');
  visit:=(public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',1,'record',data),gen_random_uuid())->>'visitId')::uuid;
  select visit_id into visit from public.queue_entries where id=queue;
  if (select clinical_notes from public.visits where id=visit)<>E'First line\nSecond line' then raise exception 'TEST: completed clinical notes lost'; end if;
  perform public.portal_mutation('update_encounter',(data-'clinicalNotes')||jsonb_build_object('id',visit),gen_random_uuid());
  if (select clinical_notes from public.visits where id=visit)<>E'First line\nSecond line' then raise exception 'TEST: omitted clinical notes erased'; end if;
  perform pg_temp.reject_registration('update_encounter',data||jsonb_build_object('id',visit,'clinicalNotes',repeat('x',10001)),'VALIDATION_FAILED');
  perform public.portal_mutation('update_encounter',data||jsonb_build_object('id',visit,'clinicalNotes',''),gen_random_uuid());
  if (select clinical_notes from public.visits where id=visit)<>'' then raise exception 'TEST: notes not cleared'; end if;
  meds:=jsonb_build_array(jsonb_build_object('medicationName','Custom medication','dose','Dose','frequency','Frequency','route','Oral'));
  perform pg_temp.reject_registration('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array((meds->0)-'route')),'VALIDATION_FAILED');
  perform pg_temp.reject_registration('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array((meds->0)||'{"route":"  "}')),'VALIDATION_FAILED');
  rx:=(public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',meds),gen_random_uuid())->>'id')::uuid;
  if (select route from public.prescriptions where id=rx)<>'Oral' then raise exception 'TEST: route compatibility missing'; end if;
  perform public.portal_mutation('update_prescription',jsonb_build_object('id',rx,'medications',jsonb_build_array((meds->0)||'{"route":"Custom route"}')),gen_random_uuid());
  if (select route from public.prescriptions where id=rx)<>'Custom route' then raise exception 'TEST: custom route not saved'; end if;
  perform public.portal_mutation('update_owner',jsonb_build_object('id',person,'fullName','Registration household','phone','09171234567','address','Test','isActive',false),gen_random_uuid());
  perform pg_temp.reject_registration('create_pet',jsonb_build_object('ownerId',person,'name','Invalid','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),'VALIDATION_FAILED');
  perform public.portal_mutation('update_pet',jsonb_build_object('id',patient,'ownerId',person,'name','Edited existing patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown','status','Active'),gen_random_uuid());
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit),gen_random_uuid());
  perform pg_temp.reject_registration('update_encounter',data||jsonb_build_object('id',visit),'RECORD_FINALIZED');
  perform set_config('registration.pet',patient::text,true);
end $$;
reset role;
-- Service-only media attachment: no real provider calls and no persisted fixtures.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$
declare actor uuid:=current_setting('registration.actor')::uuid; pet uuid:=current_setting('registration.pet')::uuid;
  request uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid(); first_id text; next_id text; result jsonb; before_count integer;
begin
  if has_function_privilege('authenticated','public.pet_photo_admin(uuid,jsonb)','EXECUTE') or has_table_privilege('authenticated','private.pet_photos','SELECT') then raise exception 'TEST: browser media metadata exposed'; end if;
  result:=public.pet_photo_admin(actor,jsonb_build_object('action','begin','petId',pet,'requestId',request,'expectedRevision',0,'contentHash',repeat('a',64)));
  first_id:=result->>'publicId';
  perform public.pet_photo_admin(actor,jsonb_build_object('action','finish','petId',pet,'requestId',request,'publicId',first_id,'assetId','test-asset','version',1,'format','jpg','bytes',10));
  result:=public.pet_photo_admin(actor,jsonb_build_object('action','begin','petId',pet,'requestId',request,'expectedRevision',0,'contentHash',repeat('a',64)));
  if result->>'completed'<>'true' or (select photo_revision from public.pets where id=pet)<>1 then raise exception 'TEST: lost upload acknowledgement not idempotent'; end if;
  result:=public.pet_photo_admin(actor,jsonb_build_object('action','begin','petId',pet,'requestId',replacement,'expectedRevision',1,'contentHash',repeat('b',64)));
  next_id:=result->>'publicId';
  if (public.pet_photo_admin(actor,jsonb_build_object('action','read','petId',pet))->>'public_id')<>first_id then raise exception 'TEST: replacement removed existing photo before successful attach'; end if;
  perform public.pet_photo_admin(actor,jsonb_build_object('action','finish','petId',pet,'requestId',replacement,'publicId',next_id,'assetId','replacement-asset','version',2,'format','jpg','bytes',20));
  if not exists(select 1 from private.pet_photo_cleanup where public_id=first_id) then raise exception 'TEST: replaced photo not queued for cleanup'; end if;
  perform public.pet_photo_admin(actor,jsonb_build_object('action','remove','petId',pet,'expectedRevision',2));
  perform public.pet_photo_admin(actor,jsonb_build_object('action','remove','petId',pet,'expectedRevision',2));
  if (select has_photo from public.pets where id=pet) or (select photo_revision from public.pets where id=pet)<>3 then raise exception 'TEST: photo removal not idempotent'; end if;
  result:=public.pet_photo_admin(null,'{"action":"cleanup_claim"}');
  if jsonb_array_length(result)<>2 then raise exception 'TEST: obsolete photos not claimed'; end if;
  if jsonb_array_length(public.pet_photo_admin(null,'{"action":"cleanup_claim"}'))<>0 then raise exception 'TEST: cleanup lease duplicated'; end if;
  request:=gen_random_uuid();
  result:=public.pet_photo_admin(actor,jsonb_build_object('action','begin','petId',pet,'requestId',request,'expectedRevision',3,'contentHash',repeat('c',64)));
  first_id:=result->>'publicId';
  update private.pet_photo_requests set lease_until=now()-interval '1 minute' where id=request;
  update private.pet_photo_cleanup set available_at=now()-interval '1 minute' where public_id=first_id;
  perform public.pet_photo_admin(null,'{"action":"cleanup_claim"}');
  -- Even an expired worker lease must never allow this asset ID to be reused.
  update private.pet_photo_cleanup set lease_until=now()-interval '1 minute' where public_id=first_id;
  begin
    perform public.pet_photo_admin(actor,jsonb_build_object('action','begin','petId',pet,'requestId',request,'expectedRevision',3,'contentHash',repeat('c',64)));
    raise exception 'TEST: retry reused a cleanup-claimed upload';
  exception when others then if sqlerrm not like 'PHOTO_CONFLICT%' then raise; end if; end;
  perform public.pet_photo_admin(null,jsonb_build_object('action','cleanup_done','publicId',first_id));
  begin
    perform public.pet_photo_admin(actor,jsonb_build_object('action','finish','petId',pet,'requestId',request,'publicId',first_id,'assetId','too-late','version',3,'format','jpg','bytes',10));
    raise exception 'TEST: deleted upload was attached';
  exception when others then if sqlerrm not like 'PHOTO_CONFLICT%' then raise; end if; end;
end $$;
reset role;
rollback;
