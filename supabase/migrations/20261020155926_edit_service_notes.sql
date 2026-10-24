-- Extend the existing active-staff, audited and idempotent mutation endpoint.
-- Only maintenance notes may change; queue dates, status, assignment and drafts stay intact.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    $old$elsif p_action='update_encounter' then$old$,
    $new$elsif p_action='update_service_notes' then
    if exists(select 1 from (values ('notes'),('serviceNotes'),('originalNotes'),('originalServiceNotes')) as fields(name)
      where not (p_data ? name) or jsonb_typeof(p_data->name) <> 'string' or (name in ('notes','serviceNotes') and length(p_data->>name)>10000)) then
      raise exception 'VALIDATION_FAILED: service notes must be text of at most 10000 characters';
    end if;
    perform 1 from public.queue_entries where id=entity and category='maintenance' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if exists(select 1 from public.queue_entries where id=entity and
      (notes is distinct from p_data->>'originalNotes' or service_notes is distinct from p_data->>'originalServiceNotes')) then
      raise exception 'RECORD_CHANGED: service notes have been edited by another staff member';
    end if;
    if exists(select 1 from public.queue_entries where id=entity and status='completed') and length(btrim(p_data->>'serviceNotes'))=0 then
      raise exception 'VALIDATION_FAILED: completed services require work performed notes';
    end if;
    update public.queue_entries set notes=p_data->>'notes',service_notes=p_data->>'serviceNotes' where id=entity;
  elsif p_action='update_encounter' then$new$);
  if patched=definition then raise exception 'Expected checkup mutation handler not found'; end if;
  execute patched;
end $migration$;
