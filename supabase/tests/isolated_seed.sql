-- Synthetic configuration only. Run exclusively on an empty isolated test stack.
insert into public.clinic_settings(clinic_name, timezone, ai_enabled)
select 'Veterina isolated test clinic','Asia/Manila',false
where not exists(select 1 from public.clinic_settings);
insert into public.service_types(name,default_duration_minutes,workflow) values
('Wellness check',30,'checkup'),('Vaccination',20,'vaccination'),
('Surgery',60,'checkup'),('Grooming',60,'maintenance')
on conflict(name) do nothing;
notify pgrst, 'reload schema';
