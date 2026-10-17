-- Drafts belong to the existing care entry and inherit its staff-only RLS.
-- They never enter the clinical tables or generate reminders until completed.
alter table public.queue_entries
  add column care_draft jsonb not null default '{}'::jsonb check (jsonb_typeof(care_draft)='object'),
  add column draft_version integer not null default 0 check (draft_version>=0),
  add column draft_saved_at timestamptz,
  add column draft_saved_by uuid references public.profiles(id);
create index queue_draft_saved_by on public.queue_entries(draft_saved_by);

create function private.clear_completed_queue_draft() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status='completed' and old.status<>'completed' then
    new.care_draft:='{}'::jsonb;
    new.draft_saved_at:=null;
    new.draft_saved_by:=null;
    new.draft_version:=old.draft_version+1;
  end if;
  return new;
end $$;
revoke all on function private.clear_completed_queue_draft() from public,anon,authenticated;
create trigger queue_clear_completed_draft before update of status on public.queue_entries
  for each row execute function private.clear_completed_queue_draft();

do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    '''cancel_queue_entry'',''complete_queue_entry'') then',
    '''cancel_queue_entry'',''save_queue_draft'',''complete_queue_entry'') then');
  if patched=definition then raise exception 'Expected queue dispatcher was not found'; end if;
  execute patched;

  select pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    '    elsif p_action=''complete_queue_entry'' then',
    $branch$    elsif p_action='save_queue_draft' then
      if entry.status<>'in_progress' then raise exception 'INVALID_TRANSITION'; end if;
      if coalesce((p_data->>'draftVersion')::integer,0)<>entry.draft_version then raise exception 'DRAFT_CONFLICT: a newer draft is available'; end if;
      record_data:=p_data->'record';
      if jsonb_typeof(record_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED: draft fields required'; end if;
      if exists(select 1 from jsonb_each(record_data) as field where jsonb_typeof(field.value)<>'string' or
        not (field.key=any(case when entry.category='vaccination' then
          array['vaccine','administeredAt','nextDueAt','lotNumber','dose','veterinarianId'] else
          array['type','encounteredAt','veterinarianId','complaint','weightKg','temperatureC','heartRate','respiratoryRate','bodyConditionScore','hydration','subjective','objective','assessment','plan','diagnosis','followUpDate'] end))) then
        raise exception 'VALIDATION_FAILED: unsupported draft fields'; end if;
      if nullif(record_data->>'veterinarianId','') is not null and (record_data->>'veterinarianId')::uuid is distinct from entry.veterinarian_id then
        raise exception 'VALIDATION_FAILED: veterinarian must match the queue entry'; end if;
      update public.queue_entries set care_draft=record_data,draft_version=draft_version+1,draft_saved_at=now(),draft_saved_by=actor where id=entity;
      return jsonb_build_object('id',entity,'draftVersion',entry.draft_version+1);
    elsif p_action='complete_queue_entry' then$branch$);
  if patched=definition then raise exception 'Expected queue completion branch was not found'; end if;
  definition:=patched;
  patched:=replace(definition,
    $old$    elsif p_action='complete_queue_entry' then
      if entry.status<>'in_progress' then raise exception 'INVALID_TRANSITION'; end if;$old$,
    $new$    elsif p_action='complete_queue_entry' then
      if entry.status<>'in_progress' then raise exception 'INVALID_TRANSITION'; end if;
      if coalesce((p_data->>'draftVersion')::integer,0)<>entry.draft_version then raise exception 'DRAFT_CONFLICT: a newer draft is available'; end if;$new$);
  if patched=definition then raise exception 'Expected completion version check location was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
