-- Preserve self visibility for pending/inactive access checks in the existing
-- staff SELECT policy, avoiding two permissive SELECT policies for every read.
alter policy staff_read on public.profiles using (
  id=(select auth.uid()) or
  ((select private.staff_role()) is not null and clinic_id=(select private.current_clinic_id()))
);
drop policy profile_self_access on public.profiles;
create unique index legacy_clinic_clinic on private.legacy_clinic(clinic_id);
notify pgrst,'reload schema';
