-- Administrator-run integration fixtures; every identity and write rolls back.
begin;
select set_config('clinical_test.owner',gen_random_uuid()::text,true);
select set_config('clinical_test.staff',gen_random_uuid()::text,true);
select set_config('clinical_test.pending',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
select current_setting('clinical_test.owner')::uuid,'clinical-owner-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('clinical_test.staff')::uuid,'clinical-staff-'||gen_random_uuid()||'@example.org',now()
union all select current_setting('clinical_test.pending')::uuid,'clinical-pending-'||gen_random_uuid()||'@example.org',now();
insert into public.profiles(id,full_name,role,is_active) values
 (current_setting('clinical_test.owner')::uuid,'Clinical test owner','owner',true),
 (current_setting('clinical_test.staff')::uuid,'Clinical test staff','clinical_staff',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('clinical_test.owner'),'role','authenticated')::text,true);

create function pg_temp.reject(action text,data jsonb,pattern text) returns void language plpgsql as $$
begin
  begin
    perform public.portal_mutation(action,data,gen_random_uuid());
  exception when others then
    if sqlerrm like pattern then return; end if;
    raise;
  end;
  raise exception 'TEST: action % unexpectedly accepted',action;
end $$;
grant execute on function pg_temp.reject(text,jsonb,text) to authenticated;
set local role authenticated;
do $$
#variable_conflict use_variable
declare
  actor uuid:=current_setting('clinical_test.owner')::uuid;
  owner_id uuid; pet uuid; vaccine_item uuid; vaccine_id uuid; visit_id uuid; queue uuid; service uuid; booking uuid;
  data jsonb; pet_data jsonb; clinical jsonb; result jsonb; replay uuid; document jsonb; rejected boolean;
  today date:=(now() at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date;
  before_stock integer;
begin
  owner_id:=(public.portal_mutation('create_owner',jsonb_build_object('fullName','Clinical fixture owner','phone','09171234567','address','Test'),gen_random_uuid())->>'id')::uuid;
  pet_data:=jsonb_build_object('ownerId',owner_id,'name','Clinical fixture pet','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Intact','diet','Dry food twice daily','birthMode','age','ageYears','2','ageMonths','3');
  perform pg_temp.reject('create_pet',pet_data||'{"sex":"Unknown"}', 'VALIDATION_FAILED%');
  perform pg_temp.reject('create_pet',pet_data||'{"sex":""}', 'VALIDATION_FAILED%');
  perform pg_temp.reject('create_pet',pet_data||'{"ageMonths":"12"}', 'VALIDATION_FAILED%');
  perform pg_temp.reject('create_pet',pet_data||'{"ageYears":"1.5"}', 'VALIDATION_FAILED%');
  pet:=(public.portal_mutation('create_pet',pet_data,gen_random_uuid())->>'id')::uuid;
  if not exists(select 1 from public.pets where id=pet and birth_date=(today-interval '2 years 3 months')::date and birth_date_estimated and diet='Dry food twice daily') then raise exception 'TEST: age/diet save'; end if;
  pet_data:=pet_data-'birthMode'-'ageYears'-'ageMonths'||jsonb_build_object('id',pet,'status','Active','birthDate',(select birth_date from public.pets where id=pet));
  perform public.portal_mutation('update_pet',pet_data||'{"diet":"Wet food"}',gen_random_uuid());
  if not (select birth_date_estimated from public.pets where id=pet) then raise exception 'TEST: estimated flag lost'; end if;
  perform pg_temp.reject('update_pet',pet_data||jsonb_build_object('birthMode','date','birthDate',today+1), 'VALIDATION_FAILED%');
  perform public.portal_mutation('update_pet',pet_data||jsonb_build_object('birthMode','date','birthDate','2020-02-29'),gen_random_uuid());
  if (select birth_date_estimated from public.pets where id=pet) then raise exception 'TEST: exact birth date stayed estimated'; end if;
  -- Same clamp used by the age preview, independent of the fixture's execution date.
  if (date '2024-03-31'-make_interval(months=>1))::date<>date '2024-02-29' or (date '2024-02-29'-make_interval(years=>1))::date<>date '2023-02-28' then raise exception 'TEST: calendar clamp'; end if;

  clinical:=jsonb_build_object('petId',pet,'veterinarianId',actor,'type','Surgery','complaint','Procedure care','weightKg','5','bodyConditionScore','5','bodyConditionMode','replace');
  perform pg_temp.reject('create_encounter',clinical||'{"bodyConditionScore":"6"}', 'VALIDATION_FAILED%');
  perform pg_temp.reject('create_encounter',clinical||'{"bodyConditionScore":"0"}', 'VALIDATION_FAILED%');
  visit_id:=(public.portal_mutation('create_encounter',clinical,gen_random_uuid())->>'id')::uuid;
  if not exists(select 1 from public.visit_vitals v where v.visit_id=visit_id and body_condition_score=5 and body_condition_scale=5) then raise exception 'TEST: new score scale'; end if;
  perform public.portal_mutation('update_encounter',clinical||jsonb_build_object('id',visit_id,'bodyConditionScore','1'),gen_random_uuid());
  if not exists(select 1 from public.visit_vitals v where v.visit_id=visit_id and body_condition_score=1 and body_condition_scale=5) then raise exception 'TEST: score edit'; end if;

  data:=jsonb_build_object('name','Fixture vaccine','brand','Fixture Brand','category','Vaccines','unit','dose','minimumStock','0');
  perform pg_temp.reject('create_inventory_item',data||'{"brand":""}', 'VALIDATION_FAILED%');
  vaccine_item:=(public.portal_mutation('create_inventory_item',data,gen_random_uuid())->>'id')::uuid;
  select count(*) into before_stock from public.inventory_movements;
  clinical:=jsonb_build_object('petId',pet,'veterinarianId',actor,'inventoryItemId',vaccine_item,'vaccine','Forged name','brand','Forged brand','administeredAt',today,'nextDueAt',today+10);
  replay:=gen_random_uuid(); result:=public.portal_mutation('create_queued_vaccination',clinical,replay);
  vaccine_id:=(result->>'id')::uuid; queue:=(result->>'queueEntryId')::uuid;
  if public.portal_mutation('create_queued_vaccination',clinical,replay)<>result then raise exception 'TEST: vaccine retry'; end if;
  if not exists(select 1 from public.vaccinations where id=vaccine_id and vaccine_name='Fixture vaccine' and brand='Fixture Brand' and inventory_item_id=vaccine_item and lot_number is null) then raise exception 'TEST: authoritative vaccine snapshots'; end if;
  if (select status from public.queue_entries where id=queue)<>'waiting' then raise exception 'TEST: vaccine care status'; end if;
  perform public.portal_mutation('update_inventory_item',data||jsonb_build_object('id',vaccine_item,'name','Renamed vaccine','brand','New Brand','isActive','false'),gen_random_uuid());
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',actor),gen_random_uuid());
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'draftVersion',0,'record',jsonb_build_object('inventoryItemId',vaccine_item::text,'dose','Partial dose')),gen_random_uuid());
  perform pg_temp.reject('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',0,'record',clinical),'DRAFT_CONFLICT%');
  perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',queue,'draftVersion',1,'record',clinical||jsonb_build_object('dose','Saved dose')),gen_random_uuid());
  if (select brand from public.vaccinations where id=vaccine_id)<>'Fixture Brand' or (select vaccine_name from public.vaccinations where id=vaccine_id)<>'Fixture vaccine' then raise exception 'TEST: snapshot changed after inventory edit'; end if;
  if (select count(*) from public.vaccinations where pet_id=pet)<>1 or (select count(*) from public.reminders where vaccination_id=vaccine_id)<>1 then raise exception 'TEST: duplicate clinical record/reminder'; end if;
  if (select count(*) from public.inventory_movements)<>before_stock then raise exception 'TEST: selecting vaccine changed stock'; end if;
  perform pg_temp.reject('create_vaccination',clinical,'VALIDATION_FAILED%');
  perform pg_temp.reject('create_vaccination',clinical||jsonb_build_object('inventoryItemId',''),'VALIDATION_FAILED%');
  perform public.portal_mutation('delete_record',jsonb_build_object('entity','inventory_item','id',vaccine_item,'reason','Rollback history preservation check'),gen_random_uuid());
  if not exists(select 1 from public.vaccinations where id=vaccine_id and inventory_item_id is null and brand='Fixture Brand' and vaccine_name='Fixture vaccine') then raise exception 'TEST: deleting inventory erased historical snapshots'; end if;
  if (select count(*) from public.reminders where vaccination_id=vaccine_id)<>1 then raise exception 'TEST: clearing inventory link duplicated reminder'; end if;

  service:=(public.portal_mutation('create_service',jsonb_build_object('name','Fixture maintenance','duration','60','workflow','maintenance'),gen_random_uuid())->>'id')::uuid;
  queue:=(public.portal_mutation('add_queue_entry',jsonb_build_object('petId',pet,'serviceId',service),gen_random_uuid())->>'id')::uuid;
  if (select category from public.queue_entries where id=queue)<>'maintenance' then raise exception 'TEST: service workflow'; end if;
  perform pg_temp.reject('start_queue_entry',jsonb_build_object('id',queue),'VALIDATION_FAILED%');
  perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',queue,'veterinarianId',actor),gen_random_uuid());
  clinical:=jsonb_build_object('petId',pet,'veterinarianId',actor,'serviceNotes','');
  perform pg_temp.reject('complete_queue_entry',jsonb_build_object('id',queue,'record',clinical),'VALIDATION_FAILED%');
  if (select status from public.queue_entries where id=queue)<>'in_progress' then raise exception 'TEST: failed maintenance completion changed status'; end if;
  perform public.portal_mutation('save_queue_draft',jsonb_build_object('id',queue,'record','{"serviceNotes":"Bath and trim"}'::jsonb),gen_random_uuid());
  replay:=gen_random_uuid(); data:=jsonb_build_object('id',queue,'draftVersion',1,'record',clinical||'{"serviceNotes":"Bath and trim"}');
  result:=public.portal_mutation('complete_queue_entry',data,replay);
  if public.portal_mutation('complete_queue_entry',data,replay)<>result then raise exception 'TEST: maintenance retry'; end if;
  if not exists(select 1 from public.queue_entries where id=queue and status='completed' and service_notes='Bath and trim' and care_draft='{}'::jsonb) then raise exception 'TEST: maintenance save'; end if;
  perform pg_temp.reject('update_service',jsonb_build_object('id',service,'name','Fixture maintenance','duration','60','workflow','checkup'),'VALIDATION_FAILED%');
  perform public.portal_mutation('update_service',jsonb_build_object('id',service,'name','Renamed maintenance','duration','45','workflow','maintenance','isActive','false'),gen_random_uuid());
  if (select service_name from public.queue_entries where id=queue)<>'Fixture maintenance' then raise exception 'TEST: service snapshot changed'; end if;
  perform pg_temp.reject('add_queue_entry',jsonb_build_object('petId',pet,'serviceId',service),'VALIDATION_FAILED%');
  document:=public.filtered_export_report('history',pet,'{}')->'rows'->0;
  if document->'patient'->>'diet' is null or jsonb_array_length(document->'maintenance')<>1 or document->'vaccinations'->0->>'brand'<>'Fixture Brand' then raise exception 'TEST: complete history extensions'; end if;
  perform set_config('clinical_test.pet',pet::text,true);
  perform set_config('clinical_test.visit',visit_id::text,true);
end $$;

-- Seed genuine historical data as administrator, then edit through staff RPCs.
reset role;
update public.visit_vitals set body_condition_scale=9,body_condition_score=7 where visit_id=current_setting('clinical_test.visit')::uuid;
insert into public.vaccinations(pet_id,vaccine_name,lot_number,administered_at,administered_by)
values(current_setting('clinical_test.pet')::uuid,'Legacy vaccine','LEGACY-LOT',current_date,current_setting('clinical_test.owner')::uuid);
set local role authenticated;
do $$
declare data jsonb; v public.vaccinations; q uuid; a uuid; result jsonb;
begin
 data:=jsonb_build_object('id',current_setting('clinical_test.visit'),'type','Surgery','complaint','Unrelated edit','weightKg','5','veterinarianId',current_setting('clinical_test.owner'));
 perform public.portal_mutation('update_encounter',data,gen_random_uuid());
 if not exists(select 1 from public.visit_vitals where visit_id=current_setting('clinical_test.visit')::uuid and body_condition_score=7 and body_condition_scale=9) then raise exception 'TEST: old score silently relabeled'; end if;
 perform public.portal_mutation('update_encounter',data||'{"bodyConditionMode":"replace","bodyConditionScore":"3"}',gen_random_uuid());
 if not exists(select 1 from public.visit_vitals where visit_id=current_setting('clinical_test.visit')::uuid and body_condition_score=3 and body_condition_scale=5) then raise exception 'TEST: old score replacement'; end if;
 select * into v from public.vaccinations where pet_id=current_setting('clinical_test.pet')::uuid and vaccine_name='Legacy vaccine';
 perform public.portal_mutation('update_vaccination',jsonb_build_object('id',v.id,'administeredAt',v.administered_at,'veterinarianId',v.administered_by,'dose','Updated historical dose'),gen_random_uuid());
 if not exists(select 1 from public.vaccinations where id=v.id and lot_number='LEGACY-LOT' and brand is null and vaccine_name='Legacy vaccine') then raise exception 'TEST: legacy vaccine lost'; end if;
 -- New service workflow applies to appointment check-in and calendar completion.
 a:=(public.portal_mutation('book_appointment',jsonb_build_object('petId',current_setting('clinical_test.pet'),'service','Grooming','date',to_char((clock_timestamp() at time zone 'Asia/Manila')+interval '2 minutes','YYYY-MM-DD'),'time',to_char((clock_timestamp() at time zone 'Asia/Manila')+interval '2 minutes','HH24:MI'),'veterinarianId',current_setting('clinical_test.owner')),gen_random_uuid())->>'id')::uuid;
 result:=public.portal_mutation('check_in_appointment',jsonb_build_object('appointmentId',a),gen_random_uuid()); q:=(result->>'id')::uuid;
 perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',q,'veterinarianId',current_setting('clinical_test.owner')),gen_random_uuid());
 perform pg_temp.reject('transition_appointment',jsonb_build_object('id',a,'status','completed'),'CARE_RECORD_REQUIRED%');
 perform public.portal_mutation('complete_queue_entry',jsonb_build_object('id',q,'record',jsonb_build_object('petId',current_setting('clinical_test.pet'),'veterinarianId',current_setting('clinical_test.owner'),'serviceNotes','Groomed')),gen_random_uuid());
 if (select status from public.appointments where id=a)<>'completed' then raise exception 'TEST: maintenance appointment synchronization'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('clinical_test.staff'),'role','authenticated')::text,true);
 perform pg_temp.reject('create_service','{"name":"Forbidden","duration":"30","workflow":"checkup"}','FORBIDDEN%');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('clinical_test.pending'),'role','authenticated')::text,true);
 if exists(select 1 from public.queue_entries) then raise exception 'TEST: unapproved account can read queue'; end if;
 perform pg_temp.reject('add_queue_entry',jsonb_build_object('petId',current_setting('clinical_test.pet'),'category','checkup'),'FORBIDDEN%');
end $$;
reset role;
select 'PASS: age/sex/diet, legacy and new scores, inventory snapshots, stock, service permissions, maintenance drafts/completion and calendar synchronization' as result;
rollback;
