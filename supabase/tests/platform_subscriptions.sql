begin;
select set_config('sub.admin',gen_random_uuid()::text,true),set_config('sub.owner_a',gen_random_uuid()::text,true),
  set_config('sub.owner_b',gen_random_uuid()::text,true),set_config('sub.staff',gen_random_uuid()::text,true),
  set_config('sub.extra',gen_random_uuid()::text,true),set_config('sub.request',gen_random_uuid()::text,true),
  set_config('sub.extend_request',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) select current_setting('sub.'||kind)::uuid,'subscription-'||gen_random_uuid()||'@veterina-test.invalid',now()
  from unnest(array['admin','staff','extra']) as kind;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) select current_setting('sub.'||kind)::uuid,'subscription-'||gen_random_uuid()||'@veterina-test.invalid',now(),
  jsonb_build_object('application','veterina','account_type','owner','full_name','Subscription owner','clinic_name','Subscription test '||kind,'role','platform_admin','isPlatformAdmin',true)
  from unnest(array['owner_a','owner_b']) as kind;
insert into private.platform_admins(user_id) values(current_setting('sub.admin')::uuid);
create function pg_temp.subscription_denied(query text,prefix text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: forbidden subscription operation succeeded';
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like prefix||'%' then raise; end if;
end $$;
do $$ begin
  if exists(select 1 from public.profiles where id in (current_setting('sub.owner_a')::uuid,current_setting('sub.owner_b')::uuid)) then raise exception 'TEST: owner signup provisioned without a code'; end if;
  if has_table_privilege('authenticated','private.activation_codes','SELECT')
    or has_table_privilege('authenticated','private.clinic_subscriptions','UPDATE')
    or has_function_privilege('authenticated','public.redeem_clinic_activation(uuid,text,jsonb,uuid,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.platform_subscription_admin(uuid,text,jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.account_access()','EXECUTE') then raise exception 'TEST: subscription privileges exposed'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare status jsonb:=public.account_access(); begin
  if (status->>'isPlatformAdmin')::boolean or not (status->>'needsRegistration')::boolean or status->>'registrationType'<>'owner' then raise exception 'TEST: editable metadata granted admin access or owner setup missing'; end if;
end $$;
select pg_temp.subscription_denied($q$select public.platform_subscription_admin(auth.uid(),'list')$q$,'permission denied');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.subscription_denied(format('select public.platform_subscription_admin(%L,''list'')',current_setting('sub.owner_a')),'FORBIDDEN');
select set_config('sub.generated',public.platform_subscription_admin(current_setting('sub.admin')::uuid,'generate','{"label":"Test reusable","windowDays":30,"termDays":30}')::text,true);
select set_config('sub.code',current_setting('sub.generated')::jsonb->>'code',true),set_config('sub.code_id',current_setting('sub.generated')::jsonb->>'id',true);
select set_config('sub.first',public.redeem_clinic_activation(current_setting('sub.owner_a')::uuid,current_setting('sub.code'),'{}',current_setting('sub.request')::uuid,false)::text,true);
-- A lost response must return the same grant and must not add another month.
do $$ begin
  if public.redeem_clinic_activation(current_setting('sub.owner_a')::uuid,current_setting('sub.code'),'{}',current_setting('sub.request')::uuid,false) is distinct from current_setting('sub.first')::jsonb then raise exception 'TEST: redemption retry changed'; end if;
end $$;
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{}'',%L,true)',current_setting('sub.owner_a'),current_setting('sub.code'),gen_random_uuid()),'ACTIVATION_CODE_USED');
reset role;
select set_config('sub.clinic_a',current_setting('sub.first')::jsonb->>'clinicId',true);
select set_config('sub.first_expiry',(select expires_at::text from private.clinic_subscriptions where clinic_id=current_setting('sub.clinic_a')::uuid),true);
do $$ begin
  if (select expires_at from private.clinic_subscriptions where clinic_id=current_setting('sub.clinic_a')::uuid)not between now()+interval '30 days' and clock_timestamp()+interval '30 days' then raise exception 'TEST: first clinic term incorrect'; end if;
  if (select code_hash from private.activation_codes where id=current_setting('sub.code_id')::uuid)=current_setting('sub.code') then raise exception 'TEST: plaintext code stored'; end if;
end $$;
-- Simulate another clinic redeeming ten days into the availability window.
update private.activation_codes set first_used_at=now()-interval '10 days' where id=current_setting('sub.code_id')::uuid;
set local role service_role;
select set_config('sub.second',public.redeem_clinic_activation(current_setting('sub.owner_b')::uuid,current_setting('sub.code'),'{}',gen_random_uuid(),false)::text,true);
reset role;
select set_config('sub.clinic_b',current_setting('sub.second')::jsonb->>'clinicId',true);
do $$ begin
  if current_setting('sub.clinic_a')=current_setting('sub.clinic_b') then raise exception 'TEST: clinics share identity'; end if;
  if (select expires_at from private.clinic_subscriptions where clinic_id=current_setting('sub.clinic_b')::uuid)not between now()+interval '30 days' and clock_timestamp()+interval '30 days' then raise exception 'TEST: later clinic lost part of its term'; end if;
  if (select first_used_at from private.activation_codes where id=current_setting('sub.code_id')::uuid)<>now()-interval '10 days' then raise exception 'TEST: second redemption reset code window'; end if;
  if (select count(*) from private.activation_redemptions where code_id=current_setting('sub.code_id')::uuid)<>2 then raise exception 'TEST: shared code could not activate two clinics'; end if;
end $$;
insert into public.profiles(id,clinic_id,full_name,role,is_active) values(current_setting('sub.staff')::uuid,current_setting('sub.clinic_a')::uuid,'Subscription staff','clinical_staff',true);
-- Real clinical and file fixtures make expiry and isolation checks non-vacuous.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.owner_a'),'role','authenticated')::text,true);
set local role authenticated;
select set_config('sub.person',public.portal_mutation('create_owner','{"fullName":"Subscription household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id',true);
select public.portal_mutation('create_pet',jsonb_build_object('ownerId',current_setting('sub.person'),'name','Subscription patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid());
reset role;
insert into storage.buckets(id,name,public) values('medical-attachments','medical-attachments',false) on conflict(id) do nothing;
insert into storage.objects(bucket_id,name) values('medical-attachments',current_setting('sub.clinic_a')||'/subscription-test.pdf');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.owner_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pets where name='Subscription patient') or exists(select 1 from storage.objects where name=current_setting('sub.clinic_a')||'/subscription-test.pdf') then raise exception 'TEST: cross-clinic records or files exposed'; end if;
end $$;
select pg_temp.subscription_denied(format('insert into storage.objects(bucket_id,name) values(''medical-attachments'',%L)',current_setting('sub.clinic_a')||'/forged.pdf'),'new row violates row-level security');
reset role;
set local role service_role;
select public.platform_subscription_admin(current_setting('sub.admin')::uuid,'extend',jsonb_build_object('clinicId',current_setting('sub.clinic_a'),'days',15,'note','Manual payment'),current_setting('sub.extend_request')::uuid);
select public.platform_subscription_admin(current_setting('sub.admin')::uuid,'extend',jsonb_build_object('clinicId',current_setting('sub.clinic_a'),'days',15,'note','Manual payment'),current_setting('sub.extend_request')::uuid);
select pg_temp.subscription_denied(format('select public.platform_subscription_admin(%L,''extend'',%L,%L)',current_setting('sub.admin'),jsonb_build_object('clinicId',current_setting('sub.clinic_a'),'days',20),current_setting('sub.extend_request')),'REQUEST_CHANGED');
select public.platform_subscription_admin(current_setting('sub.admin')::uuid,'revoke',jsonb_build_object('codeId',current_setting('sub.code_id')),gen_random_uuid());
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{}'',%L,true)',current_setting('sub.owner_b'),current_setting('sub.code'),gen_random_uuid()),'ACTIVATION_CODE_REVOKED');
reset role;
do $$ begin
  if (select expires_at from private.clinic_subscriptions where clinic_id=current_setting('sub.clinic_a')::uuid)<>current_setting('sub.first_expiry')::timestamptz+interval '15 days' then raise exception 'TEST: extension retry added time twice or revocation shortened term'; end if;
end $$;
-- Boundary expiry denies clinical data while leaving own subscription metadata accessible.
update private.clinic_subscriptions set expires_at=now() where clinic_id=current_setting('sub.clinic_a')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if private.current_clinic_id() is not null or private.staff_role() is not null then raise exception 'TEST: expired clinic retains authority'; end if;
  if exists(select 1 from public.clinic_settings) or exists(select 1 from public.pets) or exists(select 1 from public.owners) then raise exception 'TEST: expired owner can read clinical data'; end if;
  if public.account_access()->'subscription'->>'status'<>'expired' then raise exception 'TEST: expired billing status inaccessible'; end if;
end $$;
select pg_temp.subscription_denied($q$select public.save_clinic_logo(null)$q$,'FORBIDDEN');
select pg_temp.subscription_denied($q$select public.portal_mutation('create_owner','{"fullName":"Forbidden","phone":"09171234567","address":"Test"}',gen_random_uuid())$q$,'FORBIDDEN');
select pg_temp.subscription_denied(format('insert into storage.objects(bucket_id,name) values(''medical-attachments'',%L)',current_setting('sub.clinic_a')||'/expired.pdf'),'new row violates row-level security');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pets) or exists(select 1 from public.clinic_settings) then raise exception 'TEST: expired staff can read clinic'; end if;
  if exists(select 1 from storage.objects where bucket_id in ('medical-attachments','pet-photos','knowledge-base')) then raise exception 'TEST: expired staff can read stored files'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('sub.renew_code',public.platform_subscription_admin(current_setting('sub.admin')::uuid,'generate','{"windowDays":1,"termDays":90}')::text,true);
select public.redeem_clinic_activation(current_setting('sub.owner_a')::uuid,current_setting('sub.renew_code')::jsonb->>'code','{}',gen_random_uuid(),true);
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{}'',%L,true)',current_setting('sub.staff'),current_setting('sub.renew_code')::jsonb->>'code',gen_random_uuid()),'FORBIDDEN');
reset role;
do $$ begin
  if (select expires_at from private.clinic_subscriptions where clinic_id=current_setting('sub.clinic_a')::uuid)not between now()+interval '90 days' and clock_timestamp()+interval '90 days' then raise exception 'TEST: expired renewal did not start from now'; end if;
end $$;
update private.activation_codes set first_used_at=now()-interval '1 day' where id=(current_setting('sub.renew_code')::jsonb->>'id')::uuid;
set local role service_role;
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{}'',%L,false)',current_setting('sub.extra'),current_setting('sub.renew_code')::jsonb->>'code',gen_random_uuid()),'ACTIVATION_CODE_EXPIRED');
select set_config('sub.unused',public.platform_subscription_admin(current_setting('sub.admin')::uuid,'generate','{"windowDays":30,"termDays":30}')::text,true);
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{}'',%L,false)',current_setting('sub.extra'),current_setting('sub.unused')::jsonb->>'code',gen_random_uuid()),'VALIDATION_FAILED');
reset role;
-- Fail after provisioning begins, then ensure every row and first-use stamp rolls back.
create function pg_temp.fail_subscription_provision() returns trigger language plpgsql as $$ begin
  if new.id=current_setting('sub.extra')::uuid then raise exception 'SIMULATED_PROVISION_FAILURE'; end if;
  return new;
end $$;
create trigger subscription_test_failure before insert on public.profiles for each row execute function pg_temp.fail_subscription_provision();
set local role service_role;
select pg_temp.subscription_denied(format('select public.redeem_clinic_activation(%L,%L,''{"fullName":"Rollback owner","clinicName":"Rollback clinic"}'',%L,false)',current_setting('sub.extra'),current_setting('sub.unused')::jsonb->>'code',gen_random_uuid()),'SIMULATED_PROVISION_FAILURE');
reset role;
drop trigger subscription_test_failure on public.profiles;
do $$ begin
  if exists(select 1 from private.activation_codes where id=(current_setting('sub.unused')::jsonb->>'id')::uuid and first_used_at is not null) or exists(select 1 from public.profiles where id=current_setting('sub.extra')::uuid) then raise exception 'TEST: failed activation consumed code or created a clinic'; end if;
  if exists(select 1 from public.clinics where name='Rollback clinic') then raise exception 'TEST: failed provisioning left clinic rows'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.owner_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if private.current_clinic_id() is distinct from current_setting('sub.clinic_a')::uuid then raise exception 'TEST: renewal did not restore access'; end if;
  if exists(select 1 from public.clinic_settings where clinic_id=current_setting('sub.clinic_b')::uuid) then raise exception 'TEST: owner can see another clinic'; end if;
  if not exists(select 1 from public.pets where name='Subscription patient') or not exists(select 1 from storage.objects where name=current_setting('sub.clinic_a')||'/subscription-test.pdf') then raise exception 'TEST: renewal lost clinical records or files'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sub.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not (public.account_access()->>'isPlatformAdmin')::boolean then raise exception 'TEST: platform admin not recognized'; end if;
  if exists(select 1 from public.clinic_settings) or exists(select 1 from public.pets) then raise exception 'TEST: platform admin gained clinical access'; end if;
end $$;
reset role;
select 'PASS platform subscription security and lifecycle' as result;
rollback;
