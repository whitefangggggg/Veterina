alter table public.pets add column has_photo boolean not null default false,
  add column photo_revision bigint not null default 0;
create table private.pet_photo_config(id boolean primary key default true check(id),enabled boolean not null default false);
insert into private.pet_photo_config values(true,false);
alter table private.pet_photo_config enable row level security;
revoke all on private.pet_photo_config from public,anon,authenticated;
grant all on private.pet_photo_config to service_role;

create table private.pet_photos (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  public_id text not null unique,
  asset_id text not null,
  version bigint not null,
  format text not null check(format in ('jpg','png','webp')),
  bytes integer not null check(bytes between 1 and 5000000),
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create table private.pet_photo_requests (
  id uuid primary key,
  pet_id uuid not null references public.pets(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  public_id text not null unique,
  base_revision bigint not null,
  completed boolean not null default false,
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index pet_photo_requests_pet on private.pet_photo_requests(pet_id);
create index pet_photo_requests_actor on private.pet_photo_requests(actor_id);
create table private.pet_photo_cleanup (
  public_id text primary key,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz
);
create index pet_photo_cleanup_ready on private.pet_photo_cleanup(available_at);
alter table private.pet_photos enable row level security;
alter table private.pet_photo_requests enable row level security;
alter table private.pet_photo_cleanup enable row level security;
revoke all on private.pet_photos,private.pet_photo_requests,private.pet_photo_cleanup from public,anon,authenticated;
grant all on private.pet_photos,private.pet_photo_requests,private.pet_photo_cleanup to service_role;

-- These fields can only be changed by the service-only photo RPC, never through
-- the existing staff mutation's security-definer execution context.
create function private.guard_pet_photo_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (new.has_photo is distinct from old.has_photo or new.photo_revision is distinct from old.photo_revision)
    and nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  return new;
end $$;
revoke all on function private.guard_pet_photo_metadata() from public,anon,authenticated;
create trigger pets_photo_metadata before update on public.pets for each row execute function private.guard_pet_photo_metadata();

create function private.enqueue_pet_photo_delete() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- A per-pet trigger runs before FK cascades, so metadata is still available.
  insert into private.pet_photo_cleanup(public_id)
    select public_id from private.pet_photos where pet_id=old.id on conflict(public_id) do nothing;
  return old;
end $$;
revoke all on function private.enqueue_pet_photo_delete() from public,anon,authenticated;
create trigger pets_photo_cleanup before delete on public.pets for each row execute function private.enqueue_pet_photo_delete();

-- Only Edge Functions with the service credential may call this RPC. Browser
-- callers can neither provide a Cloudinary reference nor read private metadata.
create function public.pet_photo_admin(p_actor uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  action text:=p_data->>'action'; patient public.pets; request private.pet_photo_requests;
  photo private.pet_photos; request_id uuid; generated_id text; result jsonb;
begin
  if action='provider_ready' then
    update private.pet_photo_config set enabled=coalesce((p_data->>'enabled')::boolean,false) where id;
    return '{}';
  elsif action='cleanup_enqueue' then
    insert into private.pet_photo_cleanup(public_id) values(p_data->>'publicId') on conflict do nothing;
    return '{}';
  end if;
  if action in ('cleanup_claim','cleanup_done','cleanup_failed') then
    if action='cleanup_claim' then
      with targets as (
        select c.public_id from private.pet_photo_cleanup c where c.available_at<=now()
          and (c.lease_until is null or c.lease_until<now())
          and not exists(select 1 from private.pet_photos p where p.public_id=c.public_id)
          and not exists(select 1 from private.pet_photo_requests r where r.public_id=c.public_id and not r.completed and r.lease_until>now())
          order by c.available_at for update skip locked limit 20
      ), claimed as (
        update private.pet_photo_cleanup c set lease_until=now()+interval '2 minutes',attempts=attempts+1
          from targets t where c.public_id=t.public_id returning c.public_id
      ) select coalesce(jsonb_agg(public_id),'[]') into result from claimed;
      return result;
    elsif action='cleanup_done' then
      delete from private.pet_photo_cleanup where public_id=p_data->>'publicId';
      delete from private.pet_photo_requests where public_id=p_data->>'publicId' and not completed;
    else
      update private.pet_photo_cleanup set lease_until=null,available_at=now()+interval '1 hour' where public_id=p_data->>'publicId';
    end if;
    return '{}';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor and is_active and role in ('owner','clinical_staff')) then raise exception 'FORBIDDEN'; end if;
  if action='capabilities' then return jsonb_build_object('enabled',(select enabled from private.pet_photo_config where id)); end if;
  select * into patient from public.pets where id=(p_data->>'petId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into photo from private.pet_photos where pet_id=patient.id;
  if action='read' then return to_jsonb(photo); end if;
  if action='remove' and photo.public_id is null then return jsonb_build_object('revision',patient.photo_revision); end if;
  if action='remove' and patient.photo_revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'PHOTO_CONFLICT'; end if;
  if action='begin' then
    request_id:=(p_data->>'requestId')::uuid;
    select * into request from private.pet_photo_requests where id=request_id for update;
    if found then
      if request.pet_id<>patient.id or request.actor_id<>p_actor or request.content_hash is distinct from p_data->>'contentHash' then raise exception 'VALIDATION_FAILED'; end if;
      if request.completed then return jsonb_build_object('completed',true,'revision',patient.photo_revision); end if;
      perform 1 from private.pet_photo_cleanup where public_id=request.public_id for update;
      if exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id and lease_until>now()) then raise exception 'PHOTO_BUSY'; end if;
      if request.lease_until>now() then raise exception 'PHOTO_BUSY'; end if;
      if request.base_revision<>patient.photo_revision then raise exception 'PHOTO_CONFLICT'; end if;
      update private.pet_photo_requests set lease_until=now()+interval '1 minute' where id=request_id;
      return jsonb_build_object('publicId',request.public_id,'completed',false);
    end if;
    if patient.photo_revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'PHOTO_CONFLICT'; end if;
    generated_id:='veterina/pet-photos/'||request_id;
    insert into private.pet_photo_requests(id,pet_id,actor_id,content_hash,public_id,base_revision,lease_until)
      values(request_id,patient.id,p_actor,p_data->>'contentHash',generated_id,patient.photo_revision,now()+interval '1 minute');
    -- Reserve cleanup before contacting Cloudinary, covering a crashed upload.
    insert into private.pet_photo_cleanup(public_id,available_at) values(generated_id,now()+interval '15 minutes');
    return jsonb_build_object('publicId',generated_id,'completed',false);
  elsif action='finish' then
    select * into request from private.pet_photo_requests where id=(p_data->>'requestId')::uuid for update;
    if not found or request.actor_id<>p_actor or request.pet_id<>patient.id then raise exception 'FORBIDDEN'; end if;
    if request.completed then return jsonb_build_object('revision',patient.photo_revision); end if;
    perform 1 from private.pet_photo_cleanup where public_id=request.public_id for update;
    if exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id and lease_until>now()) then raise exception 'PHOTO_BUSY'; end if;
    if request.base_revision<>patient.photo_revision then raise exception 'PHOTO_CONFLICT'; end if;
    if p_data->>'publicId' is distinct from request.public_id then raise exception 'VALIDATION_FAILED'; end if;
    if photo.public_id is not null then insert into private.pet_photo_cleanup(public_id) values(photo.public_id) on conflict do nothing; end if;
    insert into private.pet_photos(pet_id,public_id,asset_id,version,format,bytes,request_id)
      values(patient.id,request.public_id,p_data->>'assetId',(p_data->>'version')::bigint,p_data->>'format',(p_data->>'bytes')::integer,request.id)
      on conflict(pet_id) do update set public_id=excluded.public_id,asset_id=excluded.asset_id,version=excluded.version,format=excluded.format,bytes=excluded.bytes,request_id=excluded.request_id,created_at=now();
    update private.pet_photo_requests set completed=true,lease_until=now() where id=request.id;
    delete from private.pet_photo_cleanup where public_id=request.public_id;
    update public.pets set has_photo=true,photo_revision=photo_revision+1 where id=patient.id returning photo_revision into patient.photo_revision;
    insert into public.audit_logs(actor_id,action,table_name,record_id) values(p_actor,'PET_PHOTO_ATTACHED','pets',patient.id);
    return jsonb_build_object('revision',patient.photo_revision);
  elsif action='failed' then
    update private.pet_photo_requests set lease_until=now() where id=(p_data->>'requestId')::uuid and pet_id=patient.id and actor_id=p_actor and not completed;
    return '{}';
  elsif action='remove' then
    if photo.public_id is not null then insert into private.pet_photo_cleanup(public_id) values(photo.public_id) on conflict do nothing; end if;
    delete from private.pet_photos where pet_id=patient.id;
    update public.pets set has_photo=false,photo_revision=photo_revision+1 where id=patient.id returning photo_revision into patient.photo_revision;
    insert into public.audit_logs(actor_id,action,table_name,record_id) values(p_actor,'PET_PHOTO_REMOVED','pets',patient.id);
    return jsonb_build_object('revision',patient.photo_revision);
  end if;
  raise exception 'VALIDATION_FAILED';
end $$;
revoke all on function public.pet_photo_admin(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pet_photo_admin(uuid,jsonb) to service_role;

create function private.dispatch_pet_photo_cleanup() returns bigint
language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
  select net.http_post(url:=c.project_url||'/functions/v1/pet-photo-cleanup',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',c.publishable_key,'x-worker-secret',s.decrypted_secret),
    body:='{}'::jsonb) into request_id
  from private.rag_schedule_config c cross join vault.decrypted_secrets s where s.name='veterina_worker_secret';
  return request_id;
end $$;
revoke all on function private.dispatch_pet_photo_cleanup() from public,anon,authenticated;
select cron.schedule('veterina-photo-cleanup','0 * * * *','select private.dispatch_pet_photo_cleanup()');
notify pgrst,'reload schema';
