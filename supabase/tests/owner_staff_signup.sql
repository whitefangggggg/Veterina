begin;
select set_config('signup.owner_a',gen_random_uuid()::text,true),
  set_config('signup.owner_b',gen_random_uuid()::text,true),
  set_config('signup.staff',gen_random_uuid()::text,true);

insert into auth.users(id,email,raw_user_meta_data) values
  (current_setting('signup.owner_a')::uuid,'owner-a-'||gen_random_uuid()||'@veterina-test.invalid',
    jsonb_build_object('application','veterina','account_type','owner','full_name','First owner','clinic_name','New signup clinic A','clinic_id',private.legacy_clinic_id()));
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('signup.owner_a')::uuid) then raise exception 'TEST: unverified owner has access'; end if;
  if not exists(select 1 from private.owner_registrations where id=current_setting('signup.owner_a')::uuid and clinic_id is null) then raise exception 'TEST: owner signup not captured'; end if;
end $$;

-- Later editable metadata cannot replace the original owner request.
update auth.users set raw_user_meta_data='{"application":"veterina","account_type":"staff","full_name":"Forged name","clinic_name":"Forged clinic"}'
  where id=current_setting('signup.owner_a')::uuid;
update auth.users set email_confirmed_at=now() where id=current_setting('signup.owner_a')::uuid;
select set_config('signup.clinic_a',(select clinic_id::text from public.profiles where id=current_setting('signup.owner_a')::uuid),true);
do $$ begin
  if not exists(select 1 from public.profiles where id=current_setting('signup.owner_a')::uuid and role='owner' and is_active and full_name='First owner' and clinic_id<>private.legacy_clinic_id()) then raise exception 'TEST: owner not provisioned in a new clinic'; end if;
  if not exists(select 1 from public.clinic_settings where clinic_id=current_setting('signup.clinic_a')::uuid and clinic_name='New signup clinic A' and timezone='Asia/Manila') then raise exception 'TEST: clinic settings missing'; end if;
  if (select count(*) from public.service_types where clinic_id=current_setting('signup.clinic_a')::uuid)<>6 then raise exception 'TEST: clinic services missing'; end if;
  if not exists(select 1 from private.clinic_codes where clinic_id=current_setting('signup.clinic_a')::uuid) then raise exception 'TEST: clinic code missing'; end if;
end $$;

-- Confirmation/email retries do not create another clinic or reassign membership.
update auth.users set email_confirmed_at=now(),email='owner-a-retry-'||gen_random_uuid()||'@veterina-test.invalid' where id=current_setting('signup.owner_a')::uuid;
do $$ begin
  if (select count(*) from public.clinics where name='New signup clinic A')<>1 then raise exception 'TEST: repeated confirmation created another clinic'; end if;
end $$;

-- Also handle deployments where Auth confirms accounts during insertion.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  (current_setting('signup.owner_b')::uuid,'owner-b-'||gen_random_uuid()||'@veterina-test.invalid',now(),
    '{"application":"veterina","account_type":"owner","full_name":"Second owner","clinic_name":"New signup clinic B"}');
select set_config('signup.clinic_b',(select clinic_id::text from public.profiles where id=current_setting('signup.owner_b')::uuid),true);
do $$ begin
  if current_setting('signup.clinic_b')='' or current_setting('signup.clinic_b')=current_setting('signup.clinic_a') then raise exception 'TEST: owners share a clinic'; end if;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
  (current_setting('signup.staff')::uuid,'staff-'||gen_random_uuid()||'@veterina-test.invalid',
    jsonb_build_object('application','veterina','account_type','staff','full_name','Pending staff',
      'veterina_code',(select code from private.clinic_codes where clinic_id=current_setting('signup.clinic_a')::uuid),
      'role','owner','clinic_id',current_setting('signup.clinic_b')));
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"account_type":"owner","clinic_name":"Injected clinic"}'::jsonb where id=current_setting('signup.staff')::uuid;
update auth.users set email_confirmed_at=now() where id=current_setting('signup.staff')::uuid;
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('signup.staff')::uuid) or exists(select 1 from private.owner_registrations where id=current_setting('signup.staff')::uuid) then raise exception 'TEST: staff metadata granted access'; end if;
  if not exists(select 1 from private.staff_join_requests where id=current_setting('signup.staff')::uuid and clinic_id=current_setting('signup.clinic_a')::uuid and status='pending' and email_confirmed) then raise exception 'TEST: staff request missing or wrong clinic'; end if;
  if has_table_privilege('anon','private.owner_registrations','SELECT') or has_table_privilege('authenticated','private.owner_registrations','INSERT') or has_function_privilege('authenticated','public.provision_vetshop(uuid,text,text,text)','EXECUTE') or has_function_privilege('authenticated','private.register_veterina_staff()','EXECUTE') then raise exception 'TEST: provisioning exposed to browser'; end if;
end $$;

-- Ordinary password sessions can use their own workspace and approve staff.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('signup.owner_a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('signup.owner_b')::uuid) then raise exception 'TEST: owner can read another clinic'; end if;
  if (public.owner_veterina_code(false)->>'code') is null then raise exception 'TEST: owner code unavailable without MFA'; end if;
  perform public.staff_administration('approve',jsonb_build_object('id',current_setting('signup.staff'),'full_name','Approved staff','role','clinical_staff'));
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.profiles where id=current_setting('signup.staff')::uuid and role='clinical_staff' and clinic_id=current_setting('signup.clinic_a')::uuid) then raise exception 'TEST: approved staff membership missing'; end if;
end $$;
rollback;
