-- Edge Functions call invoker RPC wrappers as service_role. BYPASSRLS does
-- not grant schema lookup permission, which a schema-only restore can omit.
-- Restore the grant originally declared in 003_connected_backend.sql.
grant usage on schema private to service_role;
