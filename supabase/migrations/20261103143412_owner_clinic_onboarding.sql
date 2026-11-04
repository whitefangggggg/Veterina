-- Existing clinics keep their current workspace; newly provisioned clinics
-- receive a null completion marker and enter owner setup on first sign-in.
alter table public.clinic_settings
  add column onboarding_completed_at timestamptz default now(),
  add column onboarding_step smallint not null default 0 check (onboarding_step between 0 and 3),
  add column tagline text not null default '' check (length(tagline) <= 160),
  add column website text not null default '' check (length(website) <= 254),
  add column brand_color text not null default '#2a6f62'
    check (brand_color in ('#2a6f62','#305b9a','#72549a','#a04b67','#966128','#426b45')),
  add column business_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(business_hours) = 'object');
alter table public.clinic_settings alter column onboarding_completed_at drop default;

grant create on schema private to veterina_rpc;
create function private.save_clinic_onboarding(p_data jsonb, p_complete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  clinic uuid := private.current_clinic_id();
  result uuid;
  hours jsonb := coalesce(p_data->'businessHours', '{}'::jsonb);
  day record;
  v_name text := btrim(coalesce(p_data->>'clinicName', ''));
  v_address text := btrim(coalesce(p_data->>'address', ''));
  v_phone text := btrim(coalesce(p_data->>'phone', ''));
  v_email text := btrim(coalesce(p_data->>'email', ''));
  v_website text := btrim(coalesce(p_data->>'website', ''));
  step integer;
  reminder_days integer;
begin
  if actor is null or private.staff_role() is distinct from 'owner' then
    raise exception 'FORBIDDEN: active clinic owner required';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
    or length(v_name) not between 1 and 160 or length(v_address) > 500 or length(v_phone) > 60
    or length(v_email) > 254 or length(v_website) > 254 or length(coalesce(p_data->>'tagline', '')) > 160
    or (v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    or (v_website <> '' and v_website !~ '^https?://[^[:space:]]+$')
    or coalesce(p_data->>'brandColor', '') not in ('#2a6f62','#305b9a','#72549a','#a04b67','#966128','#426b45')
    or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_data->>'timezone') then
    raise exception 'VALIDATION_FAILED: check your clinic details, website and timezone';
  end if;
  if p_complete and (v_address = '' or v_phone = '') then
    raise exception 'VALIDATION_FAILED: clinic address and phone are required';
  end if;
  if coalesce(p_data->>'step', '') !~ '^[0-3]$'
    or coalesce(p_data->>'reminderLeadDays', '') !~ '^[0-9]{1,3}$' then
    raise exception 'VALIDATION_FAILED: check the setup step and reminder lead days';
  end if;
  step := (p_data->>'step')::integer;
  reminder_days := (p_data->>'reminderLeadDays')::integer;
  if reminder_days > 365 then raise exception 'VALIDATION_FAILED: reminder lead days must be between 0 and 365'; end if;
  if jsonb_typeof(hours) is distinct from 'object' or octet_length(hours::text) > 2000 then
    raise exception 'VALIDATION_FAILED: check clinic opening hours';
  end if;
  for day in select * from jsonb_each(hours) loop
    if day.key not in ('mon','tue','wed','thu','fri','sat','sun')
      or jsonb_typeof(day.value) is distinct from 'object'
      or jsonb_typeof(day.value->'closed') is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED: check clinic opening hours';
    end if;
    if day.value->>'closed' = 'false' and (
      coalesce(day.value->>'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(day.value->>'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or day.value->>'open' >= day.value->>'close') then
      raise exception 'VALIDATION_FAILED: closing time must be after opening time';
    end if;
  end loop;
  -- Serialize saves for this clinic. The existing helper validates embedded PNG
  -- bytes and dimensions; failure rolls back the entire settings update.
  perform 1 from public.clinic_settings where clinic_id = clinic for update;
  if not found then raise exception 'NOT_FOUND: clinic settings unavailable'; end if;
  if p_data ? 'logoDataUrl' then perform private.save_clinic_logo(p_data->>'logoDataUrl'); end if;
  update public.clinic_settings set clinic_name = v_name,
    address = v_address, phone = v_phone, email = v_email, website = v_website,
    tagline = btrim(coalesce(p_data->>'tagline', '')), brand_color = p_data->>'brandColor',
    timezone = p_data->>'timezone', reminder_lead_days = reminder_days,
    business_hours = hours, onboarding_step = case when p_complete then 3 else step end,
    onboarding_completed_at = case when p_complete then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end
    where clinic_id = clinic returning id into result;
  return jsonb_build_object('id', result, 'completed', p_complete);
end $$;
alter function private.save_clinic_onboarding(jsonb,boolean) owner to veterina_rpc;
revoke all on function private.save_clinic_onboarding(jsonb,boolean) from public, anon;
grant execute on function private.save_clinic_onboarding(jsonb,boolean) to authenticated;
revoke create on schema private from veterina_rpc;

create function public.save_clinic_onboarding(p_data jsonb, p_complete boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_clinic_onboarding(p_data, p_complete);
$$;
revoke all on function public.save_clinic_onboarding(jsonb,boolean) from public, anon;
grant execute on function public.save_clinic_onboarding(jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
