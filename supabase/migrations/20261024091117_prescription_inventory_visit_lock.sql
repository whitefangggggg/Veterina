-- Serialize clinical edits with encounter finalization before inventory locks.
do $migration$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('private.prepare_prescription_inventory()'::regprocedure);
  patched := replace(definition,
    $old$  if new.medications is not null and jsonb_typeof(new.medications) <> 'array' then$old$,
    $new$  perform 1 from public.visits where id=new.visit_id and finalized_at is null for update;
  if not found then raise exception 'RECORD_FINALIZED: select an open encounter'; end if;
  if new.medications is not null and jsonb_typeof(new.medications) <> 'array' then$new$);
  if patched = definition then raise exception 'Expected prescription inventory guard was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
