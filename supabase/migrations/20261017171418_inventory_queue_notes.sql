do $migration$
declare definition text;
begin
  select pg_get_functiondef('private.create_queued_vaccination(jsonb)'::regprocedure) into definition;
  if strpos(definition,$old$doctor,p_data->>'vaccine',actor)$old$)=0 then raise exception 'Expected queued vaccine arrival notes'; end if;
  definition:=replace(definition,$old$doctor,p_data->>'vaccine',actor)$old$,$new$doctor,coalesce(p_data->>'vaccine',''),actor)$new$);
  execute definition;
end $migration$;
notify pgrst, 'reload schema';
