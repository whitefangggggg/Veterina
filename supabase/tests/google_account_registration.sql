begin;
select set_config('google.owner', gen_random_uuid()::text, true),
  set_config('google.staff', gen_random_uuid()::text, true),
  set_config('google.email', gen_random_uuid()::text, true),
  set_config('google.unverified', gen_random_uuid()::text, true);

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
select current_setting('google.' || kind)::uuid, 'google-' || gen_random_uuid() || '@veterina-test.invalid',
  case when kind = 'unverified' then null else now() end,
  '{"role":"owner","clinic_id":"00000000-0000-0000-0000-000000000000"}'::jsonb
from unnest(array['owner', 'staff', 'email', 'unverified']) as kind;
insert into auth.identities(id, user_id, provider_id, provider, identity_data)
select gen_random_uuid(), current_setting('google.' || kind)::uuid,
  current_setting('google.' || kind), 'google', jsonb_build_object('sub', current_setting('google.' || kind))
from unnest(array['owner', 'staff', 'unverified']) as kind;

-- Browser roles cannot read registrations, provision arbitrary owners or call anonymously.
do $$ begin
  if has_function_privilege('anon', 'public.google_account_registration()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_google_registration(uuid,jsonb)', 'EXECUTE')
    or has_table_privilege('authenticated', 'private.owner_registrations', 'SELECT')
    or has_table_privilege('authenticated', 'private.staff_join_requests', 'INSERT')
    or has_function_privilege('authenticated', 'public.provision_vetshop(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'TEST: registration grants are too broad';
  end if;
  begin
    perform public.google_account_registration();
    raise exception 'TEST: missing identity accepted';
  exception when raise_exception then
    if sqlerrm not like 'UNAUTHORIZED:%' then raise; end if;
  end;
end $$;

-- Trusted Google identity and confirmed email are required, regardless of metadata.
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.email'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    perform public.complete_google_registration(current_setting('google.email')::uuid, '{"accountType":"owner","fullName":"Forged","clinicName":"Forbidden"}');
    raise exception 'TEST: non-Google identity accepted';
  exception when raise_exception then
    if sqlerrm not like 'FORBIDDEN:%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.unverified'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.google_account_registration();
    raise exception 'TEST: unverified Google account accepted';
  exception when raise_exception then
    if sqlerrm not like 'FORBIDDEN:%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if public.google_account_registration()->>'status' <> 'unregistered' then raise exception 'TEST: new Google account not detected'; end if;
  begin
    perform private.google_account_registration(current_setting('google.staff')::uuid, null);
    raise exception 'TEST: another account status was readable';
  exception when raise_exception then
    if sqlerrm not like 'FORBIDDEN:%' then raise; end if;
  end;
  begin
    perform private.google_account_registration(auth.uid(), '{"accountType":"owner","fullName":"Forged","clinicName":"Forbidden"}');
    raise exception 'TEST: browser provisioned a clinic';
  exception when raise_exception then
    if sqlerrm not like 'FORBIDDEN:%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    perform public.complete_google_registration(current_setting('google.owner')::uuid, '{"accountType":"owner","fullName":"Owner","clinicName":" "}');
    raise exception 'TEST: blank clinic accepted';
  exception when raise_exception then
    if sqlerrm not like 'VALIDATION_FAILED:%' then raise; end if;
  end;
  begin
    perform public.complete_google_registration(current_setting('google.owner')::uuid, '{"accountType":"owner","fullName":"Google owner","clinicName":"Google test clinic"}');
    raise exception 'TEST: Google owner bypassed activation';
  exception when raise_exception then
    if sqlerrm not like 'ACTIVATION_CODE_REQUIRED:%' then raise; end if;
  end;
end $$;
reset role;
select set_config('google.admin',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('google.admin')::uuid,'google-admin-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into private.platform_admins(user_id) values(current_setting('google.admin')::uuid);
select set_config('google.activation',public.platform_subscription_admin(current_setting('google.admin')::uuid,'generate','{"windowDays":30,"termDays":30}')->>'code',true);
select public.redeem_clinic_activation(current_setting('google.owner')::uuid,current_setting('google.activation'),'{"fullName":"Google owner","clinicName":"Google test clinic"}',gen_random_uuid(),false);
select set_config('google.clinic', (select clinic_id::text from public.profiles where id = current_setting('google.owner')::uuid), true);
select set_config('google.code', (select code from private.clinic_codes where clinic_id = current_setting('google.clinic')::uuid), true);
do $$ begin
  if not exists(select 1 from public.profiles where id = current_setting('google.owner')::uuid and role = 'owner' and is_active and clinic_id <> private.legacy_clinic_id()) then
    raise exception 'TEST: owner missing or attached to existing clinic';
  end if;
  if exists(select 1 from public.clinics where name = 'Duplicate clinic') then raise exception 'TEST: retry created duplicate clinic'; end if;
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.staff'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    perform public.complete_google_registration(current_setting('google.staff')::uuid, '{"accountType":"staff","fullName":"Staff","veterinaCode":"VET-BAD"}');
    raise exception 'TEST: invalid code accepted';
  exception when raise_exception then
    if sqlerrm not like 'INVALID_VETERINA_CODE:%' then raise; end if;
  end;
  if public.complete_google_registration(current_setting('google.staff')::uuid, jsonb_build_object('accountType', 'staff', 'fullName', 'Google staff', 'veterinaCode', current_setting('google.code'), 'role', 'owner', 'clinicId', '00000000-0000-0000-0000-000000000000'))->>'status' <> 'pending' then
    raise exception 'TEST: staff registration not pending';
  end if;
  -- Retries and later owner selection cannot replace a captured staff request.
  perform public.complete_google_registration(current_setting('google.staff')::uuid, '{"accountType":"owner","fullName":"Promote me","clinicName":"Forbidden promotion"}');
end $$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.staff'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if public.google_account_registration()->>'status' <> 'pending' then raise exception 'TEST: pending request not retained'; end if;
  if exists(select 1 from public.profiles where id = current_setting('google.staff')::uuid) then raise exception 'TEST: pending staff has access'; end if;
  if exists(select 1 from public.clinic_settings where clinic_id = current_setting('google.clinic')::uuid) then raise exception 'TEST: pending staff can read clinic'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from private.staff_join_requests where id = current_setting('google.staff')::uuid and clinic_id = current_setting('google.clinic')::uuid and status = 'pending' and email_confirmed) then
    raise exception 'TEST: staff request was not bound to the code';
  end if;
  if exists(select 1 from private.owner_registrations where id = current_setting('google.staff')::uuid) then raise exception 'TEST: staff promoted itself'; end if;
end $$;

-- Approval uses the existing owner-only path and grants only clinical staff access.
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('google.owner'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
select public.staff_administration('approve', jsonb_build_object('id', current_setting('google.staff'), 'full_name', 'Google staff', 'role', 'clinical_staff'));
reset role;
do $$ begin
  if not exists(select 1 from public.profiles where id = current_setting('google.staff')::uuid and clinic_id = current_setting('google.clinic')::uuid and role = 'clinical_staff' and is_active) then
    raise exception 'TEST: Google staff approval failed';
  end if;
end $$;
rollback;
