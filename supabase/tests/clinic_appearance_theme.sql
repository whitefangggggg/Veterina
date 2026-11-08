begin;
select set_config('theme.owner',gen_random_uuid()::text,true),set_config('theme.other',gen_random_uuid()::text,true),
  set_config('theme.staff',gen_random_uuid()::text,true),set_config('theme.inactive',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
  select current_setting('theme.'||name)::uuid,'theme-'||name||'-'||gen_random_uuid()||'@veterina-test.invalid',now(),
    jsonb_build_object('application','veterina','account_type','owner','full_name','Theme '||name,'clinic_name','Theme '||name)
  from unnest(array['owner','other']) name;
select public.provision_vetshop(r.id,r.clinic_name,r.full_name) from private.owner_registrations r
  where r.id in (current_setting('theme.owner')::uuid,current_setting('theme.other')::uuid);
insert into private.clinic_subscriptions(clinic_id,expires_at)
  select clinic_id,now()+interval '30 days' from public.profiles where id in (current_setting('theme.owner')::uuid,current_setting('theme.other')::uuid);
select set_config('theme.clinic',(select clinic_id::text from public.profiles where id=current_setting('theme.owner')::uuid),true),
  set_config('theme.other_clinic',(select clinic_id::text from public.profiles where id=current_setting('theme.other')::uuid),true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('theme.'||name)::uuid,'theme-'||name||'-'||gen_random_uuid()||'@veterina-test.invalid',now()
  from unnest(array['staff','inactive']) name;
insert into public.profiles(id,clinic_id,full_name,role,is_active) values
  (current_setting('theme.staff')::uuid,current_setting('theme.clinic')::uuid,'Theme staff','clinical_staff',true),
  (current_setting('theme.inactive')::uuid,current_setting('theme.clinic')::uuid,'Inactive theme owner','owner',false);
select set_config('theme.other_before',(select to_jsonb(s)::text from public.clinic_settings s where clinic_id=current_setting('theme.other_clinic')::uuid),true);
select set_config('theme.profiles_before',(select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) from public.profiles p),true);
create function pg_temp.reject_theme(payload jsonb,pattern text,key uuid default gen_random_uuid()) returns void language plpgsql as $$
begin
  perform public.portal_mutation('set_clinic_theme',payload,key);
  raise exception 'TEST: expected theme rejection %',pattern;
exception when others then if sqlerrm like 'TEST:%' or sqlerrm not like pattern||'%' then raise; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('theme.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare before_settings jsonb; after_settings jsonb; color text; key uuid:=gen_random_uuid(); response jsonb; audit_before integer; settings_id text; begin
  select to_jsonb(s),s.id::text into before_settings,settings_id from public.clinic_settings s where clinic_id=current_setting('theme.clinic')::uuid;
  select count(*) into audit_before from public.audit_logs where table_name='clinic_settings' and record_id=settings_id;
  response:=public.portal_mutation('set_clinic_theme','{"brandColor":"#72549a"}',key);
  if public.portal_mutation('set_clinic_theme','{"brandColor":"#72549a"}',key)<>response then raise exception 'TEST: theme retry response changed'; end if;
  if (select count(*) from public.audit_logs where table_name='clinic_settings' and record_id=settings_id)<>audit_before+1 then raise exception 'TEST: theme audit missing or retry duplicated'; end if;
  perform pg_temp.reject_theme('{"brandColor":"#305b9a"}','VALIDATION_FAILED: retry payload changed',key);
  foreach color in array array['#2a6f62','#305b9a','#72549a','#a04b67','#966128','#426b45'] loop
    perform public.portal_mutation('set_clinic_theme',jsonb_build_object('brandColor',color,'clinicId',current_setting('theme.other_clinic'),'clinicName','Forged'),gen_random_uuid());
    if (select brand_color from public.clinic_settings where clinic_id=current_setting('theme.clinic')::uuid)<>color then raise exception 'TEST: palette not saved'; end if;
  end loop;
  select to_jsonb(s) into after_settings from public.clinic_settings s where clinic_id=current_setting('theme.clinic')::uuid;
  if before_settings-array['brand_color','updated_at'] is distinct from after_settings-array['brand_color','updated_at'] then raise exception 'TEST: unrelated settings changed'; end if;
  perform pg_temp.reject_theme('{}','VALIDATION_FAILED');
  perform pg_temp.reject_theme('{"brandColor":null}','VALIDATION_FAILED');
  perform pg_temp.reject_theme('{"brandColor":false}','VALIDATION_FAILED');
  perform pg_temp.reject_theme('{"brandColor":"#ffffff"}','VALIDATION_FAILED');
  perform pg_temp.reject_theme('{"brandColor":"url(evil)"}','VALIDATION_FAILED');
  if has_table_privilege('authenticated','public.clinic_settings','UPDATE') then raise exception 'TEST: direct theme writes exposed'; end if;
end $$;
reset role;
do $$ begin
  if (select to_jsonb(s) from public.clinic_settings s where clinic_id=current_setting('theme.other_clinic')::uuid) is distinct from current_setting('theme.other_before')::jsonb then raise exception 'TEST: another clinic changed'; end if;
  if (select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) from public.profiles p) is distinct from current_setting('theme.profiles_before') then raise exception 'TEST: staff credentials changed'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('theme.staff'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_theme('{"brandColor":"#305b9a"}','FORBIDDEN');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('theme.inactive'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_theme('{"brandColor":"#305b9a"}','FORBIDDEN');
reset role;
update private.clinic_subscriptions set expires_at=now()-interval '1 day' where clinic_id=current_setting('theme.clinic')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('theme.owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.reject_theme('{"brandColor":"#305b9a"}','FORBIDDEN');
reset role;
set local role anon;
select pg_temp.reject_theme('{"brandColor":"#305b9a"}','permission denied');
reset role;
rollback;
