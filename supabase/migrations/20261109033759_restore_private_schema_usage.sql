-- Invoker RPC wrappers (including public.account_access) and RLS policies
-- resolve explicitly granted helpers in private as the signed-in caller.
-- Restore the schema lookup permission from 003_connected_backend.sql when
-- provisioning/restoring a database has omitted schema ACLs. Function/table
-- privileges and row-level policies continue to control access independently.
grant usage on schema private to authenticated;
