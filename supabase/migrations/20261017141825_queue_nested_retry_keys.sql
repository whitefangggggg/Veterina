-- The outer portal action owns retry identity. Child operations need separate
-- keys because callers may reuse a UUID across different public action names.
-- All children are in the parent's transaction and roll back with it.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,',p_key);',',gen_random_uuid());');
  if patched=definition then raise exception 'Expected nested queue calls were not found'; end if;
  execute patched;
end $migration$;
