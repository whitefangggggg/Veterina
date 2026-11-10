begin;
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TEST: %',label; end if; end $$;
select set_config('tracking.actor',gen_random_uuid()::text,true);
select set_config('tracking.staff',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
 (current_setting('tracking.actor')::uuid,'tracking-owner-'||gen_random_uuid()||'@veterina-test.invalid',now()),
 (current_setting('tracking.staff')::uuid,'tracking-staff-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values
 (current_setting('tracking.actor')::uuid,'Tracking owner','owner',true,true),
 (current_setting('tracking.staff')::uuid,'Tracking staff','clinical_staff',true,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tracking.actor'),'role','authenticated')::text,true);
create function pg_temp.share(action text,p jsonb default '{}',k uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare admission_uuid uuid:=current_setting('tracking.admission')::uuid; begin
  return public.portal_mutation(action,jsonb_build_object('id',admission_uuid,'expectedVersion',coalesce((select version from public.admission_public_sharing where id=admission_uuid),0))||p,k);
end $$;
create function pg_temp.reject(action text,p jsonb,pattern text) returns void language plpgsql as $$
begin
  perform pg_temp.share(action,p); raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if; end $$;
set local role authenticated;
do $$ declare owner uuid; pet uuid; a uuid; result jsonb; payload jsonb; k uuid:=gen_random_uuid(); version integer; begin
  owner:=(public.portal_mutation('create_owner','{"fullName":"Private household","phone":"09171234567","address":"Private home"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Private patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  a:=(public.portal_mutation('admission_create',jsonb_build_object('petId',pet,'reason','PRIVATE MEDICAL REASON','condition','critical','admittedAt',now()-interval '10 days','veterinarianId',auth.uid()),gen_random_uuid())->>'id')::uuid;
  perform set_config('tracking.admission',a::text,true);
  perform pg_temp.reject('tracking_generate','{"acknowledgePublic":true}','VALIDATION_FAILED');
  perform pg_temp.share('tracking_configure','{"petDisplayName":"Mochi","clinicName":"Approved clinic","clinicContact":"Clinic desk: 123","showSpecies":false,"showAdmissionDetails":false}');
  perform pg_temp.reject('tracking_generate','{}','VALIDATION_FAILED');
  perform pg_temp.reject('tracking_generate','{"acknowledgePublic":true,"expectedVersion":0}','RECORD_CHANGED');
  select s.version into version from public.admission_public_sharing s where id=a;
  payload:=jsonb_build_object('id',a,'expectedVersion',version,'acknowledgePublic',true);
  result:=public.portal_mutation('tracking_generate',payload,k);
  perform pg_temp.check(result->>'token' ~ '^[A-Za-z0-9]{13}$','code format');
  perform pg_temp.check(public.portal_mutation('tracking_generate',payload,k)=result,'lost acknowledgment replay');
  begin
    perform public.portal_mutation('tracking_generate',payload||'{"acknowledgePublic":false}',k);
    raise exception 'TEST: changed retry accepted';
  exception when others then if sqlerrm not like 'VALIDATION_FAILED: retry payload changed%' then raise; end if; end;
  perform set_config('tracking.token',result->>'token',true);
  perform pg_temp.check((select token_hash<>result->>'token' and length(token_hash)=64 from public.admission_public_sharing where id=a),'hash storage');
  perform pg_temp.reject('tracking_publish','{"update":"Never public without approval"}','VALIDATION_FAILED');
  perform pg_temp.share('tracking_publish','{"update":"Resting comfortably <literal text>","acknowledgePublic":true}');
end $$;
reset role;
set local role service_role;
do $$ declare doc jsonb; key text; begin
  doc:=public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64));
  perform pg_temp.check(doc->>'petName'='Mochi' and doc->>'status'='admitted','public snapshot');
  perform pg_temp.check(doc->>'latestUpdate'='Resting comfortably <literal text>','published update');
  perform pg_temp.check(not(doc ? 'species' or doc ? 'admittedAt' or doc ? 'reason' or doc ? 'reference'),'optional fields default hidden');
  for key in select jsonb_object_keys(doc) loop
    perform pg_temp.check(key=any(array['clinicName','clinicContact','petName','status','timezone','updatedAt','latestUpdate','publishedAt']),'strict DTO: '||key);
  end loop;
  perform pg_temp.check(doc::text not like '%PRIVATE%' and doc::text not like '%critical%','medical details private');
  perform pg_temp.check(public.lookup_public_admission('bad',repeat('a',64)) is null,'malformed lookup');
  perform pg_temp.check(public.lookup_public_admission('0000000000000',repeat('a',64)) is null,'unknown credential');
end $$;
reset role;
-- Active clinical staff can approve, publish, unpublish, rotate and revoke.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tracking.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.share('tracking_configure','{"petDisplayName":"Mochi","clinicName":"Approved clinic","clinicContact":"Clinic desk","showSpecies":true,"showAdmissionDetails":true,"publicReason":"Observation stay"}');
select pg_temp.share('tracking_unpublish');
-- Store a rotated response without exposing its capability in test output.
do $$ declare r jsonb; begin
  r:=pg_temp.share('tracking_generate','{"acknowledgePublic":true}');
  perform pg_temp.check(r->>'token'<>current_setting('tracking.token'),'rotation changes code');
  perform set_config('tracking.rotated',r->>'token',true);
end $$;
reset role;
set local role service_role;
do $$ declare doc jsonb; begin
  perform pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'old QR revoked immediately');
  doc:=public.lookup_public_admission(current_setting('tracking.rotated'),repeat('a',64));
  perform pg_temp.check(doc->>'species'='Cat' and doc ? 'reference' and doc ? 'admittedAt' and doc->>'reason'='Observation stay','approved optional fields');
  perform pg_temp.check(doc->>'latestUpdate' is null and doc->>'publishedAt' is null,'unpublished update removed');
end $$;
reset role;
set local role authenticated;
select pg_temp.share('tracking_revoke');
reset role;
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.rotated'),repeat('a',64)) is null,'disabled code unavailable');
reset role;
set local role authenticated;
do $$ declare r jsonb; a uuid:=current_setting('tracking.admission')::uuid; begin
  r:=pg_temp.share('tracking_generate','{"acknowledgePublic":true}'); perform set_config('tracking.token',r->>'token',true);
  perform public.portal_mutation('admission_transition',jsonb_build_object('id',a,'expectedVersion',(select version from public.admissions where id=a),'status','ready_for_discharge'),gen_random_uuid());
  perform public.portal_mutation('admission_discharge',jsonb_build_object('id',a,'expectedVersion',(select version from public.admissions where id=a),'condition','stable','assessment','PRIVATE ASSESSMENT','instructions','PRIVATE DISCHARGE','acknowledgeFutureTasks',true),gen_random_uuid());
end $$;
reset role;
set local role service_role;
do $$ declare doc jsonb; begin
  doc:=public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64));
  perform pg_temp.check(doc->>'status'='discharged' and doc::text not like '%PRIVATE%','final status without private discharge summary');
end $$;
reset role;
update public.admissions set closed_at=now()-interval '8 days' where id=current_setting('tracking.admission')::uuid;
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'seven day discharge expiry');
reset role;
update public.admissions set closed_at=now() where id=current_setting('tracking.admission')::uuid;
update public.admission_public_sharing set expires_at=now()-interval '1 second' where id=current_setting('tracking.admission')::uuid;
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'absolute expiry');
reset role;
update public.admission_public_sharing set expires_at=now()+interval '1 day' where id=current_setting('tracking.admission')::uuid;
update public.admissions set status='cancelled' where id=current_setting('tracking.admission')::uuid;
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'cancelled stay unavailable');
reset role;
set local role authenticated;
select pg_temp.reject('tracking_generate','{"acknowledgePublic":true}','VALIDATION_FAILED');
reset role;
update public.admissions set status='discharged',is_historical=true where id=current_setting('tracking.admission')::uuid;
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'historical stay unavailable');
reset role;
update public.admissions set is_historical=false where id=current_setting('tracking.admission')::uuid;
update public.clinics set is_active=false where id=(select clinic_id from public.admissions where id=current_setting('tracking.admission')::uuid);
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'inactive clinic');
reset role;
update public.clinics set is_active=true;
update private.clinic_subscriptions set expires_at=now()-interval '1 second';
set local role service_role;
select pg_temp.check(public.lookup_public_admission(current_setting('tracking.token'),repeat('a',64)) is null,'expired subscription');
reset role;
update private.clinic_subscriptions set expires_at=now()+interval '1 day';
-- Browser personas cannot bypass the Edge endpoint or mutate sharing rows.
do $$ begin
  perform pg_temp.check(not has_function_privilege('anon','public.lookup_public_admission(text,text)','execute'),'no anonymous RPC');
  perform pg_temp.check(not has_function_privilege('authenticated','public.lookup_public_admission(text,text)','execute'),'no authenticated bypass');
  perform pg_temp.check(not has_function_privilege('authenticated','private.tracking_mutation(text,jsonb)','execute'),'no helper bypass');
  perform pg_temp.check(not has_table_privilege('anon','public.admission_public_sharing','select'),'no anonymous sharing rows');
  perform pg_temp.check(not has_table_privilege('authenticated','public.admission_public_sharing','update'),'no direct writes');
  perform pg_temp.check((select count(*)>=8 from public.audit_logs where table_name='admission_public_sharing' and record_id=current_setting('tracking.admission')),'audited sharing changes');
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tracking.actor'),'role','authenticated')::text,true);
update public.profiles set is_active=false where id=current_setting('tracking.staff')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tracking.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject('tracking_generate','{"acknowledgePublic":true}','FORBIDDEN');
reset role;
-- Another clinic cannot select or change this stay's sharing, even by known UUID.
do $$ declare shop uuid; actor uuid:=gen_random_uuid(); begin
  insert into public.clinics(name) values('Other tracking clinic') returning id into shop;
  insert into private.clinic_subscriptions(clinic_id,expires_at) values(shop,now()+interval '1 day');
  insert into auth.users(id,email,email_confirmed_at) values(actor,'tracking-other-'||actor||'@veterina-test.invalid',now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.profiles(id,clinic_id,full_name,role,is_active,is_veterinarian) values(actor,shop,'Other owner','owner',true,true);
end $$;
set local role authenticated;
select pg_temp.reject('tracking_generate','{"acknowledgePublic":true}','NOT_FOUND');
select pg_temp.check(not exists(select 1 from public.admission_public_sharing),'tenant isolation');
reset role;
-- Global and per-caller limits apply to successful and failed lookups alike.
delete from private.admission_tracking_limits;
set local role service_role;
do $$ declare i integer; r jsonb; begin
  for i in 1..30 loop perform public.lookup_public_admission('',repeat('b',64)); end loop;
  r:=public.lookup_public_admission(current_setting('tracking.token'),repeat('b',64));
  perform pg_temp.check(r='{"limited":true}','per-caller throttle');
  for i in 1..269 loop perform public.lookup_public_admission('',md5(i::text)||md5(i::text)); end loop;
  perform pg_temp.check(public.lookup_public_admission('',repeat('c',64))='{"limited":true}','global throttle');
end $$;
rollback;
