-- Clinical vaccine lots are independent of the batch used to deduct stock.
-- Existing snapshots and stock ledger identities are unchanged.
do $migration$
declare definition text; patched text;
begin
  definition:=replace(pg_get_functiondef('private.save_preventive_care(jsonb,boolean,boolean)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$    if length(coalesce(title,'')) not between 1 and 300$old$,$new$    if kind='vaccination' and purpose='queue' then
      if line ? 'lotNumber' and jsonb_typeof(line->'lotNumber') is distinct from 'string' then
        raise exception 'VALIDATION_FAILED: enter a lot number of up to 200 characters';
      end if;
      -- Omitted fields from older clients preserve existing clinical evidence.
      lot:=btrim(coalesce(line->>'lotNumber',old_vaccine.lot_number,''));
      if (old_vaccine.id is null or completing) and lot !~ '[^[:space:]]' then
        raise exception 'VALIDATION_FAILED: lot number required for each vaccine';
      end if;
      if lot ~ '[[:cntrl:]]' then raise exception 'VALIDATION_FAILED: invalid lot number'; end if;
    end if;
    if length(coalesce(title,'')) not between 1 and 300$new$);
  if patched=definition then raise exception 'Expected preventive validation missing'; end if;
  execute patched;
end $migration$;

-- Called only inside certificate issuance, under the existing RPC role/transaction.
-- The client UUID is the vaccination ID, allowing preview and issued evidence to agree.
create function private.prepare_manual_certificate_vaccines(data jsonb, issue_day date)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare items jsonb:=coalesce(data->'manualVaccinations','[]'::jsonb); line jsonb;
  manual_id uuid:=nullif(data->>'manualRabiesItemId','')::uuid; saved_id uuid:=nullif(data->>'rabiesVaccinationId','')::uuid;
  item_id uuid; seen uuid[]:='{}'; field text; value text; max_length integer;
  administered date; due date; expiry date; selected_expiry date;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'VALIDATION_FAILED: manual vaccines must be an array'; end if;
  if jsonb_array_length(items)>50 then raise exception 'VALIDATION_FAILED: no more than fifty manual vaccines'; end if;
  if manual_id is not null and saved_id is not null then raise exception 'VALIDATION_FAILED: choose exactly one Anti-Rabies source'; end if;
  if manual_id is not null and not exists(select 1 from jsonb_array_elements(items) x where x->>'id'=manual_id::text) then
    raise exception 'VALIDATION_FAILED: select a manually entered Anti-Rabies vaccine';
  end if;
  if jsonb_array_length(items)=0 then return data; end if;
  if manual_id is null and saved_id is null then raise exception 'VALIDATION_FAILED: choose exactly one Anti-Rabies source'; end if;
  for line in select x from jsonb_array_elements(items) x loop
    if jsonb_typeof(line) is distinct from 'object' or octet_length(line::text)>8192
      or exists(select 1 from jsonb_object_keys(line) k where k not in ('id','vaccine','brand','lotNumber','administeredAt','nextDueAt','dose','veterinarianName','expirationDate')) then
      raise exception 'VALIDATION_FAILED: invalid manual vaccine details';
    end if;
    if jsonb_typeof(line->'id') is distinct from 'string' or coalesce(line->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED: invalid manual vaccine identifier';
    end if;
    item_id:=(line->>'id')::uuid;
    if item_id=any(seen) or exists(select 1 from public.vaccinations where id=item_id) then raise exception 'VALIDATION_FAILED: duplicate manual vaccine identifier'; end if;
    seen:=array_append(seen,item_id);
    foreach field in array array['vaccine','lotNumber','brand','dose','veterinarianName'] loop
      value:=coalesce(line->>field,''); max_length:=case when field='lotNumber' then 200 else 300 end;
      if (line ? field and jsonb_typeof(line->field) is distinct from 'string')
        or (field in ('vaccine','lotNumber') and value !~ '[^[:space:]]')
        or length(btrim(value))>max_length or value ~ '[[:cntrl:]]' then
        raise exception 'VALIDATION_FAILED: invalid manual vaccine %',field;
      end if;
    end loop;
    if coalesce(line->>'administeredAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (nullif(line->>'nextDueAt','') is not null and line->>'nextDueAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (nullif(line->>'expirationDate','') is not null and line->>'expirationDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'VALIDATION_FAILED: invalid manual vaccination dates';
    end if;
    begin
      administered:=(line->>'administeredAt')::date;
      due:=nullif(line->>'nextDueAt','')::date;
      expiry:=nullif(line->>'expirationDate','')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'VALIDATION_FAILED: invalid manual vaccination dates';
    end;
    if administered>issue_day or (due is not null and due<=administered) or expiry<administered then
      raise exception 'VALIDATION_FAILED: check manual vaccine administration, next due and expiration dates';
    end if;
    if item_id=manual_id then
      if due is null or due<issue_day or due<(data->>'travelDate')::date or due<(data->>'validUntil')::date then
        raise exception 'VALIDATION_FAILED: manual Anti-Rabies validity must cover issuance and certificate validity';
      end if;
      selected_expiry:=expiry;
    end if;
  end loop;
  -- Validation above precedes writes; every record rolls back if any later check fails.
  for line in select x from jsonb_array_elements(items) x loop
    perform private.save_preventive_care(jsonb_build_object('kind','vaccination','recordingPurpose','record_only',
      'petId',data->>'petId','administeredAt',line->>'administeredAt','veterinarianName',coalesce(line->>'veterinarianName',''),
      'vaccines',jsonb_build_array(jsonb_build_object('id',line->>'id','vaccine',line->>'vaccine','brand',coalesce(line->>'brand',''),
        'lotNumber',line->>'lotNumber','dose',coalesce(line->>'dose',''),'nextDueAt',coalesce(line->>'nextDueAt','')))),false,false);
  end loop;
  if manual_id is not null then
    data:=data||jsonb_build_object('rabiesVaccinationId',manual_id,'vaccineExpirationDate',selected_expiry);
  end if;
  return data;
end $function$;
revoke all on function private.prepare_manual_certificate_vaccines(jsonb,date) from public,anon,authenticated;
grant execute on function private.prepare_manual_certificate_vaccines(jsonb,date) to veterina_rpc;

do $migration$
declare definition text; patched text;
begin
  definition:=replace(pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$  select * into vaccination from public.vaccinations where id=nullif(p_data->>'rabiesVaccinationId','')::uuid and pet_id=patient.id;$old$,$new$  p_data:=private.prepare_manual_certificate_vaccines(p_data,issue_day);
  product_expiry:=nullif(p_data->>'vaccineExpirationDate','')::date;
  select * into vaccination from public.vaccinations where id=nullif(p_data->>'rabiesVaccinationId','')::uuid and pet_id=patient.id;$new$);
  if patched=definition then raise exception 'Expected certificate vaccination lookup missing'; end if;
  definition:=patched;
  patched:=replace(definition,$old$  document:=jsonb_build_object($old$,$new$  -- Product expiration is certificate evidence, not a patient stock attribute.
  select coalesce(jsonb_agg(e.item || case when nullif(m.item->>'expirationDate','') is not null
      then jsonb_build_object('expirationDate',m.item->>'expirationDate') else '{}'::jsonb end order by e.position),'[]'::jsonb)
    into history from jsonb_array_elements(history) with ordinality e(item,position)
    left join lateral (select x as item from jsonb_array_elements(coalesce(p_data->'manualVaccinations','[]'::jsonb)) x
      where x->>'id'=e.item->>'id') m on true;
  document:=jsonb_build_object($new$);
  if patched=definition then raise exception 'Expected certificate snapshot missing'; end if;
  execute patched;
end $migration$;
notify pgrst,'reload schema';
