-- Keep preventive measurements attached to the clinical record: grouped
-- vaccinations share this one row and deworming has one row per administration.
create table public.preventive_record_vitals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  preventive_record_id uuid not null unique references public.preventive_care_records(id) on delete cascade,
  weight_kg numeric check(weight_kg is null or weight_kg>0),
  temperature_c numeric check(temperature_c is null or temperature_c>0),
  heart_rate_bpm integer check(heart_rate_bpm is null or heart_rate_bpm>0),
  respiratory_rate_rpm integer check(respiratory_rate_rpm is null or respiratory_rate_rpm>0),
  body_condition_score smallint check(body_condition_score is null or body_condition_score between 1 and 5),
  hydration text check(hydration is null or hydration in ('Normal','Mild dehydration','Moderate dehydration','Severe dehydration')),
  measured_by uuid not null references public.profiles(id),
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check(num_nonnulls(weight_kg,temperature_c,heart_rate_bpm,respiratory_rate_rpm,body_condition_score,hydration)>0)
);
create index preventive_record_vitals_clinic on public.preventive_record_vitals(clinic_id,preventive_record_id);
alter table public.preventive_record_vitals enable row level security;
revoke all on public.preventive_record_vitals from public,anon,authenticated;
grant select on public.preventive_record_vitals to authenticated;
grant select,insert,update,delete on public.preventive_record_vitals to veterina_rpc;
create policy clinic_read on public.preventive_record_vitals for select to authenticated
  using(clinic_id=(select private.current_clinic_id()) and (select private.staff_role()) is not null);
create policy rpc_clinic on public.preventive_record_vitals for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()));
create trigger a_clinic_scope before insert or update on public.preventive_record_vitals
  for each row execute function private.enforce_clinic_scope();
create trigger audit_preventive_vitals after insert or update or delete on public.preventive_record_vitals
  for each row execute function private.write_audit_log();

create function private.save_preventive_record_vitals(p_record_id uuid,p_values jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare clinic uuid:=private.current_clinic_id(); parent public.preventive_care_records; key text;
  weight numeric; temperature numeric; heart_value numeric; respiratory_value numeric; body_value numeric;
  heart integer; respiratory integer; body smallint; hydration_value text;
begin
  if auth.uid() is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' then raise exception 'VALIDATION_FAILED: vitals must be an object'; end if;
  select * into parent from public.preventive_care_records where id=p_record_id and clinic_id=clinic;
  if parent.id is null then raise exception 'NOT_FOUND: preventive record'; end if;
  for key in select jsonb_object_keys(p_values) loop
    if key not in ('weightKg','temperatureC','heartRate','respiratoryRate','bodyConditionScore','hydration') then
      raise exception 'VALIDATION_FAILED: unsupported preventive measurement';
    end if;
    if key='hydration' then
      if jsonb_typeof(p_values->key) not in ('string','null') then raise exception 'VALIDATION_FAILED: hydration'; end if;
    elsif jsonb_typeof(p_values->key) not in ('number','null') then
      raise exception 'VALIDATION_FAILED: numeric measurements required';
    end if;
    if key in ('heartRate','respiratoryRate','bodyConditionScore') and jsonb_typeof(p_values->key)='number'
      and (p_values->>key)::numeric<>trunc((p_values->>key)::numeric) then
      raise exception 'VALIDATION_FAILED: whole-number vitals required';
    end if;
  end loop;
  weight:=nullif(p_values->>'weightKg','')::numeric;
  temperature:=nullif(p_values->>'temperatureC','')::numeric;
  heart_value:=nullif(p_values->>'heartRate','')::numeric;
  respiratory_value:=nullif(p_values->>'respiratoryRate','')::numeric;
  body_value:=nullif(p_values->>'bodyConditionScore','')::numeric;
  heart:=heart_value::integer;
  respiratory:=respiratory_value::integer;
  body:=body_value::smallint;
  hydration_value:=nullif(p_values->>'hydration','');
  if (weight is not null and weight<=0) or (temperature is not null and temperature<=0)
    or (heart is not null and heart<=0) or (respiratory is not null and respiratory<=0)
    or (body is not null and body not between 1 and 5)
    or hydration_value not in ('Normal','Mild dehydration','Moderate dehydration','Severe dehydration') then
    raise exception 'VALIDATION_FAILED: check vitals and condition values';
  end if;
  if num_nonnulls(weight,temperature,heart,respiratory,body,hydration_value)=0 then
    delete from public.preventive_record_vitals where preventive_record_id=p_record_id and clinic_id=clinic;
    return;
  end if;
  insert into public.preventive_record_vitals(clinic_id,preventive_record_id,weight_kg,temperature_c,heart_rate_bpm,respiratory_rate_rpm,body_condition_score,hydration,measured_by,measured_at)
  values(clinic,p_record_id,weight,temperature,heart,respiratory,body,hydration_value,auth.uid(),now())
  on conflict(preventive_record_id) do update set weight_kg=excluded.weight_kg,temperature_c=excluded.temperature_c,
    heart_rate_bpm=excluded.heart_rate_bpm,respiratory_rate_rpm=excluded.respiratory_rate_rpm,
    body_condition_score=excluded.body_condition_score,hydration=excluded.hydration,
    measured_by=excluded.measured_by,measured_at=excluded.measured_at;
end $$;
revoke all on function private.save_preventive_record_vitals(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.save_preventive_record_vitals(uuid,jsonb) to veterina_rpc;

-- Keep vitals in the same transaction as the preventive record and inventory
-- workflow. Older callers that omit vitals leave existing evidence untouched.
do $$ declare definition text; patched text; begin
  definition:=replace(pg_get_functiondef('private.save_preventive_care(jsonb,boolean,boolean)'::regprocedure),chr(13),'');
  patched:=replace(definition,
    $old$private.consume_preventive_stock(record_id); end if;$old$,
    $new$private.consume_preventive_stock(record_id); end if;
  if data ? 'vitals' then perform private.save_preventive_record_vitals(record_id,data->'vitals'); end if;$new$);
  if patched=definition then raise exception 'Expected preventive save return block missing'; end if;
  execute patched;

  definition:=replace(pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure),chr(13),'');
  patched:=replace(definition,
    $old$'petId','version','vaccines','deworming'))$old$,
    $new$'petId','version','vaccines','deworming','vitals'))$new$);
  if patched=definition then raise exception 'Expected preventive draft field guard missing'; end if;
  execute patched;
end $$;

notify pgrst,'reload schema';
