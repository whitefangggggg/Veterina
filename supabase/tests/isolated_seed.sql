-- Synthetic configuration only. Supports snapshots before/after clinic tenancy.
do $$ declare clinic uuid; begin
  if to_regclass('public.clinics') is null then
    insert into public.clinic_settings(clinic_name,timezone,ai_enabled)
      select 'Veterina isolated test clinic','Asia/Manila',false where not exists(select 1 from public.clinic_settings);
    insert into public.service_types(name,default_duration_minutes,workflow) values
      ('Wellness check',30,'checkup'),('Vaccination',20,'vaccination'),('Surgery',60,'checkup'),('Grooming',60,'maintenance') on conflict(name) do nothing;
  else
    select clinic_id into clinic from public.clinic_settings where clinic_name='Veterina isolated test clinic';
    if clinic is null then
      insert into public.clinics(name) values('Veterina isolated test clinic') returning id into clinic;
      insert into private.legacy_clinic(clinic_id) values(clinic);
      insert into public.clinic_settings(clinic_id,clinic_name,timezone,ai_enabled) values(clinic,'Veterina isolated test clinic','Asia/Manila',false);
      insert into private.clinic_codes(clinic_id) values(clinic);
    end if;
    insert into public.service_types(clinic_id,name,default_duration_minutes,workflow) values
      (clinic,'Wellness check',30,'checkup'),(clinic,'Vaccination',20,'vaccination'),(clinic,'Surgery',60,'checkup'),(clinic,'Grooming',60,'maintenance') on conflict(clinic_id,name) do nothing;
  end if;
end $$;
notify pgrst, 'reload schema';
