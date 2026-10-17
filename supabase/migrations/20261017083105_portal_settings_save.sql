-- Keep Supabase's safe-update protection enabled. Both the legacy and portal
-- settings functions must identify the singleton row explicitly.
do $migration$
declare routine record; definition text; patched text;
begin
  for routine in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('mutate','portal_mutation')
  loop
    definition:=pg_get_functiondef(routine.oid);
    patched:=regexp_replace(definition,
      '(update public.clinic_settings set[^;]*)( returning id into entity;)',
      '\1 where id=(select s.id from public.clinic_settings s order by s.created_at,s.id limit 1)\2');
    if patched=definition then raise exception 'Expected settings statement was not found'; end if;
    execute patched;
  end loop;
end $migration$;
notify pgrst, 'reload schema';
