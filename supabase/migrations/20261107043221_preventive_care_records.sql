-- A clinical record groups vaccine evidence without changing existing vaccine IDs.
create table public.preventive_care_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  pet_id uuid not null references public.pets(id) on delete cascade,
  kind text not null check(kind in ('vaccination','deworming')),
  recording_purpose text not null check(recording_purpose in ('queue','record_only')),
  administered_at date not null,
  administered_by uuid references public.profiles(id),
  administered_by_name text not null default '',
  version integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check(recording_purpose='record_only' or administered_by is not null)
);
create index preventive_care_patient on public.preventive_care_records(clinic_id,pet_id,administered_at desc);
create index preventive_care_doctor on public.preventive_care_records(administered_by);
create index preventive_care_creator on public.preventive_care_records(created_by);
alter table public.vaccinations
  add column preventive_record_id uuid references public.preventive_care_records(id) on delete cascade,
  add column batch_id uuid references public.inventory_batches(id),
  add column dispense_quantity numeric(12,2) check(dispense_quantity>0),
  add column dispense_unit text,
  add column stock_tracked boolean not null default false,
  add column consumed_at timestamptz;
create index vaccinations_preventive on public.vaccinations(preventive_record_id);
create index vaccinations_batch on public.vaccinations(batch_id);
insert into public.preventive_care_records(id,clinic_id,pet_id,kind,recording_purpose,administered_at,administered_by,administered_by_name,created_by,created_at)
 select id,clinic_id,pet_id,'vaccination',recording_purpose,administered_at,administered_by,administered_by_name,recorded_by,created_at from public.vaccinations;
-- Do not fire legacy audit/RAG triggers merely to attach a parent to old evidence.
alter table public.vaccinations disable trigger user;
update public.vaccinations set preventive_record_id=id where preventive_record_id is null;
alter table public.vaccinations enable trigger user;
alter table public.vaccinations alter column stock_tracked set default true;
alter table public.queue_entries add column preventive_record_id uuid references public.preventive_care_records(id) on delete set null;
create index queue_preventive on public.queue_entries(preventive_record_id);
update public.queue_entries set preventive_record_id=vaccination_id where vaccination_id is not null;

create table public.deworming_administrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  preventive_record_id uuid not null unique references public.preventive_care_records(id) on delete cascade,
  product_name text not null check(length(btrim(product_name)) between 1 and 300),
  brand text,lot_number text,dose text,next_due_at date,
  inventory_item_id uuid references public.inventory_items(id),
  batch_id uuid references public.inventory_batches(id),
  dispense_quantity numeric(12,2) check(dispense_quantity>0),dispense_unit text,
  stock_tracked boolean not null default true,consumed_at timestamptz
);
create index deworming_item on public.deworming_administrations(inventory_item_id);
create index deworming_batch on public.deworming_administrations(batch_id);
alter table public.reminders add column deworming_id uuid references public.deworming_administrations(id) on delete cascade;
create index reminders_deworming on public.reminders(deworming_id);

create table private.preventive_dispenses (
  preventive_record_id uuid not null references public.preventive_care_records(id) on delete restrict,
  item_id uuid not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  quantity numeric(12,2) not null check(quantity>0),
  unit text not null,
  movement_id uuid not null unique references public.inventory_movements(id) on delete restrict,
  primary key(preventive_record_id,item_id)
);
create index preventive_dispenses_inventory on private.preventive_dispenses(inventory_item_id);
create index preventive_dispenses_batch on private.preventive_dispenses(batch_id);
alter table private.preventive_dispenses enable row level security;
revoke all on private.preventive_dispenses from public,anon,authenticated;
grant select,insert on private.preventive_dispenses to veterina_rpc;
create policy rpc_clinic on private.preventive_dispenses for all to veterina_rpc
  using(exists(select 1 from public.preventive_care_records p where p.id=preventive_record_id and p.clinic_id=(select private.current_clinic_id())))
  with check(exists(select 1 from public.preventive_care_records p where p.id=preventive_record_id and p.clinic_id=(select private.current_clinic_id())));
create trigger preventive_dispenses_immutable before update or delete on private.preventive_dispenses for each row execute function private.portal_immutable_ledger();

do $$ declare t text; begin
  foreach t in array array['preventive_care_records','deworming_administrations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to veterina_rpc',t);
    execute format('create policy clinic_read on public.%I for select to authenticated using(clinic_id=(select private.current_clinic_id()) and (select private.staff_role()) is not null)',t);
    execute format('create policy rpc_clinic on public.%I for all to veterina_rpc using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()))',t);
    execute format('create trigger a_clinic_scope before insert or update on public.%I for each row execute function private.enforce_clinic_scope()',t);
    execute format('create trigger audit_preventive after insert or update or delete on public.%I for each row execute function private.write_audit_log()',t);
    execute format('create trigger owner_only_delete before delete on public.%I for each row execute function private.owner_only_permanent_delete()',t);
  end loop;
end $$;

-- All child writes, including older entrypoints, retain group consistency.
create function private.guard_preventive_item() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent public.preventive_care_records; ledger private.preventive_dispenses; expected text; product public.inventory_items;
begin
  if tg_op='DELETE' then
    if exists(select 1 from private.preventive_dispenses where item_id=old.id) then raise exception 'DISPENSING_LOCKED: use Inventory for stock corrections'; end if;
    return old;
  end if;
  if tg_table_name='vaccinations' and new.preventive_record_id is null then
    insert into public.preventive_care_records(id,clinic_id,pet_id,kind,recording_purpose,administered_at,administered_by,administered_by_name,created_by)
    values(new.id,new.clinic_id,new.pet_id,'vaccination',new.recording_purpose,new.administered_at,new.administered_by,new.administered_by_name,auth.uid());
    new.preventive_record_id:=new.id;
  end if;
  select * into parent from public.preventive_care_records where id=new.preventive_record_id and clinic_id=new.clinic_id;
  expected:=case when tg_table_name='vaccinations' then 'vaccination' else 'deworming' end;
  if parent.id is null or parent.kind<>expected then raise exception 'VALIDATION_FAILED: incorrect preventive record'; end if;
  if tg_table_name='vaccinations' then
    if new.pet_id<>parent.pet_id or new.recording_purpose<>parent.recording_purpose
      or new.administered_at<>parent.administered_at or new.administered_by is distinct from parent.administered_by then
      raise exception 'VALIDATION_FAILED: vaccine must match its parent record';
    end if;
  end if;
  if tg_op='UPDATE' and (new.preventive_record_id<>old.preventive_record_id or new.stock_tracked<>old.stock_tracked) then raise exception 'DISPENSING_LOCKED: record identity is fixed'; end if;
  if parent.recording_purpose='record_only' then
    new.stock_tracked:=false;
    if new.inventory_item_id is not null or new.batch_id is not null or new.dispense_quantity is not null then raise exception 'VALIDATION_FAILED: historical care cannot deduct inventory'; end if;
  elsif new.stock_tracked then
    if new.inventory_item_id is null or new.batch_id is null or new.dispense_quantity is null then raise exception 'VALIDATION_FAILED: select an inventory product, batch and stock quantity'; end if;
    select * into product from public.inventory_items where id=new.inventory_item_id and clinic_id=parent.clinic_id;
    if product.id is null or (new.consumed_at is null and product.category<>(case when expected='vaccination' then 'Vaccines' else 'Medicine' end)) then raise exception 'VALIDATION_FAILED: incorrect inventory category'; end if;
  end if;
  select * into ledger from private.preventive_dispenses where preventive_record_id=new.preventive_record_id and item_id=new.id;
  if ledger.item_id is not null then
    if new.inventory_item_id is distinct from ledger.inventory_item_id or new.batch_id is distinct from ledger.batch_id or new.dispense_quantity is distinct from ledger.quantity or new.dispense_unit is distinct from ledger.unit then raise exception 'DISPENSING_LOCKED: product, batch and stock quantity are fixed'; end if;
    new.consumed_at:=coalesce(old.consumed_at,now());
  end if;
  return new;
end $$;
revoke all on function private.guard_preventive_item() from public,anon,authenticated;
grant execute on function private.guard_preventive_item() to veterina_rpc;
create trigger c_preventive_item before insert or update or delete on public.vaccinations for each row execute function private.guard_preventive_item();
create trigger c_preventive_item before insert or update or delete on public.deworming_administrations for each row execute function private.guard_preventive_item();

-- Detach both queue links together while their referenced clinical rows exist.
-- Independent FK SET NULL actions otherwise expose an intermediate dangling link
-- to the clinic-scope guard when a parent cascades to its vaccine children.
create function private.guard_preventive_delete() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from private.preventive_dispenses where preventive_record_id=old.id) then raise exception 'DISPENSING_LOCKED: use Inventory for stock corrections'; end if;
  if exists(select 1 from public.pets where id=old.pet_id) then
    update public.queue_entries set preventive_record_id=null,vaccination_id=null where preventive_record_id=old.id;
  else
    -- Patient deletion also cascades to queue entries; remove them before their
    -- FK actions try to validate a reference to the already-deleted patient.
    delete from public.queue_entries where preventive_record_id=old.id;
  end if;
  return old;
end $$;
revoke all on function private.guard_preventive_delete() from public,anon,authenticated;
grant execute on function private.guard_preventive_delete() to veterina_rpc;
create trigger b_preventive_delete before delete on public.preventive_care_records for each row execute function private.guard_preventive_delete();

create function private.consume_preventive_stock(record_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare line record; balance numeric; movement uuid; clinic uuid:=private.current_clinic_id(); clinic_today date;
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.preventive_care_records where id=record_id and clinic_id=clinic and recording_purpose='queue') then raise exception 'FORBIDDEN'; end if;
  select (now() at time zone timezone)::date into clinic_today from public.clinic_settings where clinic_id=clinic;
  perform i.id from public.inventory_items i where i.clinic_id=clinic and i.id in (
    select inventory_item_id from public.vaccinations where preventive_record_id=record_id and stock_tracked
    union select inventory_item_id from public.deworming_administrations where preventive_record_id=record_id and stock_tracked
  ) order by i.id for update;
  for line in select x.*,i.is_active,i.allows_fraction,b.is_active batch_active,b.item_id,b.expiration_date from (
    select id,inventory_item_id,batch_id,dispense_quantity amount,dispense_unit unit from public.vaccinations where preventive_record_id=record_id and stock_tracked
    union all select id,inventory_item_id,batch_id,dispense_quantity,dispense_unit from public.deworming_administrations where preventive_record_id=record_id and stock_tracked
  ) x join public.inventory_items i on i.id=x.inventory_item_id and i.clinic_id=clinic
    join public.inventory_batches b on b.id=x.batch_id and b.clinic_id=clinic
    order by x.inventory_item_id,x.batch_id,x.id loop
    if exists(select 1 from private.preventive_dispenses where preventive_record_id=record_id and item_id=line.id) then continue; end if;
    if not line.is_active or not line.batch_active or line.item_id<>line.inventory_item_id then raise exception 'INVENTORY_UNAVAILABLE'; end if;
    if line.expiration_date<clinic_today then raise exception 'EXPIRED_BATCH'; end if;
    if line.amount is null or line.amount<=0 or (not line.allows_fraction and line.amount<>trunc(line.amount)) then raise exception 'VALIDATION_FAILED: invalid stock quantity'; end if;
    select coalesce(sum(quantity_delta),0) into balance from public.inventory_movements where item_id=line.inventory_item_id and batch_id=line.batch_id;
    if balance<line.amount then raise exception 'INSUFFICIENT_STOCK'; end if;
    insert into public.inventory_movements(clinic_id,item_id,batch_id,movement_type,quantity_delta,reason,reference,performed_by)
      values(clinic,line.inventory_item_id,line.batch_id,'stock_out',-line.amount,'Administered to patient','Preventive care '||record_id||' / item '||line.id,auth.uid()) returning id into movement;
    insert into private.preventive_dispenses values(record_id,line.id,line.inventory_item_id,line.batch_id,line.amount,line.unit,movement);
    update public.vaccinations set consumed_at=now() where id=line.id and preventive_record_id=record_id;
    update public.deworming_administrations set consumed_at=now() where id=line.id and preventive_record_id=record_id;
  end loop;
end $$;
revoke all on function private.consume_preventive_stock(uuid) from public,anon,authenticated;
grant execute on function private.consume_preventive_stock(uuid) to veterina_rpc;

create function private.save_preventive_care(data jsonb, updating boolean default false, completing boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare parent public.preventive_care_records; entry public.queue_entries; clinic uuid:=private.current_clinic_id();
  record_id uuid:=coalesce(nullif(data->>'id','')::uuid,gen_random_uuid()); patient uuid:=nullif(data->>'petId','')::uuid;
  doctor uuid:=nullif(data->>'veterinarianId','')::uuid; clinician text:=btrim(coalesce(data->>'veterinarianName',''));
  kind text:=data->>'kind'; purpose text:=coalesce(data->>'recordingPurpose','queue'); items jsonb; line jsonb; item_id uuid;
  product public.inventory_items; batch public.inventory_batches; old_vaccine public.vaccinations; old_deworm public.deworming_administrations;
  seen uuid[]:='{}'; stock_tracked boolean; amount numeric; administered date; due date; title text; brand text; lot text; first_vaccine uuid;
  service public.service_types; clinic_today date; qty_text text;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(data) is distinct from 'object' or octet_length(data::text)>65536 or kind not in ('vaccination','deworming') or kind is null or purpose not in ('queue','record_only') then raise exception 'VALIDATION_FAILED: choose a record type'; end if;
  if not exists(select 1 from public.pets where id=patient and clinic_id=clinic) then raise exception 'NOT_FOUND: patient'; end if;
  select (now() at time zone timezone)::date into clinic_today from public.clinic_settings where clinic_id=clinic;
  if coalesce(data->>'administeredAt','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'VALIDATION_FAILED: administration date required'; end if;
  administered:=(data->>'administeredAt')::date;
  if not isfinite(administered) or administered>clinic_today then raise exception 'VALIDATION_FAILED: administration cannot be in the future'; end if;
  if doctor is not null then
    select full_name into clinician from public.profiles where id=doctor and clinic_id=clinic and (purpose='record_only' or is_active);
    if not found then raise exception 'VALIDATION_FAILED: select clinic personnel'; end if;
  elsif purpose='queue' then raise exception 'VALIDATION_FAILED: veterinarian required'; end if;
  if length(clinician)>300 then raise exception 'VALIDATION_FAILED: clinician name too long'; end if;
  -- Appointment -> queue -> parent -> inventory is the shared lock order.
  if updating then
    select * into parent from public.preventive_care_records where id=record_id and clinic_id=clinic;
    if parent.id is null then raise exception 'NOT_FOUND: preventive record'; end if;
    select * into entry from public.queue_entries where preventive_record_id=record_id;
    if entry.appointment_id is not null then perform 1 from public.appointments where id=entry.appointment_id for update; end if;
    if entry.id is not null then select * into entry from public.queue_entries where id=entry.id for update; end if;
    select * into parent from public.preventive_care_records where id=record_id and clinic_id=clinic for update;
    if parent.pet_id<>patient or parent.kind<>kind or parent.recording_purpose<>purpose then raise exception 'VALIDATION_FAILED: record identity cannot change'; end if;
    if data ? 'version' and (data->>'version')::integer<>parent.version then raise exception 'RECORD_CHANGED'; end if;
    if entry.status in ('waiting','in_progress') and doctor is distinct from entry.veterinarian_id then raise exception 'VALIDATION_FAILED: veterinarian must match the queue entry'; end if;
  else
    if purpose='queue' and not completing then
      select * into service from public.service_types where clinic_id=clinic and workflow='vaccination' and is_active
        and (nullif(data->>'serviceId','') is null or id=(data->>'serviceId')::uuid) order by created_at,id limit 1;
      if service.id is null then raise exception 'VALIDATION_FAILED: active Vaccinations and Deworming service required'; end if;
      select * into entry from public.queue_entries where pet_id=patient and category='vaccination' and status in ('waiting','in_progress');
      if entry.appointment_id is not null then perform 1 from public.appointments where id=entry.appointment_id for update; end if;
      if entry.id is not null then
        select * into entry from public.queue_entries where id=entry.id for update;
        if entry.preventive_record_id is not null or entry.vaccination_id is not null or entry.draft_saved_at is not null then raise exception 'VACCINATION_ALREADY_QUEUED'; end if;
      else
        insert into public.queue_entries(clinic_id,pet_id,category,service_name,service_type_id,source,veterinarian_id,created_by)
          values(clinic,patient,'vaccination',service.name,service.id,'patient_record',doctor,auth.uid()) returning * into entry;
      end if;
      if entry.veterinarian_id is not null and entry.veterinarian_id<>doctor then raise exception 'VALIDATION_FAILED: veterinarian must match the queue entry'; end if;
    end if;
    insert into public.preventive_care_records(id,clinic_id,pet_id,kind,recording_purpose,administered_at,administered_by,administered_by_name,created_by)
      values(record_id,clinic,patient,kind,purpose,administered,doctor,clinician,auth.uid()) returning * into parent;
  end if;
  if kind='vaccination' then
    if data ? 'deworming' then raise exception 'VALIDATION_FAILED: choose one record type'; end if;
    items:=data->'vaccines';
  else
    if data ? 'vaccines' or jsonb_typeof(data->'deworming') is distinct from 'object' then raise exception 'VALIDATION_FAILED: one deworming product required'; end if;
    items:=jsonb_build_array(data->'deworming');
  end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 50 then raise exception 'VALIDATION_FAILED: add between one and fifty vaccines'; end if;
  -- Lock every affected item before checking balances or writing clinical rows.
  perform i.id from public.inventory_items i where i.clinic_id=clinic and i.id in
    (select nullif(value->>'inventoryItemId','')::uuid from jsonb_array_elements(items)) order by i.id for update;
  update public.preventive_care_records set administered_at=administered,administered_by=doctor,administered_by_name=clinician,version=version+case when updating then 1 else 0 end where id=record_id;
  for line in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(line) is distinct from 'object' then raise exception 'VALIDATION_FAILED: invalid administration'; end if;
    item_id:=coalesce(nullif(line->>'id','')::uuid,gen_random_uuid());
    if item_id=any(seen) then raise exception 'VALIDATION_FAILED: duplicate item identifier'; end if;
    seen:=array_append(seen,item_id);
    old_vaccine:=null; old_deworm:=null;
    if kind='vaccination' then select * into old_vaccine from public.vaccinations where id=item_id and preventive_record_id=record_id;
    else select * into old_deworm from public.deworming_administrations where id=item_id and preventive_record_id=record_id; end if;
    stock_tracked:=purpose='queue' and coalesce(old_vaccine.stock_tracked,old_deworm.stock_tracked,true);
    if purpose='record_only' and (nullif(line->>'inventoryItemId','') is not null or nullif(line->>'batchId','') is not null or line ? 'dispenseQuantity') then raise exception 'VALIDATION_FAILED: historical records cannot link stock'; end if;
    title:=btrim(coalesce(line->>'vaccine',''));brand:=btrim(coalesce(line->>'brand',''));lot:=btrim(coalesce(line->>'lotNumber',''));amount:=null;product:=null;batch:=null;
    if purpose='queue' then
      if not stock_tracked then
        -- Grandfathered evidence never acquires a retroactive stock movement.
        select * into product from public.inventory_items where id=coalesce(nullif(line->>'inventoryItemId','')::uuid,old_vaccine.inventory_item_id) and clinic_id=clinic;
        title:=old_vaccine.vaccine_name;brand:=old_vaccine.brand;lot:=old_vaccine.lot_number;
        if product.id is distinct from old_vaccine.inventory_item_id and product.id is not null then title:=product.name;brand:=product.brand; end if;
      else
        select * into product from public.inventory_items where id=nullif(line->>'inventoryItemId','')::uuid and clinic_id=clinic;
        select * into batch from public.inventory_batches where id=nullif(line->>'batchId','')::uuid and clinic_id=clinic;
        if product.id is null or batch.id is null or batch.item_id<>product.id then raise exception 'INVENTORY_UNAVAILABLE'; end if;
        if old_vaccine.consumed_at is null and old_deworm.consumed_at is null and product.category<>(case when kind='vaccination' then 'Vaccines' else 'Medicine' end) then raise exception 'INVENTORY_UNAVAILABLE'; end if;
        if old_vaccine.consumed_at is null and old_deworm.consumed_at is null and (not product.is_active or not batch.is_active or batch.expiration_date<clinic_today) then raise exception 'INVENTORY_UNAVAILABLE: product or batch is inactive or expired'; end if;
        qty_text:=line->>'dispenseQuantity';
        if jsonb_typeof(line->'dispenseQuantity') is distinct from 'number' or qty_text is null then raise exception 'VALIDATION_FAILED: numeric stock quantity required'; end if;
        amount:=qty_text::numeric;
        if amount<=0 or amount>=10000000000 or amount<>round(amount,2) or (old_vaccine.consumed_at is null and old_deworm.consumed_at is null and not product.allows_fraction and amount<>trunc(amount)) then raise exception 'VALIDATION_FAILED: invalid stock quantity'; end if;
        title:=product.name;brand:=product.brand;lot:=batch.lot_number;
        if old_vaccine.id is not null and old_vaccine.inventory_item_id=product.id then
          title:=old_vaccine.vaccine_name;brand:=old_vaccine.brand;
          if old_vaccine.batch_id=batch.id then lot:=old_vaccine.lot_number; end if;
        end if;
        if old_deworm.id is not null and old_deworm.inventory_item_id=product.id then
          title:=old_deworm.product_name;brand:=old_deworm.brand;
          if old_deworm.batch_id=batch.id then lot:=old_deworm.lot_number; end if;
        end if;
        if kind='vaccination' and length(btrim(coalesce(brand,'')))=0 then raise exception 'VALIDATION_FAILED: add the vaccine brand in Inventory'; end if;
        if old_vaccine.consumed_at is not null then title:=old_vaccine.vaccine_name;brand:=old_vaccine.brand;lot:=old_vaccine.lot_number;product.unit:=old_vaccine.dispense_unit; end if;
        if old_deworm.consumed_at is not null then title:=old_deworm.product_name;brand:=old_deworm.brand;lot:=old_deworm.lot_number;product.unit:=old_deworm.dispense_unit; end if;
      end if;
    end if;
    if length(coalesce(title,'')) not between 1 and 300 or length(coalesce(brand,''))>300 or length(coalesce(lot,''))>200 or length(coalesce(line->>'dose',''))>300 then raise exception 'VALIDATION_FAILED: check product, brand, lot and dose'; end if;
    due:=nullif(line->>'nextDueAt','')::date;
    if due is not null and (not isfinite(due) or due<=administered) then raise exception 'VALIDATION_FAILED: next due must be after administration'; end if;
    if kind='vaccination' then
      if first_vaccine is null then first_vaccine:=item_id; end if;
      if old_vaccine.id is null then
        insert into public.vaccinations(id,clinic_id,pet_id,preventive_record_id,vaccine_name,brand,lot_number,dose,administered_at,next_due_at,administered_by,administered_by_name,recording_purpose,inventory_item_id,batch_id,dispense_quantity,dispense_unit,stock_tracked)
          values(item_id,clinic,patient,record_id,title,brand,lot,line->>'dose',administered,due,doctor,clinician,purpose,product.id,batch.id,amount,product.unit,stock_tracked);
      else
        update public.vaccinations set vaccine_name=title,brand=brand,lot_number=lot,dose=line->>'dose',administered_at=administered,next_due_at=due,administered_by=doctor,administered_by_name=clinician,inventory_item_id=product.id,batch_id=batch.id,dispense_quantity=amount,dispense_unit=product.unit where id=item_id;
      end if;
      if purpose='queue' then
        if old_vaccine.id is not null and due is distinct from old_vaccine.next_due_at then
          update public.reminders set status='cancelled',outcome='Next due changed' where vaccination_id=item_id and status not in ('completed','cancelled');
        end if;
        if due is null then update public.reminders set status='cancelled',outcome='Next due removed' where vaccination_id=item_id and status not in ('completed','cancelled');
        elsif exists(select 1 from public.reminders where vaccination_id=item_id and status not in ('completed','cancelled')) then
          update public.reminders set title=title||' due',due_at=due::timestamp at time zone (select timezone from public.clinic_settings where clinic_id=clinic) where vaccination_id=item_id and status not in ('completed','cancelled');
        elsif old_vaccine.id is not null then
          insert into public.reminders(clinic_id,pet_id,vaccination_id,reminder_type,title,due_at,created_by) values(clinic,patient,item_id,'vaccination',title||' due',due::timestamp at time zone (select timezone from public.clinic_settings where clinic_id=clinic),auth.uid());
        end if;
      end if;
    else
      if old_deworm.id is null then
        insert into public.deworming_administrations(id,clinic_id,preventive_record_id,product_name,brand,lot_number,dose,next_due_at,inventory_item_id,batch_id,dispense_quantity,dispense_unit,stock_tracked)
          values(item_id,clinic,record_id,title,brand,lot,line->>'dose',due,product.id,batch.id,amount,product.unit,stock_tracked);
      else
        update public.deworming_administrations set product_name=title,brand=brand,lot_number=lot,dose=line->>'dose',next_due_at=due,inventory_item_id=product.id,batch_id=batch.id,dispense_quantity=amount,dispense_unit=product.unit where id=item_id;
      end if;
      if purpose='queue' then
        if old_deworm.id is not null and due is distinct from old_deworm.next_due_at then
          update public.reminders set status='cancelled',outcome='Next due changed' where deworming_id=item_id and status not in ('completed','cancelled');
        end if;
        if due is null then update public.reminders set status='cancelled',outcome='Next due removed' where deworming_id=item_id and status not in ('completed','cancelled');
        elsif exists(select 1 from public.reminders where deworming_id=item_id and status not in ('completed','cancelled')) then
          update public.reminders set title='Deworming: '||title||' due',due_at=due::timestamp at time zone (select timezone from public.clinic_settings where clinic_id=clinic) where deworming_id=item_id and status not in ('completed','cancelled');
        else insert into public.reminders(clinic_id,pet_id,deworming_id,reminder_type,title,due_at,created_by) values(clinic,patient,item_id,'medication','Deworming: '||title||' due',due::timestamp at time zone (select timezone from public.clinic_settings where clinic_id=clinic),auth.uid()); end if;
      end if;
    end if;
  end loop;
  if exists(select 1 from public.vaccinations where preventive_record_id=record_id and not(id=any(seen)) and consumed_at is not null) then raise exception 'DISPENSING_LOCKED'; end if;
  -- Removal is owner-managed, matching existing clinical deletion permissions.
  if exists(select 1 from public.vaccinations where preventive_record_id=record_id and not(id=any(seen))) and private.staff_role()<>'owner' then raise exception 'FORBIDDEN: removal is owner-only'; end if;
  delete from public.vaccinations where preventive_record_id=record_id and not(id=any(seen));
  if entry.id is not null then
    update public.queue_entries set preventive_record_id=record_id,vaccination_id=first_vaccine,veterinarian_id=coalesce(veterinarian_id,doctor) where id=entry.id;
  end if;
  if purpose='queue' and (completing or (updating and coalesce(entry.status,'completed')='completed')) then perform private.consume_preventive_stock(record_id); end if;
  return jsonb_strip_nulls(jsonb_build_object('id',record_id,'version',parent.version+case when updating then 1 else 0 end,'queueEntryId',entry.id,'queueNumber',entry.queue_number));
end $$;
revoke all on function private.save_preventive_care(jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function private.save_preventive_care(jsonb,boolean,boolean) to veterina_rpc;

-- Extend, rather than replace, the authenticated retry/audit dispatcher.
do $$ declare definition text; patched text; begin
  definition:=replace(pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$  if p_action='set_clinic_theme' then$old$,$new$  if p_action in ('create_preventive_care','update_preventive_care') then
    result:=private.save_preventive_care(p_data,p_action='update_preventive_care',false); entity:=(result->>'id')::uuid;
  elsif p_action='delete_preventive_care' then
    if private.staff_role()<>'owner' or length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'FORBIDDEN: owner and deletion reason required'; end if;
    delete from public.preventive_care_records where id=entity and clinic_id=private.current_clinic_id();
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='set_clinic_theme' then$new$);
  if patched=definition then raise exception 'Expected mutation dispatcher missing'; end if;
  execute patched;
  definition:=replace(pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$      if entry.category='checkup' then$old$,$new$      if entry.category='vaccination' and record_data ? 'kind' then
        saved:=private.save_preventive_care(record_data||jsonb_build_object('id',coalesce(entry.preventive_record_id,nullif(record_data->>'id','')::uuid,gen_random_uuid()),'recordingPurpose','queue'),entry.preventive_record_id is not null,true);
        update public.queue_entries set status='completed',preventive_record_id=(saved->>'id')::uuid,
          vaccination_id=(select id from public.vaccinations where preventive_record_id=(saved->>'id')::uuid order by id limit 1),finished_at=now() where id=entity;
        if not(p_data->'record' ? 'kind') then
          saved:=saved||jsonb_build_object('preventiveRecordId',saved->>'id','id',(select id from public.vaccinations where preventive_record_id=(saved->>'id')::uuid order by id limit 1));
        end if;
      elsif entry.category='checkup' then$new$);
  if patched=definition then raise exception 'Expected queue completion dispatcher missing'; end if;
  definition:=patched;
  patched:=replace(definition,$old$      if exists(select 1 from jsonb_each(record_data)$old$,$new$      if entry.category='vaccination' and record_data ? 'kind' then
        if record_data->>'kind' not in ('vaccination','deworming') or octet_length(record_data::text)>65536
          or exists(select 1 from jsonb_object_keys(record_data) k where k not in ('id','kind','recordingPurpose','administeredAt','veterinarianId','veterinarianName','petId','version','vaccines','deworming'))
          or (record_data->>'kind'='vaccination' and (jsonb_typeof(record_data->'vaccines') is distinct from 'array' or record_data ? 'deworming'))
          or (record_data->>'kind'='deworming' and (jsonb_typeof(record_data->'deworming') is distinct from 'object' or record_data ? 'vaccines')) then raise exception 'VALIDATION_FAILED: invalid preventive draft'; end if;
      end if;
      if not(entry.category='vaccination' and record_data ? 'kind') and exists(select 1 from jsonb_each(record_data)$new$);
  if patched=definition then raise exception 'Expected queue draft guard missing'; end if;
  patched:=replace(patched,$old$when 'vaccination' then 'Vaccination'$old$,$new$when 'vaccination' then 'Vaccinations and Deworming'$new$);
  execute patched;
end $$;

-- Preserve existing service IDs and used workflow identifiers.
update public.service_types s set name='Vaccinations and Deworming' where name='Vaccination' and workflow='vaccination'
  and not exists(select 1 from public.service_types other where other.clinic_id=s.clinic_id and other.name='Vaccinations and Deworming');
do $$ declare routine record; definition text; begin
  for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname in ('create_queued_vaccination','provision_vetshop') loop
    definition:=replace(pg_get_functiondef(routine.oid),chr(13),'');
    execute replace(definition,'''Vaccination''','''Vaccinations and Deworming''');
  end loop;
end $$;
notify pgrst,'reload schema';

-- Every vaccine in a pending group is pending evidence, not only its first row.
do $$ declare definition text; patched text; begin
  definition:=replace(pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure),chr(13),'');
  patched:=replace(definition,'where vaccination_id=vaccination.id and status',
    'where (preventive_record_id=vaccination.preventive_record_id or vaccination_id=vaccination.id) and status');
  patched:=replace(patched,'where q.vaccination_id=v.id and q.status',
    'where (q.preventive_record_id=v.preventive_record_id or q.vaccination_id=v.id) and q.status');
  if patched=definition then raise exception 'Expected certificate vaccine eligibility guard missing'; end if;
  execute patched;
end $$;

create function private.legacy_preventive_payload(data jsonb,updating boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare vaccine public.vaccinations; parent public.preventive_care_records; line jsonb; result jsonb;
begin
  if data->>'recordingPurpose'='record_only' and (data ? 'inventoryItemId' or data ? 'batchId' or data ? 'dispenseQuantity') then raise exception 'VALIDATION_FAILED: historical records cannot link stock'; end if;
  if updating then
    select * into vaccine from public.vaccinations where id=nullif(data->>'id','')::uuid and clinic_id=private.current_clinic_id();
    if vaccine.id is null then raise exception 'NOT_FOUND'; end if;
    if (select count(*) from public.vaccinations where preventive_record_id=vaccine.preventive_record_id)<>1 then raise exception 'VALIDATION_FAILED: open the full vaccination record to edit multiple vaccines'; end if;
    select * into parent from public.preventive_care_records where id=vaccine.preventive_record_id;
  end if;
  line:=jsonb_build_object('id',coalesce(vaccine.id,gen_random_uuid()),'vaccine',coalesce(data->>'vaccine',vaccine.vaccine_name),
    'brand',coalesce(data->>'brand',vaccine.brand),'lotNumber',coalesce(data->>'lotNumber',vaccine.lot_number),'dose',coalesce(data->>'dose',vaccine.dose,''),
    'nextDueAt',coalesce(data->>'nextDueAt',vaccine.next_due_at::text,''));
  if coalesce(data->>'recordingPurpose',parent.recording_purpose,'queue')='queue' then
    line:=line||jsonb_build_object('inventoryItemId',coalesce(nullif(data->>'inventoryItemId',''),vaccine.inventory_item_id::text,''),
      'batchId',coalesce(nullif(data->>'batchId',''),vaccine.batch_id::text,''),'dispenseQuantity',coalesce(data->'dispenseQuantity',to_jsonb(vaccine.dispense_quantity)));
  end if;
  result:=jsonb_build_object('petId',coalesce(data->>'petId',vaccine.pet_id::text),'kind','vaccination',
    'recordingPurpose',coalesce(data->>'recordingPurpose',parent.recording_purpose,'queue'),
    'administeredAt',coalesce(data->>'administeredAt',vaccine.administered_at::text),
    'veterinarianId',coalesce(data->>'veterinarianId',vaccine.administered_by::text,case when not updating and coalesce(data->>'recordingPurpose','queue')='queue' then auth.uid()::text else '' end),
    'veterinarianName',coalesce(data->>'veterinarianName',vaccine.administered_by_name,''),'vaccines',jsonb_build_array(line));
  if updating then result:=result||jsonb_build_object('id',parent.id); end if;
  if data ? 'serviceId' then result:=result||jsonb_build_object('serviceId',data->>'serviceId'); end if;
  return result;
end $$;
revoke all on function private.legacy_preventive_payload(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.legacy_preventive_payload(jsonb,boolean) to veterina_rpc;

-- The original public.create_vaccination RPC still uses private.mutate and its
-- original receipt namespace. Keep that receipt and child-ID response contract.
do $$ declare definition text; start_at integer; finish_at integer; begin
  definition:=replace(pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure),chr(13),'');
  start_at:=strpos(definition,'  elsif p_action = ''create_vaccination'' then');
  finish_at:=strpos(definition,'  elsif p_action = ''book_appointment'' then');
  if start_at=0 or finish_at<=start_at then raise exception 'Expected original vaccination RPC missing'; end if;
  execute substr(definition,1,start_at-1)||$patch$  elsif p_action = 'create_vaccination' then
    result:=private.save_preventive_care(private.legacy_preventive_payload(p_data,false),false,false);
    select id into entity from public.vaccinations where preventive_record_id=(result->>'id')::uuid order by id limit 1;
$patch$||substr(definition,finish_at);
end $$;

create function private.delete_preventive_record(data jsonb,legacy boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare target uuid:=nullif(data->>'id','')::uuid; queue public.queue_entries;
begin
  if private.staff_role() is distinct from 'owner' or length(btrim(coalesce(data->>'reason','')))=0 then raise exception 'FORBIDDEN: owner and deletion reason required'; end if;
  if legacy then
    select preventive_record_id into target from public.vaccinations where id=target and clinic_id=private.current_clinic_id();
    if (select count(*) from public.vaccinations where preventive_record_id=target)>1 then raise exception 'VALIDATION_FAILED: delete the full vaccination record'; end if;
  end if;
  select * into queue from public.queue_entries where preventive_record_id=target;
  if queue.appointment_id is not null then perform 1 from public.appointments where id=queue.appointment_id for update; end if;
  if queue.id is not null then perform 1 from public.queue_entries where id=queue.id for update; end if;
  perform 1 from public.preventive_care_records where id=target and clinic_id=private.current_clinic_id() for update;
  if exists(select 1 from private.preventive_dispenses where preventive_record_id=target) then raise exception 'DISPENSING_LOCKED: use Inventory for stock corrections'; end if;
  delete from public.preventive_care_records where id=target and clinic_id=private.current_clinic_id();
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_logs(actor_id,action,table_name,record_id) values(auth.uid(),'PERMANENT_DELETE: '||left(data->>'reason',200),'preventive_care_records',target);
  return target;
end $$;
revoke all on function private.delete_preventive_record(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.delete_preventive_record(jsonb,boolean) to veterina_rpc;

do $$ declare definition text; patched text; begin
  definition:=replace(pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$begin
$old$,$new$begin
  if action in ('create_vaccination','update_vaccination') then return data; end if;
  if action in ('book_appointment','reschedule_appointment') and data->>'service'='Vaccination'
    and not exists(select 1 from public.service_types where name='Vaccination' and is_active)
    and exists(select 1 from public.service_types where name='Vaccinations and Deworming' and is_active) then
    data:=data||'{"service":"Vaccinations and Deworming"}'::jsonb;
  end if;
$new$);
  if patched=definition then raise exception 'Expected clinical payload guard missing'; end if;
  execute patched;
  definition:=replace(pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$  if p_action in ('create_preventive_care','update_preventive_care') then$old$,$new$  if p_action in ('create_queued_vaccination','create_vaccination','create_record_only_vaccination','update_vaccination') then
    result:=private.save_preventive_care(private.legacy_preventive_payload(p_data||case when p_action='create_record_only_vaccination' then '{"recordingPurpose":"record_only"}'::jsonb else '{}'::jsonb end,p_action='update_vaccination'),p_action='update_vaccination',false);
    entity:=(result->>'id')::uuid;
    -- Older callers address the single vaccine, not its new parent.
    result:=result||jsonb_build_object('preventiveRecordId',entity,'id',(select id from public.vaccinations where preventive_record_id=entity order by id limit 1));
  elsif p_action='delete_record' and p_data->>'entity'='vaccination' then
    entity:=private.delete_preventive_record(p_data,true);
  elsif p_action in ('create_preventive_care','update_preventive_care') then$new$);
  if patched=definition then raise exception 'Expected legacy mutation dispatcher missing'; end if;
  patched:=replace(patched,$old$    if private.staff_role()<>'owner' or length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'FORBIDDEN: owner and deletion reason required'; end if;
    delete from public.preventive_care_records where id=entity and clinic_id=private.current_clinic_id();
    if not found then raise exception 'NOT_FOUND'; end if;$old$,$new$    entity:=private.delete_preventive_record(p_data,false);$new$);
  execute patched;
  definition:=replace(pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure),chr(13),'');
  patched:=replace(definition,$old$      if entry.category='vaccination' and record_data ? 'kind' then
        saved:=$old$,$new$      if entry.category='vaccination' then
        if not(record_data ? 'kind') then record_data:=private.legacy_preventive_payload(record_data||case when entry.vaccination_id is not null then jsonb_build_object('id',entry.vaccination_id) else '{}'::jsonb end,entry.vaccination_id is not null); end if;
        saved:=$new$);
  if patched=definition then raise exception 'Expected preventive queue dispatcher missing'; end if;
  execute patched;
end $$;

-- Reports preserve vaccine evidence and add grouped administration/deworming data.
create view private.preventive_report_items with(security_invoker=true) as
  select v.clinic_id,v.pet_id,v.preventive_record_id,'Vaccination'::text as record_type,v.vaccine_name,v.administered_at,v.next_due_at,v.brand,v.inventory_item_id,v.lot_number,v.dose,v.administered_by_name
  from public.vaccinations v
  union all
  select d.clinic_id,p.pet_id,p.id,'Deworming',d.product_name,p.administered_at,d.next_due_at,d.brand,d.inventory_item_id,d.lot_number,d.dose,p.administered_by_name
  from public.deworming_administrations d join public.preventive_care_records p on p.id=d.preventive_record_id;
revoke all on private.preventive_report_items from public,anon,authenticated;
grant select on private.preventive_report_items to veterina_rpc;
do $$ declare routine record; definition text; patched text; begin
  for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('export_report','filtered_export_report') loop
    definition:=replace(pg_get_functiondef(routine.oid),chr(13),'');
    patched:=replace(definition,$old$'vaccinations',(select$old$,$new$'preventive_care',(select coalesce(jsonb_agg(to_jsonb(pc)||jsonb_build_object('vaccines',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.vaccinations v where v.preventive_record_id=pc.id),'deworming',(select to_jsonb(d) from public.deworming_administrations d where d.preventive_record_id=pc.id)) order by pc.administered_at desc),'[]') from public.preventive_care_records pc where pc.pet_id=p.id),
      'vaccinations',(select$new$);
    patched:=replace(patched,'from public.vaccinations v join public.pets p on p.id=v.pet_id','from private.preventive_report_items v join public.pets p on p.id=v.pet_id');
    patched:=replace(patched,'v.administered_by_name as veterinarian','v.administered_by_name as veterinarian,v.record_type,v.preventive_record_id as record_id,v.dose');
    patched:=replace(patched,'v.brand,v.lot_number from private.preventive_report_items','v.brand,v.lot_number,v.record_type,v.preventive_record_id as record_id,v.dose from private.preventive_report_items');
    execute patched;
  end loop;
end $$;
-- Existing views declared with SELECT * need their new deworming source column.
do $$ declare definition text; patched text; begin
  definition:=pg_get_viewdef('public.reminder_worklist'::regclass,true);
  patched:=replace(definition,'FROM reminders r',', r.deworming_id FROM reminders r');
  if patched=definition then raise exception 'Expected reminder worklist source missing'; end if;
  execute 'create or replace view public.reminder_worklist with(security_invoker=true) as '||patched;
end $$;
notify pgrst,'reload schema';
