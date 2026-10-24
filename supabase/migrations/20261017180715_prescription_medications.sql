-- One prescription holds an ordered medication list. NULL preserves historical
-- single-medication rows without rewriting finalized clinical records.
alter table public.prescriptions add column medications jsonb;

create function private.validate_prescription_medications()
returns trigger language plpgsql set search_path = '' as $$
declare medication jsonb; field_name text;
begin
  if new.medications is null then return new; end if;
  if jsonb_typeof(new.medications) <> 'array' then
    raise exception 'VALIDATION_FAILED: medications must be a list';
  end if;
  if jsonb_array_length(new.medications) = 0 then
    raise exception 'VALIDATION_FAILED: add at least one medication';
  end if;
  for medication in select value from jsonb_array_elements(new.medications) loop
    if jsonb_typeof(medication) <> 'object' then
      raise exception 'VALIDATION_FAILED: invalid medication';
    end if;
    foreach field_name in array array['medicationName','dose','frequency'] loop
      if jsonb_typeof(medication->field_name) is distinct from 'string'
        or length(btrim(medication->>field_name)) = 0 then
        raise exception 'VALIDATION_FAILED: each medication needs a name, dose and frequency';
      end if;
    end loop;
    foreach field_name in array array['duration','instructions'] loop
      if medication ? field_name and jsonb_typeof(medication->field_name) <> 'string' then
        raise exception 'VALIDATION_FAILED: medication duration and instructions must be text';
      end if;
    end loop;
  end loop;
  -- Keep older consumers compatible with the first medication in the list.
  new.medication_name := new.medications->0->>'medicationName';
  new.dose := new.medications->0->>'dose';
  new.frequency := new.medications->0->>'frequency';
  new.duration := new.medications->0->>'duration';
  new.instructions := coalesce(new.medications->0->>'instructions','');
  return new;
end $$;
create trigger prescriptions_validate_medications before insert or update on public.prescriptions
for each row execute function private.validate_prescription_medications();
revoke all on function private.validate_prescription_medications() from public, anon, authenticated;

-- Extend the existing authenticated, audited, idempotent mutation paths so every
-- medication is saved in the same transaction and finalized guards still apply.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.mutate(text,jsonb,uuid)'::regprocedure) into definition;
  patched := replace(definition,
    'insert into public.prescriptions(visit_id,medication_name,dose,frequency,instructions,prescribed_by)',
    'insert into public.prescriptions(visit_id,medication_name,dose,frequency,instructions,prescribed_by,medications,duration)');
  patched := replace(patched,
    'values(entity,p_data->>''medicationName'',p_data->>''dose'',p_data->>''frequency'',coalesce(p_data->>''instructions'',''''),u) returning id into entity;',
    'values(entity,p_data->>''medicationName'',p_data->>''dose'',p_data->>''frequency'',coalesce(p_data->>''instructions'',''''),u,p_data->''medications'',nullif(p_data->>''duration'','''')) returning id into entity;');
  if patched=definition or strpos(patched,'u,p_data->''medications''')=0 then raise exception 'Expected prescription creation was not found'; end if;
  execute patched;

  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched := replace(definition,
    'update public.prescriptions set medication_name=p_data->>''medicationName'',dose=p_data->>''dose'',frequency=p_data->>''frequency'',instructions=coalesce(p_data->>''instructions'','''') where id=entity;',
    'update public.prescriptions set medication_name=p_data->>''medicationName'',dose=p_data->>''dose'',frequency=p_data->>''frequency'',instructions=coalesce(p_data->>''instructions'',''''),medications=p_data->''medications'',duration=nullif(p_data->>''duration'','''') where id=entity;');
  if patched=definition then raise exception 'Expected prescription update was not found'; end if;
  execute patched;
end $migration$;
notify pgrst, 'reload schema';
