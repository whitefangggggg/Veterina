alter table public.visits add column clinical_notes text not null default ''
  check (length(clinical_notes) <= 10000);

-- Extend the existing validated and audited payload preparation, preserving old
-- values when an older client updates a checkup without the new optional field.
do $migration$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('private.prepare_clinical_payload(text,jsonb)'::regprocedure);
  patched := replace(definition,
    $old$  elsif action in ('create_encounter','update_encounter') then$old$,
    $new$  elsif action in ('create_encounter','update_encounter') then
    if data ? 'clinicalNotes' and (jsonb_typeof(data->'clinicalNotes') <> 'string' or length(data->>'clinicalNotes')>10000) then
      raise exception 'VALIDATION_FAILED: clinical notes must be text of at most 10000 characters'; end if;
    $new$);
  if patched=definition then raise exception 'Expected clinical payload branch not found'; end if;
  execute patched;

  definition := pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,
    $old$insert into public.visits(pet_id,visit_type,chief_complaint,$old$,
    $new$insert into public.visits(clinical_notes,pet_id,visit_type,chief_complaint,$new$);
  patched := replace(patched,
    $old$values(pet,p_data->>'type',p_data->>'complaint',$old$,
    $new$values(coalesce(p_data->>'clinicalNotes',''),pet,p_data->>'type',p_data->>'complaint',$new$);
  if patched=definition or strpos(patched,'visits(clinical_notes,')=0 then raise exception 'Expected encounter insert not found'; end if;
  -- Legacy single-medication APIs must persist the required route too.
  patched := replace(patched,'insert into public.prescriptions(visit_id,medication_name,dose,frequency,instructions,prescribed_by,medications,duration)',
    'insert into public.prescriptions(route,visit_id,medication_name,dose,frequency,instructions,prescribed_by,medications,duration)');
  patched := replace(patched,$old$values(entity,p_data->>'medicationName',p_data->>'dose',$old$,$new$values(p_data->>'route',entity,p_data->>'medicationName',p_data->>'dose',$new$);
  execute patched;

  definition := pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,'update public.visits set visit_type=',
    $new$update public.visits set clinical_notes=coalesce(p_data->>'clinicalNotes',clinical_notes),visit_type=$new$);
  if patched=definition then raise exception 'Expected encounter update not found'; end if;
  patched := replace(patched,'update public.prescriptions set medication_name=',
    $new$update public.prescriptions set route=p_data->>'route',medication_name=$new$);
  execute patched;

  definition := pg_get_functiondef('private.queue_mutation(text,jsonb,uuid)'::regprocedure);
  patched := replace(definition,$old$'assessment','plan','diagnosis','followUpDate'$old$,$new$'assessment','plan','clinicalNotes','diagnosis','followUpDate'$new$);
  if patched=definition then raise exception 'Expected draft allowlist not found'; end if;
  patched := replace(patched,$old$  if p_action='add_queue_entry' then$old$,
    $new$  if p_action='add_queue_entry' then
    if not exists(select 1 from public.pets p join public.owners o on o.id=p.owner_id
      where p.id=(p_data->>'petId')::uuid and p.status='Active' and o.is_active
      and (not (p_data ? 'ownerId') or o.id=(p_data->>'ownerId')::uuid)) then
      raise exception 'VALIDATION_FAILED: select an active patient belonging to the selected active owner'; end if;$new$);
  execute patched;

  definition := pg_get_functiondef('private.validate_prescription_medications()'::regprocedure);
  patched := replace(definition,'if new.medications is null then return new; end if;',
    $new$if new.medications is null then
      if nullif(btrim(new.route),'') is null then raise exception 'VALIDATION_FAILED: route is required for every medication'; end if;
      return new;
    end if;$new$);
  patched := replace(patched,$old$array['medicationName','dose','frequency']$old$,$new$array['medicationName','dose','route','frequency']$new$);
  patched := replace(patched,'each medication needs a name, dose and frequency','each medication needs a name, dose, route and frequency');
  patched := replace(patched,$old$new.medication_name := new.medications->0->>'medicationName';$old$,
    $new$new.route := new.medications->0->>'route';
  new.medication_name := new.medications->0->>'medicationName';$new$);
  if patched=definition then raise exception 'Expected prescription validation not found'; end if;
  execute patched;
end $migration$;

-- Owner selections must reference real, active records; unchanged historical
-- ownership remains editable even if the linked owner was later deactivated.
create function private.validate_patient_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or new.owner_id is distinct from old.owner_id then
    if not exists(select 1 from public.owners where id=new.owner_id and is_active) then
      raise exception 'VALIDATION_FAILED: select an active owner'; end if;
  end if;
  return new;
end $$;
revoke all on function private.validate_patient_owner() from public,anon,authenticated;
create trigger pets_validate_owner before insert or update of owner_id on public.pets
  for each row execute function private.validate_patient_owner();
notify pgrst,'reload schema';
