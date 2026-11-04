-- Scheduling metadata is separate from the original clinical follow-up plan.
-- The existing staff-only SELECT policies and RPC-only writes also cover these
-- columns; no new browser write privileges are granted.
alter table public.visits
  add column follow_up_scheduled_date date,
  add column follow_up_visit_id uuid references public.visits(id) on delete set null,
  add column follow_up_queue_id uuid references public.queue_entries(id) on delete set null,
  add column follow_up_arrived_at timestamptz;
create index visits_follow_up_visit on public.visits(follow_up_visit_id) where follow_up_visit_id is not null;
create index visits_follow_up_queue on public.visits(follow_up_queue_id) where follow_up_queue_id is not null;

-- A finalized checkup's scheduling metadata may change; its clinical fields,
-- original follow_up_date, clinician snapshots and finalization remain immutable.
create or replace function private.protect_finalized_visit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.finalized_at is not null and
    (to_jsonb(new) - array['card_color','updated_at','follow_up_scheduled_date','follow_up_visit_id','follow_up_queue_id','follow_up_arrived_at']) is distinct from
    (to_jsonb(old) - array['card_color','updated_at','follow_up_scheduled_date','follow_up_visit_id','follow_up_queue_id','follow_up_arrived_at']) then
    raise exception 'RECORD_FINALIZED: append a correction instead';
  end if;
  if new.finalized_at is not null and old.finalized_at is null then new.finalized_by:=auth.uid(); end if;
  return new;
end $$;
revoke all on function private.protect_finalized_visit() from public,anon,authenticated;

create function private.sync_follow_up_schedule() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.follow_up_date is distinct from old.follow_up_date then
    if old.follow_up_arrived_at is not null then
      raise exception 'FOLLOWUP_ALREADY_ARRIVED: set the next follow-up on the new clinical record';
    end if;
    new.follow_up_scheduled_date:=null;
  end if;
  return new;
end $$;
revoke all on function private.sync_follow_up_schedule() from public,anon,authenticated;
create trigger visits_follow_up_schedule before update of follow_up_date on public.visits
  for each row execute function private.sync_follow_up_schedule();

create function private.follow_up_mutation(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); original public.visits; service public.service_types;
  clinic_day date; scheduled date; requested date; doctor uuid; saved jsonb;
begin
  if actor is null or private.staff_role() is null then raise exception 'FORBIDDEN: active staff required'; end if;
  select (now() at time zone coalesce(timezone,'Asia/Manila'))::date into clinic_day from public.clinic_settings limit 1;
  clinic_day:=coalesce(clinic_day,(now() at time zone 'Asia/Manila')::date);
  select * into original from public.visits where id=(p_data->>'visitId')::uuid for update;
  if not found or original.follow_up_date is null then raise exception 'NOT_FOUND: follow-up schedule'; end if;
  if p_data->>'petId' is not null and (p_data->>'petId')::uuid<>original.pet_id then raise exception 'VALIDATION_FAILED: patient does not match the follow-up'; end if;
  if original.follow_up_arrived_at is not null then
    if p_action='arrive_follow_up' then
      return jsonb_build_object('id',original.follow_up_visit_id,'queueEntryId',original.follow_up_queue_id,'sourceVisitId',original.id);
    end if;
    raise exception 'FOLLOWUP_ALREADY_ARRIVED: open the new clinical record';
  end if;
  scheduled:=coalesce(original.follow_up_scheduled_date,original.follow_up_date);
  if nullif(p_data->>'expectedDate','')::date is distinct from scheduled then raise exception 'RECORD_CHANGED: follow-up schedule changed; refresh and try again'; end if;
  if p_action='reschedule_follow_up' then
    requested:=nullif(p_data->>'date','')::date;
    if requested is null or requested<clinic_day then raise exception 'VALIDATION_FAILED: choose today or a future follow-up date'; end if;
    update public.visits set follow_up_scheduled_date=requested where id=original.id;
    update public.reminders set due_at=requested::timestamp at time zone
      (select coalesce(timezone,'Asia/Manila') from public.clinic_settings limit 1),status='upcoming'
      where visit_id=original.id and reminder_type='follow_up' and status not in ('completed','cancelled');
    return jsonb_build_object('id',original.id,'date',requested);
  end if;
  if p_action<>'arrive_follow_up' then raise exception 'VALIDATION_FAILED: unknown follow-up action'; end if;
  if scheduled<>clinic_day then raise exception 'FOLLOWUP_NOT_TODAY: this follow-up is not scheduled for today; reschedule it before recording arrival'; end if;
  perform 1 from public.pets p join public.owners o on o.id=p.owner_id
    where p.id=original.pet_id and p.status='Active' and o.is_active for share of p,o;
  if not found then raise exception 'VALIDATION_FAILED: active patient and owner required'; end if;
  select * into service from public.service_types where id=(p_data->>'serviceId')::uuid and is_active and workflow='checkup' for share;
  if not found then raise exception 'VALIDATION_FAILED: select an active checkup service'; end if;
  doctor:=nullif(p_data->>'veterinarianId','')::uuid;
  if not exists(select 1 from public.profiles where id=doctor and is_active) then raise exception 'VALIDATION_FAILED: select an active veterinarian'; end if;
  if length(btrim(coalesce(p_data->>'complaint','')))=0 or nullif(p_data->>'weightKg','') is null then raise exception 'VALIDATION_FAILED: chief complaint and current weight required'; end if;
  if exists(select 1 from public.queue_entries where pet_id=original.pet_id and category='checkup' and status in ('waiting','in_progress')) then
    raise exception 'QUEUE_DUPLICATE: this patient already has an active checkup';
  end if;
  -- Reuse atomic encounter/vitals creation and the existing queue numbering,
  -- auditing, clinician snapshots and completion behavior. No prior SOAP or
  -- prescriptions are copied into the new checkup.
  saved:=private.create_queued_encounter(jsonb_build_object('petId',original.pet_id,'type',service.name,
    'complaint',btrim(p_data->>'complaint'),'weightKg',p_data->>'weightKg','veterinarianId',doctor,'encounteredAt',now()));
  update public.queue_entries set notes=coalesce(p_data->>'notes','') where id=(saved->>'queueEntryId')::uuid;
  update public.visits set follow_up_visit_id=(saved->>'id')::uuid,follow_up_queue_id=(saved->>'queueEntryId')::uuid,
    follow_up_arrived_at=now() where id=original.id;
  return saved||jsonb_build_object('sourceVisitId',original.id);
end $$;
revoke all on function private.follow_up_mutation(text,jsonb) from public,anon,authenticated;

-- Route through the established authenticated, payload-bound idempotency
-- dispatcher so schedule validation and every arrival write share a transaction.
do $migration$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  if p_action in ('create_service','update_service') then$old$,
    $new$  if p_action in ('arrive_follow_up','reschedule_follow_up') then
    result:=private.follow_up_mutation(p_action,p_data);
  elsif p_action in ('create_service','update_service') then$new$);
  if patched=definition then raise exception 'Expected portal dispatcher was not found'; end if;
  execute patched;
end $migration$;
notify pgrst,'reload schema';
