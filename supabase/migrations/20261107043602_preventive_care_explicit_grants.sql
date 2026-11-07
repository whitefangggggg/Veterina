-- Hosted projects can grant new public tables through default privileges.
-- Keep browser access read-only explicitly as well as through the RLS policies.
revoke all on public.preventive_care_records,public.deworming_administrations from public,anon,authenticated;
grant select on public.preventive_care_records,public.deworming_administrations to authenticated;
notify pgrst,'reload schema';
