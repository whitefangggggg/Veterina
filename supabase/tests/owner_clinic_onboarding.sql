begin;
select set_config('setup.owner',gen_random_uuid()::text,true), set_config('setup.other',gen_random_uuid()::text,true),
  set_config('setup.staff',gen_random_uuid()::text,true),
  set_config('setup.image','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6MsAAAAASUVORK5CYII=',true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  (current_setting('setup.owner')::uuid,'setup-owner-'||gen_random_uuid()||'@veterina-test.invalid',now(),'{"application":"veterina","account_type":"owner","full_name":"Setup owner","clinic_name":"Setup clinic"}'),
  (current_setting('setup.other')::uuid,'setup-other-'||gen_random_uuid()||'@veterina-test.invalid',now(),'{"application":"veterina","account_type":"owner","full_name":"Other owner","clinic_name":"Other setup clinic"}');
-- Trusted fixtures; code activation is exercised in platform_subscriptions.sql.
select public.provision_vetshop(r.id,r.clinic_name,r.full_name) from private.owner_registrations r where r.id=current_setting('setup.owner')::uuid;
select public.provision_vetshop(r.id,r.clinic_name,r.full_name) from private.owner_registrations r where r.id=current_setting('setup.other')::uuid;
insert into private.clinic_subscriptions(clinic_id,expires_at) select clinic_id,now()+interval '30 days' from public.profiles where id in (current_setting('setup.owner')::uuid,current_setting('setup.other')::uuid);
select set_config('setup.clinic',(select clinic_id::text from public.profiles where id=current_setting('setup.owner')::uuid),true),
  set_config('setup.other_clinic',(select clinic_id::text from public.profiles where id=current_setting('setup.other')::uuid),true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('setup.staff')::uuid,'setup-staff-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,clinic_id,full_name,role,is_active) values(current_setting('setup.staff')::uuid,current_setting('setup.clinic')::uuid,'Setup staff','clinical_staff',true);
select set_config('setup.payload',jsonb_build_object('clinicName','Personalized clinic','address','123 Clinic Street','phone','09171234567','email','clinic@example.org','website','https://example.org','tagline','Care for every paw','brandColor','#72549a','timezone','Asia/Manila','reminderLeadDays',2,'businessHours','{"mon":{"closed":false,"open":"09:00","close":"17:00"}}'::jsonb,'logoDataUrl',current_setting('setup.image'),'step',1)::text,true);
create function pg_temp.setup_denied(payload jsonb, complete boolean default true) returns void language plpgsql as $$
begin
  perform public.save_clinic_onboarding(payload,complete);
  raise exception 'TEST: invalid or forbidden setup succeeded';
exception when others then if sqlerrm like 'TEST:%' then raise; end if;
end $$;
do $$ begin
  if exists(select 1 from public.clinic_settings where clinic_id=current_setting('setup.clinic')::uuid and onboarding_completed_at is not null) then raise exception 'TEST: new clinic skipped onboarding'; end if;
  if has_function_privilege('anon','public.save_clinic_onboarding(jsonb,boolean)','EXECUTE') then raise exception 'TEST: anonymous setup allowed'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('setup.owner'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select public.save_clinic_onboarding(current_setting('setup.payload')::jsonb,false);
do $$ begin
  if not exists(select 1 from public.clinic_settings where clinic_id=current_setting('setup.clinic')::uuid and onboarding_step=1 and onboarding_completed_at is null and tagline='Care for every paw' and logo_data_url=current_setting('setup.image')) then raise exception 'TEST: setup draft not retained'; end if;
end $$;
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"address":""}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"phone":""}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"timezone":"Invalid/Timezone"}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"brandColor":"red"}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"website":"javascript:alert(1)"}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"reminderLeadDays":366}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"businessHours":{"mon":{"closed":false,"open":"17:00","close":"09:00"}}}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"businessHours":{"unknown":{"closed":true}}}');
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb||'{"logoDataUrl":"https://invalid.example/image.png","clinicName":"Should roll back"}');
do $$ begin
  if exists(select 1 from public.clinic_settings where clinic_name='Should roll back') then raise exception 'TEST: invalid logo partially saved'; end if;
end $$;
-- Caller-supplied clinic IDs cannot redirect a settings update to another tenant.
select public.save_clinic_onboarding(current_setting('setup.payload')::jsonb||jsonb_build_object('clinicId',current_setting('setup.other_clinic')),true);
select set_config('setup.completed',(select onboarding_completed_at::text from public.clinic_settings where clinic_id=current_setting('setup.clinic')::uuid),true);
select public.save_clinic_onboarding(current_setting('setup.payload')::jsonb,true);
reset role;
do $$ begin
  if not exists(select 1 from public.clinic_settings where clinic_id=current_setting('setup.clinic')::uuid and onboarding_completed_at::text=current_setting('setup.completed') and onboarding_step=3 and brand_color='#72549a') then raise exception 'TEST: completion or retry changed'; end if;
  if not exists(select 1 from public.clinic_settings where clinic_id=current_setting('setup.other_clinic')::uuid and clinic_name='Other setup clinic' and onboarding_completed_at is null and logo_data_url is null) then raise exception 'TEST: setup changed another clinic'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('setup.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb);
do $$ begin
  if not exists(select 1 from public.clinic_settings where brand_color='#72549a' and logo_data_url=current_setting('setup.image')) then raise exception 'TEST: staff cannot see clinic branding'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('setup.owner'),'role','authenticated')::text,true);
update public.profiles set is_active=false where id=current_setting('setup.owner')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('setup.owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.setup_denied(current_setting('setup.payload')::jsonb);
reset role;
rollback;
