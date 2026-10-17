-- Allocate inventory SKUs on the server; retain every existing identifier.
-- The table lock also protects sequence initialization from concurrent inserts.
lock table public.inventory_items in share row exclusive mode;

create sequence private.inventory_sku_seq;
revoke all on sequence private.inventory_sku_seq from public, anon, authenticated;

select setval('private.inventory_sku_seq'::regclass,
  coalesce(max(substring(sku from '^SKU-([0-9]+)$')::bigint), 0) + 1, false)
from public.inventory_items;

create function private.assign_inventory_sku()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare number_text text;
begin
  if tg_op = 'INSERT' then
    number_text := nextval('private.inventory_sku_seq'::regclass)::text;
    new.sku := 'SKU-' || lpad(number_text, greatest(6, length(number_text)), '0');
  elsif new.sku is distinct from old.sku then
    raise exception 'VALIDATION_FAILED: SKU is generated automatically and cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function private.assign_inventory_sku() from public, anon, authenticated;

create trigger inventory_items_assign_sku
before insert or update of sku on public.inventory_items
for each row execute function private.assign_inventory_sku();

-- Inventory updates accept the editable fields only. Older clients may still
-- submit a SKU; it must never replace the item's assigned identifier.
do $migration$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,
    'update public.inventory_items set sku=p_data->>''sku'',name=',
    'update public.inventory_items set name=');
  if patched = definition then raise exception 'Expected inventory update statement was not found'; end if;
  execute patched;
end;
$migration$;

notify pgrst, 'reload schema';
