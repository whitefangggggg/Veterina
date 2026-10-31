begin;
select set_config('logo.owner_a',gen_random_uuid()::text,true),
  set_config('logo.owner_b',gen_random_uuid()::text,true),
  set_config('logo.staff',gen_random_uuid()::text,true),
  set_config('logo.image','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6MsAAAAASUVORK5CYII=',true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  (current_setting('logo.owner_a')::uuid,'logo-a-'||gen_random_uuid()||'@veterina-test.invalid',now(),'{"application":"veterina","account_type":"owner","full_name":"Logo owner A","clinic_name":"Logo test shop A"}'),
  (current_setting('logo.owner_b')::uuid,'logo-b-'||gen_random_uuid()||'@veterina-test.invalid',now(),'{"application":"veterina","account_type":"owner","full_name":"Logo owner B","clinic_name":"Logo test shop B"}');
select set_config('logo.clinic_a',(select clinic_id::text from public.profiles where id=current_setting('logo.owner_a')::uuid),true),
  set_config('logo.clinic_b',(select clinic_id::text from public.profiles where id=current_setting('logo.owner_b')::uuid),true);
insert into auth.users(id,email,email_confirmed_at) values(current_setting('logo.staff')::uuid,'logo-staff-'||gen_random_uuid()||'@veterina-test.invalid',now());
insert into public.profiles(id,clinic_id,full_name,role,is_active) values(current_setting('logo.staff')::uuid,current_setting('logo.clinic_a')::uuid,'Logo staff','clinical_staff',true);
create function pg_temp.logo_denied(query text) returns void language plpgsql as $$
begin execute query; raise exception 'TEST: forbidden logo operation succeeded';
exception when others then if sqlerrm like 'TEST:%' then raise; end if; end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('logo.owner_a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select public.save_clinic_logo(current_setting('logo.image'));
do $$ begin
  if not exists(select 1 from public.clinic_settings where clinic_id=current_setting('logo.clinic_a')::uuid and logo_data_url=current_setting('logo.image')) then raise exception 'TEST: logo not persisted'; end if;
  if exists(select 1 from public.clinic_settings where clinic_id=current_setting('logo.clinic_b')::uuid) then raise exception 'TEST: foreign clinic logo visible'; end if;
end $$;
select pg_temp.logo_denied($query$select public.save_clinic_logo('https://example.org/logo.png')$query$);
select pg_temp.logo_denied($query$select public.save_clinic_logo('data:image/svg+xml,<svg onload="alert(1)"></svg>')$query$);
select pg_temp.logo_denied($query$select public.save_clinic_logo('data:image/png;base64,iVBORw0KGgo'||repeat('A',400000))$query$);
select pg_temp.logo_denied($query$select public.save_clinic_logo('data:image/png;base64,iVBORw0KGgo=')$query$);
select pg_temp.logo_denied($query$select public.save_clinic_logo('data:image/png;base64,'||replace(encode(set_byte(decode(substr(current_setting('logo.image'),23),'base64'),18,2),'base64'),chr(10),''))$query$);
select public.save_clinic_logo(current_setting('logo.image'));
reset role;
do $$ begin
  if (select logo_data_url from public.clinic_settings where clinic_id=current_setting('logo.clinic_b')::uuid) is not null then raise exception 'TEST: owner changed another clinic logo'; end if;
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('logo.owner_b'),'role','authenticated')::text,true);
set local role authenticated;
select public.save_clinic_logo(current_setting('logo.image'));
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('logo.staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.clinic_settings where logo_data_url=current_setting('logo.image') and clinic_id=current_setting('logo.clinic_a')::uuid) then raise exception 'TEST: clinical staff cannot use saved logo for prescriptions'; end if;
end $$;
select pg_temp.logo_denied($query$select public.save_clinic_logo(null)$query$);
select pg_temp.logo_denied($query$select public.save_clinic_logo(current_setting('logo.image'))$query$);
select pg_temp.logo_denied($query$update public.clinic_settings set logo_data_url=null$query$);
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('logo.owner_a'),'role','authenticated')::text,true);
set local role authenticated;
select public.save_clinic_logo(null);
reset role;
do $$ begin
  if (select logo_data_url from public.clinic_settings where clinic_id=current_setting('logo.clinic_a')::uuid) is not null then raise exception 'TEST: logo removal failed'; end if;
  if (select logo_data_url from public.clinic_settings where clinic_id=current_setting('logo.clinic_b')::uuid) is distinct from current_setting('logo.image') then raise exception 'TEST: removing logo affected another clinic'; end if;
  if has_function_privilege('anon','public.save_clinic_logo(text)','EXECUTE') or has_function_privilege('anon','private.save_clinic_logo(text)','EXECUTE') then raise exception 'TEST: anonymous logo mutation allowed'; end if;
end $$;
update public.profiles set is_active=false where id=current_setting('logo.owner_a')::uuid;
set local role authenticated;
select pg_temp.logo_denied($query$select public.save_clinic_logo(current_setting('logo.image'))$query$);
reset role;
rollback;
