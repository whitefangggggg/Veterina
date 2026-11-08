// Rehearse catalog provisioning and populated upgrades inside rolled-back local
// transactions. The baseline must be a reviewed, schema-only catalog snapshot.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const db = localAdmissionDatabase()
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.admissions']) assert.equal(db.sql(`select count(*) from ${table}`), '0', 'Provisioning rehearsal requires an empty synthetic stack')
const flag = process.argv.indexOf('--baseline')
assert.ok(flag >= 0 && process.argv[flag + 1], 'Supply --baseline PATH to a reviewed pre-admission catalog snapshot')
const baseline = await readFile(process.argv[flag + 1], 'utf8')
assert.ok(baseline.includes('create schema if not exists private') && !/create table public\.admissions\s*\(/i.test(baseline), 'Expected a pre-admission application catalog')
const body = baseline.replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '')
const seed = await readFile('supabase/tests/isolated_seed.sql', 'utf8')
const migrations = (await Promise.all(['20261108143221_admission_foundation', '20261108143222_inpatient_care', '20261108143224_admission_history_and_discharge', '20261108152806_admission_foreign_key_indexes'].map((name) => readFile(`supabase/migrations/${name}.sql`, 'utf8')))).join('\n')
const suite = (await readFile('supabase/tests/admissions.sql', 'utf8')).replace(/^begin;\s*/, '').replace(/rollback;\s*$/, '')
const prefix = 'begin; drop schema public cascade; drop schema private cascade; create schema public;\n' + body + '\n' + seed
db.sql(prefix + '\n' + migrations + '\n' + suite + '\nreset role; rollback;')
console.log('PASS clean catalog provisioning plus all admission SQL acceptance cases (rolled back)')

const actor = randomUUID()
const fixture = `
insert into auth.users(id,email,email_confirmed_at) values('${actor}','admission-upgrade-${actor}@veterina-test.invalid',now());
insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values('${actor}','Upgrade clinician','owner',true,true);
select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
do $$ declare owner uuid; pet uuid; visit uuid; item uuid; batch uuid; manual uuid:=gen_random_uuid(); day date; begin
  owner:=(public.portal_mutation('create_owner','{"fullName":"Upgrade household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Upgrade patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
  visit:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',pet,'type','Checkup','complaint','Preserved clinical evidence','weightKg',4,'veterinarianId','${actor}'),gen_random_uuid())->>'id')::uuid;
  item:=(public.portal_mutation('create_inventory_item','{"name":"Upgrade medicine","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
  select id into batch from public.inventory_batches where item_id=item;
  perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',5,'reason','Upgrade stock'),gen_random_uuid());
  perform public.portal_mutation('create_prescription',jsonb_build_object('visitId',visit,'medications',jsonb_build_array(jsonb_build_object('medicationId',gen_random_uuid(),'medicationName','Upgrade medicine','dose','Recorded dose','route','Oral','frequency','Once','inventoryItemId',item,'batchId',batch,'dispenseQuantity',1))),gen_random_uuid());
  select (now() at time zone timezone)::date into day from public.clinic_settings limit 1;
  perform public.portal_mutation('issue_travel_certificate',jsonb_build_object('petId',pet,'issuerId','${actor}','travelDate',day+1,'validUntil',day+5,'destination','Upgrade destination','controlNumber','UPGRADE-ADM',
    'rabiesConfirmed',true,'eligibilityConfirmed',true,'manualRabiesItemId',manual,'manualVaccinations',jsonb_build_array(jsonb_build_object('id',manual,'vaccine','Rabies','lotNumber','UPGRADE-LOT','administeredAt',day-30,'nextDueAt',day+365))),gen_random_uuid());
end $$;
create temp table admission_upgrade_before as select jsonb_build_object(
  'visits',(select jsonb_agg(to_jsonb(x) order by id) from public.visits x),
  'prescriptions',(select jsonb_agg(to_jsonb(x)-'dispensing_mode' order by id) from public.prescriptions x),
  'movements',(select jsonb_agg(to_jsonb(x) order by id) from public.inventory_movements x),
  'dispenses',(select jsonb_agg(to_jsonb(x) order by prescription_id,medication_id) from private.prescription_dispenses x),
  'vaccinations',(select jsonb_agg(to_jsonb(x) order by id) from public.vaccinations x),
  'certificates',(select jsonb_agg(to_jsonb(x) order by id) from public.travel_certificates x)) as fingerprint;
`
const verify = `do $$ declare current_fingerprint jsonb; begin
  select jsonb_build_object(
    'visits',(select jsonb_agg(to_jsonb(x) order by id) from public.visits x),
    'prescriptions',(select jsonb_agg(to_jsonb(x)-'dispensing_mode' order by id) from public.prescriptions x),
    'movements',(select jsonb_agg(to_jsonb(x) order by id) from public.inventory_movements x),
    'dispenses',(select jsonb_agg(to_jsonb(x) order by prescription_id,medication_id) from private.prescription_dispenses x),
    'vaccinations',(select jsonb_agg(to_jsonb(x) order by id) from public.vaccinations x),
    'certificates',(select jsonb_agg(to_jsonb(x) order by id) from public.travel_certificates x)) into current_fingerprint;
  if current_fingerprint is distinct from (select fingerprint from admission_upgrade_before) then raise exception 'TEST: upgrade changed clinical, dispensing or issued evidence'; end if;
  if exists(select 1 from public.prescriptions where dispensing_mode<>'on_save') then raise exception 'TEST: existing outpatient prescription mode changed'; end if;
end $$; rollback;`
db.sql(prefix + '\n' + fixture + '\n' + migrations + '\n' + verify)
console.log('PASS populated upgrade preserves encounters, prescriptions, dispensing ledgers, stock, vaccine history and issued certificate snapshots (rolled back)')
