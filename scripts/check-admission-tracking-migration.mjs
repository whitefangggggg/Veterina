import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const db = localAdmissionDatabase()
const migration = readFileSync('supabase/migrations/20261109083959_admission_public_tracking.sql', 'utf8')
const clinicalMigration = readFileSync('supabase/migrations/20261109103355_admission_tracking_clinical_sections.sql', 'utf8')
const clinicalSuite = readFileSync('supabase/tests/admission_tracking_clinical.sql', 'utf8')
  .replace(/^begin;\s*/, '').replace(/rollback;\s*$/, '')
const suite = readFileSync('supabase/tests/admission_tracking.sql', 'utf8')
  .replace(/^begin;\s*/, '').replace(/rollback;\s*$/, '')
const trackingBranch = `if left(p_action,9)='tracking_' then
    result:=private.tracking_mutation(p_action,p_data); entity:=(result->>'id')::uuid;
  elsif left(p_action,10)='admission_'`

// Rehearse a fresh migration and the full sharing suite for both RPC ownership
// layouts. The helper refuses remote databases and non-synthetic test accounts.
for (const owner of ['veterina_rpc', 'postgres']) {
  assert.match(owner, /^(veterina_rpc|postgres)$/)
  db.sql(`begin;
    drop table public.admission_public_sharing cascade;
    drop table private.admission_tracking_credentials cascade;
    drop table private.admission_tracking_limits cascade;
    drop function private.tracking_mutation(text,jsonb);
    drop function public.lookup_public_admission(text,text);
    drop function if exists public.lookup_public_admission_content(text,text,text,jsonb);
    drop function if exists private.public_admission_clinical_page(public.admissions,text,jsonb);
    do $restore$ declare definition text; begin
      definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
      execute replace(definition,$branch$${trackingBranch}$branch$,$branch$if left(p_action,10)='admission_'$branch$);
    end $restore$;
    grant create on schema private to ${owner};
    alter function private.portal_mutation(text,jsonb,uuid) owner to ${owner};
    ${migration}
    ${clinicalMigration}
    ${suite}
    reset role;
    delete from private.admission_tracking_limits;
    ${clinicalSuite}
    rollback;`)
  console.log(`PASS admission tracking migration and SQL suite with ${owner} dispatcher owner (rolled back)`)
}
