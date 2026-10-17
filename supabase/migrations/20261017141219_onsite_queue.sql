-- Waiting-room work is separate from future appointment scheduling.
create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  category text not null check (category in ('checkup','vaccination')),
  service_name text not null,
  source text not null check (source in ('walk_in','appointment')),
  appointment_id uuid unique references public.appointments(id) on delete set null,
  veterinarian_id uuid references public.profiles(id),
  status text not null default 'waiting' check (status in ('waiting','in_progress','completed','cancelled')),
  arrived_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  notes text not null default '',
  created_by uuid not null references public.profiles(id),
  visit_id uuid references public.visits(id) on delete set null,
  vaccination_id uuid references public.vaccinations(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (visit_id is null or vaccination_id is null)
);
create unique index queue_active_patient_service on public.queue_entries(pet_id,category)
  where status in ('waiting','in_progress');
create index queue_active_arrival on public.queue_entries(arrived_at,id) where status in ('waiting','in_progress');
create index queue_finished_at on public.queue_entries(finished_at);
create index queue_veterinarian on public.queue_entries(veterinarian_id);
create index queue_creator on public.queue_entries(created_by);
create index queue_visit on public.queue_entries(visit_id);
create index queue_vaccination on public.queue_entries(vaccination_id);
alter table public.queue_entries enable row level security;
create policy staff_read on public.queue_entries for select to authenticated using ((select private.staff_role()) is not null);
revoke all on public.queue_entries from anon,authenticated;
grant select on public.queue_entries to authenticated;
create trigger queue_audit after insert or update or delete on public.queue_entries
  for each row execute function private.write_audit_log();
create trigger queue_updated before update on public.queue_entries
  for each row execute function private.set_updated_at();

-- Appointment writes always lock the appointment before its queue entry.
-- The trigger also covers older appointment RPC entrypoints.
create function private.sync_appointment_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  entry public.queue_entries; service_name text; service_category text; clinic_zone text;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into entry from public.queue_entries where appointment_id=new.id for update;
  if new.status in ('arrived','in_progress') then
    if new.status='arrived' and (tg_op='INSERT' or old.status not in ('arrived','in_progress')) then
      select coalesce(timezone,'Asia/Manila') into clinic_zone from public.clinic_settings limit 1;
      clinic_zone:=coalesce(clinic_zone,'Asia/Manila');
      if (new.starts_at at time zone clinic_zone)::date<>(now() at time zone clinic_zone)::date then
        raise exception 'VALIDATION_FAILED: only today''s appointments can be checked in';
      end if;
    end if;
    if not exists(select 1 from public.pets where id=new.pet_id and status='Active') then
      raise exception 'VALIDATION_FAILED: select an active patient';
    end if;
    if new.status='in_progress' and not exists(select 1 from public.profiles where id=new.veterinarian_id and is_active) then
      raise exception 'VALIDATION_FAILED: select an active veterinarian';
    end if;
    if entry.id is null then
      select name into service_name from public.service_types where id=new.service_type_id;
      service_category:=case when service_name='Vaccination' then 'vaccination' else 'checkup' end;
      insert into public.queue_entries(pet_id,category,service_name,source,appointment_id,veterinarian_id,status,started_at,notes,created_by)
      values(new.pet_id,service_category,coalesce(service_name,'Checkup'),'appointment',new.id,new.veterinarian_id,
        case when new.status='arrived' then 'waiting' else 'in_progress' end,
        case when new.status='in_progress' then now() end,new.notes,coalesce(auth.uid(),new.created_by));
    else
      if entry.status not in ('waiting','in_progress') then raise exception 'INVALID_TRANSITION'; end if;
      update public.queue_entries set status=case when new.status='arrived' then 'waiting' else 'in_progress' end,
        veterinarian_id=new.veterinarian_id,started_at=case when new.status='in_progress' then coalesce(started_at,now()) else started_at end
        where id=entry.id;
    end if;
  elsif new.status='completed' and entry.id is not null then
    if entry.status<>'completed' or (entry.visit_id is null and entry.vaccination_id is null) then
      raise exception 'CARE_RECORD_REQUIRED: save the clinical record to complete this queue entry';
    end if;
  elsif new.status='cancelled' and entry.id is not null then
    if entry.status not in ('waiting','in_progress','cancelled') then raise exception 'INVALID_TRANSITION'; end if;
    update public.queue_entries set status='cancelled',finished_at=coalesce(finished_at,now()) where id=entry.id;
  end if;
  return new;
exception when unique_violation then raise exception 'QUEUE_DUPLICATE: this patient is already waiting for this service';
end $$;
revoke all on function private.sync_appointment_queue() from public,anon,authenticated;
create trigger appointments_sync_queue after insert or update of status on public.appointments
  for each row execute function private.sync_appointment_queue();

-- Only active visits need a backfill; terminal historical bookings remain untouched.
insert into public.queue_entries(pet_id,category,service_name,source,appointment_id,veterinarian_id,status,arrived_at,started_at,notes,created_by)
select a.pet_id,case when s.name='Vaccination' then 'vaccination' else 'checkup' end,
  coalesce(s.name,'Checkup'),'appointment',a.id,a.veterinarian_id,
  case when a.status='arrived' then 'waiting' else 'in_progress' end,a.updated_at,
  case when a.status='in_progress' then a.updated_at end,a.notes,a.created_by
from public.appointments a left join public.service_types s on s.id=a.service_type_id
where a.status in ('arrived','in_progress');

-- Called only inside portal_mutation, which owns authorization and retry keys.
create function private.queue_mutation(p_action text,p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); entry public.queue_entries; booking public.appointments;
  entity uuid:=nullif(p_data->>'id','')::uuid; doctor uuid; appointment uuid;
  record_data jsonb; saved jsonb; care_id uuid;
begin
  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_action='add_queue_entry' then
    if not exists(select 1 from public.pets where id=(p_data->>'petId')::uuid and status='Active') then
      raise exception 'VALIDATION_FAILED: select an active patient'; end if;
    if coalesce(p_data->>'category','') not in ('checkup','vaccination') then raise exception 'VALIDATION_FAILED: select a service'; end if;
    doctor:=nullif(p_data->>'veterinarianId','')::uuid;
    if doctor is not null and not exists(select 1 from public.profiles where id=doctor and is_active) then
      raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
    insert into public.queue_entries(pet_id,category,service_name,source,veterinarian_id,notes,created_by)
    values((p_data->>'petId')::uuid,p_data->>'category',case when p_data->>'category'='vaccination' then 'Vaccination' else 'Checkup' end,
      'walk_in',doctor,coalesce(p_data->>'notes',''),actor) returning id into entity;
  elsif p_action='check_in_appointment' then
    select * into booking from public.appointments where id=(p_data->>'appointmentId')::uuid for update;
    if booking.id is null then raise exception 'NOT_FOUND'; end if;
    if booking.status not in ('pending','confirmed') then raise exception 'INVALID_TRANSITION'; end if;
    if booking.status='pending' then
      perform private.portal_mutation('transition_appointment',jsonb_build_object('id',booking.id,'status','confirmed'),gen_random_uuid());
    end if;
    perform private.portal_mutation('transition_appointment',jsonb_build_object('id',booking.id,'status','arrived'),gen_random_uuid());
    select id into entity from public.queue_entries where appointment_id=booking.id;
  else
    -- Consistent lock order with calendar transitions prevents cross-screen deadlocks.
    select appointment_id into appointment from public.queue_entries where id=entity;
    if appointment is not null then perform 1 from public.appointments where id=appointment for update; end if;
    select * into entry from public.queue_entries where id=entity for update;
    if entry.id is null then raise exception 'NOT_FOUND'; end if;
    if p_action='start_queue_entry' then
      if entry.status<>'waiting' then raise exception 'INVALID_TRANSITION'; end if;
      doctor:=coalesce(nullif(p_data->>'veterinarianId','')::uuid,entry.veterinarian_id);
      if not exists(select 1 from public.profiles where id=doctor and is_active) then
        raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
      if entry.appointment_id is not null then
        update public.appointments set veterinarian_id=doctor where id=entry.appointment_id;
        perform private.portal_mutation('transition_appointment',jsonb_build_object('id',entry.appointment_id,'status','in_progress'),p_key);
      else
        update public.queue_entries set status='in_progress',veterinarian_id=doctor,started_at=now() where id=entity;
      end if;
    elsif p_action='cancel_queue_entry' then
      if entry.status not in ('waiting','in_progress') then raise exception 'INVALID_TRANSITION'; end if;
      if entry.appointment_id is not null then
        perform private.portal_mutation('transition_appointment',jsonb_build_object('id',entry.appointment_id,'status','cancelled'),p_key);
      else
        update public.queue_entries set status='cancelled',finished_at=now() where id=entity;
      end if;
    elsif p_action='complete_queue_entry' then
      if entry.status<>'in_progress' then raise exception 'INVALID_TRANSITION'; end if;
      record_data:=p_data->'record';
      if jsonb_typeof(record_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED: clinical record required'; end if;
      if nullif(record_data->>'petId','')::uuid is distinct from entry.pet_id or
        nullif(record_data->>'veterinarianId','')::uuid is distinct from entry.veterinarian_id then
        raise exception 'VALIDATION_FAILED: patient and veterinarian must match the queue entry'; end if;
      if not exists(select 1 from public.profiles where id=entry.veterinarian_id and is_active) then
        raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
      if entry.category='checkup' then
        if length(btrim(coalesce(record_data->>'complaint','')))=0 or nullif(record_data->>'weightKg','') is null then
          raise exception 'VALIDATION_FAILED: complaint and weight required'; end if;
        saved:=private.portal_mutation('create_encounter',record_data,p_key);
        care_id:=(saved->>'id')::uuid;
        update public.visits set appointment_id=entry.appointment_id where id=care_id;
        update public.queue_entries set status='completed',visit_id=care_id,finished_at=now() where id=entity;
      else
        if length(btrim(coalesce(record_data->>'vaccine','')))=0 or length(btrim(coalesce(record_data->>'lotNumber','')))=0 then
          raise exception 'VALIDATION_FAILED: vaccine and batch required'; end if;
        saved:=private.portal_mutation('create_vaccination',record_data,p_key);
        care_id:=(saved->>'id')::uuid;
        update public.queue_entries set status='completed',vaccination_id=care_id,finished_at=now() where id=entity;
      end if;
      if entry.appointment_id is not null then
        perform private.portal_mutation('transition_appointment',jsonb_build_object('id',entry.appointment_id,'status','completed'),p_key);
      end if;
      return saved||jsonb_build_object('queueEntryId',entity);
    else raise exception 'VALIDATION_FAILED: unknown queue action'; end if;
  end if;
  return jsonb_build_object('id',entity);
exception
  when unique_violation then raise exception 'QUEUE_DUPLICATE: this patient is already waiting for this service';
end $$;
revoke all on function private.queue_mutation(text,jsonb,uuid) from public,anon,authenticated;

-- Extend the existing dispatcher without replacing unrelated record workflows.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    '  if p_action in (''create_owner'',''create_pet'',''create_supplier'',''create_inventory_item'',',
    '  if p_action in (''add_queue_entry'',''check_in_appointment'',''start_queue_entry'',''cancel_queue_entry'',''complete_queue_entry'') then'||chr(10)||
    '    result:=private.queue_mutation(p_action,p_data,p_key);'||chr(10)||
    '  elsif p_action in (''create_owner'',''create_pet'',''create_supplier'',''create_inventory_item'',');
  patched:=replace(patched,
    '(prior=''arrived'' and p_data->>''status''=''in_progress'')',
    '(prior=''arrived'' and p_data->>''status'' in (''in_progress'',''cancelled''))');
  patched:=replace(patched,
    '(prior=''in_progress'' and p_data->>''status''=''completed'')',
    '(prior=''in_progress'' and p_data->>''status'' in (''completed'',''cancelled''))');
  if patched=definition or position('result:=private.queue_mutation' in patched)=0 then
    raise exception 'Expected portal mutation source was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
