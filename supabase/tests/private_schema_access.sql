-- Regression for the signed-in account_access RPC after a schema restore.
-- No application rows are created or changed; the synthetic identity is absent.
begin;

do $$ begin
  if not has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'TEST: authenticated cannot resolve private RPC helpers';
  end if;
  if has_schema_privilege('authenticated', 'private', 'CREATE') then
    raise exception 'TEST: authenticated can create private objects';
  end if;
  if has_table_privilege('authenticated', 'private.platform_admins', 'SELECT') then
    raise exception 'TEST: platform administrator records exposed';
  end if;
  if has_function_privilege('anon', 'private.account_access()', 'EXECUTE') then
    raise exception 'TEST: anonymous account access exposed';
  end if;
  if not has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'TEST: Edge Functions cannot resolve private RPC helpers';
  end if;
  if has_schema_privilege('service_role', 'private', 'CREATE') then
    raise exception 'TEST: Edge Functions can create private objects';
  end if;
  if has_function_privilege('authenticated',
    'private.platform_subscription_admin(uuid,text,jsonb,uuid)', 'EXECUTE') then
    raise exception 'TEST: browser role can call privileged subscription helper';
  end if;
end $$;

select set_config('request.jwt.claims',
  jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$ declare result jsonb; begin
  result := public.account_access();
  if result is null
    or result->'subscription' is distinct from 'null'::jsonb
    or result->'isPlatformAdmin' is distinct from 'false'::jsonb then
    raise exception 'TEST: account access must return an unprovisioned non-admin account';
  end if;
end $$;

reset role;

-- Reaching the explicit administrator check proves schema/function resolution
-- works for Edge Functions without creating accounts or subscription records.
set local role service_role;
do $$ begin
  perform public.platform_subscription_admin(gen_random_uuid(), 'list', '{}', null);
  raise exception 'TEST: non-admin subscription access succeeded';
exception when raise_exception then
  if sqlerrm not like 'FORBIDDEN:%' then raise; end if;
end $$;
reset role;
rollback;
