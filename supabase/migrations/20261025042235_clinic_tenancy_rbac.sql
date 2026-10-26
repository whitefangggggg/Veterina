-- Preserve the existing single clinic, then make every clinic record explicit.
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.clinics(id,name) select id,clinic_name from public.clinic_settings;
create table private.legacy_clinic(id boolean primary key default true check(id),clinic_id uuid not null references public.clinics(id));
insert into private.legacy_clinic(clinic_id) select id from public.clinics order by created_at limit 1;
alter table private.legacy_clinic enable row level security;
revoke all on private.legacy_clinic from public,anon,authenticated;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='veterina_rpc') then create role veterina_rpc nologin inherit nobypassrls; end if;
end $$;
grant veterina_rpc to postgres;
grant authenticated to veterina_rpc;
grant usage,create on schema private to veterina_rpc;
grant usage on schema public,auth,extensions to veterina_rpc;
grant execute on all functions in schema private to veterina_rpc;
grant execute on function auth.uid(),auth.jwt() to veterina_rpc;

create function private.legacy_clinic_id() returns uuid language sql stable security definer set search_path='' as $$
  select clinic_id from private.legacy_clinic where id;
$$;
revoke all on function private.legacy_clinic_id() from public,anon,authenticated;
grant execute on function private.legacy_clinic_id() to service_role,veterina_rpc;

-- Columns are populated before applying policies/guards. Existing profiles,
-- including co-owners, remain in the existing shop.
do $$ declare name text; begin
  foreach name in array array['profiles','owners','owner_contacts','pets','pet_alerts','visits','visit_vitals','diagnoses','treatments','prescriptions','vaccinations','attachments','appointments','appointment_events','queue_entries','reminders','reminder_activity','suppliers','inventory_items','item_suppliers','inventory_batches','inventory_movements','clinic_settings','service_types','audit_logs','idempotency_keys','export_events','kb_documents','rag_chunks','rag_jobs','ai_interactions','visit_corrections'] loop
    -- A constant column default populates legacy rows without firing clinical
    -- UPDATE triggers (or requiring missing historical routes to be invented).
    execute format('alter table public.%I add column clinic_id uuid not null default %L::uuid references public.clinics(id)',name,private.legacy_clinic_id());
    execute format('create index %I on public.%I(clinic_id)',name||'_clinic',name);
  end loop;
end $$;

create function private.current_clinic_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.clinic_id from public.profiles p join public.clinics c on c.id=p.clinic_id
  where p.id=(select auth.uid()) and p.is_active and c.is_active;
$$;
create or replace function private.staff_role() returns public.staff_role language sql stable security definer set search_path='' as $$
  select p.role from public.profiles p join public.clinics c on c.id=p.clinic_id
  where p.id=(select auth.uid()) and p.is_active and c.is_active;
$$;
revoke all on function private.current_clinic_id() from public,anon;
grant execute on function private.current_clinic_id() to authenticated,service_role,veterina_rpc;

-- A non-login role executes clinical RPCs and obeys RLS. It cannot be assumed by
-- browser roles, and has no BYPASSRLS or table ownership.
do $$ declare t record; policy record; signature text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename not in ('clinics') and exists(
    select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tablename and c.column_name='clinic_id') loop
    execute format('alter table public.%I alter column clinic_id set default private.current_clinic_id()',t.tablename);
    execute format('grant select,insert,update,delete on public.%I to veterina_rpc',t.tablename);
    for policy in select * from pg_policies where schemaname='public' and tablename=t.tablename and roles<>'{service_role}'::name[] loop
      if policy.qual is not null then
        execute format('alter policy %I on public.%I using ((%s) and clinic_id=(select private.current_clinic_id()))',policy.policyname,t.tablename,policy.qual);
      end if;
      if policy.with_check is not null then
        execute format('alter policy %I on public.%I with check ((%s) and clinic_id=(select private.current_clinic_id()))',policy.policyname,t.tablename,policy.with_check);
      end if;
    end loop;
    execute format('create policy clinic_rpc_write on public.%I for all to veterina_rpc using (clinic_id=(select private.current_clinic_id())) with check (clinic_id=(select private.current_clinic_id()))',t.tablename);
  end loop;
  -- Self access must still show an inactive account as inactive; it grants no
  -- access to clinic data, and cannot be used to update approval/role fields.
  create policy profile_self_access on public.profiles for select to authenticated using(id=(select auth.uid()));
  foreach signature in array array[
    'private.mutate(text,jsonb,uuid)','private.portal_mutation(text,jsonb,uuid)','private.queue_mutation(text,jsonb,uuid)',
    'private.create_queued_encounter(jsonb)','private.create_queued_vaccination(jsonb)',
    'private.follow_up_mutation(text,jsonb)','private.create_custom_reminder(jsonb,uuid)',
    'private.record_inventory_movement(uuid,uuid,numeric,text,text,uuid)',
    'private.prepare_clinical_payload(text,jsonb)','private.filtered_export_report(text,uuid,jsonb)',
    'private.export_report(text,uuid)','private.start_assistant(text,uuid)',
    'private.finish_assistant(uuid,text,uuid[],text,integer)','private.assistant_feedback(uuid,smallint,text)',
    'private.manage_kb(jsonb)','private.sync_appointment_queue()','private.create_vaccine_reminder()'
  ] loop execute 'alter function '||signature||' owner to veterina_rpc'; end loop;
end $$;
grant usage,select on all sequences in schema public to veterina_rpc;
grant usage,select on all sequences in schema private to veterina_rpc;
alter table public.clinics enable row level security;
revoke all on public.clinics from public,anon,authenticated;
grant select on public.clinics to authenticated,veterina_rpc;
grant select on public.clinics to service_role;
create policy clinic_read on public.clinics for select to authenticated,veterina_rpc using(id=(select private.current_clinic_id()));

-- Validate every same-shop FK, even though PostgreSQL FK checks themselves
-- bypass RLS. Private trigger code reads only IDs/clinic IDs and returns no data.
create function private.enforce_clinic_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare constraint_row record; parent_clinic uuid; reference_id uuid; row_data jsonb:=to_jsonb(new); candidate uuid:=new.clinic_id;
begin
  for constraint_row in
    select a.attname as col,c.confrelid as parent from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.conrelid=tg_relid and c.contype='f' and cardinality(c.conkey)=1 and c.confrelid in
      (select attrelid from pg_attribute where attname='clinic_id' and not attisdropped)
  loop
    reference_id:=nullif(row_data->>constraint_row.col,'')::uuid;
    if reference_id is null then continue; end if;
    execute format('select clinic_id from %s where id=$1',constraint_row.parent::regclass) into parent_clinic using reference_id;
    if parent_clinic is null then raise exception 'NOT_FOUND: linked clinic record'; end if;
    candidate:=coalesce(candidate,parent_clinic);
    if candidate<>parent_clinic then raise exception 'FORBIDDEN: linked records must belong to the same clinic'; end if;
  end loop;
  candidate:=coalesce(candidate,private.current_clinic_id());
  if candidate is null and current_setting('role',true) in ('none','postgres','service_role') then candidate:=private.legacy_clinic_id(); end if;
  if candidate is null then raise exception 'FORBIDDEN: clinic access required'; end if;
  if tg_op='UPDATE' and candidate<>old.clinic_id then raise exception 'FORBIDDEN: clinic assignment cannot be changed'; end if;
  if current_setting('role',true) not in ('none','postgres','service_role') and candidate is distinct from private.current_clinic_id() then raise exception 'FORBIDDEN: another clinic'; end if;
  new.clinic_id:=candidate;
  return new;
end $$;
revoke all on function private.enforce_clinic_scope() from public,anon,authenticated;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename<>'clinics' and exists(
    select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tablename and c.column_name='clinic_id') loop
    execute format('create trigger a_clinic_scope before insert or update on public.%I for each row execute function private.enforce_clinic_scope()',t.tablename);
  end loop;
end $$;

-- Shop-local settings, product names, microchips and daily queue numbers.
drop index public.clinic_settings_singleton;
create unique index clinic_settings_per_clinic on public.clinic_settings(clinic_id);
alter table public.service_types drop constraint service_types_name_key;
alter table public.service_types add constraint service_types_clinic_name_key unique(clinic_id,name);
alter table public.pets drop constraint pets_microchip_number_key;
alter table public.pets add constraint pets_clinic_microchip_key unique(clinic_id,microchip_number);
alter table public.queue_entries drop constraint queue_date_number_unique;
alter table public.queue_entries add constraint queue_date_number_unique unique(clinic_id,queue_date,queue_number);
do $$ begin
  execute format('alter table private.queue_number_counters add column clinic_id uuid not null default %L::uuid references public.clinics(id)',private.legacy_clinic_id());
end $$;
alter table private.queue_number_counters alter column clinic_id drop default;
alter table private.queue_number_counters drop constraint queue_number_counters_pkey;
alter table private.queue_number_counters add primary key(clinic_id,queue_date);
create or replace function private.assign_queue_number() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.queue_date:=(new.arrived_at at time zone coalesce((select timezone from public.clinic_settings where clinic_id=new.clinic_id),'Asia/Manila'))::date;
  insert into private.queue_number_counters(clinic_id,queue_date,last_number) values(new.clinic_id,new.queue_date,1)
    on conflict(clinic_id,queue_date) do update set last_number=private.queue_number_counters.last_number+1 returning last_number into new.queue_number;
  return new;
end $$;

-- Audit and indexing workers receive the originating clinic explicitly. They
-- run globally as trusted internal workers, not as staff RPCs.
create or replace function private.write_audit_log() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_logs(clinic_id,actor_id,action,table_name,record_id,old_data,new_data)
  values(coalesce(new.clinic_id,old.clinic_id),auth.uid(),tg_op,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new,old);
end $$;
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.enqueue_rag()'::regprocedure);
  patched:=replace(definition,'insert into public.rag_jobs(', 'insert into public.rag_jobs(clinic_id,');
  -- Add the originating clinic to each VALUES clause belonging to this trigger.
  patched:=replace(patched,'values (','values (coalesce(new.clinic_id,old.clinic_id),');
  patched:=replace(patched,'values(','values(coalesce(new.clinic_id,old.clinic_id),');
  if patched=definition then raise exception 'Expected RAG trigger not found'; end if;
  execute patched;
end $$;

-- Private dispensing records remain denied to the browser, while the clinical
-- RPC role can read/insert only the current shop's immutable history.
do $$ begin
  execute format('alter table private.prescription_dispenses add column clinic_id uuid not null default %L::uuid references public.clinics(id)',private.legacy_clinic_id());
end $$;
alter table private.prescription_dispenses alter column clinic_id set default private.current_clinic_id();
create index prescription_dispenses_clinic on private.prescription_dispenses(clinic_id);
create trigger a_clinic_scope before insert or update on private.prescription_dispenses for each row execute function private.enforce_clinic_scope();
grant select,insert on private.prescription_dispenses to veterina_rpc;
create policy clinic_rpc_dispenses on private.prescription_dispenses for all to veterina_rpc using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()));

-- Service-only photo administration explicitly checks the actor/resource shop
-- before issuing any metadata or touching the shared server-side byte cache.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.pet_photo_admin(uuid,jsonb)'::regprocedure);
  patched:=replace(definition,'where id=(p_data->>''petId'')::uuid for update;',
    'where id=(p_data->>''petId'')::uuid and clinic_id=(select p.clinic_id from public.profiles p join public.clinics c on c.id=p.clinic_id where p.id=p_actor and p.is_active and c.is_active) for update;');
  if patched=definition then raise exception 'Expected photo patient lookup not found'; end if;
  execute patched;
end $$;
revoke create on schema private from veterina_rpc;
-- This trigger only queues assets of the OLD, already-authorized pet row.
alter function private.enqueue_pet_photo_delete() security definer;
notify pgrst,'reload schema';
