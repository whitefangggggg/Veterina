-- Optional housing information; existing patients remain unclassified.
alter table public.pets add column environment text not null default ''
  constraint pets_environment_check check (environment in ('', 'Indoor', 'Outdoor', 'Indoor & outdoor'));

-- Preserve the established authorization, audit and idempotency behavior.
-- Fail atomically if the current function definitions differ from the reviewed schema.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure) into definition;
  patched:=replace(definition,
    $old$if action in ('create_pet','update_pet') then$old$,
    $new$if action in ('create_pet','update_pet') then
    if coalesce(data->>'environment','') not in ('', 'Indoor', 'Outdoor', 'Indoor & outdoor') then
      raise exception 'VALIDATION_FAILED: select a valid patient environment';
    end if;$new$);
  if patched=definition then raise exception 'Expected clinical payload handler not found'; end if;
  execute patched;

  select pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,'birth_date_estimated,diet,color_markings','birth_date_estimated,diet,environment,color_markings');
  if patched=definition then raise exception 'Expected patient creation columns not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$coalesce(p_data->>'diet',''),p_data->>'color'$old$,
    $new$coalesce(p_data->>'diet',''),coalesce(p_data->>'environment',''),p_data->>'color'$new$);
  if patched=definition then raise exception 'Expected patient creation values not found'; end if;
  execute patched;

  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,$old$diet=coalesce(p_data->>'diet',''),color_markings$old$,
    $new$diet=coalesce(p_data->>'diet',''),environment=case when p_data ? 'environment' then coalesce(p_data->>'environment','') else environment end,color_markings$new$);
  if patched=definition then raise exception 'Expected patient update handler not found'; end if;
  execute patched;
end $migration$;
