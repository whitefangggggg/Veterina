// Rehearse populated rollout and inspect real plans, entirely rolled back.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const { sql } = localAdmissionDatabase()
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.pets']) assert.equal(sql(`select count(*) from ${table}`), '0', 'Run catalog/scale rehearsal alone on an empty synthetic stack')
const actor = randomUUID(), claims = JSON.stringify({ sub: actor, role: 'authenticated' })
const migration = await readFile('supabase/migrations/20261109091730_clinic_global_search.sql', 'utf8')
const result = sql(`begin;
  drop function public.search_clinic_records(text,text,integer,jsonb);
  drop function public.clinic_search_record(text,uuid);
  drop function private.search_clinic_records(text,text,integer,jsonb);
  drop function private.clinic_search_record(text,uuid);
  drop function private.search_sync() cascade;
  drop function private.search_truncate() cascade;
  drop function private.search_refresh(text,uuid);
  drop function private.search_project(text,jsonb);
  drop function private.search_href(text,uuid);
  drop function if exists private.search_care_status(text,uuid,text);
  drop table private.clinic_search_documents;
  drop function private.search_normalize(text);
  insert into auth.users(id,email,email_confirmed_at) values('${actor}','search-scale-${actor}@veterina-test.invalid',now());
  insert into public.profiles(id,full_name,role,is_active) values('${actor}','Search scale owner','owner',true);
  select set_config('request.jwt.claims','${claims}',true);
  do $$ declare o uuid; begin
    o:=(public.portal_mutation('create_owner','{"fullName":"Scale household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
    insert into public.pets(owner_id,name,species,breed,sex,reproductive_status,created_by)
      select o,'Scale patient Needle'||lpad(n::text,5,'0'),'Cat','Mixed','Female','Unknown','${actor}' from generate_series(1,10000) n;
    insert into public.visits(pet_id,visited_at,visit_type,chief_complaint,recorded_by,recording_purpose,attending_veterinarian_name)
      select id,'2024-01-02T03:00:00Z','Medical Concern','Scale historical visit','${actor}','record_only','Historical clinician' from public.pets;
    perform set_config('search.fingerprint',(select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.pets p),true);
  end $$;
  ${migration}
  do $$ begin
    if (select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.pets p)<>current_setting('search.fingerprint') then raise exception 'TEST: migration changed patient rows'; end if;
    if (select count(*) from private.clinic_search_documents)<>20001 then raise exception 'TEST: populated backfill incomplete'; end if;
  end $$;
  analyze private.clinic_search_documents;
  set local role veterina_search;
  do $$ declare plan jsonb; result jsonb; started timestamptz; selective_ms numeric; broad_ms numeric; page2 jsonb; begin
    execute 'explain (analyze,buffers,format json) select entity_id from private.clinic_search_documents where clinic_id=(select private.current_clinic_id()) and search_text like ''%needle04242%''' into plan;
    started:=clock_timestamp(); result:=public.search_clinic_records('needle04242',null,25); selective_ms:=extract(epoch from clock_timestamp()-started)*1000;
    if (result->>'total')::integer<>2 then raise exception 'TEST: large persisted query lost a source'; end if;
    started:=clock_timestamp(); result:=public.search_clinic_records('Scale patient',null,25); broad_ms:=extract(epoch from clock_timestamp()-started)*1000;
    if (result->>'total')::integer<>20000 or jsonb_array_length(result->'records')<>25 or result->'nextCursor'='null' then raise exception 'TEST: large query not paginated'; end if;
    page2:=public.search_clinic_records('Scale patient',null,25,result->'nextCursor');
    if (page2->>'total')::integer<>20000 or jsonb_array_length(page2->'records')<>25 then raise exception 'TEST: large query page totals'; end if;
    perform set_config('search.scale_report',jsonb_build_object('documents',20001,'selectiveMs',selective_ms,'broadMs',broad_ms,'plan',plan,'firstPageBytes',octet_length(result::text),'pageSize',jsonb_array_length(result->'records'))::text,true);
  end $$;
  select current_setting('search.scale_report'); rollback;`).split('\n').at(-1)
const report = JSON.parse(result)
await mkdir('test-artifacts.local', { recursive: true })
await writeFile('test-artifacts.local/global-search-scale.json', JSON.stringify(report, null, 2))
assert.ok(report.selectiveMs < 5000 && report.broadMs < 5000, 'Search exceeded the 5-second local rehearsal budget')
assert.ok(report.firstPageBytes < 30000, 'Bounded page exceeded 30 KB')
assert.ok(JSON.stringify(report.plan).includes('clinic_search_text'), 'Selective search did not use its trigram index')
console.log(`PASS populated search rollout: ${report.documents} documents; selective ${report.selectiveMs.toFixed(0)} ms, broad ${report.broadMs.toFixed(0)} ms, ${report.firstPageBytes} bytes/page. Plan saved in global-search-scale.json; all fixtures rolled back.`)
