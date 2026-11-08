alter table public.prescriptions add column dispensing_mode text not null default 'on_save'
  check(dispensing_mode in ('on_save','on_administration'));

create table public.admission_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  kind text not null check(kind in ('medication','treatment')),
  title text not null check(length(btrim(title)) between 1 and 300),
  instructions text not null default '' check(length(instructions)<=10000),
  prescription_id uuid unique references public.prescriptions(id) on delete restrict,
  medication_id uuid,
  inventory_item_id uuid references public.inventory_items(id),
  starts_at timestamptz not null check(isfinite(starts_at)),
  ends_at timestamptz not null check(isfinite(ends_at)),
  interval_hours numeric check(interval_hours>=0.25 and interval_hours<=8760),
  status text not null default 'active' check(status in ('active','revised','stopped')),
  replaces_id uuid unique references public.admission_orders(id),
  ordered_by uuid not null default auth.uid() references public.profiles(id),
  author_name text not null,
  created_at timestamptz not null default now(),
  check(ends_at>=starts_at),
  check((kind='medication')=(prescription_id is not null and medication_id is not null)),
  check(kind='medication' or inventory_item_id is null)
);
create index admission_orders_page on public.admission_orders(admission_id,created_at,id);
create table public.admission_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  order_id uuid not null references public.admission_orders(id),
  original_due_at timestamptz not null check(isfinite(original_due_at)),
  due_at timestamptz not null check(isfinite(due_at)),
  status text not null default 'pending' check(status in ('pending','delayed','given','held','missed','cancelled')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  unique(order_id,original_due_at)
);
create index admission_tasks_board on public.admission_tasks(admission_id,status,due_at,id);
create table public.admission_administrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  admission_id uuid not null references public.admissions(id),
  order_id uuid references public.admission_orders(id),
  task_id uuid references public.admission_tasks(id),
  outcome text not null check(outcome in ('given','held','missed','delayed','cancelled','correction')),
  title text not null check(length(btrim(title)) between 1 and 300),
  reason text not null default '' check(length(reason)<=10000),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  author_name text not null,
  deferred_until timestamptz,
  inventory_item_id uuid references public.inventory_items(id),
  batch_id uuid references public.inventory_batches(id),
  stock_quantity numeric(12,2) check(stock_quantity>0),
  stock_unit text,
  movement_id uuid unique references public.inventory_movements(id) on delete restrict,
  corrects_id uuid unique references public.admission_administrations(id),
  check(outcome='given' or movement_id is null),
  check(outcome='given' or length(btrim(reason))>0),
  check((outcome='correction')=(corrects_id is not null)),
  check((movement_id is not null)=(inventory_item_id is not null and batch_id is not null and stock_quantity is not null))
);
create unique index admission_task_once on public.admission_administrations(task_id) where outcome in ('given','held','missed','cancelled');
create index admission_administrations_page on public.admission_administrations(admission_id,recorded_at,id);

do $$ declare t text; begin
  foreach t in array array['admission_orders','admission_tasks','admission_administrations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('grant select,insert,update on public.%I to veterina_rpc',t);
    execute format('create policy clinic_read on public.%I for select to authenticated using(clinic_id=(select private.current_clinic_id()))',t);
    execute format('create policy clinic_rpc on public.%I for all to veterina_rpc using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()))',t);
    execute format('create trigger a_clinic_scope before insert or update on public.%I for each row execute function private.enforce_clinic_scope()',t);
    execute format('create trigger audit after insert or update on public.%I for each row execute function private.write_audit_log()',t);
  end loop;
end $$;
revoke update on public.admission_administrations from veterina_rpc;
create trigger immutable before update or delete on public.admission_administrations for each row execute function private.portal_immutable_ledger();

-- Inpatient orders carry canonical prescription details, but dispense per dose.
-- Keep the existing outpatient trigger and its legacy locking behavior intact.
do $$ declare d text; patched text; routine text; begin
  foreach routine in array array['prepare_prescription_inventory','dispense_prescription_inventory'] loop
    d:=pg_get_functiondef(format('private.%I()',routine)::regprocedure);
    patched:=replace(d,E'begin\n',E'begin\n  if tg_op<>''DELETE'' and new.dispensing_mode=''on_administration'' then\n    if not exists(select 1 from public.admissions where visit_id=new.visit_id) then raise exception ''VALIDATION_FAILED: admission medication required''; end if;\n    if exists(select 1 from jsonb_array_elements(coalesce(new.medications,''[]'')) m where m ?| array[''inventoryItemId'',''batchId'',''dispenseQuantity'',''dispenseUnit'']) then raise exception ''VALIDATION_FAILED: select stock only when administering''; end if;\n    return new;\n  end if;\n');
    if patched=d then raise exception 'Expected inventory trigger body missing'; end if;
    execute patched;
  end loop;
end $$;

create function private.admission_prescription(p_admission public.admissions,p_data jsonb,p_historical boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare rx uuid; med uuid:=gen_random_uuid(); clinician uuid; clinician_name text; medicines jsonb;
begin
  select attending_veterinarian_id,attending_veterinarian_name into clinician,clinician_name from public.visits where id=p_admission.visit_id;
  if p_data ?| array['batchId','dispenseQuantity','dispenseUnit'] then raise exception 'VALIDATION_FAILED: orders do not dispense'; end if;
  medicines:=jsonb_build_array(jsonb_build_object('medicationId',med,'medicationName',btrim(p_data->>'title'),
    'dose',coalesce(p_data->>'dose',''),'route',coalesce(p_data->>'route',''),'frequency',coalesce(p_data->>'frequency',''),
    'duration',coalesce(p_data->>'duration',''),'instructions',coalesce(p_data->>'instructions','')));
  insert into public.prescriptions(visit_id,medication_name,dose,route,frequency,duration,instructions,medications,prescribed_by,prescribed_by_name,prescribed_at,dispensing_mode)
    values(p_admission.visit_id,btrim(p_data->>'title'),coalesce(p_data->>'dose',''),coalesce(p_data->>'route',''),coalesce(p_data->>'frequency',''),p_data->>'duration',coalesce(p_data->>'instructions',''),medicines,clinician,clinician_name,
      case when p_historical then coalesce((p_data->>'occurredAt')::timestamptz,p_admission.admitted_at) else now() end,'on_administration') returning id into rx;
  return rx;
end $$;

create or replace function private.admission_has_care(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.admission_observations where admission_id=p_id and kind<>'intake')
    or exists(select 1 from public.admission_orders where admission_id=p_id)
    or exists(select 1 from public.admission_administrations where admission_id=p_id);
$$;

create or replace function private.admission_care_mutation(p_action text,p_data jsonb,p_admission public.admissions) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ord public.admission_orders; previous public.admission_orders; task public.admission_tasks; prior public.admission_administrations;
  begins timestamptz; ends timestamptz; hours numeric; due timestamptz; n integer:=0; rx uuid; saved uuid;
  outcome text:=p_data->>'outcome'; happened timestamptz:=coalesce((p_data->>'occurredAt')::timestamptz,now());
  deferred timestamptz; item public.inventory_items; batch public.inventory_batches; amount numeric; balance numeric; movement uuid;
begin
  if p_action in ('admission_order','admission_revise_order') then
    if p_admission.status='ready_for_discharge' then raise exception 'INVALID_TRANSITION: resume treatment before ordering'; end if;
    begins:=(p_data->>'startsAt')::timestamptz; ends:=coalesce((p_data->>'endsAt')::timestamptz,begins);
    hours:=nullif(p_data->>'intervalHours','')::numeric;
    if hours is not null and nullif(p_data->>'endsAt','') is null then raise exception 'VALIDATION_FAILED: repeating care requires an end time'; end if;
    if begins is null or not isfinite(begins) or not isfinite(ends) or ends<begins or begins<p_admission.admitted_at
      or (hours is not null and (hours<0.25 or hours>8760)) then raise exception 'VALIDATION_FAILED: invalid care schedule'; end if;
    if hours is not null and floor(extract(epoch from ends-begins)/(hours*3600))+1>1000 then raise exception 'VALIDATION_FAILED: schedule exceeds 1000 tasks'; end if;
    if p_action='admission_revise_order' then
      select * into previous from public.admission_orders where id=(p_data->>'replacesOrderId')::uuid and admission_id=p_admission.id for update;
      if previous.id is null then raise exception 'NOT_FOUND: order'; end if;
      if previous.status<>'active' then raise exception 'RECORD_CHANGED'; end if;
      if begins<now() or length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: revision requires a future schedule and reason'; end if;
      update public.admission_orders set status='revised' where id=previous.id;
      for task in select * from public.admission_tasks where order_id=previous.id and status in ('pending','delayed') and due_at>now() order by id for update loop
        update public.admission_tasks set status='cancelled',version=version+1 where id=task.id;
        insert into public.admission_administrations(admission_id,order_id,task_id,outcome,title,reason,occurred_at,author_name)
          values(p_admission.id,previous.id,task.id,'cancelled',previous.title,p_data->>'reason',now(),private.admission_author());
      end loop;
    end if;
    if p_data->>'kind'='medication' then rx:=private.admission_prescription(p_admission,p_data); end if;
    if nullif(p_data->>'inventoryItemId','') is not null and not exists(select 1 from public.inventory_items where id=(p_data->>'inventoryItemId')::uuid and is_active) then raise exception 'INVENTORY_UNAVAILABLE'; end if;
    insert into public.admission_orders(admission_id,kind,title,instructions,prescription_id,medication_id,inventory_item_id,starts_at,ends_at,interval_hours,replaces_id,author_name)
      values(p_admission.id,p_data->>'kind',btrim(p_data->>'title'),coalesce(p_data->>'instructions',''),rx,
        (select (medications->0->>'medicationId')::uuid from public.prescriptions where id=rx),nullif(p_data->>'inventoryItemId','')::uuid,begins,ends,hours,previous.id,private.admission_author()) returning * into ord;
    due:=begins;
    loop
      insert into public.admission_tasks(admission_id,order_id,original_due_at,due_at) values(p_admission.id,ord.id,due,due);
      n:=n+1; exit when hours is null; due:=due+make_interval(secs=>(hours*3600)::double precision); exit when due>ends;
    end loop;
    perform private.admission_event(p_admission.id,'care_order',jsonb_build_object('orderId',ord.id,'replacesId',previous.id,'reason',p_data->>'reason','tasks',n));
    return jsonb_build_object('orderId',ord.id);
  elsif p_action='admission_stop_order' then
    select * into ord from public.admission_orders where id=(p_data->>'orderId')::uuid and admission_id=p_admission.id for update;
    if ord.id is null then raise exception 'NOT_FOUND: order'; end if;
    if ord.status<>'active' then raise exception 'RECORD_CHANGED'; end if;
    if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: stopping reason required'; end if;
    update public.admission_orders set status='stopped' where id=ord.id;
    for task in select * from public.admission_tasks where order_id=ord.id and status in ('pending','delayed') and due_at>now() order by id for update loop
      update public.admission_tasks set status='cancelled',version=version+1 where id=task.id;
      insert into public.admission_administrations(admission_id,order_id,task_id,outcome,title,reason,occurred_at,author_name)
        values(p_admission.id,ord.id,task.id,'cancelled',ord.title,p_data->>'reason',now(),private.admission_author());
    end loop;
    perform private.admission_event(p_admission.id,'order_stopped',jsonb_build_object('orderId',ord.id,'reason',p_data->>'reason'));
    return '{}';
  elsif p_action='admission_correct' then
    if private.staff_role()<>'owner' then raise exception 'FORBIDDEN'; end if;
    select * into prior from public.admission_administrations where id=(p_data->>'administrationId')::uuid and admission_id=p_admission.id;
    if prior.id is null then raise exception 'NOT_FOUND: care event'; end if;
    if length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: correction explanation required'; end if;
    if p_data ?| array['inventoryItemId','batchId','stockQuantity','movementId'] then raise exception 'DISPENSING_LOCKED'; end if;
    insert into public.admission_administrations(admission_id,order_id,task_id,outcome,title,reason,occurred_at,author_name,corrects_id)
      values(p_admission.id,prior.order_id,prior.task_id,'correction',prior.title,p_data->>'reason',prior.occurred_at,private.admission_author(),prior.id) returning id into saved;
    return jsonb_build_object('administrationId',saved);
  elsif p_action not in ('admission_task','admission_unscheduled') then raise exception 'VALIDATION_FAILED: unknown admission action'; end if;

  if p_action='admission_task' then
    select * into task from public.admission_tasks where id=(p_data->>'taskId')::uuid and admission_id=p_admission.id for update;
    if task.id is null then raise exception 'NOT_FOUND: care task'; end if;
    if task.status not in ('pending','delayed') or (p_data->>'taskVersion')::integer is distinct from task.version then raise exception 'RECORD_CHANGED'; end if;
    select * into ord from public.admission_orders where id=task.order_id and admission_id=p_admission.id;
  elsif nullif(p_data->>'orderId','') is not null then
    select * into ord from public.admission_orders where id=(p_data->>'orderId')::uuid and admission_id=p_admission.id;
    if ord.id is null then raise exception 'NOT_FOUND: care order'; end if;
  end if;
  if outcome not in ('given','held','missed','delayed') or outcome is null then raise exception 'VALIDATION_FAILED: care outcome'; end if;
  if outcome='delayed' and task.id is null then raise exception 'VALIDATION_FAILED: only a scheduled task can be delayed'; end if;
  if outcome<>'given' and length(btrim(coalesce(p_data->>'reason','')))=0 then raise exception 'VALIDATION_FAILED: document a reason'; end if;
  if ord.id is not null and ord.status<>'active' and outcome not in ('held','missed') then raise exception 'INVALID_TRANSITION: this order was stopped or revised'; end if;
  if not isfinite(happened) or happened<p_admission.admitted_at or happened>now() then raise exception 'VALIDATION_FAILED: care time outside stay'; end if;
  if outcome='delayed' then
    deferred:=(p_data->>'deferredUntil')::timestamptz;
    if deferred is null or not isfinite(deferred) or deferred<=now() or deferred<=task.due_at then raise exception 'VALIDATION_FAILED: choose a later due time'; end if;
  end if;
  if outcome='given' and ord.inventory_item_id is not null then
    if nullif(p_data->>'inventoryItemId','')::uuid is distinct from ord.inventory_item_id then raise exception 'VALIDATION_FAILED: use the ordered inventory item'; end if;
    select * into item from public.inventory_items where id=ord.inventory_item_id for update;
    if item.id is null or not item.is_active then raise exception 'INVENTORY_UNAVAILABLE'; end if;
    select * into batch from public.inventory_batches where id=nullif(p_data->>'batchId','')::uuid and item_id=item.id for share;
    if batch.id is null or not batch.is_active then raise exception 'INVENTORY_UNAVAILABLE'; end if;
    if batch.expiration_date<(now() at time zone (select timezone from public.clinic_settings where clinic_id=p_admission.clinic_id))::date then raise exception 'EXPIRED_BATCH'; end if;
    if jsonb_typeof(p_data->'stockQuantity') is distinct from 'number' then raise exception 'VALIDATION_FAILED: numeric stock quantity required'; end if;
    amount:=(p_data->>'stockQuantity')::numeric;
    if amount<=0 or amount>=10000000000 or amount<>round(amount,2) or (not item.allows_fraction and amount<>trunc(amount)) then raise exception 'VALIDATION_FAILED: invalid stock quantity'; end if;
    select coalesce(sum(quantity_delta),0) into balance from public.inventory_movements where item_id=item.id and batch_id=batch.id;
    if balance<amount then raise exception 'INSUFFICIENT_STOCK'; end if;
    insert into public.inventory_movements(item_id,batch_id,visit_id,movement_type,quantity_delta,reason,reference,performed_by)
      values(item.id,batch.id,p_admission.visit_id,'stock_out',-amount,'Inpatient medication administered',p_admission.reference||' / order '||ord.id,auth.uid()) returning id into movement;
  elsif p_data ?| array['inventoryItemId','batchId','stockQuantity'] then raise exception 'VALIDATION_FAILED: stock applies only to a given inventory medication'; end if;
  insert into public.admission_administrations(admission_id,order_id,task_id,outcome,title,reason,occurred_at,author_name,deferred_until,inventory_item_id,batch_id,stock_quantity,stock_unit,movement_id)
    values(p_admission.id,ord.id,task.id,outcome,coalesce(ord.title,btrim(p_data->>'title')),coalesce(p_data->>'reason',''),happened,private.admission_author(),deferred,item.id,batch.id,amount,item.unit,movement) returning id into saved;
  if task.id is not null then update public.admission_tasks set status=outcome,due_at=coalesce(deferred,due_at),version=version+1 where id=task.id; end if;
  return jsonb_build_object('administrationId',saved);
end $$;

create or replace function private.admission_resolve_tasks(p_id uuid,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare task public.admission_tasks; a public.admissions; title text; outcome text; reason text;
begin
  select * into a from public.admissions where id=p_id;
  if a.is_historical then return; end if;
  if exists(select 1 from public.admission_tasks where admission_id=p_id and status in ('pending','delayed') and due_at<=now())
    and length(btrim(coalesce(p_data->>'overdueReason','')))=0 then raise exception 'OPEN_CARE_TASKS: document why overdue tasks were missed'; end if;
  if exists(select 1 from public.admission_tasks where admission_id=p_id and status in ('pending','delayed') and due_at>now())
    and coalesce((p_data->>'acknowledgeFutureTasks')::boolean,false) is not true then raise exception 'OPEN_CARE_TASKS: acknowledge cancellation of future care'; end if;
  for task in select * from public.admission_tasks where admission_id=p_id and status in ('pending','delayed') order by id for update loop
    outcome:=case when task.due_at<=now() then 'missed' else 'cancelled' end;
    reason:=case when outcome='missed' then p_data->>'overdueReason' else 'Future care cancelled at authorized discharge' end;
    select o.title into title from public.admission_orders o where o.id=task.order_id;
    update public.admission_tasks set status=outcome,version=version+1 where id=task.id;
    insert into public.admission_administrations(admission_id,order_id,task_id,outcome,title,reason,occurred_at,author_name)
      values(p_id,task.order_id,task.id,outcome,title,reason,now(),private.admission_author());
  end loop;
  update public.admission_orders set status='stopped' where admission_id=p_id and status='active';
end $$;

-- Any prescription on an admission must stay out of the outpatient dispatcher.
create function private.admission_prescription_mode() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.admissions where visit_id=new.visit_id) and new.dispensing_mode<>'on_administration' then raise exception 'ADMISSION_WORKSPACE_REQUIRED'; end if;
  if tg_op='UPDATE' and old.dispensing_mode<>new.dispensing_mode then raise exception 'DISPENSING_LOCKED'; end if;
  return new;
end $$;
create trigger prescriptions_ab_admission_mode before insert or update on public.prescriptions for each row execute function private.admission_prescription_mode();
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'admission_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to veterina_rpc',r.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
