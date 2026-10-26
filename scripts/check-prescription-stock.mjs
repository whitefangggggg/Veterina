// Real concurrent PostgreSQL sessions on an otherwise empty synthetic local stack.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), 'TEST_')
assert.ok(env.TEST_DATABASE_URL, 'Configure the isolated test database in .env.test.local')
const url = new URL(env.TEST_DATABASE_URL)
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Remote database writes are refused')
const args = [url.href, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
const sql = (input) => {
  const result = spawnSync('psql', args, { input, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
assert.equal(sql('select clinic_name from public.clinic_settings limit 1'), 'Veterina isolated test clinic')
for (const table of ['auth.users', 'public.owners', 'public.pets', 'public.profiles', 'public.inventory_items']) {
  assert.equal(sql(`select count(*) from ${table}`), '0', `Refusing concurrency fixtures: ${table} must be empty`)
}
const userId = randomUUID()
const claims = JSON.stringify({ sub: userId, role: 'authenticated' })
let setup = false
const pending = []
function session(input) {
  const child = spawn('psql', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', signal
  const marked = new Promise((resolve) => { signal = resolve })
  const timer = setTimeout(() => child.kill(), 30000)
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('FIRST_DEDUCTED')) signal(true) })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (failure) => { clearTimeout(timer); signal(false); reject(failure) })
    child.on('close', (code) => { clearTimeout(timer); signal(false); resolve({ code, output, error }) })
  })
  child.stdin.end(input)
  pending.push(completed)
  return { completed, marked }
}
try {
  const fixture = JSON.parse(sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${userId}','stock-${userId}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active) values('${userId}','Stock concurrency clinician','clinical_staff',true);
    do $$ declare person uuid; patient uuid; visit uuid; other_visit uuid; item uuid; begin
      perform set_config('request.jwt.claims','${claims}',true);
      person:=(public.portal_mutation('create_owner','{"fullName":"Concurrent owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Concurrent patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      visit:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',patient,'type','Wellness check','complaint','Concurrency check','weightKg',3,'veterinarianId','${userId}'),gen_random_uuid())->>'id')::uuid;
      other_visit:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',patient,'type','Follow-up','complaint','Second check','weightKg',3,'veterinarianId','${userId}'),gen_random_uuid())->>'id')::uuid;
      item:=(public.portal_mutation('create_inventory_item','{"name":"Concurrency stock","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
      perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',(select id from public.inventory_batches where item_id=item),'delta',5,'reason','Supplier delivery'),gen_random_uuid());
      perform set_config('veterina_test.concurrent',jsonb_build_object('visit',visit,'otherVisit',other_visit,'item',item,'batch',(select id from public.inventory_batches where item_id=item))::text,true);
    end $$;
    select current_setting('veterina_test.concurrent');
    commit;`))
  setup = true
  const medication = { medicationId: randomUUID(), medicationName: 'Stock', inventoryItemId: fixture.item, batchId: fixture.batch, dispenseQuantity: 4, route: 'Oral', dose: 'Recorded dose', frequency: 'Recorded frequency' }
  const payload = JSON.stringify({ visitId: fixture.visit, medications: [medication] })
  const key = randomUUID()
  const mutation = (data, idempotencyKey) => `select public.portal_mutation('create_prescription','${data}','${idempotencyKey}');`
  const begin = `begin; set local statement_timeout='10s'; select set_config('request.jwt.claims','${claims}',true); set local role authenticated;`
  const first = session(`${begin}${mutation(payload, key)} select 'FIRST_DEDUCTED'; select pg_sleep(1.5); commit;`)
  assert.ok(await first.marked, 'First transaction did not reach its dispensing lock')
  const secondPayload = JSON.stringify({ visitId: fixture.otherVisit, medications: [{ ...medication, medicationId: randomUUID() }] })
  const second = session(`${begin}${mutation(secondPayload, randomUUID())} commit;`)
  const [one, two] = await Promise.all([first.completed, second.completed])
  assert.equal(one.code, 0, one.error)
  assert.notEqual(two.code, 0, 'Concurrent prescriptions oversold the same batch')
  assert.match(two.error, /INSUFFICIENT_STOCK/)
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${fixture.batch}'`), '1.00')
  const replays = await Promise.all([session(`${begin}${mutation(payload, key)} commit;`).completed, session(`${begin}${mutation(payload, key)} commit;`).completed])
  replays.forEach((result) => assert.equal(result.code, 0, result.error))
  assert.equal(sql('select count(*) from private.prescription_dispenses'), '1')
  assert.equal(sql('select count(*) from public.prescriptions'), '1')
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${fixture.batch}'`), '1.00')
  console.log('PASS real concurrent prescriptions cannot oversell; simultaneous replays retain one prescription, dispensing record and stock deduction')
  const prescriptionId = sql('select id from public.prescriptions')
  const savedMedications = JSON.parse(sql('select medications from public.prescriptions'))
  const finalization = session(`${begin}select public.portal_mutation('finalize_encounter','{"id":"${fixture.visit}"}','${randomUUID()}'); select 'FIRST_DEDUCTED'; select pg_sleep(1.5); commit;`)
  assert.ok(await finalization.marked, 'Finalization did not acquire its encounter lock')
  const edit = JSON.stringify({ id: prescriptionId, medications: [...savedMedications, { ...medication, medicationId: randomUUID(), dispenseQuantity: 1 }] })
  const concurrentEdit = session(`${begin}select public.portal_mutation('update_prescription','${edit}','${randomUUID()}'); commit;`)
  const [finalized, edited] = await Promise.all([finalization.completed, concurrentEdit.completed])
  assert.equal(finalized.code, 0, finalized.error)
  assert.notEqual(edited.code, 0, 'Concurrent edit bypassed encounter finalization')
  assert.match(edited.error, /RECORD_FINALIZED/)
  assert.equal(sql('select count(*) from private.prescription_dispenses'), '1')
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${fixture.batch}'`), '1.00')
  console.log('PASS encounter finalization serializes with prescription edits and cannot deduct stock after finalization')
} finally {
  await Promise.allSettled(pending)
  if (setup) {
    // The guards require a dedicated, otherwise empty local clinic before writes.
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    sql(`delete from auth.users where id='${userId}';`)
    assert.equal(sql('select count(*) from public.inventory_items'), '0')
    console.log('PASS synthetic concurrency fixtures removed')
  }
}
