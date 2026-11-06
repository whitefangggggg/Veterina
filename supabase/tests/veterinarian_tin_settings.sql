begin;
select set_config('tin.owner',gen_random_uuid()::text,true),set_config('tin.staff',gen_random_uuid()::text,true),
  set_config('tin.foreign',gen_random_uuid()::text,true),set_config('tin.inactive',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('tin.'||name)::uuid,'tin-'||name||'-'||gen_random_uuid()||'@veterina-test.invalid',now()
  from unnest(array['owner','staff','foreign','inactive']) name;
insert into public.profiles(id,full_name,role,is_active) values
  (current_setting('tin.owner')::uuid,'TIN settings owner','owner',true),
  (current_setting('tin.staff')::uuid,'TIN settings veterinarian','clinical_staff',true),
  (current_setting('tin.inactive')::uuid,'Inactive veterinarian','clinical_staff',false);
select public.provision_vetshop(current_setting('tin.foreign')::uuid,'Foreign TIN clinic','Foreign veterinarian');
create function pg_temp.reject_tin(query text,pattern text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: expected rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if; end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tin.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare payload jsonb; response jsonb; key uuid:=gen_random_uuid(); before_audit integer; bad jsonb; settings jsonb; begin
  payload:=jsonb_build_object('id',current_setting('tin.staff'),'tinNumber','  000-123-456  ');
  select count(*) into before_audit from public.audit_logs where table_name='profiles' and record_id=current_setting('tin.staff');
  response:=public.portal_mutation('set_veterinarian_tin',payload,key);
  if public.portal_mutation('set_veterinarian_tin',payload,key)<>response then raise exception 'TEST: TIN retry changed response'; end if;
  if (select tin_number from public.profiles where id=current_setting('tin.staff')::uuid)<>'000-123-456' then raise exception 'TEST: saved TIN lost formatting or leading zeroes'; end if;
  if (select count(*) from public.audit_logs where table_name='profiles' and record_id=current_setting('tin.staff'))<>before_audit+1 then raise exception 'TEST: TIN change audit or retry duplicated'; end if;
  foreach bad in array array['123'::jsonb,'{}'::jsonb,to_jsonb(repeat('x',65)),to_jsonb(E'bad\nTIN'::text)] loop
    perform pg_temp.reject_tin(format('select public.portal_mutation(''set_veterinarian_tin'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('tinNumber',bad)),'VALIDATION_FAILED: enter a TIN');
  end loop;
  perform pg_temp.reject_tin(format('select public.portal_mutation(''set_veterinarian_tin'',%L::jsonb,gen_random_uuid())',payload-'tinNumber'),'VALIDATION_FAILED');
  perform pg_temp.reject_tin(format('select public.portal_mutation(''set_veterinarian_tin'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('id',current_setting('tin.foreign'))),'NOT_FOUND');
  perform pg_temp.reject_tin(format('select public.portal_mutation(''set_veterinarian_tin'',%L::jsonb,gen_random_uuid())',payload||jsonb_build_object('id',current_setting('tin.inactive'))),'NOT_FOUND');
  perform public.portal_mutation('set_veterinarian_tin',payload||'{"tinNumber":""}',gen_random_uuid());
  if (select tin_number from public.profiles where id=current_setting('tin.staff')::uuid) is not null then raise exception 'TEST: optional TIN did not clear'; end if;
  perform public.portal_mutation('set_veterinarian_tin',jsonb_build_object('id',auth.uid(),'tinNumber','000-111-222'),gen_random_uuid());
  select jsonb_build_object('clinicName',c.clinic_name,'phone',c.phone,'email',c.email,'address',c.address,'timezone',c.timezone,
    'retentionYears',c.record_retention_years,'reminderLeadDays',c.reminder_lead_days,'aiEnabled',c.ai_enabled,'fullName','TIN settings owner','tinNumber','000-111-222')
    into settings from public.clinic_settings c limit 1;
  perform public.portal_mutation('save_settings',settings,gen_random_uuid());
  if (select tin_number from public.profiles where id=auth.uid())<>'000-111-222' then raise exception 'TEST: professional settings TIN not saved'; end if;
  perform public.portal_mutation('save_settings',settings-'tinNumber',gen_random_uuid());
  if (select tin_number from public.profiles where id=auth.uid())<>'000-111-222' then raise exception 'TEST: older settings client cleared TIN'; end if;
  perform public.portal_mutation('save_settings',settings||'{"tinNumber":false}',gen_random_uuid());
  if (select tin_number from public.profiles where id=auth.uid())<>'000-111-222' then raise exception 'TEST: invalid settings partially saved'; end if;
  if has_table_privilege('authenticated','public.profiles','UPDATE') or has_function_privilege('authenticated','private.validated_veterinarian_tin(jsonb)','EXECUTE') then raise exception 'TEST: direct TIN writes exposed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('tin.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_tin(format('select public.portal_mutation(''set_veterinarian_tin'',%L::jsonb,gen_random_uuid())',jsonb_build_object('id',current_setting('tin.staff'),'tinNumber','forged')),'FORBIDDEN');
reset role;
set local role anon;
select pg_temp.reject_tin('select public.portal_mutation(''set_veterinarian_tin'',''{}'',gen_random_uuid())','permission denied');
rollback;
