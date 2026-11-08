-- A discharge snapshot is frozen once, including care and the authoritative
-- prescriptions. Rendering never rebuilds old evidence from mutable sources.
do $$ declare d text; patched text; begin
  d:=pg_get_functiondef('private.admission_snapshot(uuid,jsonb)'::regprocedure);
  patched:=replace(d,$old$'events',(select$old$,$new$'orders',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') from public.admission_orders x where x.admission_id=a.id),
    'tasks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.original_due_at),'[]') from public.admission_tasks x where x.admission_id=a.id),
    'administrations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.recorded_at),'[]') from public.admission_administrations x where x.admission_id=a.id),
    'prescriptions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.prescribed_at),'[]') from public.prescriptions x where x.visit_id=a.visit_id),
    'occupancy',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('unitName',u.name,'wardName',w.name) order by x.assigned_at),'[]') from public.admission_occupancy x join public.admission_units u on u.id=x.unit_id join public.admission_wards w on w.id=u.ward_id where x.admission_id=a.id),
    'events',(select$new$);
  if patched=d then raise exception 'Expected admission snapshot extension point missing'; end if;
  execute patched;
end $$;

create function private.admission_historical_details(p_id uuid,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.admissions; entry jsonb; happened timestamptz;
begin
  select * into a from public.admissions where id=p_id;
  if not a.is_historical then return; end if;
  if jsonb_typeof(coalesce(p_data->'observations','[]'))<>'array' or jsonb_typeof(coalesce(p_data->'medications','[]'))<>'array' then raise exception 'VALIDATION_FAILED: historical details must be lists'; end if;
  if jsonb_array_length(coalesce(p_data->'observations','[]'))>1000 or jsonb_array_length(coalesce(p_data->'medications','[]'))>100 then raise exception 'VALIDATION_FAILED: too many historical entries'; end if;
  for entry in select value from jsonb_array_elements(coalesce(p_data->'observations','[]')) loop
    happened:=(entry->>'occurredAt')::timestamptz;
    if happened is null or not isfinite(happened) or happened<a.admitted_at or happened>a.closed_at then raise exception 'VALIDATION_FAILED: historical observation time outside stay'; end if;
    if entry->>'kind' not in ('vitals','condition','note') or entry->>'kind' is null then raise exception 'VALIDATION_FAILED: historical observation kind'; end if;
    if entry->>'kind'='note' and length(btrim(coalesce(entry->>'note','')))=0 then raise exception 'VALIDATION_FAILED: historical note required'; end if;
    if entry->>'kind'='condition' and not(coalesce(entry->'values','{}') ? 'condition') then raise exception 'VALIDATION_FAILED: historical condition required'; end if;
    insert into public.admission_observations(admission_id,kind,values,note,occurred_at,author_name)
      values(p_id,entry->>'kind',private.admission_values(coalesce(entry->'values','{}')),coalesce(entry->>'note',''),happened,private.admission_author());
  end loop;
  for entry in select value from jsonb_array_elements(coalesce(p_data->'medications','[]')) loop
    if entry ?| array['inventoryItemId','batchId','dispenseQuantity','stockQuantity'] then raise exception 'VALIDATION_FAILED: historical medications cannot consume stock'; end if;
    happened:=coalesce((entry->>'occurredAt')::timestamptz,a.admitted_at);
    if not isfinite(happened) or happened<a.admitted_at or happened>a.closed_at then raise exception 'VALIDATION_FAILED: historical medication time outside stay'; end if;
    perform private.admission_prescription(a,entry,true);
  end loop;
end $$;

-- Hook historical detail insertion before the existing snapshot/finalization.
do $$ declare d text; patched text; begin
  d:=pg_get_functiondef('private.admission_resolve_tasks(uuid,jsonb)'::regprocedure);
  patched:=replace(d,'if a.is_historical then return; end if;',
    'if a.is_historical then perform private.admission_historical_details(p_id,p_data); return; end if;');
  if patched=d then raise exception 'Expected historical detail hook missing'; end if; execute patched;
end $$;

-- Complete patient-history exports include inpatient evidence, irrespective of
-- the visible UI tab. Existing checkups and document contracts remain intact.
do $$ declare routine record; d text; patched text; begin
  for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('export_report','filtered_export_report') loop
    d:=pg_get_functiondef(routine.oid);
    patched:=replace(d,$old$'vaccinations',(select$old$,$new$'admissions',(select coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(a),'snapshot',coalesce(s.snapshot,private.admission_snapshot(a.id,'{}')),
      'observations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.recorded_at),'[]') from public.admission_observations x where x.admission_id=a.id),
      'administrations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.recorded_at),'[]') from public.admission_administrations x where x.admission_id=a.id)) order by a.admitted_at desc),'[]') from public.admissions a left join public.admission_discharge_summaries s on s.admission_id=a.id where a.pet_id=p.id),
      'vaccinations',(select$new$);
    if patched<>d then execute patched; end if;
  end loop;
end $$;

-- Admission-linked encounters must never be queued, including historical stays.
create function private.admission_queue_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.admissions where visit_id=new.visit_id) or exists(select 1 from public.visits where id=new.visit_id and recording_purpose='admission') then raise exception 'ADMISSION_WORKSPACE_REQUIRED'; end if;
  return new;
end $$;
create trigger queue_admission_mode before insert or update on public.queue_entries for each row execute function private.admission_queue_guard();

do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'admission_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to veterina_rpc',r.signature);
  end loop;
end $$;
create view public.admission_observation_history with(security_invoker=true) as
  select o.*,not exists(select 1 from public.admission_observations c where c.corrects_id=o.id) as is_current from public.admission_observations o;
revoke all on public.admission_observation_history from public,anon,authenticated;
grant select on public.admission_observation_history to authenticated,service_role,veterina_rpc;
notify pgrst,'reload schema';
