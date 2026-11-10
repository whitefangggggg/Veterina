-- KAN-22. Codes are bearer secrets; only hashes are retained in sharing tables.
create table public.admission_public_sharing (
  id uuid primary key references public.admissions(id),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  enabled boolean not null default false,
  token_hash text unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  pet_display_name text not null default '' check(length(pet_display_name)<=120),
  clinic_name text not null default '' check(length(clinic_name)<=200),
  clinic_contact text not null default '' check(length(clinic_contact)<=1000),
  show_species boolean not null default false,
  show_admission_details boolean not null default false,
  public_reason text not null default '' check(length(public_reason)<=1000),
  published_update text not null default '' check(length(published_update)<=2000),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  check(not enabled or (token_hash is not null and expires_at is not null and isfinite(expires_at)
    and length(btrim(pet_display_name))>0 and length(btrim(clinic_name))>0))
);
create index admission_public_sharing_clinic on public.admission_public_sharing(clinic_id);
alter table public.admission_public_sharing enable row level security;
revoke all on public.admission_public_sharing from public,anon,authenticated;
grant select on public.admission_public_sharing to authenticated,service_role;
create policy clinic_read on public.admission_public_sharing for select to authenticated
  using(clinic_id=(select private.current_clinic_id()));
-- Restored hosted projects may retain postgres as the dispatcher owner rather
-- than the local no-login role. Grant only to the actual existing RPC owner.
do $$ declare rpc_owner name; begin
  select pg_get_userbyid(proowner) into rpc_owner from pg_proc
    where oid='private.portal_mutation(text,jsonb,uuid)'::regprocedure;
  execute format('grant select,insert,update on public.admission_public_sharing to %I',rpc_owner);
  execute format('create policy clinic_rpc on public.admission_public_sharing for all to %I using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()))',rpc_owner);
end $$;
create trigger a_clinic_scope before insert or update on public.admission_public_sharing
  for each row execute function private.enforce_clinic_scope();
create trigger audit after insert or update on public.admission_public_sharing
  for each row execute function private.write_audit_log();

-- Never reuse a retired hash, even after rotation/revocation or another stay.
create table private.admission_tracking_credentials (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  admission_id uuid not null references public.admissions(id),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id)
);
create index admission_tracking_credentials_admission on private.admission_tracking_credentials(admission_id);
create index admission_tracking_credentials_clinic on private.admission_tracking_credentials(clinic_id);
alter table private.admission_tracking_credentials enable row level security;
revoke all on private.admission_tracking_credentials from public,anon,authenticated;
do $$ declare rpc_owner name; begin
  select pg_get_userbyid(proowner) into rpc_owner from pg_proc
    where oid='private.portal_mutation(text,jsonb,uuid)'::regprocedure;
  execute format('grant select,insert on private.admission_tracking_credentials to %I',rpc_owner);
  execute format('create policy clinic_rpc on private.admission_tracking_credentials for all to %I using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()))',rpc_owner);
end $$;

create function private.tracking_mutation(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.admissions; s public.admission_public_sharing; token text; hash text;
  alphabet constant text:='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  bytes bytea; b integer; i integer; attempt integer; inserted integer;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  select * into a from public.admissions where id=(p_data->>'id')::uuid
    and clinic_id=private.current_clinic_id() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.status='cancelled' or a.is_historical then raise exception 'VALIDATION_FAILED: tracking is unavailable for cancelled or historical stays'; end if;
  insert into public.admission_public_sharing(id) values(a.id) on conflict do nothing;
  select * into s from public.admission_public_sharing where id=a.id for update;
  if (p_data->>'expectedVersion')::integer is distinct from s.version then raise exception 'RECORD_CHANGED: reload public sharing'; end if;
  if p_action='tracking_configure' then
    if jsonb_typeof(p_data->'showSpecies') is distinct from 'boolean'
      or jsonb_typeof(p_data->'showAdmissionDetails') is distinct from 'boolean'
      or length(btrim(coalesce(p_data->>'petDisplayName',''))) not between 1 and 120
      or length(btrim(coalesce(p_data->>'clinicName',''))) not between 1 and 200 then
      raise exception 'VALIDATION_FAILED: approve the public display fields';
    end if;
    update public.admission_public_sharing set pet_display_name=btrim(p_data->>'petDisplayName'),
      clinic_name=btrim(p_data->>'clinicName'),clinic_contact=btrim(coalesce(p_data->>'clinicContact','')),
      show_species=(p_data->>'showSpecies')::boolean,show_admission_details=(p_data->>'showAdmissionDetails')::boolean,
      public_reason=btrim(coalesce(p_data->>'publicReason','')) where id=a.id;
  elsif p_action='tracking_generate' then
    if (p_data->>'acknowledgePublic')::boolean is distinct from true then raise exception 'VALIDATION_FAILED: explicitly approve bearer-secret sharing'; end if;
    if s.pet_display_name='' or s.clinic_name='' then raise exception 'VALIDATION_FAILED: approve public fields first'; end if;
    if a.closed_at is not null and a.closed_at+interval '7 days'<=now() then raise exception 'VALIDATION_FAILED: discharge visibility has ended'; end if;
    for attempt in 1..10 loop
      token:='';
      -- Rejection sampling avoids modulo bias over the 62-character alphabet.
      while length(token)<13 loop
        bytes:=extensions.gen_random_bytes(24);
        for i in 0..23 loop
          b:=get_byte(bytes,i);
          if b<248 then token:=token||substr(alphabet,(b%62)+1,1); end if;
          exit when length(token)=13;
        end loop;
      end loop;
      hash:=encode(extensions.digest(token,'sha256'),'hex');
      insert into private.admission_tracking_credentials(token_hash,admission_id) values(hash,a.id) on conflict do nothing;
      get diagnostics inserted=row_count;
      exit when inserted=1;
    end loop;
    if inserted<>1 then raise exception 'TEMPORARILY_UNAVAILABLE'; end if;
    update public.admission_public_sharing set enabled=true,token_hash=hash,expires_at=now()+interval '90 days' where id=a.id;
  elsif p_action='tracking_revoke' then
    update public.admission_public_sharing set enabled=false,token_hash=null where id=a.id;
  elsif p_action='tracking_publish' then
    if length(btrim(coalesce(p_data->>'update',''))) not between 1 and 2000
      or (p_data->>'acknowledgePublic')::boolean is distinct from true then
      raise exception 'VALIDATION_FAILED: explicitly approve an owner-facing update (1–2000 characters)';
    end if;
    update public.admission_public_sharing set published_update=btrim(p_data->>'update'),published_at=clock_timestamp() where id=a.id;
  elsif p_action='tracking_unpublish' then
    update public.admission_public_sharing set published_update='',published_at=null where id=a.id;
  else raise exception 'VALIDATION_FAILED: unknown tracking action';
  end if;
  update public.admission_public_sharing set version=version+1,updated_at=clock_timestamp() where id=a.id;
  perform private.admission_event(a.id,p_action,jsonb_build_object('sharingVersion',s.version+1));
  -- The portal's protected payload-bound receipt can replay a lost generation response.
  return jsonb_strip_nulls(jsonb_build_object('id',a.id,'version',s.version+1,'token',token));
end $$;
revoke all on function private.tracking_mutation(text,jsonb) from public,anon,authenticated;
do $$ declare rpc_owner name; begin
  select pg_get_userbyid(proowner) into rpc_owner from pg_proc
    where oid='private.portal_mutation(text,jsonb,uuid)'::regprocedure;
  execute format('grant execute on function private.tracking_mutation(text,jsonb) to %I',rpc_owner);
end $$;

do $$ declare d text; patched text; begin
  d:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(d,$old$if left(p_action,10)='admission_'$old$,$new$if left(p_action,9)='tracking_' then
    result:=private.tracking_mutation(p_action,p_data); entity:=(result->>'id')::uuid;
  elsif left(p_action,10)='admission_'$new$);
  if patched=d then raise exception 'Expected admission dispatcher missing'; end if;
  execute patched;
end $$;

-- Shared database buckets work across Edge isolates. No IPs or tokens are stored.
create table private.admission_tracking_limits (
  scope text not null,
  bucket timestamptz not null,
  attempts integer not null,
  primary key(scope,bucket)
);
create index admission_tracking_limits_expiry on private.admission_tracking_limits(bucket);
alter table private.admission_tracking_limits enable row level security;
revoke all on private.admission_tracking_limits from public,anon,authenticated;
grant select,insert,update,delete on private.admission_tracking_limits to service_role;
grant usage on schema private,extensions to service_role;

create function public.lookup_public_admission(p_token text,p_client_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare minute timestamptz:=date_trunc('minute',clock_timestamp()); n integer;
  s public.admission_public_sharing; a public.admissions; tz text; result jsonb; status_time timestamptz;
begin
  if p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  delete from private.admission_tracking_limits where bucket<minute-interval '2 minutes';
  insert into private.admission_tracking_limits as l(scope,bucket,attempts) values('global',minute,1)
    on conflict(scope,bucket) do update set attempts=least(l.attempts+1,301) returning attempts into n;
  if n>300 then return jsonb_build_object('limited',true); end if;
  insert into private.admission_tracking_limits as l(scope,bucket,attempts) values(p_client_hash,minute,1)
    on conflict(scope,bucket) do update set attempts=least(l.attempts+1,31) returning attempts into n;
  if n>30 then return jsonb_build_object('limited',true); end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9]{13}$' then return null; end if;
  select * into s from public.admission_public_sharing
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and enabled and expires_at>now();
  if not found then return null; end if;
  select * into a from public.admissions where id=s.id and clinic_id=s.clinic_id;
  if not found or a.status='cancelled' or a.is_historical
    or (a.closed_at is not null and a.closed_at+interval '7 days'<=now())
    or not exists(select 1 from public.clinics c where c.id=s.clinic_id and c.is_active)
    or not private.subscription_active(s.clinic_id) then return null; end if;
  select timezone into tz from public.clinic_settings where clinic_id=s.clinic_id;
  select max(occurred_at) into status_time from public.admission_events
    where admission_id=a.id and event_type in ('status','discharged');
  result:=jsonb_build_object('clinicName',s.clinic_name,'clinicContact',s.clinic_contact,
    'petName',s.pet_display_name,'status',a.status,'timezone',coalesce(tz,'Asia/Manila'),
    'updatedAt',greatest(s.updated_at,a.created_at,a.closed_at,status_time),
    'latestUpdate',nullif(s.published_update,''),'publishedAt',s.published_at);
  if s.show_species then result:=result||jsonb_build_object('species',(select species from public.pets where id=a.pet_id and clinic_id=s.clinic_id)); end if;
  if s.show_admission_details then result:=result||jsonb_build_object('reference',a.reference,'admittedAt',a.admitted_at); end if;
  if s.public_reason<>'' then result:=result||jsonb_build_object('reason',s.public_reason); end if;
  return result;
end $$;
revoke all on function public.lookup_public_admission(text,text) from public,anon,authenticated;
grant execute on function public.lookup_public_admission(text,text) to service_role;
notify pgrst,'reload schema';
