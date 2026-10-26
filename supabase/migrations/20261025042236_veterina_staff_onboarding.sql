create table private.clinic_codes (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  code text not null unique default ('VET-'||upper(encode(extensions.gen_random_bytes(10),'hex'))),
  updated_at timestamptz not null default now()
);
alter table private.clinic_codes enable row level security;
revoke all on private.clinic_codes from public,anon,authenticated;
grant select,insert,update on private.clinic_codes to veterina_rpc;
create policy owner_codes on private.clinic_codes for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id()) and (select private.staff_role())='owner')
  with check(clinic_id=(select private.current_clinic_id()) and (select private.staff_role())='owner');
insert into private.clinic_codes(clinic_id) select id from public.clinics;

create table private.staff_join_requests (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  full_name text not null check(length(btrim(full_name)) between 1 and 120),
  email text not null,
  email_confirmed boolean not null default false,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);
create index staff_join_requests_clinic on private.staff_join_requests(clinic_id,status,requested_at);
create index staff_join_requests_decided_by on private.staff_join_requests(decided_by);
alter table private.staff_join_requests enable row level security;
revoke all on private.staff_join_requests from public,anon,authenticated;
grant select,insert,update on private.staff_join_requests to veterina_rpc;
create policy owner_join_requests on private.staff_join_requests for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id()) and (select private.staff_role())='owner')
  with check(clinic_id=(select private.current_clinic_id()) and (select private.staff_role())='owner');
insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed,status)
  select p.id,p.clinic_id,coalesce(nullif(btrim(p.full_name),''),'Staff member'),coalesce(u.email,''),u.email_confirmed_at is not null,'approved'
  from public.profiles p join auth.users u on u.id=p.id;
insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed)
  select u.id,private.legacy_clinic_id(),left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),'Staff member'),120),coalesce(u.email,''),u.email_confirmed_at is not null
  from auth.users u where u.raw_user_meta_data->>'application'='veterina' and not exists(select 1 from public.profiles p where p.id=u.id);

create function private.normalized_veterina_code(value text) returns text language sql immutable set search_path='' as $$
  select case when regexp_replace(upper(coalesce(value,'')),'[[:space:]-]','','g') ~ '^VET[0-9A-F]{20}$'
    then 'VET-'||substr(regexp_replace(upper(value),'[[:space:]-]','','g'),4) else null end;
$$;
revoke all on function private.normalized_veterina_code(text) from public;
grant execute on function private.normalized_veterina_code(text) to veterina_rpc;
create function private.lookup_veterina_code(p_code text) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('valid',true,'clinicName',s.clinic_name)
    from private.clinic_codes k join public.clinics c on c.id=k.clinic_id join public.clinic_settings s on s.clinic_id=c.id
    where length(p_code)<=60 and k.code=private.normalized_veterina_code(p_code) and c.is_active),'{"valid":false}'::jsonb);
$$;
-- Public validation reveals only a shop name for an exact, high-entropy code.
revoke all on function private.lookup_veterina_code(text) from public;
grant execute on function private.lookup_veterina_code(text) to anon,authenticated;
-- The schema is not exposed by PostgREST. Anonymous callers get EXECUTE only
-- on the bounded code lookup used by this invoker wrapper, never clinic RPCs.
grant usage on schema private to anon;
create function public.veterina_code_info(p_code text) returns jsonb language sql stable security invoker set search_path='' as $$ select private.lookup_veterina_code(p_code); $$;
revoke all on function public.veterina_code_info(text) from public;
grant execute on function public.veterina_code_info(text) to anon,authenticated;

create function private.register_veterina_staff() returns trigger language plpgsql security definer set search_path='' as $$
declare clinic uuid; full_name text;
begin
  if tg_op='UPDATE' then
    update private.staff_join_requests set email=coalesce(new.email,''),email_confirmed=new.email_confirmed_at is not null where id=new.id;
    return new;
  end if;
  if new.raw_user_meta_data->>'application' is distinct from 'veterina' then return new; end if;
  select k.clinic_id into clinic from private.clinic_codes k join public.clinics c on c.id=k.clinic_id
    where k.code=private.normalized_veterina_code(new.raw_user_meta_data->>'veterina_code') and c.is_active;
  if clinic is null then raise exception 'INVALID_VETERINA_CODE: use a current code from your shop owner'; end if;
  full_name:=btrim(coalesce(new.raw_user_meta_data->>'full_name',''));
  if length(full_name) not between 1 and 120 then raise exception 'VALIDATION_FAILED: full name required'; end if;
  -- Metadata is only an application request. No role or profile is created.
  insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed)
    values(new.id,clinic,full_name,coalesce(new.email,''),new.email_confirmed_at is not null);
  return new;
end $$;
revoke all on function private.register_veterina_staff() from public,anon,authenticated;
create trigger veterina_staff_signup after insert on auth.users for each row execute function private.register_veterina_staff();
create trigger veterina_staff_email after update of email,email_confirmed_at on auth.users for each row execute function private.register_veterina_staff();

grant create on schema private to veterina_rpc;
create function private.owner_veterina_code(p_rotate boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare result text; begin
  if private.staff_role() is distinct from 'owner' then raise exception 'FORBIDDEN: owner required'; end if;
  if p_rotate then
    update private.clinic_codes set code='VET-'||upper(encode(extensions.gen_random_bytes(10),'hex')),updated_at=now() where clinic_id=private.current_clinic_id() returning code into result;
    insert into public.audit_logs(actor_id,action,table_name,record_id) values(auth.uid(),'VETERINA_CODE_ROTATED','clinics',private.current_clinic_id()::text);
  else select code into result from private.clinic_codes where clinic_id=private.current_clinic_id(); end if;
  return jsonb_build_object('code',result);
end $$;
alter function private.owner_veterina_code(boolean) owner to veterina_rpc;
revoke all on function private.owner_veterina_code(boolean) from public;
grant execute on function private.owner_veterina_code(boolean) to authenticated;
create function public.owner_veterina_code(p_rotate boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.owner_veterina_code(p_rotate); $$;
revoke all on function public.owner_veterina_code(boolean) from public;
grant execute on function public.owner_veterina_code(boolean) to authenticated;

create function private.staff_administration(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=nullif(p_data->>'id','')::uuid; application private.staff_join_requests; member public.profiles;
  desired_role public.staff_role:=coalesce(nullif(p_data->>'role',''),'clinical_staff')::public.staff_role;
  enabled boolean:=coalesce((p_data->>'is_active')::boolean,true); result jsonb;
begin
  if private.staff_role() is distinct from 'owner' or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'FORBIDDEN: owner MFA required'; end if;
  if p_action='list' then
    select jsonb_build_object('accounts',coalesce(jsonb_agg(row),'[]')) into result from (
      select r.id,r.email,coalesce(p.full_name,r.full_name) full_name,p.role,coalesce(p.is_active,false) is_active,r.email_confirmed,r.status
      from private.staff_join_requests r left join public.profiles p on p.id=r.id
      where r.clinic_id=private.current_clinic_id() and r.status<>'rejected' order by r.requested_at desc
    ) row;
    return result;
  end if;
  if p_action in ('approve','reject') then
    select * into application from private.staff_join_requests where id=target and clinic_id=private.current_clinic_id() for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if application.status<>'pending' then raise exception 'VALIDATION_FAILED: this registration has already been reviewed'; end if;
    if p_action='reject' then
      update private.staff_join_requests set status='rejected',decided_at=now(),decided_by=auth.uid() where id=target;
    else
      if not application.email_confirmed then raise exception 'VALIDATION_FAILED: verified email required'; end if;
      if desired_role<>'clinical_staff' or length(btrim(coalesce(p_data->>'full_name',''))) not between 1 and 120 then raise exception 'VALIDATION_FAILED: approve a staff name and role'; end if;
      insert into public.profiles(id,clinic_id,full_name,role,is_active) values(target,application.clinic_id,btrim(p_data->>'full_name'),'clinical_staff',true);
      update private.staff_join_requests set status='approved',decided_at=now(),decided_by=auth.uid() where id=target;
    end if;
  elsif p_action='update' then
    perform 1 from public.profiles where clinic_id=private.current_clinic_id() and role='owner' and is_active order by id for update;
    select * into member from public.profiles where id=target and clinic_id=private.current_clinic_id() for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if member.role='owner' and member.is_active and (desired_role<>'owner' or not enabled)
      and (select count(*) from public.profiles where clinic_id=member.clinic_id and role='owner' and is_active)<2 then raise exception 'VALIDATION_FAILED: keep at least one active shop owner'; end if;
    update public.profiles set role=desired_role,is_active=enabled where id=target;
  else raise exception 'VALIDATION_FAILED: unknown staff action'; end if;
  insert into public.audit_logs(actor_id,action,table_name,record_id) values(auth.uid(),'STAFF_'||upper(p_action),'profiles',target::text);
  return jsonb_build_object('success',true);
end $$;
alter function private.staff_administration(text,jsonb) owner to veterina_rpc;
revoke all on function private.staff_administration(text,jsonb) from public;
grant execute on function private.staff_administration(text,jsonb) to authenticated;
create function public.staff_administration(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.staff_administration(p_action,p_data); $$;
revoke all on function public.staff_administration(text,jsonb) from public;
grant execute on function public.staff_administration(text,jsonb) to authenticated;

-- Administrative provisioning accepts an existing Auth account, never a role
-- from registration metadata. This endpoint is unavailable to browser roles.
create function public.provision_vetshop(p_owner_id uuid,p_shop_name text,p_owner_name text,p_timezone text default 'Asia/Manila') returns uuid
language plpgsql security definer set search_path='' as $$
declare clinic uuid:=gen_random_uuid(); begin
  if length(btrim(p_shop_name)) not between 1 and 160 or length(btrim(p_owner_name)) not between 1 and 120 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'VALIDATION_FAILED'; end if;
  if not exists(select 1 from auth.users where id=p_owner_id and email_confirmed_at is not null) or exists(select 1 from public.profiles where id=p_owner_id) then raise exception 'VALIDATION_FAILED: use a verified, unassigned owner account'; end if;
  insert into public.clinics(id,name) values(clinic,btrim(p_shop_name));
  insert into public.clinic_settings(clinic_id,clinic_name,timezone) values(clinic,btrim(p_shop_name),p_timezone);
  insert into public.service_types(clinic_id,name,workflow,default_duration_minutes) values
    (clinic,'Wellness check','checkup',30),(clinic,'Sick visit','checkup',30),(clinic,'Follow-up','checkup',20),
    (clinic,'Surgery','checkup',60),(clinic,'Vaccination','vaccination',20),(clinic,'Grooming','maintenance',60);
  insert into private.clinic_codes(clinic_id) values(clinic);
  insert into public.profiles(id,clinic_id,full_name,role,is_active) values(p_owner_id,clinic,btrim(p_owner_name),'owner',true);
  insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed,status)
    select id,clinic,btrim(p_owner_name),coalesce(email,''),true,'approved' from auth.users where id=p_owner_id
    on conflict(id) do update set clinic_id=excluded.clinic_id,status='approved',full_name=excluded.full_name;
  return clinic;
end $$;
revoke all on function public.provision_vetshop(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_vetshop(uuid,text,text,text) to service_role;

-- Close the legacy service-only staff update path across shop boundaries too.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.admin_update_staff(uuid,uuid,public.staff_role,boolean)'::regprocedure);
  patched:=replace(definition,'  perform 1 from public.profiles where role=',
    '  if not exists(select 1 from public.profiles p join public.profiles a on a.id=p_actor where p.id=p_id and p.clinic_id=a.clinic_id) then raise exception ''FORBIDDEN''; end if;'||chr(10)||'  perform 1 from public.profiles where clinic_id=(select clinic_id from public.profiles where id=p_actor) and role=');
  patched:=replace(patched,'select count(*) from public.profiles where role=', 'select count(*) from public.profiles where clinic_id=(select clinic_id from public.profiles where id=p_actor) and role=');
  if patched=definition then raise exception 'Expected legacy staff update not found'; end if;
  execute patched;
end $$;
revoke create on schema private from veterina_rpc;
notify pgrst,'reload schema';
