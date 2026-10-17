-- Close the remaining record-level gaps from BR-23, BR-27, BR-44 and BR-57.
alter table public.inventory_batches add column is_active boolean not null default true;
alter table public.inventory_batches add column updated_at timestamptz not null default now();
alter table public.visits add column attending_veterinarian_name text not null default '';
alter table public.visits add column recorded_by_name text not null default '';
alter table public.vaccinations add column administered_by_name text not null default '';
alter table public.prescriptions add column prescribed_by_name text not null default '';
alter table public.visit_corrections add column before_data jsonb not null default '{}';
alter table public.visit_corrections add column after_data jsonb not null default '{}';

alter table public.inventory_movements add constraint portal_finite_stock check
  (quantity_delta not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.inventory_items add constraint portal_finite_minimum check
  (minimum_stock not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.inventory_batches add constraint portal_finite_cost check
  (unit_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.visit_vitals add constraint portal_finite_weight check
  (weight_kg not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.pets add constraint portal_finite_baseline_weight check
  (baseline_weight not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.pet_alerts add constraint portal_alert_description check (length(btrim(description))>0);
alter table public.reminders add constraint portal_completion_outcome check
  (status<>'completed' or (outcome is not null and split_part(outcome,':',1) in
    ('Reached owner','No answer','Appointment booked','Owner declined','Other')));

create or replace function private.portal_snapshot_clinicians()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name='visits' then
    if tg_op='INSERT' or new.attending_veterinarian_id is distinct from old.attending_veterinarian_id then
      select full_name into new.attending_veterinarian_name from public.profiles where id=new.attending_veterinarian_id;
      new.attending_veterinarian_name:=coalesce(new.attending_veterinarian_name,'Clinic staff');
    else new.attending_veterinarian_name:=old.attending_veterinarian_name; end if;
    if tg_op='INSERT' then
      select full_name into new.recorded_by_name from public.profiles where id=new.recorded_by;
      new.recorded_by_name:=coalesce(new.recorded_by_name,'Clinic staff');
    else new.recorded_by_name:=old.recorded_by_name; end if;
  elsif tg_table_name='vaccinations' then
    if tg_op='INSERT' or new.administered_by is distinct from old.administered_by then
      select full_name into new.administered_by_name from public.profiles where id=new.administered_by;
      new.administered_by_name:=coalesce(new.administered_by_name,'Clinic staff');
    else new.administered_by_name:=old.administered_by_name; end if;
  else
    if tg_op='INSERT' or new.prescribed_by is distinct from old.prescribed_by then
      select full_name into new.prescribed_by_name from public.profiles where id=new.prescribed_by;
      new.prescribed_by_name:=coalesce(new.prescribed_by_name,'Clinic staff');
    else new.prescribed_by_name:=old.prescribed_by_name; end if;
  end if;
  return new;
end $$;
create trigger visits_snapshot_clinicians before insert or update on public.visits
for each row execute function private.portal_snapshot_clinicians();
create trigger vaccinations_snapshot_clinicians before insert or update on public.vaccinations
for each row execute function private.portal_snapshot_clinicians();
create trigger prescriptions_snapshot_clinicians before insert or update on public.prescriptions
for each row execute function private.portal_snapshot_clinicians();

create or replace function private.portal_snapshot_correction()
returns trigger language plpgsql set search_path = '' as $$
begin
  select jsonb_build_object('visit',to_jsonb(v),'vitals',
    (select coalesce(jsonb_agg(to_jsonb(vt)),'[]') from public.visit_vitals vt where vt.visit_id=v.id))
    into new.before_data from public.visits v where v.id=new.visit_id;
  new.after_data:=new.before_data||jsonb_build_object('appended_correction',new.correction);
  return new;
end $$;
create trigger visit_corrections_snapshot before insert on public.visit_corrections
for each row execute function private.portal_snapshot_correction();

create or replace function private.portal_batch_archive_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize archiving with stock mutations using the same item lock.
  perform 1 from public.inventory_items where id=new.item_id for update;
  if not new.is_active and coalesce((select sum(quantity_delta) from public.inventory_movements where batch_id=new.id),0)<>0 then
    raise exception 'BATCH_HAS_STOCK: dispense or dispose of this batch before archiving it';
  end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger inventory_batches_archive_guard before update on public.inventory_batches
for each row execute function private.portal_batch_archive_guard();

-- Keep the established private mutation paths and add only the missing branches.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    'delete from public.item_suppliers where item_id=entity;',
    'delete from public.item_suppliers where item_id=entity and is_preferred;');
  patched:=replace(patched,
    'values(entity,(p_data->>''supplierId'')::uuid,true);',
    'values(entity,(p_data->>''supplierId'')::uuid,true) on conflict (item_id,supplier_id) do update set is_preferred=true;');
  patched:=replace(patched,
    'unit_cost=nullif(p_data->>''unitCost'','''')::numeric where id=entity;',
    'unit_cost=nullif(p_data->>''unitCost'','''')::numeric,is_active=coalesce((p_data->>''isActive'')::boolean,true) where id=entity;');
  patched:=replace(patched,
    'if (p_data->>''observedQuantity'')::numeric < 0 or',
    'if nullif(p_data->>''observedQuantity'','''') is null or (p_data->>''observedQuantity'')::numeric in (''NaN''::numeric,''Infinity''::numeric,''-Infinity''::numeric) or (p_data->>''observedQuantity'')::numeric < 0 or');
  patched:=replace(patched,
    'elsif p_action in (''create_alert'',''resolve_alert'') then',
    'elsif p_action in (''create_alert'',''update_alert'',''resolve_alert'') then');
  patched:=replace(patched,
    '    else'||chr(10)||'      update public.pet_alerts set is_active=false',
    '    elsif p_action=''update_alert'' then'||chr(10)||
    '      update public.pet_alerts set alert_type=p_data->>''alertType'',description=p_data->>''description'',severity=p_data->>''severity'' where id=entity;'||chr(10)||
    '      if not found then raise exception ''NOT_FOUND''; end if;'||chr(10)||
    '    else'||chr(10)||'      update public.pet_alerts set is_active=false');
  patched:=replace(patched,
    '  elsif p_action=''update_prescription'' then',
    '  elsif p_action=''log_reminder_attempt'' then'||chr(10)||
    '    perform 1 from public.reminders where id=entity and status not in (''completed'',''cancelled'') for update;'||chr(10)||
    '    if not found then raise exception ''INVALID_TRANSITION''; end if;'||chr(10)||
    '    if length(btrim(coalesce(p_data->>''notes'','''')))=0 then raise exception ''VALIDATION_FAILED: contact note required''; end if;'||chr(10)||
    '    insert into public.reminder_activity(reminder_id,action,note,performed_by) values(entity,''contact_attempt'',p_data->>''notes'',actor);'||chr(10)||
    '  elsif p_action=''update_prescription'' then');
  if patched=definition then raise exception 'Expected portal mutation source was not found'; end if;
  execute patched;

  select pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,'where id=batch and item_id=item)','where id=batch and item_id=item and is_active)');
  patched:=replace(patched,'at time zone ''Asia/Manila''','at time zone coalesce((select timezone from public.clinic_settings limit 1),''Asia/Manila'')');
  if patched=definition then raise exception 'Expected base mutation source was not found'; end if;
  execute patched;

  select pg_get_functiondef('private.create_vaccine_reminder()'::regprocedure) into definition;
  patched:=replace(definition,'at time zone ''Asia/Manila''','at time zone coalesce((select timezone from public.clinic_settings limit 1),''Asia/Manila'')');
  execute patched;
end $migration$;

revoke all on function private.portal_snapshot_clinicians() from public,anon,authenticated;
revoke all on function private.portal_snapshot_correction() from public,anon,authenticated;
revoke all on function private.portal_batch_archive_guard() from public,anon,authenticated;
notify pgrst, 'reload schema';
