-- Item notes use the existing staff-only mutations, audit log and retry guards.
alter table public.inventory_items add column notes text not null default '';

do $migration$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,
    'inventory_items(sku,name,brand,category,unit,minimum_stock,allows_fraction,created_by)',
    'inventory_items(sku,name,brand,category,unit,minimum_stock,allows_fraction,created_by,notes)');
  if patched = definition then raise exception 'Expected inventory insert columns were not found'; end if;
  definition := patched;
  patched := replace(definition,
    $old$coalesce((p_data->>'allowsFraction')::boolean,false),u) returning id into entity;$old$,
    $new$coalesce((p_data->>'allowsFraction')::boolean,false),u,coalesce(p_data->>'notes','')) returning id into entity;$new$);
  if patched = definition then raise exception 'Expected inventory insert values were not found'; end if;
  execute patched;

  definition := pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,
    'update public.inventory_items set name=',
    $new$update public.inventory_items set notes=case when p_data ? 'notes' then coalesce(p_data->>'notes','') else notes end,name=$new$);
  if patched = definition then raise exception 'Expected inventory update statement was not found'; end if;
  execute patched;
end;
$migration$;

notify pgrst, 'reload schema';
