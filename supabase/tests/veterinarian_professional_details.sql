begin;
select set_config('vet.owner',gen_random_uuid()::text,true),set_config('vet.staff',gen_random_uuid()::text,true),
  set_config('vet.other',gen_random_uuid()::text,true),set_config('vet.inactive',gen_random_uuid()::text,true),set_config('vet.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('vet.'||name)::uuid,'vet-details-'||name||'-'||gen_random_uuid()||'@veterina-test.invalid',now()
  from unnest(array['owner','staff','other','inactive','foreign']) name;
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('vet.owner')::uuid,'Veterinarian owner','owner',true),
  (current_setting('vet.staff')::uuid,'Veterinarian staff','clinical_staff',true),
  (current_setting('vet.other')::uuid,'Other staff','clinical_staff',true),
  (current_setting('vet.inactive')::uuid,'Inactive veterinarian','clinical_staff',false);
select public.provision_vetshop(current_setting('vet.foreign')::uuid,'Foreign veterinarian clinic','Foreign veterinarian');
create function pg_temp.reject_vet(query text,pattern text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if; end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('vet.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb; result jsonb; key uuid:=gen_random_uuid(); audit_count integer; original_clinic jsonb; original_owner jsonb; settings jsonb; invalid jsonb; begin
  select to_jsonb(c) into original_clinic from public.clinic_settings c limit 1;
  select to_jsonb(p) into original_owner from public.profiles p where id=auth.uid();
  if exists(select 1 from public.profiles where is_veterinarian) then raise exception 'TEST: new accounts must not become veterinarians implicitly'; end if;
  payload:=jsonb_build_object('id',current_setting('vet.staff'),'fullName','  Dr. Niña <Cebu>  ','isVeterinarian',true,
    'tinNumber','  000-123-456  ','prcLicenseNumber','  0009669  ','ptrNumber','  001010697  ','licenseExpiresOn','2026-11-07',
    'role','owner','isActive',false,'clinicId',gen_random_uuid());
  select count(*) into audit_count from public.audit_logs where table_name='profiles' and record_id=current_setting('vet.staff');
  result:=public.portal_mutation('save_veterinarian_details',payload,key);
  if public.portal_mutation('save_veterinarian_details',payload,key)<>result then raise exception 'TEST: details retry changed'; end if;
  if not exists(select 1 from public.profiles where id=current_setting('vet.staff')::uuid and full_name='Dr. Niña <Cebu>' and is_veterinarian
    and tin_number='000-123-456' and prc_license_number='0009669' and ptr_number='001010697' and license_expires_on='2026-11-07'
    and role='clinical_staff' and is_active and clinic_id=(original_owner->>'clinic_id')::uuid) then raise exception 'TEST: credentials or account isolation lost'; end if;
  if (select count(*) from public.audit_logs where table_name='profiles' and record_id=current_setting('vet.staff'))<>audit_count+1 then raise exception 'TEST: audited retry duplicated'; end if;
  if (select to_jsonb(c) from public.clinic_settings c limit 1)<>original_clinic or (select to_jsonb(p) from public.profiles p where id=auth.uid())<>original_owner then raise exception 'TEST: staff credentials changed clinic or another profile'; end if;
  foreach invalid in array array['{"fullName":""}'::jsonb,'{"fullName":123}'::jsonb,'{"isVeterinarian":"true"}'::jsonb,
    '{"tinNumber":123}'::jsonb,'{"prcLicenseNumber":true}'::jsonb,'{"ptrNumber":{}}'::jsonb,
    '{"licenseExpiresOn":"2026-02-30"}'::jsonb,'{"licenseExpiresOn":"infinity"}'::jsonb,'{"licenseExpiresOn":123}'::jsonb,
    jsonb_build_object('fullName',repeat('x',121)),jsonb_build_object('prcLicenseNumber',repeat('x',65)),jsonb_build_object('ptrNumber',E'001\n23')] loop
    perform pg_temp.reject_vet(format('select public.portal_mutation(''save_veterinarian_details'',%L::jsonb,gen_random_uuid())',payload||invalid),'VALIDATION_FAILED');
  end loop;
  perform pg_temp.reject_vet(format('select public.portal_mutation(''save_veterinarian_details'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('id',current_setting('vet.foreign'))),'NOT_FOUND');
  perform public.portal_mutation('save_veterinarian_details',payload||jsonb_build_object('id',auth.uid(),'fullName','Veterinarian owner','licenseExpiresOn',null),gen_random_uuid());
  if (select count(*) from public.profiles where is_veterinarian)<>2 then raise exception 'TEST: multiple veterinarian accounts not saved'; end if;
  perform public.portal_mutation('save_veterinarian_details',payload||'{"isVeterinarian":false}',gen_random_uuid());
  if not exists(select 1 from public.profiles where id=current_setting('vet.staff')::uuid and not is_veterinarian and prc_license_number='0009669' and is_active) then raise exception 'TEST: designation removal deleted credentials or disabled login'; end if;
  perform public.portal_mutation('save_veterinarian_details',payload||jsonb_build_object('id',current_setting('vet.inactive'),'fullName','Inactive veterinarian'),gen_random_uuid());
  if not exists(select 1 from public.profiles where id=current_setting('vet.inactive')::uuid and is_veterinarian and not is_active) then raise exception 'TEST: professional editing changed account status'; end if;
  select jsonb_build_object('clinicName',c.clinic_name,'phone',c.phone,'email',c.email,'address',c.address,'timezone',c.timezone,
    'retentionYears',c.record_retention_years,'reminderLeadDays',c.reminder_lead_days,'aiEnabled',c.ai_enabled,
    'fullName','IGNORE','tinNumber',false,'prcLicenseNumber',123,'ptrNumber','{}'::jsonb,'licenseExpiresOn','not-a-date') into settings from public.clinic_settings c limit 1;
  select to_jsonb(p) into original_owner from public.profiles p where id=auth.uid();
  perform public.portal_mutation('save_settings',settings,gen_random_uuid());
  perform public.portal_mutation('save_settings',settings-'fullName'-'tinNumber'-'prcLicenseNumber'-'ptrNumber'-'licenseExpiresOn',gen_random_uuid());
  if (select to_jsonb(p) from public.profiles p where id=auth.uid())<>original_owner then raise exception 'TEST: clinic settings rewrote veterinarian identity'; end if;
  perform public.portal_mutation('save_veterinarian_details',jsonb_build_object('id',current_setting('vet.staff'),'fullName','Unknown credentials','isVeterinarian',true,'tinNumber','','prcLicenseNumber',null,'ptrNumber','','licenseExpiresOn',''),gen_random_uuid());
  if not exists(select 1 from public.profiles where id=current_setting('vet.staff')::uuid and is_veterinarian and prc_license_number is null and ptr_number is null and tin_number is null and license_expires_on is null) then raise exception 'TEST: optional credentials could not clear'; end if;
  if has_function_privilege('authenticated','private.save_veterinarian_details(jsonb)','EXECUTE') or has_table_privilege('authenticated','public.profiles','UPDATE') then raise exception 'TEST: direct professional writes exposed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('vet.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_vet(format('select public.portal_mutation(''save_veterinarian_details'',%L::jsonb,gen_random_uuid())',jsonb_build_object('id',current_setting('vet.staff'),'fullName','Self edit','isVeterinarian',true)),'FORBIDDEN');
reset role;
set local role anon;
select pg_temp.reject_vet('select public.portal_mutation(''save_veterinarian_details'',''{}'',gen_random_uuid())','permission denied');
rollback;
