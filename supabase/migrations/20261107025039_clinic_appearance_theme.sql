-- Reuse the existing clinic brand column, mutation idempotency and row audit.
-- The private dispatcher already runs as veterina_rpc; no new public helper.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  if p_action='save_veterinarian_details' then$old$,
    $new$  if p_action='set_clinic_theme' then
    if private.staff_role() is distinct from 'owner' then
      raise exception 'FORBIDDEN: clinic colors are owner-managed';
    end if;
    if jsonb_typeof(p_data->'brandColor') is distinct from 'string'
      or coalesce(p_data->>'brandColor','') not in ('#2a6f62','#305b9a','#72549a','#a04b67','#966128','#426b45') then
      raise exception 'VALIDATION_FAILED: choose a supported clinic color';
    end if;
    update public.clinic_settings set brand_color=p_data->>'brandColor'
      where clinic_id=private.current_clinic_id() returning id into entity;
    if not found then raise exception 'NOT_FOUND: clinic settings'; end if;
  elsif p_action='save_veterinarian_details' then$new$);
  if patched=definition then raise exception 'Expected clinic mutation dispatcher not found'; end if;
  execute patched;
end $$;

notify pgrst,'reload schema';
