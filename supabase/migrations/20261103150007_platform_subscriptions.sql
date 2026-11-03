-- Platform permissions never come from clinic roles or editable Auth metadata.
create table private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table private.clinic_subscriptions (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  transition_grant boolean not null default false
);
create table private.activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  suffix text not null,
  label text not null default '' check(length(label)<=120),
  window_days integer not null check(window_days between 1 and 3650),
  term_days integer not null check(term_days between 1 and 3650),
  first_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index activation_codes_creator on private.activation_codes(created_by);
create table private.activation_redemptions (
  code_id uuid not null references private.activation_codes(id),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  redeemed_at timestamptz not null default now(),
  primary key(code_id,clinic_id)
);
create index activation_redemptions_clinic on private.activation_redemptions(clinic_id);
create index activation_redemptions_user on private.activation_redemptions(user_id);
create table private.subscription_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id),
  code_id uuid references private.activation_codes(id),
  actor_id uuid references auth.users(id),
  action text not null,
  previous_expiry timestamptz,
  expires_at timestamptz,
  days integer,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index subscription_events_clinic on private.subscription_events(clinic_id,created_at desc);
create index subscription_events_code on private.subscription_events(code_id);
create index subscription_events_actor on private.subscription_events(actor_id);
create table private.subscription_receipts (
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  primary key(actor_id,request_id)
);
alter table private.platform_admins enable row level security;
alter table private.clinic_subscriptions enable row level security;
alter table private.activation_codes enable row level security;
alter table private.activation_redemptions enable row level security;
alter table private.subscription_events enable row level security;
alter table private.subscription_receipts enable row level security;
revoke all on private.platform_admins,private.clinic_subscriptions,private.activation_codes,
  private.activation_redemptions,private.subscription_events,private.subscription_receipts from public,anon,authenticated;
grant select,insert,update on private.platform_admins,private.clinic_subscriptions,private.activation_codes,
  private.activation_redemptions,private.subscription_events,private.subscription_receipts to service_role;

-- Metadata-only transition grant: existing records and disabled shops are retained.
insert into private.clinic_subscriptions(clinic_id,expires_at,transition_grant)
  select id,now()+interval '30 days',true from public.clinics;
insert into private.subscription_events(clinic_id,action,expires_at,days)
  select clinic_id,'transition_grant',expires_at,30 from private.clinic_subscriptions;
do $$ declare actor uuid; begin
  select id into actor from auth.users where lower(email)='moronaldrin3@gmail.com' and email_confirmed_at is not null;
  if actor is null then raise exception 'SETUP_REQUIRED: verified initial administrator not found'; end if;
  insert into private.platform_admins(user_id) values(actor);
end $$;

create function private.subscription_active(p_clinic uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.clinic_subscriptions where clinic_id=p_clinic and expires_at>now());
$$;
revoke all on function private.subscription_active(uuid) from public,anon,authenticated;
grant execute on function private.subscription_active(uuid) to veterina_rpc,service_role;

create or replace function private.current_clinic_id() returns uuid
language sql stable security definer set search_path='' as $$
  select p.clinic_id from public.profiles p join public.clinics c on c.id=p.clinic_id
  where p.id=(select auth.uid()) and p.is_active and c.is_active and private.subscription_active(c.id);
$$;
create or replace function private.staff_role() returns public.staff_role
language sql stable security definer set search_path='' as $$
  select p.role from public.profiles p join public.clinics c on c.id=p.clinic_id
  where p.id=(select auth.uid()) and p.is_active and c.is_active and private.subscription_active(c.id);
$$;

-- Minimal billing metadata stays readable after expiry; no clinical records are returned.
create function private.account_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member public.profiles; shop public.clinics; sub private.clinic_subscriptions;
  settings public.clinic_settings; registration text; platform boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  select exists(select 1 from private.platform_admins where user_id=actor) into platform;
  select * into member from public.profiles where id=actor;
  if found then
    select * into shop from public.clinics where id=member.clinic_id;
    select * into sub from private.clinic_subscriptions where clinic_id=member.clinic_id;
    select * into settings from public.clinic_settings where clinic_id=member.clinic_id;
    return jsonb_build_object('isPlatformAdmin',platform,'needsRegistration',false,'serverNow',now(),
      'subscription',jsonb_build_object('clinicId',member.clinic_id,'clinicName',settings.clinic_name,
        'timezone',coalesce(settings.timezone,'Asia/Manila'),'expiresAt',sub.expires_at,'startedAt',sub.started_at,
        'transition',coalesce(sub.transition_grant,false),'status',case when not member.is_active or not shop.is_active then 'disabled'
          when sub.expires_at>now() then 'active' else 'expired' end));
  end if;
  if exists(select 1 from private.staff_join_requests where id=actor) then registration:='staff';
  elsif exists(select 1 from private.owner_registrations where id=actor and clinic_id is null) then registration:='owner';
  elsif exists(select 1 from auth.identities where user_id=actor and provider='google') then registration:='google';
  end if;
  return jsonb_build_object('isPlatformAdmin',platform,'serverNow',now(),'subscription',null,
    'registrationType',registration,'needsRegistration',registration in ('owner','google'));
end $$;
revoke all on function private.account_access() from public,anon;
grant execute on function private.account_access() to authenticated;
create function public.account_access() returns jsonb language sql security invoker set search_path='' as $$ select private.account_access(); $$;
revoke all on function public.account_access() from public,anon;
grant execute on function public.account_access() to authenticated;

-- New Storage objects use <clinic UUID>/<path>. Existing unprefixed files belong
-- exclusively to the original clinic. Subscription checks apply to both forms.
create function private.clinic_storage_path(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_clinic_id() is not null and (
    split_part(p_name,'/',1)=private.current_clinic_id()::text or
    (private.current_clinic_id()=private.legacy_clinic_id() and
      split_part(p_name,'/',1)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );
$$;
revoke all on function private.clinic_storage_path(text) from public,anon;
grant execute on function private.clinic_storage_path(text) to authenticated;
drop policy if exists staff_read_clinic_files on storage.objects;
create policy staff_read_clinic_files on storage.objects for select to authenticated using (
  bucket_id in ('pet-photos','medical-attachments') and private.clinic_storage_path(name));
drop policy if exists staff_upload_clinic_files on storage.objects;
create policy staff_upload_clinic_files on storage.objects for insert to authenticated with check (
  bucket_id in ('pet-photos','medical-attachments') and (select private.current_clinic_id())::text=split_part(name,'/',1));
drop policy if exists owner_delete_clinic_files on storage.objects;
create policy owner_delete_clinic_files on storage.objects for delete to authenticated using (
  bucket_id in ('pet-photos','medical-attachments') and (select private.staff_role())='owner' and private.clinic_storage_path(name));
drop policy if exists kb_owner_upload on storage.objects;
create policy kb_owner_upload on storage.objects for insert to authenticated with check (
  bucket_id='knowledge-base' and (select private.staff_role())='owner' and (select private.current_clinic_id())::text=split_part(name,'/',1));
drop policy if exists kb_owner_delete on storage.objects;
create policy kb_owner_delete on storage.objects for delete to authenticated using (
  bucket_id='knowledge-base' and (select private.staff_role())='owner' and private.clinic_storage_path(name));

-- This service-only entrypoint receives the actor exclusively from verified JWTs.
create function private.platform_subscription_admin(p_actor uuid,p_action text,p_data jsonb default '{}'::jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; token text; code_id uuid; target uuid; days integer; window_days integer; previous timestamptz; expiry timestamptz;
  fingerprint text; receipt private.subscription_receipts; operation_time timestamptz;
begin
  if not exists(select 1 from private.platform_admins a join auth.users u on u.id=a.user_id where a.user_id=p_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then raise exception 'FORBIDDEN: platform administrator required'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if p_action='list' then
    return jsonb_build_object('serverNow',now(),
      'clinics',coalesce((select jsonb_agg(row_data order by row_data->>'clinicName') from (
        select jsonb_build_object('id',c.id,'clinicName',s.clinic_name,'timezone',s.timezone,'isActive',c.is_active,
          'owners',coalesce((select jsonb_agg(jsonb_build_object('name',p.full_name,'email',u.email)) from public.profiles p join auth.users u on u.id=p.id where p.clinic_id=c.id and p.role='owner'),'[]'::jsonb),
          'expiresAt',cs.expires_at,'startedAt',cs.started_at,'transition',coalesce(cs.transition_grant,false),
          'status',case when not c.is_active then 'disabled' when cs.expires_at>now() then 'active' else 'expired' end) as row_data
          from public.clinics c join public.clinic_settings s on s.clinic_id=c.id left join private.clinic_subscriptions cs on cs.clinic_id=c.id
      ) rows),'[]'::jsonb),
      'codes',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'label',k.label,'suffix',k.suffix,'windowDays',k.window_days,'termDays',k.term_days,
        'firstUsedAt',k.first_used_at,'expiresAt',k.first_used_at+k.window_days*interval '1 day','createdAt',k.created_at,
        'redemptions',(select count(*) from private.activation_redemptions r where r.code_id=k.id),
        'status',case when k.revoked_at is not null then 'revoked' when k.first_used_at is null then 'unused'
          when k.first_used_at+k.window_days*interval '1 day'<=now() then 'expired' else 'active' end) order by k.created_at desc) from private.activation_codes k),'[]'::jsonb));
  elsif p_action='history' then
    target:=(p_data->>'clinicId')::uuid;
    return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from private.subscription_events e where e.clinic_id=target),'[]'::jsonb));
  elsif p_action='generate' then
    if coalesce(p_data->>'termDays','')!~'^[0-9]{1,4}$' or coalesce(p_data->>'windowDays','')!~'^[0-9]{1,4}$' or length(coalesce(p_data->>'label',''))>120 then raise exception 'VALIDATION_FAILED: check label and durations'; end if;
    days:=(p_data->>'termDays')::integer; window_days:=(p_data->>'windowDays')::integer;
    if days not between 1 and 3650 or window_days not between 1 and 3650 then raise exception 'VALIDATION_FAILED: durations must be 1 to 3650 days'; end if;
    token:='VET-ACCESS-'||upper(encode(extensions.gen_random_bytes(20),'hex'));
    insert into private.activation_codes(code_hash,suffix,label,window_days,term_days,created_by)
      values(encode(extensions.digest(token,'sha256'),'hex'),right(token,6),btrim(coalesce(p_data->>'label','')),window_days,days,p_actor) returning id into code_id;
    insert into private.subscription_events(code_id,actor_id,action,days) values(code_id,p_actor,'code_generated',days);
    return jsonb_build_object('id',code_id,'code',token);
  end if;
  if p_action not in ('extend','revoke') or p_request_id is null then raise exception 'VALIDATION_FAILED: request identifier required'; end if;
  perform 1 from auth.users where id=p_actor for update;
  fingerprint:=encode(extensions.digest(p_action||p_data::text,'sha256'),'hex');
  select * into receipt from private.subscription_receipts where actor_id=p_actor and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>fingerprint then raise exception 'REQUEST_CHANGED'; end if;
    return receipt.result;
  end if;
  if p_action='revoke' then
    code_id:=(p_data->>'codeId')::uuid;
    update private.activation_codes set revoked_at=coalesce(revoked_at,now()) where id=code_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    insert into private.subscription_events(code_id,actor_id,action) values(code_id,p_actor,'code_revoked');
    result:=jsonb_build_object('id',code_id);
  else
    target:=(p_data->>'clinicId')::uuid;
    if coalesce(p_data->>'days','')!~'^[0-9]{1,4}$' or length(coalesce(p_data->>'note',''))>500 then raise exception 'VALIDATION_FAILED'; end if;
    days:=(p_data->>'days')::integer;
    if days not between 1 and 3650 then raise exception 'VALIDATION_FAILED: extension must be 1 to 3650 days'; end if;
    perform 1 from public.clinics where id=target for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select expires_at into previous from private.clinic_subscriptions where clinic_id=target for update;
    operation_time:=clock_timestamp();
    expiry:=greatest(coalesce(previous,operation_time),operation_time)+days*interval '1 day';
    insert into private.clinic_subscriptions(clinic_id,expires_at) values(target,expiry)
      on conflict(clinic_id) do update set expires_at=excluded.expires_at,transition_grant=false;
    insert into private.subscription_events(clinic_id,actor_id,action,previous_expiry,expires_at,days,note)
      values(target,p_actor,'admin_extension',previous,expiry,days,btrim(coalesce(p_data->>'note','')));
    result:=jsonb_build_object('clinicId',target,'expiresAt',expiry);
  end if;
  insert into private.subscription_receipts values(p_actor,p_request_id,fingerprint,result);
  return result;
end $$;
revoke all on function private.platform_subscription_admin(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.platform_subscription_admin(uuid,text,jsonb,uuid) to service_role;
create function public.platform_subscription_admin(p_actor uuid,p_action text,p_data jsonb default '{}'::jsonb,p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.platform_subscription_admin(p_actor,p_action,p_data,p_request_id); $$;
revoke all on function public.platform_subscription_admin(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.platform_subscription_admin(uuid,text,jsonb,uuid) to service_role;

create function private.redeem_clinic_activation(p_actor uuid,p_code text,p_details jsonb,p_request_id uuid,p_renew boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account auth.users; member public.profiles; code private.activation_codes; registration private.owner_registrations;
  clinic uuid; previous timestamptz; expiry timestamptz; fingerprint text; receipt private.subscription_receipts; operation_time timestamptz; result jsonb;
  name text; full_name text; normalized text:=upper(btrim(coalesce(p_code,'')));
begin
  if p_request_id is null or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  select * into account from auth.users where id=p_actor for update;
  if not found or account.email_confirmed_at is null or (account.banned_until is not null and account.banned_until>now()) then raise exception 'FORBIDDEN: verified account required'; end if;
  fingerprint:=encode(extensions.digest('redeem:'||normalized||p_details::text||p_renew::text,'sha256'),'hex');
  select * into receipt from private.subscription_receipts where actor_id=p_actor and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>fingerprint then raise exception 'REQUEST_CHANGED'; end if;
    return receipt.result;
  end if;
  select * into member from public.profiles where id=p_actor;
  if found then
    if not p_renew or member.role<>'owner' or not member.is_active or not exists(select 1 from public.clinics where id=member.clinic_id and is_active) then raise exception 'FORBIDDEN: active clinic owner required'; end if;
    clinic:=member.clinic_id;
  else
    if p_renew or exists(select 1 from private.staff_join_requests where id=p_actor) then raise exception 'FORBIDDEN'; end if;
  end if;
  if normalized!~'^VET-ACCESS-[0-9A-F]{40}$' then raise exception 'ACTIVATION_CODE_INVALID'; end if;
  select * into code from private.activation_codes where code_hash=encode(extensions.digest(normalized,'sha256'),'hex') for update;
  if not found then raise exception 'ACTIVATION_CODE_INVALID'; end if;
  operation_time:=clock_timestamp();
  if code.revoked_at is not null then raise exception 'ACTIVATION_CODE_REVOKED'; end if;
  if code.first_used_at is not null and code.first_used_at+code.window_days*interval '1 day'<=operation_time then raise exception 'ACTIVATION_CODE_EXPIRED'; end if;
  if clinic is not null and exists(select 1 from private.activation_redemptions where code_id=code.id and clinic_id=clinic) then raise exception 'ACTIVATION_CODE_USED'; end if;
  if clinic is null then
    select * into registration from private.owner_registrations where id=p_actor for update;
    if found then name:=registration.clinic_name; full_name:=registration.full_name;
    else name:=btrim(coalesce(p_details->>'clinicName','')); full_name:=btrim(coalesce(p_details->>'fullName','')); end if;
    if length(coalesce(name,'')) not between 1 and 160 or length(coalesce(full_name,'')) not between 1 and 120 then raise exception 'VALIDATION_FAILED: clinic and full name required'; end if;
    clinic:=public.provision_vetshop(p_actor,name,full_name,'Asia/Manila');
    insert into private.owner_registrations(id,full_name,clinic_name,clinic_id) values(p_actor,full_name,name,clinic)
      on conflict(id) do update set clinic_id=excluded.clinic_id;
  end if;
  perform 1 from public.clinics where id=clinic for update;
  select expires_at into previous from private.clinic_subscriptions where clinic_id=clinic for update;
  expiry:=greatest(coalesce(previous,clock_timestamp()),clock_timestamp())+code.term_days*interval '1 day';
  insert into private.clinic_subscriptions(clinic_id,expires_at) values(clinic,expiry)
    on conflict(clinic_id) do update set expires_at=excluded.expires_at,transition_grant=false;
  update private.activation_codes set first_used_at=coalesce(first_used_at,operation_time) where id=code.id;
  insert into private.activation_redemptions(code_id,clinic_id,user_id) values(code.id,clinic,p_actor);
  insert into private.subscription_events(clinic_id,code_id,actor_id,action,previous_expiry,expires_at,days)
    values(clinic,code.id,p_actor,case when p_renew then 'code_renewal' else 'clinic_activation' end,previous,expiry,code.term_days);
  result:=jsonb_build_object('clinicId',clinic,'expiresAt',expiry,'status','registered');
  insert into private.subscription_receipts values(p_actor,p_request_id,fingerprint,result);
  return result;
end $$;
revoke all on function private.redeem_clinic_activation(uuid,text,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function private.redeem_clinic_activation(uuid,text,jsonb,uuid,boolean) to service_role;
create function public.redeem_clinic_activation(p_actor uuid,p_code text,p_details jsonb,p_request_id uuid,p_renew boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.redeem_clinic_activation(p_actor,p_code,p_details,p_request_id,p_renew); $$;
revoke all on function public.redeem_clinic_activation(uuid,text,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.redeem_clinic_activation(uuid,text,jsonb,uuid,boolean) to service_role;

-- Signup records intent; confirmed accounts redeem a code in a separate transaction.
create or replace function private.register_veterina_staff() returns trigger
language plpgsql security definer set search_path='' as $$
declare clinic uuid; full_name text; account_type text;
begin
  if tg_op='UPDATE' then
    update private.staff_join_requests set email=coalesce(new.email,''),email_confirmed=new.email_confirmed_at is not null where id=new.id;
    return new;
  end if;
  if new.raw_user_meta_data->>'application' is distinct from 'veterina' then return new; end if;
  full_name:=btrim(coalesce(new.raw_user_meta_data->>'full_name',''));
  if length(full_name) not between 1 and 120 then raise exception 'VALIDATION_FAILED: full name required'; end if;
  account_type:=coalesce(new.raw_user_meta_data->>'account_type','staff');
  if account_type='owner' then
    if length(btrim(coalesce(new.raw_user_meta_data->>'clinic_name',''))) not between 1 and 160 then raise exception 'VALIDATION_FAILED: clinic name required'; end if;
    insert into private.owner_registrations(id,full_name,clinic_name) values(new.id,full_name,btrim(new.raw_user_meta_data->>'clinic_name'));
  elsif account_type='staff' then
    select k.clinic_id into clinic from private.clinic_codes k join public.clinics c on c.id=k.clinic_id
      where k.code=private.normalized_veterina_code(new.raw_user_meta_data->>'veterina_code') and c.is_active and private.subscription_active(c.id);
    if clinic is null then raise exception 'INVALID_VETERINA_CODE: use a current code from an active shop'; end if;
    insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed) values(new.id,clinic,full_name,coalesce(new.email,''),new.email_confirmed_at is not null);
  else raise exception 'VALIDATION_FAILED: choose owner or staff'; end if;
  return new;
end $$;

-- Close the old Google owner-provisioning path; staff registration is retained.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('private.google_account_registration(uuid,jsonb)'::regprocedure);
  definition:=replace(definition,'clinic := public.provision_vetshop(actor, clinic_name, full_name, ''Asia/Manila'');',
    'raise exception ''ACTIVATION_CODE_REQUIRED: activate your clinic using a subscription code'';');
  if position('raise exception ''ACTIVATION_CODE_REQUIRED' in definition)=0 then raise exception 'MIGRATION_FAILED: Google registration definition changed'; end if;
  execute definition;
end $$;
notify pgrst,'reload schema';
