begin;
-- Seed pre-migration vaccine evidence without retroactive stock tracking.
alter table public.vaccinations alter column stock_tracked set default false;
select set_config('travel.staff',gen_random_uuid()::text,true),set_config('travel.owner',gen_random_uuid()::text,true),set_config('travel.foreign',gen_random_uuid()::text,true);
select set_config('travel.inactive',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
  (current_setting('travel.staff')::uuid,'travel-staff-'||gen_random_uuid()||'@veterina-test.invalid',now()),
  (current_setting('travel.owner')::uuid,'travel-owner-'||gen_random_uuid()||'@veterina-test.invalid',now()),
  (current_setting('travel.foreign')::uuid,'travel-foreign-'||gen_random_uuid()||'@veterina-test.invalid',now()),
  (current_setting('travel.inactive')::uuid,'travel-inactive-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('travel.staff')::uuid,'Travel clinician','clinical_staff',true),
  (current_setting('travel.owner')::uuid,'Travel owner','owner',true),
  (current_setting('travel.inactive')::uuid,'Inactive issuer','clinical_staff',false);
update public.profiles set tin_number='736-954-286',is_veterinarian=true,license_expires_on='2027-01-01' where id=current_setting('travel.staff')::uuid;
select set_config('travel.clinic',(select clinic_id::text from public.profiles where id=current_setting('travel.staff')::uuid),true);
select set_config('travel.foreign_clinic',public.provision_vetshop(current_setting('travel.foreign')::uuid,'Travel foreign clinic','Foreign issuer')::text,true);
insert into private.clinic_subscriptions(clinic_id,expires_at) values(current_setting('travel.foreign_clinic')::uuid,now()+interval '30 days');
create function pg_temp.reject_travel(query text,pattern text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if; end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare person uuid; patient uuid; result jsonb; payload jsonb; vaccine uuid; other_pet uuid; before_queue integer; before_reminders integer; begin
  person:=(public.portal_mutation('create_owner','{"fullName":"José & Ana","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Ming','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown','birthDate','2020-01-01','color','Tri-Color','latestWeight','7.5','microchip','900123456789012'),gen_random_uuid())->>'id')::uuid;
  other_pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Other pet','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  perform set_config('travel.pet',patient::text,true); perform set_config('travel.other_pet',other_pet::text,true); perform set_config('travel.person',person::text,true);
end $$;
reset role;
do $$ declare day date; vaccine uuid; other_vaccine uuid; begin
  select (now() at time zone timezone)::date into day from public.clinic_settings where clinic_id=current_setting('travel.clinic')::uuid;
  insert into public.vaccinations(pet_id,vaccine_name,brand,lot_number,dose,administered_at,next_due_at,administered_by)
    values(current_setting('travel.pet')::uuid,'Bakuna','Saved brand','LOT-TRAVEL','1 ml',day-30,day+365,current_setting('travel.staff')::uuid) returning id into vaccine;
  insert into public.vaccinations(pet_id,vaccine_name,brand,lot_number,dose,administered_at,next_due_at,administered_by)
    values(current_setting('travel.other_pet')::uuid,'Rabies','Other brand','OTHER','1 ml',day-30,day+365,current_setting('travel.staff')::uuid) returning id into other_vaccine;
  perform set_config('travel.vaccine',vaccine::text,true); perform set_config('travel.other_vaccine',other_vaccine::text,true);
  perform set_config('travel.day',day::text,true);
end $$;
-- Prepared photos are service-only and must match the current photo revision.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.pets set has_photo=true,photo_revision=1 where id=current_setting('travel.pet')::uuid;
insert into private.pet_photos(pet_id,public_id,asset_id,version,format,bytes,request_id)
  values(current_setting('travel.pet')::uuid,'veterina/pet-photos/travel-test','travel-asset',1,'png',68,gen_random_uuid());
set local role service_role;
select pg_temp.reject_travel(format('select public.pet_photo_admin(%L::uuid,%L::jsonb)',current_setting('travel.staff'),jsonb_build_object('action','certificate','petId',current_setting('travel.pet'),'expectedRevision',0,'photoDataUrl','data:image/png;base64,iVBORw0KGgo=')),'PHOTO_CONFLICT');
select public.pet_photo_admin(current_setting('travel.staff')::uuid,jsonb_build_object('action','certificate','petId',current_setting('travel.pet'),'expectedRevision',1,'photoDataUrl','data:image/png;base64,iVBORw0KGgo='));
select pg_temp.reject_travel(format('select public.pet_photo_admin(%L::uuid,%L::jsonb)',current_setting('travel.foreign'),jsonb_build_object('action','certificate','petId',current_setting('travel.pet'),'expectedRevision',1,'photoDataUrl','data:image/png;base64,iVBORw0KGgo=')),'NOT_FOUND');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb; result jsonb; key uuid:=gen_random_uuid(); before_queue integer; before_reminders integer; begin
  payload:=jsonb_build_object('petId',current_setting('travel.pet'),'issuerId',current_setting('travel.staff'),'rabiesVaccinationId',current_setting('travel.vaccine'),
    'travelDate',current_setting('travel.day')::date+365,'destination','Cebu <Port>','controlNumber','00443','validUntil',current_setting('travel.day')::date+365,'vaccineExpirationDate',current_setting('travel.day')::date+120,'veterinarianTin','IGNORED-CERTIFICATE-OVERRIDE','rabiesConfirmed',true,'eligibilityConfirmed',true);
  perform set_config('travel.payload',payload::text,true);
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"isPublic":"true"}'),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"patientPhotoRevision":0}'),'PHOTO_CONFLICT');
  payload:=payload||'{"patientPhotoRevision":1,"photoDataUrl":"data:image/png;base64,RkFLRQ=="}';
  select count(*) into before_queue from public.queue_entries; select count(*) into before_reminders from public.reminders;
  result:=public.portal_mutation('issue_travel_certificate',payload,key);
  if public.portal_mutation('issue_travel_certificate',payload,key)<>result then raise exception 'TEST: issue retry changed'; end if;
  perform set_config('travel.certificate',result->>'id',true);
  perform set_config('travel.token',(select public_token from public.travel_certificates where id=(result->>'id')::uuid),true);
  if (select is_public from public.travel_certificates where id=(result->>'id')::uuid) or current_setting('travel.token') !~ '^[a-f0-9]{64}$' then raise exception 'TEST: certificates must default private with random QR tokens'; end if;
  if not exists(select 1 from public.travel_certificates where id=(result->>'id')::uuid and reference_number like 'TC-%-000001' and status='issued'
    and snapshot#>>'{pet,name}'='Ming' and snapshot#>>'{owner,name}'='José & Ana' and snapshot#>>'{journey,destination}'='Cebu <Port>'
    and control_number='00443' and snapshot->>'controlNumber'='00443' and search_text like '00443 %' and snapshot->>'version'='4'
    and snapshot->>'issuedTime'=to_char(now() at time zone 'Asia/Manila','HH24:MI')
    and snapshot->>'validUntil'=(current_setting('travel.day')::date+365)::text
    and snapshot#>>'{owner,address}'='Test' and snapshot#>>'{owner,contactNumber}'='09171234567'
    and snapshot#>>'{pet,color}'='Tri-Color' and snapshot#>>'{pet,sex}'='Female' and (snapshot#>>'{pet,weightKg}')::numeric=7.5
    and snapshot#>>'{pet,microchipNumber}'='900123456789012' and snapshot#>>'{pet,birthDate}'='2020-01-01'
    and snapshot#>>'{issuer,tinNumber}'='736-954-286' and snapshot#>>'{issuer,licenseExpiresOn}'='2027-01-01' and snapshot#>>'{vaccinations,0,expirationDate}'=(current_setting('travel.day')::date+120)::text
    and snapshot#>>'{vaccinations,0,type}'='Anti-Rabies' and snapshot#>>'{vaccinations,0,vaccinated}'='true'
    and snapshot#>>'{vaccinations,0,brand}'='Saved brand' and snapshot#>>'{pet,photoDataUrl}'='data:image/png;base64,iVBORw0KGgo=' and recorded_by=auth.uid()) then raise exception 'TEST: certificate snapshot lost'; end if;
  if (select count(*) from public.travel_certificates)<>1 then raise exception 'TEST: retry duplicated certificate'; end if;
  -- New fields are enforced by the server; malformed attempts neither issue nor consume a reference.
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload-'controlNumber'),'VALIDATION_FAILED: enter a control number');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"controlNumber":443}'),'VALIDATION_FAILED: enter a control number');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"controlNumber":"   "}'),'VALIDATION_FAILED: enter a control number');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload-'validUntil'),'VALIDATION_FAILED: certificate valid-until');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('validUntil',current_setting('travel.day')::date+364)),'VALIDATION_FAILED: certificate validity must cover');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('validUntil',current_setting('travel.day')::date+366)),'VALIDATION_FAILED: certificate validity cannot exceed');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"validUntil":"2026-02-30"}'),'VALIDATION_FAILED: enter valid');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('vaccineExpirationDate',current_setting('travel.day')::date-31)),'VALIDATION_FAILED: vaccine product expiration cannot precede');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload),'VALIDATION_FAILED: control number already exists');

  if (select count(*) from public.queue_entries)<>before_queue or (select count(*) from public.reminders)<>before_reminders then raise exception 'TEST: issuing changed clinical workflows'; end if;
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"rabiesConfirmed":false}'),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||'{"eligibilityConfirmed":false}'),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('travelDate',current_setting('travel.day')::date-1)),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('travelDate',current_setting('travel.day')::date+366)),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('rabiesVaccinationId',current_setting('travel.other_vaccine'))),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('issuerId',current_setting('travel.foreign'))),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''void_travel_certificate'',%L::jsonb,gen_random_uuid())',jsonb_build_object('id',result->>'id','reason','Staff cannot void')),'FORBIDDEN');
  if has_table_privilege('authenticated','public.travel_certificates','INSERT') or has_table_privilege('authenticated','public.travel_certificates','UPDATE') or has_table_privilege('authenticated','private.travel_certificate_counters','SELECT') or has_function_privilege('authenticated','private.travel_certificate_mutation(text,jsonb)','EXECUTE') then raise exception 'TEST: direct certificate writes exposed'; end if;
  if has_table_privilege('authenticated','private.travel_certificate_photos','SELECT') or has_table_privilege('authenticated','private.travel_certificate_photos','INSERT') then raise exception 'TEST: prepared patient photos exposed'; end if;
end $$;
-- Certificate owner overrides are validated and stored without touching the clinic owner.
-- Roll this successful extra issue back locally so reference-boundary checks remain exact.
do $$ declare payload jsonb:=current_setting('travel.payload')::jsonb||'{"controlNumber":"OWNER-EDIT"}';
  details jsonb:=jsonb_build_object('name',U&'Ma. Ni\00F1a <Abes>','address',E'Purok 2\nBarangay San Jose','contactNumber','+63 926 121 3497');
  invalid jsonb; result jsonb; key uuid:=gen_random_uuid(); before_owner jsonb; begin
  foreach invalid in array array['null'::jsonb,'[]'::jsonb,'123'::jsonb,'{}'::jsonb,
    details||'{"name":""}',details||'{"address":"  "}',details||'{"contactNumber":null}',details||'{"name":123}',
    details||jsonb_build_object('name',repeat('x',121)),details||jsonb_build_object('address',repeat('x',2001)),
    details||jsonb_build_object('contactNumber',repeat('x',65)),details||jsonb_build_object('contactNumber',E'09\t123'),
    details||jsonb_build_object('address',E'\n\r  ')] loop
    perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,%L::uuid)',payload||jsonb_build_object('ownerDetails',invalid),key),'VALIDATION_FAILED: enter');
  end loop;
  select to_jsonb(o) into before_owner from public.owners o where id=current_setting('travel.person')::uuid;
  begin
    payload:=payload||jsonb_build_object('ownerDetails',details||'{"id":"ignored","extra":"not copied"}');
    result:=public.portal_mutation('issue_travel_certificate',payload,key);
    if public.portal_mutation('issue_travel_certificate',payload,key)<>result then raise exception 'TEST: owner edit retry changed document'; end if;
    if not exists(select 1 from public.travel_certificates where id=(result->>'id')::uuid
      and snapshot->'owner'=details and owner_name=details->>'name' and position(details->>'name' in search_text)>0
      and pet_id=current_setting('travel.pet')::uuid and snapshot->>'version'='4') then raise exception 'TEST: certificate owner override lost'; end if;
    if (select to_jsonb(o) from public.owners o where id=current_setting('travel.person')::uuid)<>before_owner then raise exception 'TEST: certificate changed clinic owner'; end if;
    raise exception using errcode='ZX001',message='Rollback extra owner test certificate';
  exception when sqlstate 'ZX001' then null; end;
end $$;
reset role;
update public.profiles set license_expires_on=current_setting('travel.day')::date-1 where id=current_setting('travel.staff')::uuid;
set local role authenticated;
-- Expiry is recorded evidence and a warning, not an issuance gate.
do $$ declare result jsonb; begin
  begin
    result:=public.portal_mutation('issue_travel_certificate',current_setting('travel.payload')::jsonb||'{"controlNumber":"EXPIRED-LICENSE"}',gen_random_uuid());
    if not exists(select 1 from public.travel_certificates where id=(result->>'id')::uuid and snapshot#>>'{issuer,licenseExpiresOn}'=(current_setting('travel.day')::date-1)::text) then raise exception 'TEST: expired license snapshot lost'; end if;
    raise exception using errcode='ZX002',message='Rollback warning-only test certificate';
  exception when sqlstate 'ZX002' then null; end;
end $$;
reset role;
update public.profiles set license_expires_on='2027-01-01' where id=current_setting('travel.staff')::uuid;
set local role authenticated;
reset role;
set local role service_role;
do $$ begin
  if public.read_public_travel_certificate(current_setting('travel.token')) is not null then raise exception 'TEST: private certificate exposed'; end if;
end $$;
reset role;
set local role authenticated;
do $$ declare payload jsonb:=jsonb_build_object('id',current_setting('travel.certificate'),'isPublic',true); key uuid:=gen_random_uuid(); result jsonb; before_snapshot jsonb; begin
  select snapshot into before_snapshot from public.travel_certificates where id=current_setting('travel.certificate')::uuid;
  result:=public.portal_mutation('set_travel_certificate_visibility',payload,key);
  if public.portal_mutation('set_travel_certificate_visibility',payload,key)<>result then raise exception 'TEST: public visibility retry changed'; end if;
  if (select snapshot from public.travel_certificates where id=current_setting('travel.certificate')::uuid)<>before_snapshot then raise exception 'TEST: sharing changed issued content'; end if;
  perform pg_temp.reject_travel(format('select public.portal_mutation(''set_travel_certificate_visibility'',%L::jsonb,gen_random_uuid())',payload||'{"isPublic":"true"}'),'VALIDATION_FAILED');
  perform pg_temp.reject_travel(format('select public.read_public_travel_certificate(%L)',current_setting('travel.token')),'permission denied');
end $$;
reset role;
set local role service_role;
do $$ declare document jsonb:=public.read_public_travel_certificate(current_setting('travel.token')); begin
  if document#>>'{snapshot,pet,name}' is distinct from 'Ming' or document->>'reference_number' not like 'TC-%-000001' or document ? 'recorded_by' then raise exception 'TEST: public document mismatch'; end if;
  if public.read_public_travel_certificate('TC-2026-000001') is not null or public.read_public_travel_certificate(repeat('f',64)) is not null then raise exception 'TEST: invalid token accepted'; end if;
end $$;
reset role;
set local role authenticated;
select public.portal_mutation('set_travel_certificate_visibility',jsonb_build_object('id',current_setting('travel.certificate'),'isPublic',false),gen_random_uuid());
reset role;
set local role service_role;
do $$ begin
  if public.read_public_travel_certificate(current_setting('travel.token')) is not null then raise exception 'TEST: private transition did not revoke the public QR'; end if;
end $$;
reset role;
set local role authenticated;
select public.portal_mutation('set_travel_certificate_visibility',jsonb_build_object('id',current_setting('travel.certificate'),'isPublic',true),gen_random_uuid());
reset role;
delete from private.travel_certificate_photos where pet_id=current_setting('travel.pet')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')::jsonb||'{"patientPhotoRevision":1}'),'VALIDATION_FAILED');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.pet_photo_admin(current_setting('travel.staff')::uuid,jsonb_build_object('action','certificate','petId',current_setting('travel.pet'),'expectedRevision',1,'photoDataUrl','data:image/png;base64,iVBORw0KGgo='));
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.staff'),'role','authenticated')::text,true);
update public.owners set is_active=false where id=current_setting('travel.person')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.owners set is_active=true where id=current_setting('travel.person')::uuid;
update public.pets set status='Inactive' where id=current_setting('travel.pet')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.pets set status='Active' where id=current_setting('travel.pet')::uuid;
-- Designation is enforced independently of permissions and already issued documents.
update public.profiles set is_veterinarian=false where id=current_setting('travel.staff')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED: select an active, designated veterinarian');
reset role;
update public.profiles set is_veterinarian=true where id=current_setting('travel.staff')::uuid;
-- Recheck eligibility from saved records; the issued snapshot never changes.
update public.vaccinations set next_due_at=null where id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.vaccinations set next_due_at=current_setting('travel.day')::date-1 where id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.vaccinations set next_due_at=current_setting('travel.day')::date where id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.portal_mutation('issue_travel_certificate',current_setting('travel.payload')::jsonb||jsonb_build_object('travelDate',current_setting('travel.day'),'validUntil',current_setting('travel.day'),'controlNumber','00444','isPublic',true),gen_random_uuid());
  if result->>'referenceNumber' not like '%-000002' then raise exception 'TEST: failed issues consumed reference numbers'; end if;
  if not (select is_public from public.travel_certificates where id=(result->>'id')::uuid) then raise exception 'TEST: public choice during issuance lost'; end if;
end $$;
reset role;
update public.preventive_care_records set administered_at=current_setting('travel.day')::date+1 where id=current_setting('travel.vaccine')::uuid;
update public.vaccinations set administered_at=current_setting('travel.day')::date+1,next_due_at=current_setting('travel.day')::date+365 where id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.preventive_care_records set administered_at=current_setting('travel.day')::date-30 where id=current_setting('travel.vaccine')::uuid;
update public.vaccinations set administered_at=current_setting('travel.day')::date-30 where id=current_setting('travel.vaccine')::uuid;
insert into public.queue_entries(pet_id,category,service_name,source,veterinarian_id,notes,created_by,vaccination_id,status)
  values(current_setting('travel.pet')::uuid,'vaccination','Vaccine','patient_record',current_setting('travel.staff')::uuid,'',current_setting('travel.staff')::uuid,current_setting('travel.vaccine')::uuid,'waiting');
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.queue_entries set preventive_record_id=current_setting('travel.vaccine')::uuid where vaccination_id=current_setting('travel.vaccine')::uuid;
-- A second vaccine in this pending group cannot become certificate evidence.
insert into public.vaccinations(pet_id,preventive_record_id,vaccine_name,brand,lot_number,dose,administered_at,next_due_at,administered_by,stock_tracked)
select pet_id,preventive_record_id,'Second Anti-Rabies',brand,lot_number,dose,administered_at,next_due_at,administered_by,false from public.vaccinations where id=current_setting('travel.vaccine')::uuid;
select set_config('travel.secondary',(select id::text from public.vaccinations where vaccine_name='Second Anti-Rabies'),true);
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')::jsonb||jsonb_build_object('rabiesVaccinationId',current_setting('travel.secondary'))),'VALIDATION_FAILED');
reset role;
update public.queue_entries set status='in_progress' where vaccination_id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.queue_entries set status='cancelled' where vaccination_id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'VALIDATION_FAILED');
reset role;
update public.queue_entries set status='completed' where vaccination_id=current_setting('travel.vaccine')::uuid;
set local role authenticated;
select pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')::jsonb||jsonb_build_object('issuerId',current_setting('travel.inactive'))),'VALIDATION_FAILED');
reset role;
-- Immutable content and source links cannot be changed, even by the RPC role.
set local role veterina_rpc;
select pg_temp.reject_travel(format('update public.travel_certificates set control_number=''00445'' where id=%L::uuid',current_setting('travel.certificate')),'IMMUTABLE_CERTIFICATE');
select pg_temp.reject_travel(format('update public.travel_certificates set valid_until=issued_on where id=%L::uuid',current_setting('travel.certificate')),'IMMUTABLE_CERTIFICATE');
select pg_temp.reject_travel(format('update public.travel_certificates set destination=''Changed'' where id=%L::uuid',current_setting('travel.certificate')),'IMMUTABLE_CERTIFICATE');
select pg_temp.reject_travel(format('update public.travel_certificates set pet_id=null where id=%L::uuid',current_setting('travel.certificate')),'IMMUTABLE_CERTIFICATE');
select pg_temp.reject_travel(format('update public.travel_certificates set public_token=%L where id=%L::uuid',repeat('a',64),current_setting('travel.certificate')),'IMMUTABLE_CERTIFICATE');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare result jsonb; key uuid:=gen_random_uuid(); payload jsonb:=jsonb_build_object('id',current_setting('travel.certificate'),'reason','Incorrect destination'); begin
  result:=public.portal_mutation('void_travel_certificate',payload,key);
  if public.portal_mutation('void_travel_certificate',payload,key)<>result then raise exception 'TEST: void retry changed'; end if;
  if not exists(select 1 from public.travel_certificates where id=(result->>'id')::uuid and status='void' and void_reason='Incorrect destination' and snapshot#>>'{journey,destination}'='Cebu <Port>') then raise exception 'TEST: void destroyed snapshot'; end if;
end $$;
reset role;
-- Source deletion clears only the source FK; snapshots and references survive.
delete from public.queue_entries where vaccination_id=current_setting('travel.vaccine')::uuid;
delete from public.reminders where vaccination_id=current_setting('travel.vaccine')::uuid;
delete from public.preventive_care_records where id=current_setting('travel.vaccine')::uuid;
delete from public.pets where id=current_setting('travel.pet')::uuid;
do $$ begin
  if not exists(select 1 from public.travel_certificates where id=current_setting('travel.certificate')::uuid and pet_id is null and rabies_vaccination_id is null and snapshot#>>'{pet,name}'='Ming' and snapshot#>>'{pet,photoDataUrl}'='data:image/png;base64,iVBORw0KGgo=') then raise exception 'TEST: deleting source changed issued record'; end if;
end $$;
set local role service_role;
do $$ declare document jsonb:=public.read_public_travel_certificate(current_setting('travel.token')); begin
  if document->>'status' is distinct from 'void' or document#>>'{snapshot,pet,photoDataUrl}' is distinct from 'data:image/png;base64,iVBORw0KGgo=' then raise exception 'TEST: shared void/source-deleted snapshot lost'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.foreign'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.travel_certificates) then raise exception 'TEST: other clinic certificates visible'; end if;
  perform pg_temp.reject_travel(format('select public.portal_mutation(''void_travel_certificate'',%L::jsonb,gen_random_uuid())',jsonb_build_object('id',current_setting('travel.certificate'),'reason','Foreign clinic')),'NOT_FOUND');
  perform pg_temp.reject_travel(format('select public.portal_mutation(''set_travel_certificate_visibility'',%L::jsonb,gen_random_uuid())',jsonb_build_object('id',current_setting('travel.certificate'),'isPublic',false)),'NOT_FOUND');
end $$;
reset role;
update private.clinic_subscriptions set expires_at=now()-interval '1 day' where clinic_id=current_setting('travel.clinic')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('travel.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.travel_certificates) then raise exception 'TEST: expired clinic certificate access'; end if;
  perform pg_temp.reject_travel(format('select public.portal_mutation(''issue_travel_certificate'',%L::jsonb,gen_random_uuid())',current_setting('travel.payload')),'FORBIDDEN');
end $$;
reset role;
set local role service_role;
do $$ begin
  if public.read_public_travel_certificate(current_setting('travel.token')) is not null then raise exception 'TEST: expired clinic public access'; end if;
end $$;
reset role;
set local role anon;
select pg_temp.reject_travel('select public.portal_mutation(''issue_travel_certificate'',''{}'',gen_random_uuid())','permission denied');
select pg_temp.reject_travel(format('select public.read_public_travel_certificate(%L)',current_setting('travel.token')),'permission denied');
rollback;
