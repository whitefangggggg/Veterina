-- Opening quantities use the existing stock ledger in the item-create
-- transaction. Legacy callers that omit the quantity still create empty stock.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  elsif p_action = 'create_inventory_item' then$old$,$new$  elsif p_action = 'create_inventory_item' then
    begin
      quantity:=coalesce(nullif(btrim(p_data->>'initialQuantity'),''),'0')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'VALIDATION_FAILED: enter a valid initial stock quantity';
    end;
    if quantity::text in ('NaN','Infinity','-Infinity') or quantity<0 or quantity>9999999999.99 or quantity<>round(quantity,2) then
      raise exception 'VALIDATION_FAILED: initial stock must be nonnegative with at most two decimal places';
    end if;
    if quantity<>trunc(quantity) and not coalesce((p_data->>'allowsFraction')::boolean,false) then
      raise exception 'VALIDATION_FAILED: enable fractional quantities or enter whole units for initial stock';
    end if;$new$);
  if patched=definition then raise exception 'Expected inventory creation branch not found'; end if;
  definition:=patched;
  patched:=replace(definition,
    $old$values(entity,nullif(p_data->>'supplierId','')::uuid,nullif(p_data->>'lotNumber',''),nullif(p_data->>'expirationDate','')::date);$old$,
    $new$values(entity,nullif(p_data->>'supplierId','')::uuid,nullif(p_data->>'lotNumber',''),nullif(p_data->>'expirationDate','')::date) returning id into batch;$new$);
  if patched=definition then raise exception 'Expected initial inventory batch insert not found'; end if;
  definition:=patched;
  patched:=replace(definition,
    $old$    if nullif(p_data->>'supplierId','') is not null then insert into public.item_suppliers(item_id,supplier_id,is_preferred) values(entity,(p_data->>'supplierId')::uuid,true); end if;$old$,
    $new$    if nullif(p_data->>'supplierId','') is not null then insert into public.item_suppliers(item_id,supplier_id,is_preferred) values(entity,(p_data->>'supplierId')::uuid,true); end if;
    if quantity>0 then
      perform private.mutate('record_inventory_movement',jsonb_build_object('id',entity,'batchId',batch,'delta',quantity,'reason','Initial stock'),gen_random_uuid());
    end if;$new$);
  if patched=definition then raise exception 'Expected inventory supplier linkage not found'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
