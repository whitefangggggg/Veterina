alter table public.export_events add column filters jsonb not null default '{}';
alter table public.export_events add column status text not null default 'prepared';

create or replace function private.filtered_export_report(p_report text,p_patient_id uuid,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rows jsonb; export_id uuid; from_date date; to_date date; timezone text;
  species_filter text:=nullif(p_filters->>'species','');
  patient_status text:=nullif(p_filters->>'patient_status','');
  reminder_state text:=coalesce(nullif(p_filters->>'reminder_status',''),'all');
  category_filter text:=nullif(p_filters->>'category','');
  low_stock boolean:=coalesce((p_filters->>'low_stock_only')::boolean,false);
  include_archived boolean:=coalesce((p_filters->>'include_archived')::boolean,false);
begin
  if private.staff_role() is distinct from 'owner'::public.staff_role then raise exception 'FORBIDDEN'; end if;
  if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'VALIDATION_FAILED: invalid report filters'; end if;
  from_date:=nullif(p_filters->>'date_from','')::date;
  to_date:=nullif(p_filters->>'date_to','')::date;
  if from_date>to_date then raise exception 'VALIDATION_FAILED: end date must be on or after start date'; end if;
  if species_filter is not null and species_filter not in ('Dog','Cat','Bird','Rabbit','Other') then raise exception 'VALIDATION_FAILED: unknown species'; end if;
  if patient_status is not null and patient_status not in ('Active','Inactive','Deceased') then raise exception 'VALIDATION_FAILED: unknown patient status'; end if;
  if reminder_state not in ('all','open','completed','cancelled','due','overdue','upcoming') then raise exception 'VALIDATION_FAILED: unknown reminder status'; end if;
  select c.timezone into timezone from public.clinic_settings c order by c.created_at,c.id limit 1;

  if p_report='patients' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select p.record_number,p.name,p.species,p.breed,p.status,p.microchip_number,o.full_name as owner_name,o.phone,o.email
      from public.pets p join public.owners o on o.id=p.owner_id
      where (species_filter is null or p.species=species_filter) and (patient_status is null or p.status=patient_status)
      order by p.record_number
    ) x;
  elsif p_report='vaccinations' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select p.record_number,p.name as patient,v.vaccine_name,v.administered_at,v.next_due_at,v.lot_number,v.administered_by_name as veterinarian
      from public.vaccinations v join public.pets p on p.id=v.pet_id
      where v.next_due_at is not null and (from_date is null or v.next_due_at>=from_date) and (to_date is null or v.next_due_at<=to_date)
      order by v.next_due_at,p.record_number
    ) x;
  elsif p_report='inventory' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select i.sku,i.name,i.category,i.unit,i.minimum_stock,i.quantity_on_hand,i.nearest_expiration,item.is_active
      from public.inventory_on_hand i join public.inventory_items item on item.id=i.id
      where (include_archived or item.is_active) and (category_filter is null or i.category=category_filter)
        and (not low_stock or i.quantity_on_hand<=i.minimum_stock)
      order by i.name,i.sku
    ) x;
  elsif p_report='reminders' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select p.record_number,p.name as patient,r.title,r.reminder_type,(r.due_at at time zone timezone)::date as due_date,
        r.display_status as status,r.outcome,r.completed_at,o.full_name as owner_name,o.phone
      from public.reminder_worklist r join public.pets p on p.id=r.pet_id join public.owners o on o.id=p.owner_id
      where (from_date is null or (r.due_at at time zone timezone)::date>=from_date)
        and (to_date is null or (r.due_at at time zone timezone)::date<=to_date)
        and (reminder_state='all' or (reminder_state='open' and r.status not in ('completed','cancelled')) or r.display_status=reminder_state)
      order by r.due_at,p.record_number
    ) x;
  elsif p_report='history' and p_patient_id is not null then
    select jsonb_build_array(jsonb_build_object('patient',to_jsonb(p),
      'owner',(select to_jsonb(o) from public.owners o where o.id=p.owner_id),
      'alerts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') from public.pet_alerts a where a.pet_id=p.id),
      'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.visited_at desc),'[]') from public.visits v where v.pet_id=p.id),
      'vitals',(select coalesce(jsonb_agg(to_jsonb(vt) order by vt.measured_at desc),'[]') from public.visit_vitals vt join public.visits v on v.id=vt.visit_id where v.pet_id=p.id),
      'vaccinations',(select coalesce(jsonb_agg(to_jsonb(v) order by v.administered_at desc),'[]') from public.vaccinations v where v.pet_id=p.id),
      'prescriptions',(select coalesce(jsonb_agg(to_jsonb(pr) order by pr.prescribed_at),'[]') from public.prescriptions pr join public.visits v on v.id=pr.visit_id where v.pet_id=p.id),
      'corrections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]') from public.visit_corrections c join public.visits v on v.id=c.visit_id where v.pet_id=p.id),
      'reminders',(select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at),'[]') from public.reminder_worklist r where r.pet_id=p.id)
    )) into rows from public.pets p where p.id=p_patient_id;
    if rows is null then raise exception 'NOT_FOUND'; end if;
  else raise exception 'VALIDATION_FAILED: unknown report'; end if;
  insert into public.export_events(user_id,report_type,row_count,filters,status)
    values(auth.uid(),p_report,jsonb_array_length(rows),p_filters||jsonb_build_object('patient_id',p_patient_id),'prepared') returning id into export_id;
  return jsonb_build_object('rows',rows,'row_count',jsonb_array_length(rows),'export_id',export_id);
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'VALIDATION_FAILED: invalid report filters';
end $$;
revoke all on function private.filtered_export_report(text,uuid,jsonb) from public,anon;
grant execute on function private.filtered_export_report(text,uuid,jsonb) to authenticated;
create or replace function public.filtered_export_report(p_report text,p_patient_id uuid default null,p_filters jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select private.filtered_export_report(p_report,p_patient_id,p_filters);
$$;
revoke all on function public.filtered_export_report(text,uuid,jsonb) from public,anon;
grant execute on function public.filtered_export_report(text,uuid,jsonb) to authenticated;

-- Count adjustments must not put stock back into an archived batch.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched:=replace(definition,
    'where id=(p_data->>''batchId'')::uuid and item_id=entity)',
    'where id=(p_data->>''batchId'')::uuid and item_id=entity and is_active)');
  if patched=definition then raise exception 'Expected batch validation was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
