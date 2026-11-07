-- The server-side workflow and reporting clients use service_role to read
-- grouped care records after a mutation completes. Keep browser roles read-only
-- through RLS while allowing that trusted backend path to resolve the parent.
grant select on table public.preventive_care_records, public.deworming_administrations, private.preventive_dispenses to service_role;

notify pgrst, 'reload schema';
