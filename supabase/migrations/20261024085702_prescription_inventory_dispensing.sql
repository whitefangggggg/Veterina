-- Keep clinical snapshots in prescriptions and immutable dispensing evidence private.
create table private.prescription_dispenses (
  prescription_id uuid not null references public.prescriptions(id) on delete restrict,
  medication_id uuid not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  quantity numeric(12,2) not null check (quantity > 0),
  medication_name text not null,
  unit text not null,
  movement_id uuid not null unique references public.inventory_movements(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (prescription_id, medication_id)
);
create index prescription_dispenses_item on private.prescription_dispenses(inventory_item_id);
create index prescription_dispenses_batch on private.prescription_dispenses(batch_id);
alter table private.prescription_dispenses enable row level security;
revoke all on private.prescription_dispenses from public, anon, authenticated;
create trigger prescription_dispenses_immutable before update or delete on private.prescription_dispenses
  for each row execute function private.portal_immutable_ledger();

-- Invoker functions inherit the authorized mutation's execution context. No new
-- browser-callable privileged RPC or direct write grants are introduced.
create function private.prepare_prescription_inventory()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  medication jsonb; prepared jsonb := '[]'; saved private.prescription_dispenses;
  item public.inventory_items; batch public.inventory_batches; amount numeric;
  clinic_today date; seen_ids uuid[] := '{}'; medication_uuid uuid;
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from private.prescription_dispenses where prescription_id=old.id) then
      raise exception 'DISPENSING_LOCKED';
    end if;
    return old;
  end if;
  if new.medications is not null and jsonb_typeof(new.medications) <> 'array' then
    raise exception 'VALIDATION_FAILED: medications must be a list';
  end if;
  if tg_op = 'UPDATE' and exists(select 1 from private.prescription_dispenses where prescription_id=old.id) then
    if new.visit_id is distinct from old.visit_id then raise exception 'DISPENSING_LOCKED'; end if;
    -- Removing a dispensed row, including via a legacy payload, is forbidden.
    if exists(select 1 from private.prescription_dispenses d where d.prescription_id=old.id
      and not exists(select 1 from jsonb_array_elements(coalesce(new.medications,'[]')) m
        where m->>'medicationId'=d.medication_id::text)) then raise exception 'DISPENSING_LOCKED'; end if;
  end if;
  if new.medications is null then return new; end if;
  if exists(select 1 from jsonb_array_elements(new.medications) m where nullif(m->>'inventoryItemId','') is not null) then
    if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
    -- Match the item lock used by the existing stock mutation. All involved items
    -- are locked in UUID order before balances are read or movements are inserted.
    perform i.id from public.inventory_items i
      where i.id in (select (m->>'inventoryItemId')::uuid from jsonb_array_elements(new.medications) m
        where nullif(m->>'inventoryItemId','') is not null)
      order by i.id for update;
  end if;
  select (now() at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date into clinic_today;
  for medication in select value from jsonb_array_elements(new.medications) loop
    if jsonb_typeof(medication) <> 'object' then raise exception 'VALIDATION_FAILED: invalid medication'; end if;
    medication_uuid := nullif(medication->>'medicationId','')::uuid;
    if medication_uuid is not null then
      if medication_uuid=any(seen_ids) then raise exception 'VALIDATION_FAILED: medication IDs must be unique'; end if;
      seen_ids := array_append(seen_ids, medication_uuid);
    end if;
    select * into saved from private.prescription_dispenses where prescription_id=new.id and medication_id=medication_uuid;
    if found then
      if medication->>'inventoryItemId' is distinct from saved.inventory_item_id::text
        or medication->>'batchId' is distinct from saved.batch_id::text
        or jsonb_typeof(medication->'dispenseQuantity') is distinct from 'number'
        or (medication->>'dispenseQuantity')::numeric is distinct from saved.quantity
        or medication->>'medicationName' is distinct from saved.medication_name
        then raise exception 'DISPENSING_LOCKED'; end if;
      medication := medication || jsonb_build_object('dispenseUnit',saved.unit);
    elsif nullif(medication->>'inventoryItemId','') is not null then
      if medication_uuid is null or jsonb_typeof(medication->'dispenseQuantity') is distinct from 'number' then
        raise exception 'VALIDATION_FAILED: inventory medications require a medication ID, batch and numeric dispensing quantity';
      end if;
      amount := (medication->>'dispenseQuantity')::numeric;
      if amount <= 0 or amount >= 10000000000 or amount <> round(amount,2) then
        raise exception 'VALIDATION_FAILED: dispensing quantity must be positive with at most two decimal places';
      end if;
      select * into item from public.inventory_items where id=(medication->>'inventoryItemId')::uuid;
      if not found or not item.is_active then raise exception 'INVENTORY_UNAVAILABLE'; end if;
      if not item.allows_fraction and amount <> trunc(amount) then raise exception 'VALIDATION_FAILED: this inventory item requires whole units'; end if;
      select * into batch from public.inventory_batches where id=nullif(medication->>'batchId','')::uuid for share;
      if not found or batch.item_id <> item.id or not batch.is_active then raise exception 'INVENTORY_UNAVAILABLE'; end if;
      if batch.expiration_date < clinic_today then raise exception 'EXPIRED_BATCH'; end if;
      medication := medication || jsonb_build_object('medicationName',item.name,'dispenseUnit',item.unit);
    elsif medication ? 'batchId' or medication ? 'dispenseQuantity' or medication ? 'dispenseUnit' then
      raise exception 'VALIDATION_FAILED: custom medications cannot include dispensing fields';
    end if;
    prepared := prepared || jsonb_build_array(medication);
  end loop;
  new.medications := prepared;
  return new;
end $$;
revoke all on function private.prepare_prescription_inventory() from public, anon, authenticated;
-- Alphabetical ordering runs this before the existing clinical validation trigger.
create trigger prescriptions_inventory_prepare before insert or update or delete on public.prescriptions
  for each row execute function private.prepare_prescription_inventory();

create function private.dispense_prescription_inventory()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare medication jsonb; amount numeric; balance numeric; movement uuid;
begin
  for medication in select value from jsonb_array_elements(coalesce(new.medications,'[]')) loop
    if nullif(medication->>'inventoryItemId','') is null or exists(
      select 1 from private.prescription_dispenses where prescription_id=new.id and medication_id=(medication->>'medicationId')::uuid
    ) then continue; end if;
    amount := (medication->>'dispenseQuantity')::numeric;
    select coalesce(sum(quantity_delta),0) into balance from public.inventory_movements
      where item_id=(medication->>'inventoryItemId')::uuid and batch_id=(medication->>'batchId')::uuid;
    if balance < amount then raise exception 'INSUFFICIENT_STOCK'; end if;
    insert into public.inventory_movements(item_id,batch_id,visit_id,movement_type,quantity_delta,reason,reference,performed_by)
      values((medication->>'inventoryItemId')::uuid,(medication->>'batchId')::uuid,new.visit_id,
        'stock_out',-amount,'Dispensed to patient','Prescription '||new.id||' / medication '||(medication->>'medicationId'),auth.uid())
      returning id into movement;
    insert into private.prescription_dispenses(prescription_id,medication_id,inventory_item_id,batch_id,quantity,medication_name,unit,movement_id)
      values(new.id,(medication->>'medicationId')::uuid,(medication->>'inventoryItemId')::uuid,
        (medication->>'batchId')::uuid,amount,medication->>'medicationName',medication->>'dispenseUnit',movement);
  end loop;
  return new;
end $$;
revoke all on function private.dispense_prescription_inventory() from public, anon, authenticated;
create trigger prescriptions_inventory_dispense after insert or update on public.prescriptions
  for each row execute function private.dispense_prescription_inventory();

create function private.protect_dispensed_parent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from private.prescription_dispenses d join public.prescriptions p on p.id=d.prescription_id
    join public.visits v on v.id=p.visit_id
    where (tg_table_name='visits' and v.id=old.id) or (tg_table_name='pets' and v.pet_id=old.id)) then
    raise exception 'DISPENSING_LOCKED';
  end if;
  return old;
end $$;
revoke all on function private.protect_dispensed_parent() from public, anon, authenticated;
create trigger visits_protect_dispensing before delete on public.visits
  for each row execute function private.protect_dispensed_parent();
create trigger pets_protect_dispensing before delete on public.pets
  for each row execute function private.protect_dispensed_parent();

notify pgrst, 'reload schema';
