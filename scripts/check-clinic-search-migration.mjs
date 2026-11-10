import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const { sql } = localAdmissionDatabase()
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.pets']) assert.equal(sql(`select count(*) from ${table}`), '0', 'Run migration rehearsal alone on the empty synthetic stack')
const migration = readFileSync('supabase/migrations/20261109091730_clinic_global_search.sql', 'utf8')
const suite = readFileSync('supabase/tests/clinic_search.sql', 'utf8').replace(/^begin;\s*/, '').replace(/rollback;\s*$/, '')
for (const layout of ['present', 'absent']) {
  sql(`begin;
    drop function public.search_clinic_records(text,text,integer,jsonb);
    drop function public.clinic_search_record(text,uuid);
    drop function private.search_clinic_records(text,text,integer,jsonb);
    drop function private.clinic_search_record(text,uuid);
    drop function private.search_sync() cascade;
    drop function private.search_truncate() cascade;
    drop function private.search_refresh(text,uuid);
    drop function private.search_project(text,jsonb);
    drop function private.search_href(text,uuid);
    drop function private.search_care_status(text,uuid,text);
    drop table private.clinic_search_documents;
    drop function private.search_normalize(text);
    -- Renaming preserves all unrelated role ownership/ACLs by OID while making
    -- the local-only role name genuinely absent. Everything rolls back.
    grant veterina_rpc to veterina_search;
    ${layout === 'absent' ? 'alter role veterina_rpc rename to veterina_rpc_rehearsal;' : ''}
    ${migration}
    do $$ begin
      if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid
        where m.member='veterina_search'::regrole and r.rolname<>'authenticated') then
        raise exception 'TEST: search still inherits a mutation role';
      end if;
      if not pg_has_role('veterina_search','authenticated','member') then raise exception 'TEST: authenticated RLS persona missing'; end if;
    end $$;
    ${suite}
    rollback;`)
  console.log(`PASS search migration and SQL suite with veterina_rpc ${layout}; legacy membership removed; rolled back`)
}
